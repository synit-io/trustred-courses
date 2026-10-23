import { hasRole } from "@/lib/auth/roles.ts";
import {
  DEMO_DELETE_BLOCKED_MESSAGE,
  demoModeBlocksDeletion,
} from "@/lib/demo/guards.ts";
import { appendAuditLog } from "@/lib/audit/repository.ts";
import { deleteCourseById, getCourseById } from "@/lib/courses/repository.ts";
import { rebuildPublicSnapshotsForCourse } from "@/lib/public_snapshot/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const adminCoursesDeleteRoute = new Hono<AppEnv>().post(
  "/:id/delete",
  async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser || !hasRole(sessionUser.role, "admin")) {
      return c.text("Forbidden", 403);
    }
    if (demoModeBlocksDeletion()) {
      return c.redirect(
        `/admin/courses/${c.req.param("id")}?course_error=${
          encodeURIComponent(DEMO_DELETE_BLOCKED_MESSAGE)
        }`,
        303,
      );
    }

    const existing = await getCourseById(c.req.param("id"));
    if (!existing) {
      return c.redirect(
        "/admin/courses?course_error=Kurs+nicht+gefunden",
        303,
      );
    }

    const deleted = await deleteCourseById(existing.id);
    if (!deleted) {
      return c.redirect(
        `/admin/courses/${existing.id}?course_error=Kurs+hat+Anmeldungen+oder+Zahlungen+oder+wurde+gleichzeitig+geändert`,
        303,
      );
    }
    await rebuildPublicSnapshotsForCourse(existing.id);

    await appendAuditLog({
      actorUserId: sessionUser.id,
      entityType: "course",
      entityId: existing.id,
      action: "course.deleted",
      oldValue: JSON.stringify(existing),
      newValue: null,
    });
    return c.redirect("/admin/courses?course_deleted=1", 303);
  },
);
