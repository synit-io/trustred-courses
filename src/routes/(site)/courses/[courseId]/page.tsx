import { isDemoMode } from "@/lib/env.ts";
import { Input } from "@/src/components/ui/forms.tsx";
import { getPublicCourseDetailSnapshot } from "@/lib/public_snapshot/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { toRegistrationStatusLabel } from "@/src/routes/shared/constants.ts";
import {
  formatCourseFee,
  registrationWindowState,
} from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export const courseDetailsPage = new Hono<AppEnv>().get(
  "/:courseId",
  async (c) => {
    const snapshot = await getPublicCourseDetailSnapshot(
      c.req.param("courseId"),
    );
    if (!snapshot || snapshot.course.status !== "active") {
      return c.text("Kurs nicht gefunden", 404);
    }
    const course = snapshot.course;
    const seats = snapshot.seats;
    const regWindow = registrationWindowState(course);
    const feeLabel = course.pricingType === "paid"
      ? formatCourseFee(course.feeAmountCents, course.feeCurrency)
      : "Kostenfrei";

    const success = c.req.query("success") === "1";
    const doiSent = c.req.query("doi_sent") === "1";
    const confirmed = c.req.query("confirmed") === "1";
    const confirmError = c.req.query("confirm_error") === "1";
    const paymentSuccess = c.req.query("payment_success") === "1";
    const paymentCancelled = c.req.query("payment_cancelled") === "1";
    const status = c.req.query("status") ?? "pending_review";
    const confirmDebug = c.req.query("confirm_debug");
    const courseError = c.req.query("course_error");

    return c.render(
      <div class="space-y-8">
        <section class="page-hero">
          <div class="flex flex-wrap items-center gap-2">
            <span class="section-kicker mb-0">Kursanmeldung</span>
            <span class={regWindow.className}>{regWindow.label}</span>
            {seats.full
              ? <span class="status-badge status-rejected">Ausgebucht</span>
              : null}
          </div>
          <h1 class="mt-3 max-w-4xl text-4xl sm:text-5xl">{course.title}</h1>
          <p class="text-body mt-4 max-w-3xl text-lg">
            {course.description}
          </p>
          <div class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <article class="fact-tile">
              <p class="text-label">Ort</p>
              <p class="metric-value mt-1 text-sm font-semibold">
                {course.location}
              </p>
            </article>
            <article class="fact-tile">
              <p class="text-label">Beginn</p>
              <p class="metric-value mt-1 text-sm font-semibold">
                {formatDateTime(course.startsAt)}
              </p>
            </article>
            <article class="fact-tile">
              <p class="text-label">Ende</p>
              <p class="metric-value mt-1 text-sm font-semibold">
                {formatDateTime(course.endsAt)}
              </p>
            </article>
            <article class="fact-tile">
              <p class="text-label">Verfügbarkeit</p>
              <p class="metric-value mt-1 text-sm font-semibold">
                {seats.available} freie Plätze
              </p>
              <p class="text-body-muted mt-1 text-xs">
                {seats.total} gesamt
              </p>
            </article>
            <article class="fact-tile">
              <p class="text-label">Teilnahmegebühr</p>
              <p class="metric-value mt-1 text-sm font-semibold">
                {feeLabel}
              </p>
            </article>
          </div>
        </section>

        <div class="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <section class="site-card p-6">
            <p class="section-kicker">Überblick</p>
            <h2 class="text-2xl">Kursdetails</h2>
            <dl class="mt-4 space-y-2 text-sm">
              <div>
                <dt class="inline font-semibold">Ort:</dt>{" "}
                <dd class="inline">{course.location}</dd>
              </div>
              <div>
                <dt class="inline font-semibold">Beginn:</dt>{" "}
                <dd class="inline">{formatDateTime(course.startsAt)}</dd>
              </div>
              <div>
                <dt class="inline font-semibold">Ende:</dt>{" "}
                <dd class="inline">{formatDateTime(course.endsAt)}</dd>
              </div>
              <div>
                <dt class="inline font-semibold">Teilnehmerlimit:</dt>{" "}
                <dd class="inline">
                  {seats.total} gesamt, {seats.available} verfügbar
                </dd>
              </div>
              <div>
                <dt class="inline font-semibold">Gebühr:</dt>{" "}
                <dd class="inline">{feeLabel}</dd>
              </div>
              {course.registrationOpensAt
                ? (
                  <div>
                    <dt class="inline font-semibold">Anmeldung ab:</dt>{" "}
                    <dd class="inline">
                      {formatDateTime(course.registrationOpensAt)}
                    </dd>
                  </div>
                )
                : null}
              {course.registrationClosesAt
                ? (
                  <div>
                    <dt class="inline font-semibold">Anmeldung bis:</dt>{" "}
                    <dd class="inline">
                      {formatDateTime(course.registrationClosesAt)}
                    </dd>
                  </div>
                )
                : null}
            </dl>
            {regWindow.open && seats.lowCapacity
              ? (
                <p class="callout-warning mt-4">
                  Fast ausgebucht: Es sind nur noch wenige Plätze verfügbar.
                </p>
              )
              : null}
            {regWindow.open && seats.full
              ? (
                <p class="callout-danger mt-4">
                  Ausgebucht.
                  {course.waitingListEnabled
                    ? " Du kannst dich weiterhin für die Warteliste anmelden."
                    : " Eine direkte Anmeldung ist aktuell nicht möglich."}
                </p>
              )
              : null}
            <ul class="feature-list mt-5">
              <li>
                <strong>Anmeldung</strong>
                Nach Prüfung ihrer Anmeldung erhalten Sie eine Bestätigung per
                E-Mail.
              </li>
              <li>
                <strong>Information</strong>
                {course.waitingListEnabled
                  ? "Bei voller Auslastung erfolgt die Aufnahme in die Warteliste."
                  : "Bei voller Auslastung sind keine weiteren Anmeldungen möglich."}
              </li>
              <li>
                <strong>Bearbeitung</strong>
                Die Reihenfolge der Bearbeitung richtet sich nach Verfügbarkeit
                und eingegangener Anmeldung.
              </li>
            </ul>
          </section>

          <section class="site-card p-6">
            <p class="section-kicker">Jetzt teilnehmen</p>
            <h2 class="text-2xl">Anmeldung</h2>
            <p class="text-body-muted mt-2 text-sm">
              Bitte trage deine Daten vollständig ein.
              {course.pricingType === "paid"
                ? isDemoMode()
                  ? ` Die Kursgebühr (${feeLabel}) wird im Demo-Modus nur simuliert.`
                  : ` Die Kursgebühr (${feeLabel}) wird bei der Anmeldung per PayPal bezahlt.`
                : ""}
            </p>
            <p class="text-meta mt-1 text-xs">
              <span class="required-mark">*</span> markiert Pflichtfelder.
            </p>
            <div class="mt-4 grid gap-2 sm:grid-cols-3">
              <article class="step-tile">
                <p class="step-index">1</p>
                <p class="text-label mt-2">Daten</p>
                <p class="metric-value mt-1 text-sm font-semibold">
                  Vollständig eintragen
                </p>
              </article>
              <article class="step-tile">
                <p class="step-index">2</p>
                <p class="text-label mt-2">Bestätigung</p>
                <p class="metric-value mt-1 text-sm font-semibold">
                  {course.pricingType === "paid"
                    ? "PayPal + E-Mail"
                    : "E-Mail prüfen"}
                </p>
              </article>
              <article class="step-tile">
                <p class="step-index">3</p>
                <p class="text-label mt-2">Rückmeldung</p>
                <p class="metric-value mt-1 text-sm font-semibold">
                  Status erhalten
                </p>
              </article>
            </div>
            {!regWindow.open
              ? (
                <p class="callout-warning mt-4">
                  Die Anmeldung ist aktuell nicht möglich:{" "}
                  <strong>{regWindow.label}</strong>
                </p>
              )
              : null}

            {doiSent
              ? (
                <p class="callout-info mt-4">
                  {paymentSuccess
                    ? "Zahlung erfolgreich. Bitte bestätige jetzt deine E-Mail-Adresse über den Bestätigungslink."
                    : "Bitte bestätige zuerst deine E-Mail-Adresse über den Bestätigungslink."}
                  {confirmDebug
                    ? (
                      <>
                        {" "}
                        <a class="font-semibold underline" href={confirmDebug}>
                          {isDemoMode()
                            ? "Demo-Modus: Bestätigung direkt öffnen"
                            : "Dev-Link zur Bestätigung"}
                        </a>
                      </>
                    )
                    : null}
                </p>
              )
              : null}
            {paymentCancelled
              ? (
                <p class="callout-warning mt-4">
                  Die PayPal-Zahlung wurde abgebrochen. Deine Anmeldung wurde
                  nicht übernommen.
                </p>
              )
              : null}

            {confirmError
              ? (
                <p class="callout-danger mt-4">
                  Der Bestätigungslink ist ungültig oder abgelaufen. Bitte
                  registriere dich erneut.
                </p>
              )
              : null}
            {courseError
              ? (
                <p class="callout-danger mt-4">
                  {courseError}
                </p>
              )
              : null}

            {confirmed || success
              ? (
                <p class="callout-success mt-4">
                  Anmeldung bestätigt. Status:{" "}
                  <strong>{toRegistrationStatusLabel(status)}</strong>
                </p>
              )
              : null}

            {regWindow.open && (!seats.full || course.waitingListEnabled)
              ? (
                <form
                  class="mt-5 grid gap-4 sm:grid-cols-2"
                  action="/api/registrations/create"
                  method="post"
                >
                  <input type="hidden" name="courseId" value={course.id} />
                  <Input id="firstName" label="Vorname" />
                  <Input id="lastName" label="Nachname" />
                  <Input id="street" label="Strasse" />
                  <Input id="houseNumber" label="Hausnummer" />
                  <Input id="postalCode" label="PLZ" />
                  <Input id="city" label="Ort" />
                  <Input id="email" label="E-Mail" type="email" />
                  <Input id="phone" label="Telefonnummer" required={false} />
                  <label
                    class="col-span-full mt-1 flex items-start gap-3 text-sm"
                    htmlFor="consentAccepted"
                  >
                    <input
                      id="consentAccepted"
                      name="consentAccepted"
                      type="checkbox"
                      required
                    />
                    <span>
                      <span class="required-mark">*</span>{" "}
                      Ich stimme der Verarbeitung meiner Daten für die
                      Kursanmeldung zu.
                    </span>
                  </label>
                  <button class="btn-primary col-span-full" type="submit">
                    {seats.full && course.waitingListEnabled
                      ? "Für Warteliste anmelden"
                      : course.pricingType === "paid"
                      ? "Jetzt mit PayPal bezahlen"
                      : "Jetzt anmelden"}
                  </button>
                </form>
              )
              : null}
            <div class="mt-5">
              <a class="btn-tertiary" href="/">
                Zurück zur Übersicht
              </a>
            </div>
          </section>
        </div>
      </div>,
    );
  },
);
