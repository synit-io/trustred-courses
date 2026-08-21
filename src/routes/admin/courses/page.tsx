import { hasRole } from "@/lib/auth/roles.ts";
import { listCourseSummaries } from "@/lib/admin/course_summaries.ts";
import type { AppEnv } from "@/src/app/context.ts";
import {
  formatCourseFee,
  registrationWindowState,
} from "@/src/routes/shared/helpers.ts";
import { toCourseStatusLabel } from "@/src/routes/shared/constants.ts";
import { Hono } from "hono";

export const adminCoursesPage = new Hono<AppEnv>().get(
  "/courses",
  async (c) => {
    const sessionUser = c.get("sessionUser");
    const canManageCourses = sessionUser
      ? hasRole(sessionUser.role, "admin")
      : false;
    const summaries = await listCourseSummaries();
    const created = c.req.query("course_created") === "1";
    const updated = c.req.query("course_updated") === "1";
    const closed = c.req.query("course_closed") === "1";
    const deleted = c.req.query("course_deleted") === "1";
    const error = c.req.query("course_error");

    return c.render(
      <div class="space-y-6">
        <section class="hero-surface">
          <span class="section-kicker">Kurse</span>
          <h1 class="mt-3 text-4xl font-bold">Kursverwaltung</h1>
          <p class="text-body mt-3 max-w-3xl text-sm sm:text-base">
            Alle Kurse mit Status, Auslastung und Anmeldungszahlen im Überblick.
          </p>
        </section>

        {created
          ? (
            <p class="callout-success">
              Kurs wurde erfolgreich angelegt.
            </p>
          )
          : null}
        {updated
          ? (
            <p class="callout-success">
              Kurs wurde aktualisiert.
            </p>
          )
          : null}
        {closed
          ? (
            <p class="callout-warning">
              Kurs wurde geschlossen.
            </p>
          )
          : null}
        {deleted
          ? (
            <p class="callout-success">
              Kurs wurde gelöscht.
            </p>
          )
          : null}
        {error
          ? (
            <p class="callout-danger">
              Kursaktion fehlgeschlagen: {error}
            </p>
          )
          : null}

        <section class="site-card p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-2xl font-semibold">Alle Kurse</h2>
              <p class="text-body-muted mt-1 text-sm">
                Details, Bearbeitung und Teilnehmerlisten sind pro Kurs
                verfügbar.
              </p>
            </div>
            {canManageCourses
              ? (
                <a
                  class="btn-secondary px-3 py-2 text-xs"
                  href="/admin/dashboard"
                >
                  Neuen Kurs anlegen
                </a>
              )
              : null}
          </div>

          <div class="mt-4 space-y-4">
            {summaries.length === 0
              ? (
                <p class="text-body-muted text-sm">
                  Noch keine Kurse vorhanden.
                </p>
              )
              : null}
            {summaries.map((summary) => {
              const regWindow = registrationWindowState(summary.course);
              return (
                <article
                  key={summary.course.id}
                  class="fact-surface p-4"
                >
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 class="text-xl font-semibold">
                        {summary.course.title}
                      </h3>
                      <p class="text-body-muted mt-1 text-sm">
                        {summary.course.location} ·{" "}
                        {new Date(summary.course.startsAt).toLocaleString(
                          "de-DE",
                        )}
                      </p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="status-badge status-cancelled">
                        {toCourseStatusLabel(summary.course.status)}
                      </span>
                      <span class={regWindow.className}>{regWindow.label}</span>
                    </div>
                  </div>

                  <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <article class="fact-tile">
                      <p class="text-label">
                        Anmeldungen
                      </p>
                      <p class="metric-value mt-1 text-2xl font-display">
                        {summary.registrationCount}
                      </p>
                    </article>
                    <article class="fact-tile">
                      <p class="text-label">
                        Zugesagt
                      </p>
                      <p class="metric-value-success mt-1 text-2xl font-display">
                        {summary.attendeeCount}
                      </p>
                    </article>
                    <article class="fact-tile">
                      <p class="text-label">
                        Warteliste
                      </p>
                      <p class="metric-value-warning mt-1 text-2xl font-display">
                        {summary.waitlistedCount}
                      </p>
                    </article>
                    <article class="fact-tile">
                      <p class="text-label">
                        Freie Plätze
                      </p>
                      <p class="metric-value-info mt-1 text-2xl font-display">
                        {summary.availableSlots}
                      </p>
                    </article>
                  </div>

                  <div class="text-body-muted mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                    <p>
                      Kapazität {summary.course.capacity} · Kursende{" "}
                      {new Date(summary.course.endsAt).toLocaleString("de-DE")}
                      {" · Preis "}
                      {summary.course.pricingType === "paid"
                        ? formatCourseFee(
                          summary.course.feeAmountCents,
                          summary.course.feeCurrency,
                        )
                        : "Kostenfrei"}
                      {" · Erinnerung "}
                      {summary.course.reminderDaysBefore
                        ? `${summary.course.reminderDaysBefore} Tage vorher`
                        : "deaktiviert"}
                    </p>
                    <a
                      class="btn-primary px-3 py-2 text-xs"
                      href={`/admin/courses/${summary.course.id}`}
                    >
                      Details und Bearbeitung
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>,
    );
  },
);
