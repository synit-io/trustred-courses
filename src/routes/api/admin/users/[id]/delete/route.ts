import { hasRole } from "@/lib/auth/roles.ts";
import { appendAuditLog } from "@/lib/audit/repository.ts";
import {
  deleteUserById,
  getUserById,
  normalizeEmail,
} from "@/lib/users/repository.ts";
import { env } from "@/lib/env.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const adminUsersDeleteRoute = new Hono<AppEnv>().post(
  "/:id/delete",
  async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser || !hasRole(sessionUser.role, "admin")) {
      return c.text("Forbidden", 403);
    }

    const targetUser = await getUserById(c.req.param("id"));
    if (!targetUser) {
      return c.redirect("/admin/users?error=user_not_found", 303);
    }

    const protectedEmail = normalizeEmail(env.initialAdminEmail);
    if (
      protectedEmail &&
      normalizeEmail(targetUser.emailNormalized) === protectedEmail
    ) {
      return c.redirect("/admin/users?error=protected_initial_admin", 303);
    }

    if (targetUser.id === sessionUser.id) {
      return c.redirect("/admin/users?error=cannot_delete_self", 303);
    }

    if (targetUser.role !== "admin" && targetUser.role !== "super_admin") {
      return c.redirect("/admin/users?error=target_not_admin", 303);
    }

    const deleted = await deleteUserById(targetUser.id);
    if (!deleted) {
      return c.redirect("/admin/users?error=user_not_found", 303);
    }

    await appendAuditLog({
      actorUserId: sessionUser.id,
      entityType: "user",
      entityId: targetUser.id,
      action: "user.admin_deleted",
      oldValue: JSON.stringify({
        email: targetUser.emailNormalized,
        role: targetUser.role,
      }),
      newValue: null,
    });

    return c.redirect("/admin/users?deleted=1", 303);
  },
);
