import { env } from "@/lib/env.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const impressumPage = new Hono<AppEnv>().get("/", (c) => {
  return c.render(
    <div class="space-y-6">
      <section class="hero-panel">
        <p class="page-eyebrow">
          Rechtliche Angaben
        </p>
        <h1 class="mt-2 text-4xl font-bold">Impressum</h1>
        <p class="text-body mt-3 text-sm">
          Angaben gemäß Paragraph 5 DDG sowie Kontaktinformationen.
        </p>
      </section>

      <section class="site-card p-6 text-sm">
        <h2 class="text-2xl font-semibold">Diensteanbieter</h2>
        <p class="mt-3">{env.legalOrganizationName}</p>
        <p>{env.legalRepresentative}</p>
        <p>{env.legalStreet}</p>
        <p>
          {env.legalPostalCode} {env.legalCity}
        </p>
      </section>

      <section class="site-card p-6 text-sm">
        <h2 class="text-2xl font-semibold">Kontakt</h2>
        <p class="mt-3">
          E-Mail:{" "}
          <a class="underline" href={`mailto:${env.legalEmail}`}>
            {env.legalEmail}
          </a>
        </p>
        <p>
          Telefon:{" "}
          <a class="underline" href={`tel:${env.legalPhone}`}>
            {env.legalPhone}
          </a>
        </p>
      </section>
    </div>,
  );
});
