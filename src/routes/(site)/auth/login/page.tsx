import { DEMO_ADMIN_ACCOUNT } from "@/lib/demo/accounts.ts";
import { isDemoMode } from "@/lib/env.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const adminLoginPage = new Hono<AppEnv>().get("/login", (c) => {
  if (c.get("sessionUser")) return c.redirect("/admin/dashboard", 303);

  const sent = c.req.query("sent") === "1";
  const error = c.req.query("error") === "1";
  const debugUrl = c.req.query("debug");
  const demoMode = isDemoMode();

  return c.render(
    <div class="grid gap-8 lg:grid-cols-[1fr_440px] lg:items-start">
      <section class="page-hero">
        <p class="page-eyebrow">
          Geschützter Bereich
        </p>
        <h1 class="text-4xl sm:text-5xl">Admin Login</h1>
        <p class="text-body mt-4 max-w-xl text-lg">
          Zugang für das interne Team. Du erhältst einen einmaligen Login-Link
          per E-Mail, ein Passwort ist nicht nötig.
        </p>
      </section>

      <div class="site-card p-6 lg:mt-8">
        <h2 class="text-2xl">Anmelden</h2>
        <p class="text-body-muted mt-2 text-sm">
          Melde dich mit deiner E-Mail-Adresse an.
        </p>

        {demoMode
          ? (
            <p class="callout-info mt-4">
              Demo-Modus: Der Login-Link wird nach dem Absenden direkt hier
              angezeigt. Demo-Zugang:{" "}
              <strong>{DEMO_ADMIN_ACCOUNT.email}</strong>
            </p>
          )
          : null}

        {sent
          ? (
            <p class="callout-success mt-4">
              {demoMode
                ? "Demo-Modus: Es wurde keine E-Mail versendet. Nutze den Demo-Login unten."
                : "Ein Login-Link wurde an deine E-Mail Adresse versendet."}
            </p>
          )
          : null}

        {error
          ? (
            <p class="callout-danger mt-4">
              Login-Link ist ungültig oder abgelaufen.
            </p>
          )
          : null}

        {debugUrl
          ? (
            <p class="callout-info mt-4">
              {demoMode ? "Demo-Login:" : "Dev-Link:"}{" "}
              <a class="font-semibold underline" href={debugUrl}>
                Jetzt einloggen
              </a>
            </p>
          )
          : null}

        <form
          class="mt-5 space-y-4"
          action="/api/auth/magic-link/request"
          method="post"
        >
          <label class="block text-sm" htmlFor="email">
            <span class="mb-1 block font-semibold">E-Mail</span>
            <input
              class="input-field"
              id="email"
              name="email"
              type="email"
              required
            />
          </label>
          <button class="btn-primary w-full" type="submit">
            Login-Link anfordern
          </button>
        </form>
      </div>
    </div>,
  );
});
