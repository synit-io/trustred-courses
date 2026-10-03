import {
  buildMagicLinkBindingClearCookie,
  buildMagicLinkVerifyHeaders,
  buildSessionSetCookie,
  getCookie,
} from "@/lib/auth/cookies.ts";
import {
  sessionCookieMaxAgeSeconds,
  verifyMagicLinkToken,
} from "@/lib/auth/service.ts";
import { env } from "@/lib/env.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { resolveAuthClientIp } from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

function verifyRedirect(
  location: string,
  cookies: readonly string[],
): Response {
  return new Response(null, {
    status: 303,
    headers: buildMagicLinkVerifyHeaders(location, cookies),
  });
}

export const magicLinkVerifyRoute = new Hono<AppEnv>().get("/", async (c) => {
  const trace = extractRequestTraceContext(c.req.raw.headers);
  const token = c.req.query("token") ?? "";
  const requestIp = resolveAuthClientIp(c);
  const verified = await verifyMagicLinkToken(token, {
    requestIp,
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
      hasRequestIp: Boolean(requestIp),
    });
    return verifyRedirect("/admin/login?error=1", [
      buildMagicLinkBindingClearCookie(),
    ]);
  }
  logger.info("auth.magic_link.verified", {
    ...trace,
    userId: verified.user.id,
    role: verified.user.role,
  });
  return verifyRedirect(verified.redirectTo || "/admin/dashboard", [
    buildMagicLinkBindingClearCookie(),
    buildSessionSetCookie(
      verified.sessionId,
      await sessionCookieMaxAgeSeconds(),
    ),
  ]);
});
