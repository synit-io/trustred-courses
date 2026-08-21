import { env } from "@/lib/env.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const datenschutzPage = new Hono<AppEnv>().get("/", (c) => {
  return c.render(
    <div class="space-y-6">
      <section class="hero-panel">
        <p class="page-eyebrow">
          Datenschutz
        </p>
        <h1 class="mt-2 text-4xl font-bold">Datenschutzerklärung</h1>
        <p class="text-body mt-3 text-sm">
          Informationen zur Verarbeitung personenbezogener Daten in dieser
          Anwendung.
        </p>
      </section>

      <section class="site-card space-y-3 p-6 text-sm">
        <h2 class="text-2xl font-semibold">Verantwortliche Stelle</h2>
        <p>{env.legalOrganizationName}</p>
        <p>{env.legalRepresentative}</p>
        <p>{env.legalStreet}</p>
        <p>
          {env.legalPostalCode} {env.legalCity}
        </p>
        <p>
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

      <section class="site-card space-y-3 p-6 text-sm">
        <h2 class="text-2xl font-semibold">Zwecke der Verarbeitung</h2>
        <ul class="list-disc space-y-2 pl-5">
          <li>Verwaltung von Kursangeboten und Kursanmeldungen.</li>
          <li>Versand von Bestätigungs- und Status-E-Mails.</li>
        </ul>
      </section>

      <section class="site-card space-y-3 p-6 text-sm">
        <h2 class="text-2xl font-semibold">
          Drittanbieter und externe Inhalte
        </h2>
        <p>
          In der Anwendung werden derzeit folgende externe Ressourcen oder
          Dienste genutzt:
        </p>
        <ul class="list-disc space-y-2 pl-5">
          <li>Google Fonts zur Darstellung eingebundener Schriftarten.</li>
        </ul>
      </section>

      <section class="site-card space-y-3 p-6 text-sm">
        <h2 class="text-2xl font-semibold">Speicherdauer</h2>
        <p>
          Registrierungs-, Audit- und Kommunikationsdaten werden für den Betrieb
          und die Nachvollziehbarkeit gespeichert.
        </p>
      </section>

      <section class="site-card space-y-3 p-6 text-sm">
        <h2 class="text-2xl font-semibold">Ihre Rechte</h2>
        <p>
          Sie haben insbesondere das Recht auf Auskunft, Berichtigung, Löschung,
          Einschränkung der Verarbeitung sowie Datenübertragbarkeit nach den
          gesetzlichen Vorgaben. Für Anliegen wenden Sie sich an die oben
          genannten Kontaktdaten.
        </p>
      </section>
    </div>,
  );
});
