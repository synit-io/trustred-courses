import { hasRole } from "@/lib/auth/roles.ts";
import { appendAuditLog } from "@/lib/audit/repository.ts";
import { getCourseById } from "@/lib/courses/repository.ts";
import { sendRegistrationEventEmails } from "@/lib/email/service.ts";
import type { RegistrationEmailEvent } from "@/lib/email/templates.ts";
import { isRegistrationEmailEventAllowed } from "@/lib/registrations/service.ts";
import { getRegistrationById } from "@/lib/registrations/repository.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { toDefaultEvent } from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

export const adminRegistrationsResendRoute = new Hono<AppEnv>().post(
  "/:id/resend",
  async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser || !hasRole(sessionUser.role, "approver")) {
      return c.text("Forbidden", 403);
    }

    const registration = await getRegistrationById(c.req.param("id"));
    if (!registration) return c.text("Anmeldung nicht gefunden", 404);
    const course = await getCourseById(registration.courseId);
    if (!course) return c.text("Kurs nicht gefunden", 404);

    const form = await c.req.formData();
    const rawEvent = form.get("event");
    const event = typeof rawEvent === "string"
      ? rawEvent as RegistrationEmailEvent
      : toDefaultEvent(registration.status);

    if (!isRegistrationEmailEventAllowed(registration.status, event)) {
      return c.redirect(
        `/admin/registrations/${registration.id}?error=${
          encodeURIComponent(
            "Die ausgewählte E-Mail passt nicht zum gespeicherten Status.",
          )
        }`,
        303,
      );
    }

    await sendRegistrationEventEmails(registration, course, event);

    await appendAuditLog({
      actorUserId: sessionUser.id,
      entityType: "registration",
      entityId: registration.id,
      action: "registration.resend_email",
      oldValue: null,
      newValue: JSON.stringify({ event }),
    });

    return c.redirect(`/admin/registrations/${registration.id}?resent=1`, 303);
  },
);
