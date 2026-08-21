import { hasRole } from "@/lib/auth/roles.ts";
import { appendAuditLog } from "@/lib/audit/repository.ts";
import { upsertCourse } from "@/lib/courses/repository.ts";
import { rebuildPublicSnapshotsForCourse } from "@/lib/public_snapshot/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import {
  parseCoursePayload,
  slugifyCourseTitle,
} from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

export const adminCoursesCreateRoute = new Hono<AppEnv>().post(
  "/create",
  async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser || !hasRole(sessionUser.role, "admin")) {
      return c.text("Forbidden", 403);
    }

    try {
      const form = await c.req.formData();
      const payload = parseCoursePayload(form);

      const slugBase = slugifyCourseTitle(payload.title) || "kurs";
      const courseId = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;

      await upsertCourse({
        id: courseId,
        title: payload.title,
        description: payload.description,
        location: payload.location,
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
        createdAt: new Date().toISOString(),
      });
      await rebuildPublicSnapshotsForCourse(courseId);
      await appendAuditLog({
        actorUserId: sessionUser.id,
        entityType: "course",
        entityId: courseId,
        action: "course.created",
        oldValue: null,
        newValue: JSON.stringify({
          title: payload.title,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
          registrationOpensAt: payload.registrationOpensAt,
          registrationClosesAt: payload.registrationClosesAt,
          pricingType: payload.pricingType,
          feeAmountCents: payload.feeAmountCents,
          feeCurrency: payload.feeCurrency,
          status: payload.status,
        }),
      });

      return c.redirect("/admin/courses?course_created=1", 303);
    } catch (error) {
      return c.redirect(
        `/admin/courses?course_error=${
          encodeURIComponent((error as Error).message)
        }`,
        303,
      );
    }
  },
);
