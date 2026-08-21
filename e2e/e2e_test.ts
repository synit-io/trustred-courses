import { assertEquals, assertMatch } from "@std/assert";

const APP_BASE_URL = Deno.env.get("E2E_APP_BASE_URL") ??
  "http://127.0.0.1:18000";
const MAILPIT_BASE_URL = Deno.env.get("E2E_MAILPIT_BASE_URL") ??
  "http://127.0.0.1:18025";
const SESSION_COOKIE_NAME = Deno.env.get("E2E_SESSION_COOKIE_NAME") ??
  "session";

interface MailpitAddress {
  Address?: string;
}

interface MailpitMessage {
  ID: string;
  To?: MailpitAddress[];
  Text?: string;
  HTML?: string;
}

interface MailpitMessagesResponse {
  messages?: MailpitMessage[];
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Unexpected ${response.status} for ${url}`);
  }
  return await response.json() as T;
}

async function waitFor(
  check: () => Promise<boolean>,
  description: string,
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function extractCookieValue(
  setCookieHeader: string | null,
  name: string,
): string {
  if (!setCookieHeader) {
    throw new Error(`Missing set-cookie header for ${name}.`);
  }
  const match = setCookieHeader.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]+)`));
  if (!match) {
    throw new Error(`Could not extract cookie ${name} from set-cookie header.`);
  }
  return match[1];
}

async function findLatestMessage(recipient: string): Promise<MailpitMessage> {
  let result: MailpitMessage | null = null;
  await waitFor(async () => {
    const messages = await fetchJson<MailpitMessagesResponse>(
      `${MAILPIT_BASE_URL}/api/v1/search?query=${
        encodeURIComponent(recipient)
      }`,
    );
    const candidate = (messages.messages ?? []).find((message) =>
      message.To?.some((entry) => entry.Address === recipient)
    );
    if (!candidate) {
      result = null;
      return false;
    }
    result = await fetchJson<MailpitMessage>(
      `${MAILPIT_BASE_URL}/api/v1/message/${candidate.ID}`,
    );
    return Boolean(result.Text || result.HTML);
  }, `email for ${recipient}`);
  return result!;
}

function extractVerificationUrl(message: MailpitMessage): string {
  const source = `${message.Text ?? ""}\n${message.HTML ?? ""}`;
  const url = source.match(/https?:\/\/[^\s"'<>)]+/)?.[0];
  if (!url) {
    throw new Error("Could not find magic link URL in SMTP message.");
  }
  return url;
}

Deno.test("e2e magic-link auth sends email via Mailpit and grants admin session", async () => {
  const requestBody = new URLSearchParams({
    email: "admin@example.org",
    redirectTo: "/admin/dashboard",
  });

  const requestResponse = await fetch(
    `${APP_BASE_URL}/api/auth/magic-link/request`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": "198.51.100.24",
        "user-agent": "trustred-e2e/1.0",
      },
      body: requestBody.toString(),
      redirect: "manual",
    },
  );

  assertEquals(requestResponse.status, 303);
  assertMatch(
    requestResponse.headers.get("location") ?? "",
    /\/admin\/login\?sent=1/,
  );

  const bindingCookie = extractCookieValue(
    requestResponse.headers.get("set-cookie"),
    "ml_bind",
  );
  await requestResponse.text();

  const message = await findLatestMessage("admin@example.org");
  const verificationUrl = extractVerificationUrl(message);

  const verifyResponse = await fetch(verificationUrl, {
    headers: {
      cookie: bindingCookie,
      "x-forwarded-for": "198.51.100.24",
      "user-agent": "trustred-e2e/1.0",
    },
    redirect: "manual",
  });

  assertEquals(verifyResponse.status, 303);
  assertEquals(verifyResponse.headers.get("location"), "/admin/dashboard");

  const sessionCookie = extractCookieValue(
    verifyResponse.headers.get("set-cookie"),
    SESSION_COOKIE_NAME,
  );
  await verifyResponse.text();

  const dashboardResponse = await fetch(`${APP_BASE_URL}/admin/dashboard`, {
    headers: {
      cookie: sessionCookie,
    },
    redirect: "manual",
  });

  assertEquals(dashboardResponse.status, 200);
  const html = await dashboardResponse.text();
  assertMatch(html, /Dashboard|Registrierungen|Kurse/);
});
