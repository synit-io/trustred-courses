import { getCourseById } from "@/lib/courses/repository.ts";
import { env, isLocalDebugBypassEnabled } from "@/lib/env.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import {
  createPayPalCheckoutOrder,
  savePendingPaidRegistration,
} from "@/lib/payments/paypal.ts";
import { enforcePayPalRateLimit } from "@/lib/payments/rate_limit.ts";
import {
  ensureRegistrationCanBeSubmitted,
  type RegistrationInput,
  submitRegistrationWithDoubleOptIn,
} from "@/lib/registrations/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { extractRequestIp, maskEmail } from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

export const registrationCreateRoute = new Hono<AppEnv>().post(
  "/",
  async (c) => {
    const trace = extractRequestTraceContext(c.req.raw.headers);
    const form = await c.req.formData();
    const read = (key: string): string => {
      const value = form.get(key);
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Feld fehlt: ${key}`);
      }
      return value;
    };
    const readOptional = (key: string): string => {
      const value = form.get(key);
      return typeof value === "string" ? value : "";
    };

    let courseId = "";

    try {
      courseId = read("courseId");
      const registrationInput: RegistrationInput = {
        courseId,
        firstName: read("firstName"),
        lastName: read("lastName"),
        street: read("street"),
        houseNumber: read("houseNumber"),
        postalCode: read("postalCode"),
        city: read("city"),
        email: read("email"),
        phone: readOptional("phone"),
        consentAccepted: form.get("consentAccepted") === "on",
      };

      logger.info("registration.create.requested", {
        ...trace,
        courseId,
        email: maskEmail(registrationInput.email.toLowerCase()),
      });
      const course = await getCourseById(courseId);
      const isPaidCourse = course?.pricingType === "paid" &&
        (course.feeAmountCents ?? 0) > 0 &&
        Boolean(course.feeCurrency);

      if (!isPaidCourse) {
        const created = await submitRegistrationWithDoubleOptIn(
          registrationInput,
        );
        logger.info("registration.create.double_opt_in_sent", {
          ...trace,
          registrationId: created.registration.id,
          courseId,
          status: created.registration.status,
        });
        const confirmDebug = isLocalDebugBypassEnabled()
          ? `&confirm_debug=${encodeURIComponent(created.confirmationUrl)}`
          : "";
        return c.redirect(
          `/courses/${courseId}?doi_sent=1${confirmDebug}`,
          303,
        );
      }

      await ensureRegistrationCanBeSubmitted(registrationInput);
      if (!registrationInput.consentAccepted) {
        throw new Error("Datenschutz-Einwilligung ist erforderlich.");
      }
      if (!course || !course.feeAmountCents || !course.feeCurrency) {
        throw new Error("Kurszahlung ist nicht korrekt konfiguriert.");
      }
      const rateLimit = await enforcePayPalRateLimit(
        "create",
        extractRequestIp(c.req.raw.headers),
      );
      if (!rateLimit.allowed) {
        c.header("Retry-After", String(rateLimit.retryAfterSeconds));
        throw new Error(
          "Zu viele Zahlungsanfragen. Bitte versuche es in einigen Minuten erneut.",
        );
      }

      const pendingId = crypto.randomUUID();
      const returnUrl =
        `${env.appBaseUrl}/api/registrations/paypal/return?state=${
          encodeURIComponent(pendingId)
        }`;
      const cancelUrl =
        `${env.appBaseUrl}/api/registrations/paypal/cancel?state=${
          encodeURIComponent(pendingId)
        }`;

      const order = await createPayPalCheckoutOrder({
        orderReference: pendingId,
        amountCents: course.feeAmountCents,
        currency: course.feeCurrency,
        title: `Kursgebühr: ${course.title}`,
        returnUrl,
        cancelUrl,
      });

      const createdAt = new Date().toISOString();
      await savePendingPaidRegistration({
        id: pendingId,
        courseId,
        registrationInput,
        paypalOrderId: order.orderId,
        feeAmountCents: course.feeAmountCents,
        feeCurrency: course.feeCurrency,
        createdAt,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      logger.info("registration.create.paypal_redirect", {
        ...trace,
        courseId,
        paypalOrderId: order.orderId,
      });
      return c.redirect(order.approvalUrl, 303);
    } catch (error) {
      logger.warn("registration.create.invalid_request", {
        ...trace,
        error,
      });
      if (courseId) {
        return c.redirect(
          `/courses/${courseId}?course_error=${
            encodeURIComponent((error as Error).message)
          }`,
          303,
        );
      }
      return c.text(`ungültige Anfrage: ${(error as Error).message}`, 400);
    }
  },
);
