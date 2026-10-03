import { assert, assertEquals } from "@std/assert";
import { Hono } from "hono";
import {
  __resetAuthForTests,
  sessionCookieMaxAgeSeconds,
} from "../lib/auth/service.ts";
import { env } from "../lib/env.ts";
import { createUserFromEmail } from "../lib/users/repository.ts";
import type { AppEnv } from "../src/app/context.ts";
import { registerGlobalMiddleware } from "../src/app/middleware.tsx";
import { magicLinkRequestRoute } from "../src/routes/api/auth/magic-link/request/route.ts";
import { magicLinkVerifyRoute } from "../src/routes/api/auth/magic-link/verify/route.ts";
import { setupKvTest } from "./test_utils.ts";

Deno.test("magic-link http flow requires origin, connection ip, and no-referrer verify", async () => {
  const ctx = await setupKvTest("auth_magic_link_http_");
  const previousAppBaseUrl = env.appBaseUrl;
  const previousAuthDevExposeMagicLink = env.authDevExposeMagicLink;
  const previousTrustedClientIpHeader = env.trustedClientIpHeader;

  try {
    env.appBaseUrl = "http://localhost:8000";
    env.authDevExposeMagicLink = true;
    env.trustedClientIpHeader = "";
    __resetAuthForTests();

    const user = await createUserFromEmail("admin@example.org", "admin");
    const app = new Hono<AppEnv>();
    registerGlobalMiddleware(app);
    app.route("/api/auth/magic-link/request", magicLinkRequestRoute);
    app.route("/api/auth/magic-link/verify", magicLinkVerifyRoute);

    const origin = "http://localhost:8000";
    const body = new URLSearchParams({
      email: user.email,
      redirectTo: "/admin/dashboard",
    });
    const denied = await app.request(`${origin}/api/auth/magic-link/request`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    assertEquals(denied.status, 403);

    const connection = {
      remoteAddr: {
        hostname: "203.0.113.50",
        port: 443,
        transport: "tcp" as const,
      },
    };
    const issued = await app.request(
      `${origin}/api/auth/magic-link/request`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin,
          "user-agent": "Mozilla/5.0",
        },
        body: body.toString(),
      },
      connection,
    );
    assertEquals(issued.status, 303);
    const issuedLocation = issued.headers.get("location") ?? "";
    const debugUrl = new URL(issuedLocation, origin).searchParams.get("debug");
    assert(debugUrl);
    const token = new URL(debugUrl).searchParams.get("token");
    assert(token);
    const bindingCookie =
      (issued.headers.get("set-cookie") ?? "").split(";")[0];
    assert(bindingCookie.startsWith(`${env.authMagicLinkBindingCookieName}=`));

    const verified = await app.request(
      `${origin}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
      {
        headers: {
          cookie: bindingCookie,
          "user-agent": "Mozilla/5.0",
        },
      },
      connection,
    );
    assertEquals(verified.status, 303);
    assertEquals(verified.headers.get("location"), "/admin/dashboard");
    assertEquals(verified.headers.get("referrer-policy"), "no-referrer");
    assertEquals(verified.headers.get("cache-control"), "no-store");

    const sessionCookie = verified.headers.getSetCookie().find((value) =>
      value.startsWith(`${env.authCookieName}=`)
    );
    assert(sessionCookie);
    const maxAgeSeconds = await sessionCookieMaxAgeSeconds();
    assertEquals(
      maxAgeSeconds,
      Math.min(env.sessionIdleTtlDays, env.sessionAbsoluteTtlDays) * 24 * 60 *
        60,
    );
    assert(sessionCookie.includes(`Max-Age=${maxAgeSeconds}`));
    await verified.text();
    await issued.text();
    await denied.text();
  } finally {
    env.appBaseUrl = previousAppBaseUrl;
    env.authDevExposeMagicLink = previousAuthDevExposeMagicLink;
    env.trustedClientIpHeader = previousTrustedClientIpHeader;
    __resetAuthForTests();
    await ctx.cleanup();
  }
});
