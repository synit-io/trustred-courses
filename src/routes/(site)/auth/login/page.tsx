import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const adminLoginPage = new Hono<AppEnv>().get("/login", (c) => {
  if (c.get("sessionUser")) return c.redirect("/admin/dashboard", 303);

  const sent = c.req.query("sent") === "1";
  const error = c.req.query("error") === "1";
  const debugUrl = c.req.query("debug");

  return c.render(
    <div class="grid gap-6 lg:grid-cols-[1fr_440px]">
      <section class="hero-panel">
        <p class="page-eyebrow">
          geschützter Bereich
        </p>
        <h1 class="mt-2 text-4xl font-bold">Admin Login</h1>
      </section>

      <div class="site-card p-6">
        <h2 class="text-2xl font-semibold">Anmelden</h2>
        <p class="text-body-muted mt-2 text-sm">
          Melde dich mit deiner E-Mail-Adresse an.
        </p>

        {sent
          ? (
            <p class="callout-success mt-4">
              Ein Login-Link wurde an deine E-Mail Adresse versendet.
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
              Dev-Link:{" "}
              <a class="font-semibold underline" href={debugUrl}>
                Jetzt einloggen
              </a>
            </p>
          )
          : null}

        <form
          class="mt-4 space-y-3"
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
          <button class="btn-primary w-full px-4 py-2 text-sm" type="submit">
            Login-Link anfordern
          </button>
        </form>
      </div>
    </div>,
  );
});
