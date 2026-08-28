import { getCourseById } from "@/lib/courses/repository.ts";
import { env, isLocalDebugBypassEnabled } from "@/lib/env.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import {
  createPayPalCheckoutOrder,
  deletePendingPaidRegistration,
  savePendingPaidRegistration,
  updatePendingPaidRegistration,
} from "@/lib/payments/paypal.ts";
import { enforcePayPalRateLimit } from "@/lib/payments/rate_limit.ts";
import { enforceRateLimit } from "@/lib/security/rate_limit.ts";
import {
  ensureRegistrationCanBeSubmitted,
  type RegistrationInput,
  submitRegistrationWithDoubleOptIn,
} from "@/lib/registrations/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { extractRequestIp, maskEmail } from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

const MAX_REGISTRATION_BODY_BYTES = 64 * 1024;
const FIELD_LIMITS: Record<string, number> = {
  courseId: 100,
  firstName: 100,
  lastName: 100,
  street: 200,
  houseNumber: 30,
  postalCode: 20,
  city: 100,
  email: 254,
  phone: 50,
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const registrationCreateRoute = new Hono<AppEnv>();

registrationCreateRoute.use(
  "/",
  bodyLimit({
    maxSize: MAX_REGISTRATION_BODY_BYTES,
    onError: (c) => c.text("Anfrage ist zu groß.", 413),
  }),
);

registrationCreateRoute.post(
  "/",
  async (c) => {
    const trace = extractRequestTraceContext(c.req.raw.headers);
    const form = await c.req.formData();
    const read = (key: string): string => {
      const value = form.get(key);
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Feld fehlt: ${key}`);
      }
      const trimmed = value.trim();
      if (trimmed.length > (FIELD_LIMITS[key] ?? 500)) {
        throw new Error(`Feld ist zu lang: ${key}`);
      }
      return trimmed;
    };
    const readOptional = (key: string): string => {
      const value = form.get(key);
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (trimmed.length > (FIELD_LIMITS[key] ?? 500)) {
        throw new Error(`Feld ist zu lang: ${key}`);
      }
      return trimmed;
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
      if (!isValidEmail(registrationInput.email)) {
        throw new Error("E-Mail-Adresse ist ungültig.");
      }

      const requestIp = extractRequestIp(c.req.raw.headers);
      const emailLimit = await enforceRateLimit(
        "registration:email",
        `${courseId}:${registrationInput.email.toLowerCase()}`,
        5,
        60 * 60 * 1000,
      );
      const ipLimit = requestIp
        ? await enforceRateLimit(
          "registration:ip",
          requestIp,
          20,
          10 * 60 * 1000,
        )
        : { allowed: true, retryAfterSeconds: 0 };
      if (!emailLimit.allowed || !ipLimit.allowed) {
        c.header(
          "Retry-After",
          String(
            Math.max(emailLimit.retryAfterSeconds, ipLimit.retryAfterSeconds),
          ),
        );
        throw new Error(
          "Zu viele Anmeldeversuche. Bitte versuche es später erneut.",
        );
      }

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
        requestIp,
      );
      if (!rateLimit.allowed) {
        c.header("Retry-After", String(rateLimit.retryAfterSeconds));
        throw new Error(
          "Zu viele Zahlungsanfragen. Bitte versuche es in einigen Minuten erneut.",
        );
      }

      const pendingId = crypto.randomUUID();
      const registrationId = crypto.randomUUID();
      const confirmationToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const returnUrl =
        `${env.appBaseUrl}/api/registrations/paypal/return?state=${
          encodeURIComponent(pendingId)
        }`;
      const cancelUrl =
        `${env.appBaseUrl}/api/registrations/paypal/cancel?state=${
          encodeURIComponent(pendingId)
        }`;

      const createdAt = new Date().toISOString();
      const pending = {
        id: pendingId,
        courseId,
        registrationInput,
        paypalOrderId: "",
        status: "creating" as const,
        registrationId,
        confirmationToken,
        feeAmountCents: course.feeAmountCents,
        feeCurrency: course.feeCurrency,
        createdAt,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
      await savePendingPaidRegistration(pending);
      let order;
      try {
        order = await createPayPalCheckoutOrder({
          orderReference: pendingId,
          amountCents: course.feeAmountCents,
          currency: course.feeCurrency,
          title: `Kursgebühr: ${course.title}`,
          returnUrl,
          cancelUrl,
          requestId: `create-${pendingId}`,
        });
        if (
          !await updatePendingPaidRegistration({
            ...pending,
            paypalOrderId: order.orderId,
            status: "checkout_created",
          })
        ) {
          throw new Error("Zahlungssitzung konnte nicht gespeichert werden.");
        }
      } catch (error) {
        await deletePendingPaidRegistration(pendingId);
        throw error;
      }

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
