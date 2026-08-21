import {
  deletePendingPaidRegistration,
  getPendingPaidRegistration,
} from "@/lib/payments/paypal.ts";
import { enforcePayPalRateLimit } from "@/lib/payments/rate_limit.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { extractRequestIp } from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

export const registrationPayPalCancelRoute = new Hono<AppEnv>().get(
  "/cancel",
  async (c) => {
    const state = (c.req.query("state") ?? "").trim();
    const orderId = (c.req.query("token") ?? "").trim();
    if (!state || !orderId) {
      return c.redirect("/?course_error=Zahlung+abgebrochen", 303);
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
      return c.redirect("/?course_error=Zahlungssitzung+nicht+gefunden", 303);
    }
    if (pending.paypalOrderId !== orderId) {
      return c.redirect(
        `/courses/${pending.courseId}?course_error=Ungültige+PayPal+Abbruchanfrage`,
        303,
      );
    }
    await deletePendingPaidRegistration(state);
    return c.redirect(
      `/courses/${pending.courseId}?payment_cancelled=1`,
      303,
    );
  },
);
