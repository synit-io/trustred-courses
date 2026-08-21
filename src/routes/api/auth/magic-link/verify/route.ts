import {
  buildMagicLinkBindingClearCookie,
  buildSessionSetCookie,
  getCookie,
} from "@/lib/auth/cookies.ts";
import { verifyMagicLinkToken } from "@/lib/auth/service.ts";
import { env } from "@/lib/env.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { extractRequestIp } from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

export const magicLinkVerifyRoute = new Hono<AppEnv>().get("/", async (c) => {
  const trace = extractRequestTraceContext(c.req.raw.headers);
  const token = c.req.query("token") ?? "";
  const verified = await verifyMagicLinkToken(token, {
    requestIp: extractRequestIp(c.req.raw.headers),
    userAgent: c.req.raw.headers.get("user-agent"),
    bindingSecret: getCookie(
      c.req.raw.headers,
      env.authMagicLinkBindingCookieName,
    ),
  });
  if (!verified) {
    logger.warn("auth.magic_link.verify_failed", {
      ...trace,
      hasToken: token.length > 0,
    });
    c.header("Set-Cookie", buildMagicLinkBindingClearCookie());
    return c.redirect("/admin/login?error=1", 303);
  }
  logger.info("auth.magic_link.verified", {
    ...trace,
    userId: verified.user.id,
    role: verified.user.role,
  });
  c.header("Set-Cookie", buildMagicLinkBindingClearCookie());
  c.header("Set-Cookie", buildSessionSetCookie(verified.sessionId), {
    append: true,
  });
  return c.redirect(verified.redirectTo || "/admin/dashboard", 303);
});
