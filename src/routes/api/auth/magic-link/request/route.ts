import { buildMagicLinkBindingSetCookie } from "@/lib/auth/cookies.ts";
import { issueMagicLink } from "@/lib/auth/service.ts";
import { env } from "@/lib/env.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { extractRequestIp, maskEmail } from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

export const magicLinkRequestRoute = new Hono<AppEnv>().post("/", async (c) => {
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
  if (typeof email === "string" && email.trim() !== "") {
    const normalizedEmail = email.trim().toLowerCase();
    logger.info("auth.magic_link.requested", {
      ...trace,
      email: maskEmail(normalizedEmail),
    });
    const result = await issueMagicLink(
      email,
      typeof redirectTo === "string" ? redirectTo : undefined,
      {
        requestIp: extractRequestIp(c.req.raw.headers),
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
