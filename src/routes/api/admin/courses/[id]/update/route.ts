import { hasRole } from "@/lib/auth/roles.ts";
import { appendAuditLog } from "@/lib/audit/repository.ts";
import { getCourseById, upsertCourse } from "@/lib/courses/repository.ts";
import { sendCourseBroadcastEmails } from "@/lib/email/service.ts";
import { rebuildPublicSnapshotsForCourse } from "@/lib/public_snapshot/service.ts";
import { listRegistrationsByCourse } from "@/lib/registrations/repository.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { parseCoursePayload } from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

function criticalCourseChanges(
  previous: Awaited<ReturnType<typeof getCourseById>> extends infer T ? T
    : never,
  next: NonNullable<Awaited<ReturnType<typeof getCourseById>>>,
) {
  if (!previous) return {};

  return {
    location: previous.location !== next.location
      ? { before: previous.location, after: next.location }
      : undefined,
    startsAt: previous.startsAt !== next.startsAt
      ? { before: previous.startsAt, after: next.startsAt }
      : undefined,
    endsAt: previous.endsAt !== next.endsAt
      ? { before: previous.endsAt, after: next.endsAt }
      : undefined,
  };
}

export const adminCoursesUpdateRoute = new Hono<AppEnv>().post(
  "/:id/update",
  async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser || !hasRole(sessionUser.role, "admin")) {
      return c.text("Forbidden", 403);
    }

    const existing = await getCourseById(c.req.param("id"));
    if (!existing) {
      return c.redirect(
        "/admin/courses?course_error=Kurs+nicht+gefunden",
        303,
      );
    }

    try {
      const form = await c.req.formData();
      const payload = parseCoursePayload(form);
      const nextCourse = {
        ...existing,
        title: payload.title,
        location: payload.location,
        description: payload.description,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        registrationOpensAt: payload.registrationOpensAt,
        registrationClosesAt: payload.registrationClosesAt,
        capacity: payload.capacity,
        pricingType: payload.pricingType,
        feeAmountCents: payload.feeAmountCents,
        feeCurrency: payload.feeCurrency,
        status: payload.status,
        waitingListEnabled: payload.waitingListEnabled,
        reminderDaysBefore: payload.reminderDaysBefore,
      };
      await upsertCourse(nextCourse);
      await rebuildPublicSnapshotsForCourse(existing.id);

      const registrations = await listRegistrationsByCourse(existing.id);
      const changes = criticalCourseChanges(existing, nextCourse);
      const hasCriticalChanges = Boolean(
        changes.location || changes.startsAt || changes.endsAt,
      );
      const archivedNow = existing.status !== "archived" &&
        nextCourse.status === "archived";

      let notifiedCount = 0;
      if (archivedNow) {
        notifiedCount = await sendCourseBroadcastEmails(
          registrations,
          nextCourse,
          "course_cancelled",
        );
      } else if (hasCriticalChanges) {
        notifiedCount = await sendCourseBroadcastEmails(
          registrations,
          nextCourse,
          "course_critical_update",
          changes,
        );
      }

      await appendAuditLog({
        actorUserId: sessionUser.id,
        entityType: "course",
        entityId: existing.id,
        action: "course.updated",
        oldValue: JSON.stringify(existing),
        newValue: JSON.stringify(nextCourse),
      });
      if (notifiedCount > 0) {
        await appendAuditLog({
          actorUserId: sessionUser.id,
          entityType: "course",
          entityId: existing.id,
          action: archivedNow
            ? "course.attendees_cancelled_notified"
            : "course.attendees_update_notified",
          oldValue: null,
          newValue: JSON.stringify({
            notifiedCount,
            changes,
          }),
        });
      }

      return c.redirect(`/admin/courses/${existing.id}?course_updated=1`, 303);
    } catch (error) {
      return c.redirect(
        `/admin/courses/${existing.id}?course_error=${
          encodeURIComponent((error as Error).message)
        }`,
        303,
      );
    }
  },
);
