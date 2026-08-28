import { buildMagicLinkBindingSetCookie } from "@/lib/auth/cookies.ts";
import { issueMagicLink } from "@/lib/auth/service.ts";
import { env } from "@/lib/env.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { extractRequestIp, maskEmail } from "@/src/routes/shared/helpers.ts";
import { enforceRateLimit } from "@/lib/security/rate_limit.ts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

export const magicLinkRequestRoute = new Hono<AppEnv>();
magicLinkRequestRoute.use(
  "/",
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => c.redirect("/admin/login?sent=1", 303),
  }),
);
magicLinkRequestRoute.post("/", async (c) => {
  const trace = extractRequestTraceContext(c.req.raw.headers);
  const form = await c.req.formData();
  const email = form.get("email");
  const redirectTo = form.get("redirectTo");
  const bindingSecret = crypto.randomUUID();
  const maxAgeSeconds = env.magicLinkTtlMinutes * 60;
  c.header(
    "Set-Cookie",
    buildMagicLinkBindingSetCookie(bindingSecret, maxAgeSeconds),
  );
  if (
    typeof email === "string" && email.trim() !== "" &&
    email.trim().length <= 254
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const requestIp = extractRequestIp(c.req.raw.headers);
    const emailLimit = await enforceRateLimit(
      "magic_link:email",
      normalizedEmail,
      3,
      15 * 60 * 1000,
    );
    const ipLimit = requestIp
      ? await enforceRateLimit(
        "magic_link:ip",
        requestIp,
        10,
        15 * 60 * 1000,
      )
      : { allowed: true, retryAfterSeconds: 0 };
    if (!emailLimit.allowed || !ipLimit.allowed) {
      logger.warn("auth.magic_link.rate_limited", {
        ...trace,
        email: maskEmail(normalizedEmail),
      });
      return c.redirect("/admin/login?sent=1", 303);
    }
    logger.info("auth.magic_link.requested", {
      ...trace,
      email: maskEmail(normalizedEmail),
    });
    const result = await issueMagicLink(
      email,
      typeof redirectTo === "string" ? redirectTo : undefined,
      {
        requestIp,
        userAgent: c.req.raw.headers.get("user-agent"),
        bindingSecret,
      },
    );
    logger.info("auth.magic_link.issued", {
      ...trace,
      email: maskEmail(normalizedEmail),
      sent: result.sent,
      hasDebugUrl: Boolean(result.debugUrl),
    });
    if (result.debugUrl) {
      return c.redirect(
        `/admin/login?sent=1&debug=${encodeURIComponent(result.debugUrl)}`,
        303,
      );
    }
  }
  logger.warn("auth.magic_link.requested_without_email", { ...trace });
  return c.redirect("/admin/login?sent=1", 303);
});
