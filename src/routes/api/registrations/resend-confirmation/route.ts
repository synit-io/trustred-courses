import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "@/src/app/context.ts";
import { isDebugLinkExposureEnabled } from "@/lib/env.ts";
import { logger } from "@/lib/observability/logger.ts";
import { parseMailbox } from "@/lib/email/mailbox.ts";
import { enforceRateLimit } from "@/lib/security/rate_limit.ts";
import { reissueRegistrationDoubleOptIn } from "@/lib/registrations/service.ts";
import { resolveClientIp } from "@/src/routes/shared/helpers.ts";

export const registrationResendConfirmationRoute = new Hono<AppEnv>();
registrationResendConfirmationRoute.use("/", bodyLimit({ maxSize: 4096 }));
registrationResendConfirmationRoute.post("/", async (c) => {
  const form = await c.req.formData();
  const courseId = String(form.get("courseId") ?? "").trim();
  const email = parseMailbox(String(form.get("email") ?? ""));
  if (!courseId || courseId.length > 100) {
    return c.text("Ungültige Anfrage", 400);
  }
  const recipientLimit = await enforceRateLimit(
    "registration:resend:email",
    `${courseId}:${email ?? "invalid"}`,
    5,
    60 * 60 * 1000,
  );
  const ip = resolveClientIp(c);
  const ipLimit = ip
    ? await enforceRateLimit("registration:resend:ip", ip, 20, 10 * 60 * 1000)
    : { allowed: true, retryAfterSeconds: 0 };
  let urls: string[] = [];
  if (ip && email && recipientLimit.allowed && ipLimit.allowed) {
    try {
      urls = await reissueRegistrationDoubleOptIn(courseId, email);
    } catch (error) {
      logger.error("registration.double_opt_in_reissue_failed", {
        courseId,
        error,
      });
    }
  }
  const debug = isDebugLinkExposureEnabled() && urls[0]
    ? `&confirm_debug=${encodeURIComponent(urls[0])}`
    : "";
  return c.redirect(
    `/courses/${encodeURIComponent(courseId)}?doi_resent=1${debug}`,
    303,
  );
});
