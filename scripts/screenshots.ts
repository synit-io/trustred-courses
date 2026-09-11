/**
 * Captures screenshots of every screen for the repository preview and social
 * media. Drives a headless Chromium against a running instance.
 *
 * Prerequisites: a running app in DEMO_MODE (auto-seeded demo data, login
 * links shown on the page). Example:
 *
 *   KV_PATH=/tmp/shots.kv DEMO_MODE=true APP_NAME="TrustRed Courses" \
 *     deno run -A --unstable-kv --unstable-cron entrypoints/local.ts
 *   deno task screenshots --base-url=http://localhost:8000
 *
 * Browser: uses SCREENSHOT_BROWSER, else a cached Playwright Chromium, else
 * lets @astral/astral download Chromium into its cache.
 *
 * Output: screenshots/*.png plus screenshots/README.md (index with captions).
 */
import { launch, type Page } from "jsr:@astral/astral@0.5.6";
import { DEMO_ADMIN_ACCOUNT } from "../lib/demo/accounts.ts";

interface Shot {
  file: string;
  title: string;
  description: string;
  viewport: "desktop" | "mobile";
  /** Capture the whole document instead of the first viewport. */
  fullPage?: boolean;
  /** Needs an admin session. */
  admin?: boolean;
  /** Resolves the URL to open (may click through pages first). */
  url: (ctx: ShotContext) => Promise<string> | string;
}

interface ShotContext {
  baseUrl: string;
  page: Page;
  keepDemoBanner: boolean;
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MAX_FULL_PAGE_HEIGHT = 2600;

function parseArgs(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    out[key] = rest.length > 0 ? rest.join("=") : true;
  }
  return out;
}

async function findBrowserPath(): Promise<string | undefined> {
  const configured = Deno.env.get("SCREENSHOT_BROWSER");
  if (configured) return configured;
  const home = Deno.env.get("HOME") ?? "";
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const playwrightCache = `${home}/Library/Caches/ms-playwright`;
  try {
    const versions: string[] = [];
    for await (const entry of Deno.readDir(playwrightCache)) {
      if (entry.isDirectory && /^chromium-\d+$/.test(entry.name)) {
        versions.push(entry.name);
      }
    }
    versions.sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
    for (const version of versions) {
      for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
        candidates.push(
          `${playwrightCache}/${version}/${arch}/Chromium.app/Contents/MacOS/Chromium`,
        );
      }
    }
  } catch {
    // no playwright cache
  }
  for (const candidate of candidates) {
    try {
      const info = await Deno.stat(candidate);
      if (info.isFile) return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

async function setViewport(
  page: Page,
  size: { width: number; height: number },
  mobile: boolean,
): Promise<void> {
  const celestial = page.unsafelyGetCelestialBindings();
  await celestial.Emulation.setDeviceMetricsOverride({
    width: size.width,
    height: size.height,
    deviceScaleFactor: 2,
    mobile,
  });
}

async function settle(page: Page, keepDemoBanner: boolean): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    globalThis.scrollTo(0, 0);
  });
  if (!keepDemoBanner) {
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = ".notice-bar,.site-nav-note{display:none!important}";
      document.head.appendChild(style);
    });
  }
  await page.waitForTimeout(250);
}

async function capture(
  page: Page,
  shot: Shot,
  keepDemoBanner: boolean,
): Promise<Uint8Array> {
  const size = shot.viewport === "mobile" ? MOBILE : DESKTOP;
  await setViewport(page, size, shot.viewport === "mobile");
  await settle(page, keepDemoBanner);
  if (shot.fullPage) {
    const height = await page.evaluate(() =>
      Math.ceil(document.documentElement.scrollHeight)
    );
    await setViewport(
      page,
      { width: size.width, height: Math.min(height, MAX_FULL_PAGE_HEIGHT) },
      shot.viewport === "mobile",
    );
    await page.waitForTimeout(150);
  }
  return await page.screenshot({ format: "png" });
}

async function loginAsDemoAdmin(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/admin/login`, { waitUntil: "networkidle2" });
  const alreadyIn = await page.evaluate(() =>
    Boolean(document.querySelector('form[action="/api/auth/logout"]'))
  );
  if (alreadyIn) return;
  await page.evaluate((email: string) => {
    const input = document.querySelector<HTMLInputElement>("#email");
    if (!input) throw new Error("Login form not found");
    input.value = email;
    input.form?.submit();
  }, { args: [DEMO_ADMIN_ACCOUNT.email] });
  await page.waitForNavigation({ waitUntil: "networkidle2" });
  const link = await page.evaluate(() => {
    const anchor = [...document.querySelectorAll("a")].find((a) =>
      /Jetzt einloggen/.test(a.textContent ?? "")
    );
    return anchor?.href ?? null;
  });
  if (!link) {
    throw new Error(
      "No login link on page. Is the app running with DEMO_MODE=true?",
    );
  }
  await page.goto(link, { waitUntil: "networkidle2" });
}

async function firstHrefMatching(
  page: Page,
  baseUrl: string,
  pageUrl: string,
  predicate: string,
): Promise<string> {
  await page.goto(`${baseUrl}${pageUrl}`, { waitUntil: "networkidle2" });
  const href = await page.evaluate((source: string) => {
    const test = new Function("a", `return (${source})(a)`) as (
      a: HTMLAnchorElement,
    ) => boolean;
    const anchor = [...document.querySelectorAll("a")].find(test);
    return anchor?.href ?? null;
  }, { args: [predicate] });
  if (!href) throw new Error(`No link matched on ${pageUrl}: ${predicate}`);
  return href;
}

const SHOTS: Shot[] = [
  {
    file: "01-home.png",
    title: "Startseite",
    description:
      "Public landing page with hero, key figures and the current course offer. Uppercase display type, brand red and card layout shared with TrustRed CMS.",
    viewport: "desktop",
    url: ({ baseUrl }) => `${baseUrl}/`,
  },
  {
    file: "02-home-course-cards.png",
    title: "Kursangebot",
    description:
      "Full course overview: price and status pills, date and location, capacity, waiting-list and sold-out states, direct registration buttons.",
    viewport: "desktop",
    fullPage: true,
    url: ({ baseUrl }) => `${baseUrl}/`,
  },
  {
    file: "03-course-detail.png",
    title: "Kursdetails und Anmeldung",
    description:
      "Course detail page with facts, three-step explanation and the public registration form with required-field markers and consent checkbox.",
    viewport: "desktop",
    fullPage: true,
    url: ({ page, baseUrl }) =>
      firstHrefMatching(
        page,
        baseUrl,
        "/",
        "a => /Jetzt anmelden/.test(a.textContent)",
      ),
  },
  {
    file: "04-course-waitlist.png",
    title: "Ausgebuchter Kurs mit Warteliste",
    description:
      "Sold-out course: the page switches to waiting-list mode with clear status badges and an adjusted call to action.",
    viewport: "desktop",
    url: ({ page, baseUrl }) =>
      firstHrefMatching(
        page,
        baseUrl,
        "/",
        "a => /Zur Warteliste/.test(a.textContent)",
      ),
  },
  {
    file: "05-registration-confirmed.png",
    title: "Anmeldung bestätigt",
    description:
      "After double opt-in the participant sees the confirmation and current status; the admin team is notified.",
    viewport: "desktop",
    url: async ({ page, baseUrl }) => {
      const courseUrl = await firstHrefMatching(
        page,
        baseUrl,
        "/",
        "a => /Jetzt anmelden/.test(a.textContent)",
      );
      await page.goto(courseUrl, { waitUntil: "networkidle2" });
      await page.evaluate(() => {
        const form = document.querySelector<HTMLFormElement>(
          'form[action="/api/registrations/create"]',
        );
        if (!form) throw new Error("registration form missing");
        const values: Record<string, string> = {
          firstName: "Lena",
          lastName: "Hoffmann",
          street: "Lindenallee",
          houseNumber: "7",
          postalCode: "66869",
          city: "Kusel",
          email: `lena.hoffmann.${Date.now()}@example.org`,
          phone: "+49 170 1234567",
        };
        for (const [key, value] of Object.entries(values)) {
          const input = form.querySelector<HTMLInputElement>(`#${key}`);
          if (input) input.value = value;
        }
        const consent = form.querySelector<HTMLInputElement>(
          "#consentAccepted",
        );
        if (consent) consent.checked = true;
        form.submit();
      });
      await page.waitForNavigation({ waitUntil: "networkidle2" });
      const confirmLink = await page.evaluate(() => {
        const anchor = [...document.querySelectorAll("a")].find((a) =>
          /Bestätigung direkt öffnen|Dev-Link zur Bestätigung/.test(
            a.textContent ?? "",
          )
        );
        return anchor?.href ?? null;
      });
      if (!confirmLink) throw new Error("confirmation link not exposed");
      return confirmLink;
    },
  },
  {
    file: "06-login.png",
    title: "Admin-Login",
    description:
      "Passwordless login for the team: a one-time magic link is sent by e-mail, no passwords to manage.",
    viewport: "desktop",
    url: ({ baseUrl }) => `${baseUrl}/admin/login`,
  },
  {
    file: "07-mobile-home.png",
    title: "Startseite (Mobil)",
    description:
      "Mobile layout of the landing page with stacked hero, key figures and course cards.",
    viewport: "mobile",
    fullPage: true,
    url: ({ baseUrl }) => `${baseUrl}/`,
  },
  {
    file: "08-mobile-course.png",
    title: "Anmeldung (Mobil)",
    description:
      "Mobile registration form with large touch targets and single-column facts.",
    viewport: "mobile",
    fullPage: true,
    url: ({ page, baseUrl }) =>
      firstHrefMatching(
        page,
        baseUrl,
        "/",
        "a => /Jetzt anmelden/.test(a.textContent)",
      ),
  },
  {
    file: "10-admin-dashboard.png",
    title: "Administration",
    description:
      "Dashboard with registration statistics, course creation form, filters, CSV export and the registration table.",
    viewport: "desktop",
    fullPage: true,
    admin: true,
    url: ({ baseUrl }) => `${baseUrl}/admin/dashboard`,
  },
  {
    file: "11-admin-courses.png",
    title: "Kursverwaltung",
    description:
      "All courses with status, registration window, capacity figures and quick access to details.",
    viewport: "desktop",
    fullPage: true,
    admin: true,
    url: ({ baseUrl }) => `${baseUrl}/admin/courses`,
  },
  {
    file: "12-admin-course-detail.png",
    title: "Kurs bearbeiten und Teilnehmer",
    description:
      "Course editing (dates, capacity, fee, waiting list, reminders), revenue figures and the participant table with payment status.",
    viewport: "desktop",
    fullPage: true,
    admin: true,
    url: ({ page, baseUrl }) =>
      firstHrefMatching(
        page,
        baseUrl,
        "/admin/courses",
        "a => /Details und Bearbeitung/.test(a.textContent)",
      ),
  },
  {
    file: "13-admin-registration.png",
    title: "Anmeldung bearbeiten",
    description:
      "Registration detail: participant data, status actions with message to the participant and internal note, e-mail resend, full timeline of status changes and e-mails.",
    viewport: "desktop",
    fullPage: true,
    admin: true,
    url: ({ page, baseUrl }) =>
      firstHrefMatching(
        page,
        baseUrl,
        "/admin/dashboard?status=approved",
        "a => /^Öffnen$/.test(a.textContent.trim())",
      ),
  },
  {
    file: "14-admin-users.png",
    title: "Benutzerverwaltung",
    description:
      "Team accounts with roles (viewer, editor, approver, administrator) managed by e-mail address.",
    viewport: "desktop",
    admin: true,
    url: ({ baseUrl }) => `${baseUrl}/admin/users`,
  },
  {
    file: "15-legal.png",
    title: "Impressum und Datenschutz",
    description:
      "Legal pages are generated from configuration (organisation, representative, contact).",
    viewport: "desktop",
    url: ({ baseUrl }) => `${baseUrl}/impressum`,
  },
  {
    file: "16-not-found.png",
    title: "Fehlerseite",
    description: "Friendly 404 page in the same design language.",
    viewport: "desktop",
    url: ({ baseUrl }) => `${baseUrl}/diese-seite-gibt-es-nicht`,
  },
];

function renderIndex(shots: Shot[]): string {
  const lines = [
    "# Screenshots",
    "",
    "Preview of every screen of TrustRed Courses, captured from a demo instance",
    "(`DEMO_MODE=true`, generated sample data). Suitable for the README and social",
    "media. Regenerate with `deno task screenshots` (see `scripts/screenshots.ts`).",
    "",
    "| Screen | Description |",
    "| --- | --- |",
  ];
  for (const shot of shots) {
    lines.push(
      `| [${shot.title}](./${shot.file})<br><img src="./${shot.file}" alt="${shot.title}" width="320"> | ${shot.description} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const baseUrl =
    (typeof args["base-url"] === "string"
      ? args["base-url"]
      : Deno.env.get("SCREENSHOT_BASE_URL") ?? "http://localhost:8000")
      .replace(/\/$/, "");
  const outDir = typeof args.out === "string" ? args.out : "screenshots";
  const keepDemoBanner = args["keep-demo-banner"] === true;
  const only = typeof args.only === "string" ? args.only.split(",") : null;

  const health = await fetch(`${baseUrl}/api/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`App not reachable at ${baseUrl}. Start it first.`);
  }
  await health.body?.cancel();

  await Deno.mkdir(outDir, { recursive: true });
  const path = await findBrowserPath();
  console.log(`Browser: ${path ?? "astral default (may download Chromium)"}`);
  const browser = await launch({
    headless: true,
    path,
    args: ["--hide-scrollbars", "--lang=de-DE"],
  });

  try {
    const page = await browser.newPage();
    let loggedIn = false;
    const selected = SHOTS.filter((shot) =>
      !only || only.some((needle) => shot.file.includes(needle))
    );
    for (const shot of selected) {
      if (shot.admin && !loggedIn) {
        await loginAsDemoAdmin(page, baseUrl);
        loggedIn = true;
      }
      await setViewport(
        page,
        shot.viewport === "mobile" ? MOBILE : DESKTOP,
        shot.viewport === "mobile",
      );
      const url = await shot.url({ baseUrl, page, keepDemoBanner });
      await page.goto(url, { waitUntil: "networkidle2" });
      const png = await capture(page, shot, keepDemoBanner);
      await Deno.writeFile(`${outDir}/${shot.file}`, png);
      console.log(`✓ ${shot.file}  (${url.replace(baseUrl, "")})`);
    }
    if (!only) {
      await Deno.writeTextFile(`${outDir}/README.md`, renderIndex(SHOTS));
      await new Deno.Command(Deno.execPath(), {
        args: ["fmt", `${outDir}/README.md`],
        stdout: "null",
        stderr: "null",
      }).output();
      console.log(`✓ ${outDir}/README.md`);
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`Screenshots failed: ${(error as Error).message}`);
    Deno.exit(1);
  }
}
