import { assert, assertEquals } from "@std/assert";
import { env } from "../lib/env.ts";
import {
  __resetAuthForTests,
  getSession,
  issueMagicLink,
  verifyMagicLinkToken,
} from "../lib/auth/service.ts";
import { createUserFromEmail } from "../lib/users/repository.ts";
import { setupKvTest } from "./test_utils.ts";

Deno.test("magic-link flow issues debug link, verifies session, and loads it", async () => {
  const ctx = await setupKvTest("auth_magic_link_flow_");
  const previousAppBaseUrl = env.appBaseUrl;
  const previousAuthDevExposeMagicLink = env.authDevExposeMagicLink;

  try {
    env.appBaseUrl = "http://localhost:8000";
    env.authDevExposeMagicLink = true;
    __resetAuthForTests();
    const user = await createUserFromEmail("admin@example.org", "admin");
    const bindingSecret = crypto.randomUUID();
    const issued = await issueMagicLink(
      user.email,
      "/admin/dashboard",
      {
        requestIp: "203.0.113.10",
        userAgent: "Mozilla/5.0",
        bindingSecret,
      },
    );

    assertEquals(issued.sent, false);
    assert(issued.debugUrl);

    const token = new URL(issued.debugUrl).searchParams.get("token");
    assert(token);

    const verified = await verifyMagicLinkToken(token, {
      requestIp: "203.0.113.10",
      userAgent: "Mozilla/5.0",
      bindingSecret,
    });

    assert(verified);
    assertEquals(verified.user.id, user.id);
    assertEquals(verified.redirectTo, "/admin/dashboard");

    const session = await getSession(verified.sessionId);
    assert(session);
    assertEquals(session.userId, user.id);
    assertEquals(session.role, "admin");
  } finally {
    env.appBaseUrl = previousAppBaseUrl;
    env.authDevExposeMagicLink = previousAuthDevExposeMagicLink;
    __resetAuthForTests();
    await ctx.cleanup();
  }
});

Deno.test("failed auth attempts are rate limited per IP", async () => {
  const ctx = await setupKvTest("auth_magic_link_rate_limit_");

  try {
    __resetAuthForTests();
    const validUser = await createUserFromEmail("admin@example.org", "admin");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await issueMagicLink(
        `missing-${attempt}@example.org`,
        "/admin/dashboard",
        {
          requestIp: "198.51.100.20",
          userAgent: "Mozilla/5.0",
          bindingSecret: crypto.randomUUID(),
        },
      );
      assertEquals(result.sent, false);
      assertEquals(result.debugUrl, undefined);
    }

    const blocked = await issueMagicLink(
      validUser.email,
      "/admin/dashboard",
      {
        requestIp: "198.51.100.20",
        userAgent: "Mozilla/5.0",
        bindingSecret: crypto.randomUUID(),
      },
    );

    assertEquals(blocked.sent, false);
    assertEquals(blocked.debugUrl, undefined);
  } finally {
    __resetAuthForTests();
    await ctx.cleanup();
  }
});
