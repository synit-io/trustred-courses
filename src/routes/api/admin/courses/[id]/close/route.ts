import { hasRole } from "@/lib/auth/roles.ts";
import { appendAuditLog } from "@/lib/audit/repository.ts";
import { getCourseById, upsertCourse } from "@/lib/courses/repository.ts";
import { sendCourseBroadcastEmails } from "@/lib/email/service.ts";
import { rebuildPublicSnapshotsForCourse } from "@/lib/public_snapshot/service.ts";
import { listRegistrationsByCourse } from "@/lib/registrations/repository.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const adminCoursesCloseRoute = new Hono<AppEnv>().post(
  "/:id/close",
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

    const nextCourse = {
      ...existing,
      status: "archived" as const,
    };
    await upsertCourse(nextCourse);
    await rebuildPublicSnapshotsForCourse(existing.id);
    const registrations = await listRegistrationsByCourse(existing.id);
    const notifiedCount = await sendCourseBroadcastEmails(
      registrations,
      nextCourse,
      "course_cancelled",
    );
    await appendAuditLog({
      actorUserId: sessionUser.id,
      entityType: "course",
      entityId: existing.id,
      action: "course.closed",
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(nextCourse),
    });
    if (notifiedCount > 0) {
      await appendAuditLog({
        actorUserId: sessionUser.id,
        entityType: "course",
        entityId: existing.id,
        action: "course.attendees_cancelled_notified",
        oldValue: null,
        newValue: JSON.stringify({ notifiedCount }),
      });
    }
    return c.redirect(`/admin/courses/${existing.id}?course_closed=1`, 303);
  },
);
