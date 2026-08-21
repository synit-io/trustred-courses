import { Input } from "@/src/components/ui/forms.tsx";
import { getPublicCourseDetailSnapshot } from "@/lib/public_snapshot/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { toRegistrationStatusLabel } from "@/src/routes/shared/constants.ts";
import {
  formatCourseFee,
  registrationWindowState,
} from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

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
      <div class="space-y-6">
        <section class="hero-surface">
          <div class="space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="section-kicker">Kursanmeldung</span>
              <span class={regWindow.className}>{regWindow.label}</span>
              {seats.full
                ? <span class="status-badge status-rejected">Ausgebucht</span>
                : null}
            </div>
            <h1 class="text-4xl font-bold">{course.title}</h1>
            <p class="text-body max-w-3xl text-base">
              {course.description}
            </p>
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <article class="fact-tile">
                <p class="text-label">Ort</p>
                <p class="metric-value mt-1 text-sm font-semibold">
                  {course.location}
                </p>
              </article>
              <article class="fact-tile">
                <p class="text-label">Beginn</p>
                <p class="metric-value mt-1 text-sm font-semibold">
                  {new Date(course.startsAt).toLocaleString("de-DE")}
                </p>
              </article>
              <article class="fact-tile">
                <p class="text-label">Ende</p>
                <p class="metric-value mt-1 text-sm font-semibold">
                  {new Date(course.endsAt).toLocaleString("de-DE")}
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
                  {course.pricingType === "paid"
                    ? formatCourseFee(course.feeAmountCents, course.feeCurrency)
                    : "Kostenfrei"}
                </p>
              </article>
            </div>
          </div>
        </section>

        <div class="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <section class="site-card p-6">
            <h2 class="text-2xl font-semibold">Kursdetails</h2>
            <dl class="mt-4 space-y-2 text-sm">
              <div>
                <dt class="inline font-semibold">Ort:</dt>{" "}
                <dd class="inline">{course.location}</dd>
              </div>
              <div>
                <dt class="inline font-semibold">Beginn:</dt>{" "}
                <dd class="inline">
                  {new Date(course.startsAt).toLocaleString("de-DE")}
                </dd>
              </div>
              <div>
                <dt class="inline font-semibold">Ende:</dt>{" "}
                <dd class="inline">
                  {new Date(course.endsAt).toLocaleString("de-DE")}
                </dd>
              </div>
              <div>
                <dt class="inline font-semibold">Teilnehmerlimit:</dt>{" "}
                <dd class="inline">
                  {seats.total} gesamt, {seats.available} verfügbar
                </dd>
              </div>
              <div>
                <dt class="inline font-semibold">Gebühr:</dt>{" "}
                <dd class="inline">
                  {course.pricingType === "paid"
                    ? formatCourseFee(course.feeAmountCents, course.feeCurrency)
                    : "Kostenfrei"}
                </dd>
              </div>
              {course.registrationOpensAt
                ? (
                  <div>
                    <dt class="inline font-semibold">Anmeldung ab:</dt>{" "}
                    <dd class="inline">
                      {new Date(course.registrationOpensAt).toLocaleString(
                        "de-DE",
                      )}
                    </dd>
                  </div>
                )
                : null}
              {course.registrationClosesAt
                ? (
                  <div>
                    <dt class="inline font-semibold">Anmeldung bis:</dt>{" "}
                    <dd class="inline">
                      {new Date(course.registrationClosesAt).toLocaleString(
                        "de-DE",
                      )}
                    </dd>
                  </div>
                )
                : null}
            </dl>
            {regWindow.open && seats.lowCapacity
              ? (
                <p class="callout-warning mt-3">
                  Fast ausgebucht: Es sind nur noch wenige Plätze verfügbar.
                </p>
              )
              : null}
            {regWindow.open && seats.full
              ? (
                <p class="callout-danger mt-3">
                  Ausgebucht.
                  {course.waitingListEnabled
                    ? " Du kannst dich weiterhin für die Warteliste anmelden."
                    : " Eine direkte Anmeldung ist aktuell nicht möglich."}
                </p>
              )
              : null}
            <ul class="mt-5 space-y-2 text-sm">
              <li class="fact-tile">
                <strong class="metric-value block">Anmeldung</strong>
                Nach Prüfung ihrer Anmeldung erhalten Sie eine Bestätigung per
                E-Mail.
              </li>
              <li class="fact-tile">
                <strong class="metric-value block">Information</strong>
                Bei voller Auslastung erfolgt die Aufnahme in die Warteliste.
              </li>
              <li class="fact-tile">
                <strong class="metric-value block">Bearbeitung</strong>
                Die Reihenfolge der Bearbeitung richtet sich nach Verfügbarkeit
                und eingegangener Anmeldung.
              </li>
            </ul>
          </section>

          <section class="site-card p-6">
            <h2 class="text-2xl font-semibold">Anmeldung</h2>
            <p class="text-body-muted mt-1 text-sm">
              Bitte trage deine Daten vollständig ein.
              {course.pricingType === "paid"
                ? ` Die Kursgebühr (${
                  formatCourseFee(course.feeAmountCents, course.feeCurrency)
                }) wird bei der Anmeldung per PayPal bezahlt.`
                : ""}
            </p>
            <p class="text-meta mt-1 text-xs">
              <span class="required-mark">*</span> markiert Pflichtfelder.
            </p>
            <div class="mt-4 grid gap-2 sm:grid-cols-3">
              <article class="fact-tile">
                <p class="text-label">1. Daten</p>
                <p class="metric-value mt-1 text-sm font-semibold">
                  Vollständig eintragen
                </p>
              </article>
              <article class="fact-tile">
                <p class="text-label">2. Bestätigung</p>
                <p class="metric-value mt-1 text-sm font-semibold">
                  {course.pricingType === "paid"
                    ? "PayPal + E-Mail"
                    : "E-Mail prüfen"}
                </p>
              </article>
              <article class="fact-tile">
                <p class="text-label">3. Rückmeldung</p>
                <p class="metric-value mt-1 text-sm font-semibold">
                  Status erhalten
                </p>
              </article>
            </div>
            {!regWindow.open
              ? (
                <p class="callout-warning mt-3">
                  Die Anmeldung ist aktuell nicht möglich:{" "}
                  <strong>{regWindow.label}</strong>
                </p>
              )
              : null}

            {doiSent
              ? (
                <p class="callout-info mt-3">
                  {paymentSuccess
                    ? "Zahlung erfolgreich. Bitte bestätige jetzt deine E-Mail-Adresse über den Bestätigungslink."
                    : "Bitte bestätige zuerst deine E-Mail-Adresse über den Bestätigungslink."}
                  {confirmDebug
                    ? (
                      <>
                        {" "}
                        <a class="font-semibold underline" href={confirmDebug}>
                          Dev-Link zur Bestätigung
                        </a>
                      </>
                    )
                    : null}
                </p>
              )
              : null}
            {paymentCancelled
              ? (
                <p class="callout-warning mt-3">
                  Die PayPal-Zahlung wurde abgebrochen. Deine Anmeldung wurde
                  nicht übernommen.
                </p>
              )
              : null}

            {confirmError
              ? (
                <p class="callout-danger mt-3">
                  Der Bestätigungslink ist ungültig oder abgelaufen. Bitte
                  registriere dich erneut.
                </p>
              )
              : null}
            {courseError
              ? (
                <p class="callout-danger mt-3">
                  {courseError}
                </p>
              )
              : null}

            {confirmed || success
              ? (
                <p class="callout-success mt-3">
                  Anmeldung bestätigt. Status:{" "}
                  <strong>{toRegistrationStatusLabel(status)}</strong>
                </p>
              )
              : null}

            {regWindow.open
              ? (
                <form
                  class="mt-4 grid gap-3 sm:grid-cols-2"
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
                    class="col-span-full mt-2 flex items-start gap-2 text-sm"
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
                  <button
                    class="btn-primary col-span-full px-4 py-2 text-sm"
                    type="submit"
                  >
                    {seats.full && course.waitingListEnabled
                      ? "Für Warteliste anmelden"
                      : course.pricingType === "paid"
                      ? "Jetzt mit PayPal bezahlen"
                      : "Jetzt anmelden"}
                  </button>
                </form>
              )
              : null}
            <div class="mt-4">
              <a class="btn-secondary inline-flex px-4 py-2 text-sm" href="/">
                Zurück
              </a>
            </div>
          </section>
        </div>
      </div>,
    );
  },
);
