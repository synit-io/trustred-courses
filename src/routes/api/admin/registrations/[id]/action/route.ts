import { hasRole } from "@/lib/auth/roles.ts";
import { appendAuditLog } from "@/lib/audit/repository.ts";
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
      const result = await applyRegistrationAction({
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

      await appendAuditLog({
        actorUserId: sessionUser.id,
        entityType: "registration",
        entityId: result.next.id,
        action: `registration.${action}`,
        oldValue: JSON.stringify({
          status: result.previous.status,
          waitingListPosition: result.previous.waitingListPosition,
          adminMessage: result.previous.adminMessage,
          internalNotes: result.previous.internalNotes,
        }),
        newValue: JSON.stringify({
          status: result.next.status,
          waitingListPosition: result.next.waitingListPosition,
          adminMessage: result.next.adminMessage,
          internalNotes: result.next.internalNotes,
        }),
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
