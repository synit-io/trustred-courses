import { hasRole } from "@/lib/auth/roles.ts";
import {
  applyRegistrationAction,
  type RegistrationAction,
} from "@/lib/registrations/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const adminRegistrationsActionRoute = new Hono<AppEnv>().post(
  "/:id/action",
  async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser || !hasRole(sessionUser.role, "approver")) {
      return c.text("Forbidden", 403);
    }

    const form = await c.req.formData();
    const action = form.get("action");
    if (typeof action !== "string") return c.text("ungültige Aktion", 400);

    try {
      await applyRegistrationAction({
        registrationId: c.req.param("id"),
        action: action as RegistrationAction,
        actorUserId: sessionUser.id,
        adminMessage: typeof form.get("adminMessage") === "string"
          ? String(form.get("adminMessage"))
          : undefined,
        internalNotes: typeof form.get("internalNotes") === "string"
          ? String(form.get("internalNotes"))
          : undefined,
      });

      return c.redirect(
        `/admin/registrations/${c.req.param("id")}?updated=1`,
        303,
      );
    } catch (error) {
      return c.redirect(
        `/admin/registrations/${c.req.param("id")}?error=${
          encodeURIComponent((error as Error).message)
        }`,
        303,
      );
    }
  },
);
