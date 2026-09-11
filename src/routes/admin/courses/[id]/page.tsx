import { hasRole } from "@/lib/auth/roles.ts";
import {
  DEMO_DELETE_BLOCKED_MESSAGE,
  demoModeBlocksDeletion,
} from "@/lib/demo/guards.ts";
import { getCourseSummaryById } from "@/lib/admin/course_summaries.ts";
import type { AppEnv } from "@/src/app/context.ts";
import {
  formatCourseFee,
  formatIsoForDatetimeLocal,
  registrationWindowState,
} from "@/src/routes/shared/helpers.ts";
import {
  courseStatusLabels,
  statusClasses,
  toCourseStatusLabel,
  toRegistrationStatusLabel,
} from "@/src/routes/shared/constants.ts";
import { Hono } from "hono";

function paymentStatusLabel(
  paymentStatus?: string,
  paymentProvider?: string | null,
): string {
  if (paymentStatus === "paid") {
    return paymentProvider === "demo" ? "Bezahlt (Demo)" : "Bezahlt";
  }
  if (paymentStatus === "not_required") return "Nicht erforderlich";
  return "Offen";
}

export const adminCourseDetailPage = new Hono<AppEnv>().get(
  "/courses/:id",
  async (c) => {
    const sessionUser = c.get("sessionUser");
    const canManageCourses = sessionUser
      ? hasRole(sessionUser.role, "admin")
      : false;
    const summary = await getCourseSummaryById(c.req.param("id"));
    if (!summary) return c.text("Kurs nicht gefunden", 404);

    const { course, registrations } = summary;
    const regWindow = registrationWindowState(course);
    const updated = c.req.query("course_updated") === "1";
    const closed = c.req.query("course_closed") === "1";
    const error = c.req.query("course_error");

    return c.render(
      <div class="space-y-6">
        <section class="hero-surface">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span class="section-kicker">Kursdetails</span>
              <h1 class="mt-3 text-4xl">{course.title}</h1>
              <p class="text-body mt-3 max-w-3xl text-sm sm:text-base">
                {course.description}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="status-badge status-cancelled">
                {toCourseStatusLabel(course.status)}
              </span>
              <span class={regWindow.className}>{regWindow.label}</span>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <a class="btn-secondary btn-sm" href="/admin/courses">
              Zur Kursübersicht
            </a>
            <a class="btn-secondary btn-sm" href="/admin/dashboard">
              Zur Administration
            </a>
          </div>
        </section>

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
        {error
          ? (
            <p class="callout-danger">
              Kursaktion fehlgeschlagen: {error}
            </p>
          )
          : null}

        <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article class="fact-tile">
            <p class="text-label">
              Anmeldungen
            </p>
            <p class="stat-number mt-1">
              {summary.registrationCount}
            </p>
          </article>
          <article class="fact-tile">
            <p class="text-label">
              Zugesagt
            </p>
            <p class="stat-number stat-number-success mt-1">
              {summary.attendeeCount}
            </p>
          </article>
          <article class="fact-tile">
            <p class="text-label">
              Warteliste
            </p>
            <p class="stat-number stat-number-warning mt-1">
              {summary.waitlistedCount}
            </p>
          </article>
          <article class="fact-tile">
            <p class="text-label">
              Freie Plätze
            </p>
            <p class="stat-number stat-number-info mt-1">
              {summary.availableSlots}
            </p>
          </article>
          <article class="fact-tile">
            <p class="text-label">
              Kursgebühr
            </p>
            <p class="stat-number stat-number-sm mt-1">
              {course.pricingType === "paid"
                ? formatCourseFee(course.feeAmountCents, course.feeCurrency)
                : "Kostenfrei"}
            </p>
          </article>
          <article class="fact-tile">
            <p class="text-label">
              Gesamtumsatz
            </p>
            <p class="stat-number stat-number-success stat-number-sm mt-1">
              {course.pricingType === "paid"
                ? formatCourseFee(summary.totalRevenueCents, course.feeCurrency)
                : "-"}
            </p>
            {course.pricingType === "paid"
              ? (
                <p class="text-body-muted mt-1 text-xs">
                  {summary.paidRegistrationCount} bezahlt
                </p>
              )
              : null}
          </article>
        </section>

        {canManageCourses
          ? (
            <section class="site-card p-5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="text-2xl">Kurs bearbeiten</h2>
                  <p class="text-body-muted mt-1 text-sm">
                    Stammdaten, Zeitraum, Status und Warteliste verwalten.
                  </p>
                </div>
              </div>
              <form
                action={`/api/admin/courses/${course.id}/update`}
                class="mt-4 grid gap-3 md:grid-cols-2"
                method="post"
              >
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Titel</span>
                  <input
                    class="input-field"
                    name="title"
                    required
                    type="text"
                    value={course.title}
                  />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Ort</span>
                  <input
                    class="input-field"
                    name="location"
                    required
                    type="text"
                    value={course.location}
                  />
                </label>
                <label class="text-sm md:col-span-2">
                  <span class="mb-1 block font-semibold">Beschreibung</span>
                  <textarea
                    class="input-field min-h-20"
                    name="description"
                    required
                  >
                    {course.description}
                  </textarea>
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Kursbeginn</span>
                  <input
                    class="input-field"
                    lang="de-DE"
                    name="startsAt"
                    required
                    type="datetime-local"
                    value={formatIsoForDatetimeLocal(course.startsAt)}
                  />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Kursende</span>
                  <input
                    class="input-field"
                    lang="de-DE"
                    name="endsAt"
                    required
                    type="datetime-local"
                    value={formatIsoForDatetimeLocal(course.endsAt)}
                  />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Anmeldungsstart</span>
                  <input
                    class="input-field"
                    lang="de-DE"
                    name="registrationOpensAt"
                    required
                    type="datetime-local"
                    value={formatIsoForDatetimeLocal(
                      course.registrationOpensAt,
                    )}
                  />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Anmeldungsende</span>
                  <input
                    class="input-field"
                    lang="de-DE"
                    name="registrationClosesAt"
                    required
                    type="datetime-local"
                    value={formatIsoForDatetimeLocal(
                      course.registrationClosesAt,
                    )}
                  />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Kapazitat</span>
                  <input
                    class="input-field"
                    min="1"
                    name="capacity"
                    required
                    step="1"
                    type="number"
                    value={String(course.capacity)}
                  />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Kurstyp</span>
                  <select class="select-field" name="pricingType" required>
                    <option
                      selected={(course.pricingType ?? "free") === "free"}
                      value="free"
                    >
                      Kostenfrei
                    </option>
                    <option
                      selected={course.pricingType === "paid"}
                      value="paid"
                    >
                      Kostenpflichtig
                    </option>
                  </select>
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Kursgebühr</span>
                  <input
                    class="input-field"
                    min="0"
                    name="feeAmount"
                    step="0.01"
                    type="number"
                    value={course.pricingType === "paid" &&
                        (course.feeAmountCents ?? 0) > 0
                      ? ((course.feeAmountCents ?? 0) / 100).toFixed(2)
                      : ""}
                  />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Währung</span>
                  <input
                    class="input-field"
                    maxLength={3}
                    name="feeCurrency"
                    value={course.feeCurrency ?? "EUR"}
                  />
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">Status</span>
                  <select class="select-field" name="status" required>
                    <option
                      selected={course.status === "active"}
                      value="active"
                    >
                      {courseStatusLabels.active}
                    </option>
                    <option selected={course.status === "draft"} value="draft">
                      {courseStatusLabels.draft}
                    </option>
                    <option
                      selected={course.status === "archived"}
                      value="archived"
                    >
                      {courseStatusLabels.archived}
                    </option>
                  </select>
                </label>
                <label class="text-sm">
                  <span class="mb-1 block font-semibold">
                    Erinnerungstage vorher
                  </span>
                  <input
                    class="input-field"
                    min="1"
                    max="60"
                    name="reminderDaysBefore"
                    step="1"
                    type="number"
                    value={course.reminderDaysBefore
                      ? String(course.reminderDaysBefore)
                      : ""}
                  />
                </label>
                <label class="mt-1 flex items-start gap-2 text-sm">
                  <input
                    checked={course.waitingListEnabled}
                    name="waitingListEnabled"
                    type="checkbox"
                    value="on"
                  />
                  <span>Warteliste aktivieren</span>
                </label>
                <div class="flex flex-wrap items-center gap-2 md:col-span-2">
                  <button class="btn-primary btn-sm" type="submit">
                    Kurs aktualisieren
                  </button>
                  <span class="text-meta text-xs">
                    Leer lassen, um keine automatische Erinnerung zu senden.
                  </span>
                </div>
              </form>
              <div class="mt-4 flex flex-wrap gap-2">
                <form
                  action={`/api/admin/courses/${course.id}/close`}
                  method="post"
                >
                  <button
                    class="btn-secondary btn-sm"
                    type="submit"
                  >
                    Schliessen
                  </button>
                </form>
                {demoModeBlocksDeletion()
                  ? (
                    <span class="text-meta self-center text-xs">
                      {DEMO_DELETE_BLOCKED_MESSAGE}
                    </span>
                  )
                  : (
                    <form
                      action={`/api/admin/courses/${course.id}/delete`}
                      method="post"
                    >
                      <button
                        class="btn-destructive btn-sm"
                        type="submit"
                      >
                        Löschen
                      </button>
                    </form>
                  )}
              </div>
            </section>
          )
          : null}

        <section class="site-card p-5">
          <h2 class="text-2xl">Teilnehmer und Anmeldungen</h2>
          <p class="text-body-muted mt-1 text-sm">
            Alle Anmeldungen für diesen Kurs mit aktuellem Bearbeitungsstatus.
          </p>
          <div class="data-table-wrap mt-4">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>E-Mail</th>
                  <th>Telefon</th>
                  <th>Status</th>
                  <th>Zahlung</th>
                  <th>Eingang</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {registrations.length === 0
                  ? (
                    <tr>
                      <td class="text-body-muted" colSpan={7}>
                        Noch keine Anmeldungen für diesen Kurs vorhanden.
                      </td>
                    </tr>
                  )
                  : null}
                {registrations.map((registration) => (
                  <tr key={registration.id}>
                    <td>
                      <div class="font-semibold">
                        {registration.firstName} {registration.lastName}
                      </div>
                    </td>
                    <td>{registration.email}</td>
                    <td>{registration.phone || "-"}</td>
                    <td>
                      <span
                        class={statusClasses[registration.status] ??
                          "status-badge status-cancelled"}
                      >
                        {toRegistrationStatusLabel(registration.status)}
                      </span>
                    </td>
                    <td>
                      <div class="space-y-1">
                        <span class="status-badge status-info">
                          {paymentStatusLabel(
                            registration.paymentStatus,
                            registration.paymentProvider,
                          )}
                        </span>
                        {registration.paymentStatus === "paid"
                          ? (
                            <p class="text-meta text-xs">
                              {formatCourseFee(
                                registration.paymentAmountCents,
                                registration.paymentCurrency ??
                                  course.feeCurrency,
                              )}
                            </p>
                          )
                          : null}
                      </div>
                    </td>
                    <td>
                      {new Date(registration.submittedAt).toLocaleString(
                        "de-DE",
                      )}
                    </td>
                    <td>
                      <a
                        class="btn-secondary btn-sm"
                        href={`/admin/registrations/${registration.id}`}
                      >
                        Details
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>,
    );
  },
);
