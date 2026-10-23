import { hasRole } from "@/lib/auth/roles.ts";
import {
  getCourseChangeEntry,
  processCourseNotificationEvents,
  saveCourseChangeChecked,
} from "@/lib/courses/service.ts";
import { processEmailOutboxBatch } from "@/lib/email/service.ts";
import { logger } from "@/lib/observability/logger.ts";
import { rebuildPublicSnapshotsForCourse } from "@/lib/public_snapshot/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { parseCoursePayload } from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

export const adminCoursesUpdateRoute = new Hono<AppEnv>().post(
  "/:id/update",
  async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser || !hasRole(sessionUser.role, "admin")) {
      return c.text("Forbidden", 403);
    }

    const entry = await getCourseChangeEntry(c.req.param("id"));
    if (!entry.value) {
      return c.redirect(
        "/admin/courses?course_error=Kurs+nicht+gefunden",
        303,
      );
    }

    const existing = entry.value;
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
      await saveCourseChangeChecked(
        { ...entry, value: existing },
        nextCourse,
        sessionUser.id,
        "course.updated",
      );
      try {
        await rebuildPublicSnapshotsForCourse(existing.id);
      } catch (error) {
        logger.error("course.snapshot_refresh_failed", {
          courseId: existing.id,
          error,
        });
      }
      try {
        await processCourseNotificationEvents(1);
        await processEmailOutboxBatch(20);
      } catch (error) {
        logger.error("course.notification_deferred", {
          courseId: existing.id,
          error,
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
