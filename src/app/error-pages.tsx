import { env } from "@/lib/env.ts";
import { logger } from "@/lib/observability/logger.ts";
import type { AppEnv } from "@/src/app/context.ts";
import type { Context, Hono } from "hono";

function renderNotFoundPage(c: Context<AppEnv>) {
  c.status(404);
  return c.render(
    <div class="space-y-6">
      <section class="hero-panel">
        <p class="page-eyebrow">
          Seite nicht gefunden
        </p>
        <h1 class="mt-2 text-4xl font-bold">404</h1>
        <p class="text-body mt-3 text-sm">
          Die angeforderte Seite ist nicht verfügbar oder wurde verschoben.
        </p>
      </section>
      <section class="site-card p-6">
        <h2 class="text-2xl font-semibold">Was Sie jetzt tun können</h2>
        <ul class="text-body mt-3 list-disc space-y-2 pl-5 text-sm">
          <li>Zur Startseite zurückkehren und einen Kurs auswählen.</li>
          <li>Die URL auf Tippfehler prüfen.</li>
          <li>Bei Fragen die Kontaktadresse im Footer nutzen.</li>
        </ul>
        <div class="mt-5 flex flex-wrap gap-3">
          <a class="btn-primary px-4 py-2 text-sm" href="/">Zur Startseite</a>
          <a class="btn-secondary px-4 py-2 text-sm" href="/admin/login">
            Admin Login
          </a>
        </div>
      </section>
    </div>,
  );
}

function renderInternalErrorPage(c: Context<AppEnv>) {
  c.status(500);
  return c.render(
    <div class="space-y-6">
      <section class="hero-panel">
        <p class="page-eyebrow">
          Serverfehler
        </p>
        <h1 class="mt-2 text-4xl font-bold">500</h1>
        <p class="text-body mt-3 text-sm">
          Beim Verarbeiten der Anfrage ist ein unerwarteter Fehler aufgetreten.
        </p>
      </section>
      <section class="site-card p-6">
        <h2 class="text-2xl font-semibold">Bitte versuchen Sie es erneut</h2>
        <p class="text-body mt-3 text-sm">
          Falls der Fehler bestehen bleibt, kontaktieren Sie {env.appName} uber
          {" "}
          <a class="underline" href={`mailto:${env.legalEmail}`}>
            {env.legalEmail}
          </a>
          .
        </p>
        <div class="mt-5">
          <a class="btn-primary px-4 py-2 text-sm" href="/">Zur Startseite</a>
        </div>
      </section>
    </div>,
  );
}

export function registerErrorPages(app: Hono<AppEnv>) {
  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Not Found" }, 404);
    }
    return renderNotFoundPage(c);
  });

  app.onError((error, c) => {
    logger.error("http.unhandled_error", {
      path: c.req.path,
      method: c.req.method,
      error,
    });

    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Internal Server Error" }, 500);
    }
    return renderInternalErrorPage(c);
  });
}
