import { isDebugLinkExposureEnabled } from "@/lib/env.ts";
import { getPendingPaidRegistration } from "@/lib/payments/paypal.ts";
import { enforcePayPalRateLimit } from "@/lib/payments/rate_limit.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import { reconcilePendingPaidRegistration } from "@/lib/payments/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { resolveClientIp } from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

export const registrationPayPalReturnRoute = new Hono<AppEnv>().get(
  "/return",
  async (c) => {
    const trace = extractRequestTraceContext(c.req.raw.headers);
    const state = (c.req.query("state") ?? "").trim();
    const orderId = (c.req.query("token") ?? "").trim();
    if (!state || !orderId) {
      return c.redirect("/?course_error=Ungültige+PayPal+Rückgabe", 303);
    }
    const requestIp = resolveClientIp(c);
    if (!requestIp) {
      return c.redirect("/?course_error=Anfrageadresse+nicht+verfügbar", 303);
    }
    const rateLimit = await enforcePayPalRateLimit(
      "callback",
      requestIp,
    );
    if (!rateLimit.allowed) {
      c.header("Retry-After", String(rateLimit.retryAfterSeconds));
      return c.redirect("/?course_error=Zu+viele+Zahlungsanfragen", 303);
    }

    const pending = await getPendingPaidRegistration(state);
    if (!pending) {
      return c.redirect(
        "/?course_error=Zahlungssitzung+nicht+mehr+verfügbar",
        303,
      );
    }

    try {
      const successRedirect = () => {
        const confirmationUrl = `${
          new URL(c.req.url).origin
        }/api/registrations/confirm?token=${
          encodeURIComponent(pending.confirmationToken)
        }`;
        const confirmDebug = isDebugLinkExposureEnabled()
          ? `&confirm_debug=${encodeURIComponent(confirmationUrl)}`
          : "";
        return c.redirect(
          `/courses/${pending.courseId}?doi_sent=1&payment_success=1${confirmDebug}`,
          303,
        );
      };
      if (pending.paypalOrderId !== orderId) {
        throw new Error(
          "PayPal-Bestellung stimmt nicht mit der Anmeldung überein.",
        );
      }
      const result = await reconcilePendingPaidRegistration(pending.id, true);
      if (result?.status === "requires_review") {
        return c.redirect(
          `/courses/${pending.courseId}?course_error=${
            encodeURIComponent(
              "Die Zahlung muss geprüft werden. Bitte kontaktiere den Veranstalter.",
            )
          }`,
          303,
        );
      }
      if (!result || result.status !== "finalized") {
        return c.redirect(
          `/courses/${pending.courseId}?payment_pending=1`,
          303,
        );
      }

      logger.info("registration.paypal.completed", {
        ...trace,
        courseId: pending.courseId,
        registrationId: result.registrationId,
        paypalOrderId: orderId,
        paypalCaptureId: result.capture?.captureId,
      });

      return successRedirect();
    } catch (error) {
      logger.warn("registration.paypal.failed", {
        ...trace,
        courseId: pending.courseId,
        paypalOrderId: orderId,
        error,
      });
      return c.redirect(
        `/courses/${pending.courseId}?course_error=${
          encodeURIComponent((error as Error).message)
        }`,
        303,
      );
    }
  },
);
