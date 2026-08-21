import { env } from "@/lib/env.ts";
import { listUsers, normalizeEmail } from "@/lib/users/repository.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const adminUsersPage = new Hono<AppEnv>().get("/users", async (c) => {
  const sessionUser = c.get("sessionUser");
  const users = await listUsers();
  const created = c.req.query("created") === "1";
  const deleted = c.req.query("deleted") === "1";
  const error = c.req.query("error");
  const protectedEmail = normalizeEmail(env.initialAdminEmail);
  const errorMessage = error === "protected_initial_admin"
    ? "Der initiale Administrator ist geschützt und kann nicht gelöscht werden."
    : error === "cannot_delete_self"
    ? "Du kannst deinen eigenen Benutzer nicht löschen."
    : error === "target_not_admin"
    ? "Nur Admin-Benutzer können hier gelöscht werden."
    : error === "user_not_found"
    ? "Benutzer wurde nicht gefunden."
    : error
    ? "Benutzer konnte nicht gelöscht werden."
    : null;

  return c.render(
    <div class="space-y-6">
      <section class="hero-panel">
        <span class="page-eyebrow">Benutzerverwaltung</span>
        <h1 class="text-3xl font-bold">Admin Benutzer</h1>
        <p class="text-body-muted mt-1 text-sm">
          Rollen und Zugriffe für das interne Team verwalten.
        </p>
      </section>

      {created
        ? (
          <p class="callout-success">
            Benutzer wurde erstellt oder existiert bereits.
          </p>
        )
        : null}
      {deleted
        ? (
          <p class="callout-success">
            Benutzer wurde gelöscht.
          </p>
        )
        : null}
      {errorMessage
        ? (
          <p class="callout-danger">
            {errorMessage}
          </p>
        )
        : null}

      <section class="site-card p-5">
        <h2 class="text-2xl font-semibold">Benutzer per E-Mail hinzufügen</h2>
        <form
          action="/api/admin/users/create"
          method="post"
          class="mt-3 grid gap-3 sm:grid-cols-2"
        >
          <label class="text-sm" htmlFor="email">
            <span class="mb-1 block font-semibold">E-Mail</span>
            <input
              class="input-field"
              id="email"
              name="email"
              type="email"
              required
            />
          </label>
          <label class="text-sm" htmlFor="role">
            <span class="mb-1 block font-semibold">Rolle</span>
            <select class="select-field" id="role" name="role" required>
              <option value="viewer">Betrachter</option>
              <option value="editor">Bearbeiter</option>
              <option value="approver">Genehmiger</option>
              <option value="admin">Administrator</option>
              <option value="super_admin">Super Administrator</option>
            </select>
          </label>
          <button
            class="btn-primary sm:col-span-2 px-4 py-2 text-sm"
            type="submit"
          >
            Benutzer speichern
          </button>
        </form>
      </section>

      <section class="site-card p-5">
        <h2 class="text-2xl font-semibold">Bestehende Benutzer</h2>
        <ul class="mt-3 divide-y divide-slate-200 text-sm">
          {users.map((user) => {
            const isProtectedInitialAdmin =
              user.emailNormalized === protectedEmail;
            const canDelete = Boolean(sessionUser) &&
              (user.role === "admin" || user.role === "super_admin") &&
              !isProtectedInitialAdmin &&
              user.id !== sessionUser?.id;

            return (
              <li
                key={user.id}
                class="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold">{user.email}</span>
                  {isProtectedInitialAdmin
                    ? (
                      <span class="status-badge status-approved">
                        geschützt
                      </span>
                    )
                    : null}
                </div>
                <div class="flex items-center gap-2">
                  <span class="status-badge status-cancelled">{user.role}</span>
                  {canDelete
                    ? (
                      <form
                        action={`/api/admin/users/${user.id}/delete`}
                        method="post"
                      >
                        <button
                          class="btn-destructive px-3 py-1 text-xs"
                          type="submit"
                        >
                          Admin löschen
                        </button>
                      </form>
                    )
                    : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>,
  );
});
