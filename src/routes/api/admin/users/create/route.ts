import type { UserRole } from "@/lib/types.ts";
import { hasRole } from "@/lib/auth/roles.ts";
import { createUserFromEmail } from "@/lib/users/repository.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const adminUsersCreateRoute = new Hono<AppEnv>().post("/", async (c) => {
  const sessionUser = c.get("sessionUser");
  if (!sessionUser || !hasRole(sessionUser.role, "admin")) {
    return c.text("Forbidden", 403);
  }
  const form = await c.req.formData();
  const email = form.get("email");
  const role = form.get("role");
  const allowedRoles: UserRole[] = [
    "viewer",
    "editor",
    "approver",
    "admin",
    "super_admin",
  ];
  if (typeof email !== "string" || email.trim() === "") {
    return c.text("E-Mail fehlt", 400);
  }
  if (typeof role !== "string" || !allowedRoles.includes(role as UserRole)) {
    return c.text("Rolle ungültig", 400);
  }
  if (role === "super_admin" && sessionUser.role !== "super_admin") {
    return c.text("Forbidden", 403);
  }
  await createUserFromEmail(email, role as UserRole);
  return c.redirect("/admin/users?created=1", 303);
});
