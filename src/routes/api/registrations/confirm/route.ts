import { confirmRegistrationDoubleOptIn } from "@/lib/registrations/service.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const registrationConfirmRoute = new Hono<AppEnv>().get(
  "/",
  async (c) => {
    const trace = extractRequestTraceContext(c.req.raw.headers);
    const token = c.req.query("token") ?? "";
    const confirmed = await confirmRegistrationDoubleOptIn(token);
    if (!confirmed) {
      logger.warn("registration.double_opt_in.invalid_or_expired", {
        ...trace,
        hasToken: token.length > 0,
      });
      return c.redirect("/?confirm_error=1", 303);
    }
    logger.info("registration.double_opt_in.confirmed", {
      ...trace,
      registrationId: confirmed.id,
      courseId: confirmed.courseId,
      status: confirmed.status,
    });
    return c.redirect(
      `/courses/${confirmed.courseId}?confirmed=1&status=${confirmed.status}`,
      303,
    );
  },
);
