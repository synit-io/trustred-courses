import { isLocalDebugBypassEnabled } from "@/lib/env.ts";
import {
  capturePayPalOrder,
  deletePendingPaidRegistration,
  getPendingPaidRegistration,
} from "@/lib/payments/paypal.ts";
import { enforcePayPalRateLimit } from "@/lib/payments/rate_limit.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import { submitRegistrationWithDoubleOptIn } from "@/lib/registrations/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { extractRequestIp } from "@/src/routes/shared/helpers.ts";
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
    const rateLimit = await enforcePayPalRateLimit(
      "callback",
      extractRequestIp(c.req.raw.headers),
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
      if (pending.paypalOrderId !== orderId) {
        throw new Error(
          "PayPal-Bestellung stimmt nicht mit der Anmeldung überein.",
        );
      }

      const capture = await capturePayPalOrder(orderId);
      if (capture.status !== "COMPLETED") {
        throw new Error("PayPal-Zahlung wurde nicht abgeschlossen.");
      }
      if (capture.customId !== pending.id) {
        throw new Error("PayPal-Zahlung enthält eine ungültige Referenz.");
      }
      if (capture.amountCents !== pending.feeAmountCents) {
        throw new Error(
          "PayPal-Zahlungsbetrag stimmt nicht mit der Kursgebühr überein.",
        );
      }
      if (capture.currency !== pending.feeCurrency.toUpperCase()) {
        throw new Error(
          "PayPal-Währung stimmt nicht mit der Kursgebühr überein.",
        );
      }

      const created = await submitRegistrationWithDoubleOptIn(
        pending.registrationInput,
        {
          provider: "paypal",
          captureId: capture.captureId,
          amountCents: capture.amountCents,
          currency: capture.currency,
          paidAt: new Date().toISOString(),
        },
      );
      await deletePendingPaidRegistration(pending.id);

      logger.info("registration.paypal.completed", {
        ...trace,
        courseId: pending.courseId,
        registrationId: created.registration.id,
        paypalOrderId: orderId,
        paypalCaptureId: capture.captureId,
      });

      const confirmDebug = isLocalDebugBypassEnabled()
        ? `&confirm_debug=${encodeURIComponent(created.confirmationUrl)}`
        : "";
      return c.redirect(
        `/courses/${pending.courseId}?doi_sent=1&payment_success=1${confirmDebug}`,
        303,
      );
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
