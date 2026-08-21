import {
  queryRegistrationRows,
  type RegistrationDashboardFilters,
} from "@/lib/admin/registration_rows.ts";
import { hasRole } from "@/lib/auth/roles.ts";
import type { RegistrationStatus } from "@/lib/types.ts";
import type { AppEnv } from "@/src/app/context.ts";
import {
  statusClasses,
  toRegistrationStatusLabel,
} from "@/src/routes/shared/constants.ts";
import { Hono } from "hono";

export const adminDashboardPage = new Hono<AppEnv>().get(
  "/dashboard",
  async (c) => {
    const sessionUser = c.get("sessionUser");
    const filters: RegistrationDashboardFilters = {
      q: c.req.query("q") ?? undefined,
      status: (c.req.query("status") as RegistrationStatus | "all") ?? "all",
      courseId: c.req.query("courseId") ?? "all",
      dateFrom: c.req.query("dateFrom") ?? undefined,
      dateTo: c.req.query("dateTo") ?? undefined,
    };

    const { rows, courses: filterCourses } = await queryRegistrationRows(
      filters,
    );

    const stats = {
      total: rows.length,
      pending: rows.filter((row) => row.status === "pending_review").length,
      waitlisted: rows.filter((row) => row.status === "waitlisted").length,
      approved: rows.filter((row) => row.status === "approved").length,
    };
    const canManageCourses = sessionUser
      ? hasRole(sessionUser.role, "admin")
      : false;

    return c.render(
      <div class="space-y-7">
        <section class="hero-surface">
          <span class="section-kicker">Kursverwaltung</span>
          <div class="mt-3 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <h1 class="text-4xl font-bold">Administration</h1>
              <p class="text-body mt-3 max-w-3xl text-sm sm:text-base">
                Kurse, Anmeldungen und Wartelisten verwalten.
              </p>
            </div>
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <article class="fact-tile">
                <p class="text-label">
                  Fokus heute
                </p>
                <p class="metric-value mt-1 text-lg font-semibold">
                  {stats.pending} offene Prüfungen
                </p>
              </article>
              <article class="fact-tile">
                <p class="text-label">
                  Warteliste aktiv
                </p>
                <p class="metric-value mt-1 text-lg font-semibold">
                  {stats.waitlisted} Eintrage
                </p>
              </article>
            </div>
          </div>
        </section>

        <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article class="fact-tile">
            <p class="text-label">Gesamt</p>
            <p class="metric-value mt-1 text-3xl font-display">
              {stats.total}
            </p>
          </article>
          <article class="fact-tile">
            <p class="text-label">
              Ausstehend
            </p>
            <p class="metric-value-warning mt-1 text-3xl font-display">
              {stats.pending}
            </p>
          </article>
          <article class="fact-tile">
            <p class="text-label">
              Warteliste
            </p>
            <p class="metric-value-warning mt-1 text-3xl font-display">
              {stats.waitlisted}
            </p>
          </article>
          <article class="fact-tile">
            <p class="text-label">
              Zugesagt
            </p>
            <p class="metric-value-success mt-1 text-3xl font-display">
              {stats.approved}
            </p>
          </article>
        </section>

        {canManageCourses
          ? (
            <section class="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div class="site-card p-4 sm:p-5">
                <div class="mb-3 flex items-center justify-between gap-2">
                  <h2 class="text-2xl font-semibold">Neuen Kurs anlegen</h2>
                  <span class="section-kicker">Admin</span>
                </div>
                <form
                  action="/api/admin/courses/create"
                  class="grid gap-3 md:grid-cols-2"
                  method="post"
                >
                  <label class="text-sm" htmlFor="courseTitle">
                    <span class="mb-1 block font-semibold">Titel</span>
                    <input
                      class="input-field"
                      id="courseTitle"
                      name="title"
                      required
                    />
                  </label>
                  <label class="text-sm" htmlFor="courseLocation">
                    <span class="mb-1 block font-semibold">Ort</span>
                    <input
                      class="input-field"
                      id="courseLocation"
                      name="location"
                      required
                    />
                  </label>
                  <label
                    class="text-sm md:col-span-2"
                    htmlFor="courseDescription"
                  >
                    <span class="mb-1 block font-semibold">Beschreibung</span>
                    <textarea
                      class="input-field min-h-24"
                      id="courseDescription"
                      name="description"
                      required
                    />
                  </label>
                  <label class="text-sm" htmlFor="courseStartsAt">
                    <span class="mb-1 block font-semibold">Kursbeginn</span>
                    <input
                      class="input-field"
                      id="courseStartsAt"
                      lang="de-DE"
                      name="startsAt"
                      type="datetime-local"
                      required
                    />
                  </label>
                  <label class="text-sm" htmlFor="courseEndsAt">
                    <span class="mb-1 block font-semibold">Kursende</span>
                    <input
                      class="input-field"
                      id="courseEndsAt"
                      lang="de-DE"
                      name="endsAt"
                      type="datetime-local"
                      required
                    />
                  </label>
                  <label class="text-sm" htmlFor="registrationOpensAt">
                    <span class="mb-1 block font-semibold">
                      Anmeldungsstart
                    </span>
                    <input
                      class="input-field"
                      id="registrationOpensAt"
                      lang="de-DE"
                      name="registrationOpensAt"
                      type="datetime-local"
                      required
                    />
                  </label>
                  <label class="text-sm" htmlFor="registrationClosesAt">
                    <span class="mb-1 block font-semibold">Anmeldungsende</span>
                    <input
                      class="input-field"
                      id="registrationClosesAt"
                      lang="de-DE"
                      name="registrationClosesAt"
                      type="datetime-local"
                      required
                    />
                  </label>
                  <label class="text-sm" htmlFor="courseCapacity">
                    <span class="mb-1 block font-semibold">Kapazitat</span>
                    <input
                      class="input-field"
                      id="courseCapacity"
                      min="1"
                      name="capacity"
                      step="1"
                      type="number"
                      required
                    />
                  </label>
                  <label class="text-sm" htmlFor="coursePricingType">
                    <span class="mb-1 block font-semibold">Kurstyp</span>
                    <select
                      class="select-field"
                      id="coursePricingType"
                      name="pricingType"
                      required
                    >
                      <option value="free">Kostenfrei</option>
                      <option value="paid">Kostenpflichtig</option>
                    </select>
                  </label>
                  <label class="text-sm" htmlFor="courseFeeAmount">
                    <span class="mb-1 block font-semibold">
                      Kursgebühr (z.B. 49.90)
                    </span>
                    <input
                      class="input-field"
                      id="courseFeeAmount"
                      min="0"
                      name="feeAmount"
                      step="0.01"
                      type="number"
                    />
                  </label>
                  <label class="text-sm" htmlFor="courseFeeCurrency">
                    <span class="mb-1 block font-semibold">Währung</span>
                    <input
                      class="input-field"
                      id="courseFeeCurrency"
                      maxLength={3}
                      name="feeCurrency"
                      placeholder="EUR"
                      value="EUR"
                    />
                  </label>
                  <label class="text-sm" htmlFor="courseStatus">
                    <span class="mb-1 block font-semibold">Status</span>
                    <select
                      class="select-field"
                      id="courseStatus"
                      name="status"
                      required
                    >
                      <option value="active">Aktiv</option>
                      <option value="draft">Entwurf</option>
                      <option value="archived">Archiviert</option>
                    </select>
                  </label>
                  <label class="text-sm" htmlFor="courseReminderDaysBefore">
                    <span class="mb-1 block font-semibold">
                      Erinnerungstage vorher
                    </span>
                    <input
                      class="input-field"
                      id="courseReminderDaysBefore"
                      min="1"
                      max="60"
                      name="reminderDaysBefore"
                      step="1"
                      type="number"
                    />
                  </label>
                  <label class="mt-1 flex items-start gap-2 text-sm md:col-span-2">
                    <input
                      checked
                      name="waitingListEnabled"
                      type="checkbox"
                      value="on"
                    />
                    <span>Warteliste aktivieren</span>
                  </label>
                  <div class="md:col-span-2">
                    <button class="btn-primary px-4 py-2 text-sm" type="submit">
                      Kurs speichern
                    </button>
                  </div>
                </form>
              </div>

              <section class="site-card p-4 sm:p-5">
                <h2 class="text-2xl font-semibold">Kurse verwalten</h2>
                <p class="text-body-muted mt-2 text-sm">
                  Bestehende Kurse werden jetzt in einer eigenen Übersicht mit
                  Kennzahlen, Detailseite und Teilnehmerliste gepflegt.
                </p>
                <div class="mt-4 grid gap-3">
                  <article class="fact-tile">
                    <p class="text-label">
                      Neue Struktur
                    </p>
                    <p class="text-body mt-1 text-sm">
                      Erst Übersicht aller Kurse, danach Bearbeitung auf der
                      Detailseite pro Kurs.
                    </p>
                  </article>
                  <a
                    class="btn-primary px-4 py-2 text-sm"
                    href="/admin/courses"
                  >
                    Zur Kursübersicht
                  </a>
                </div>
              </section>
            </section>
          )
          : null}

        <section class="site-card p-4 sm:p-5">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-2xl font-semibold">Filter und Export</h2>
            <a
              class="btn-secondary inline-block px-3 py-2 text-xs"
              href={`/api/admin/exports/registrations.csv?${
                new URLSearchParams({
                  q: filters.q ?? "",
                  status: filters.status ?? "all",
                  courseId: filters.courseId ?? "all",
                  dateFrom: filters.dateFrom ?? "",
                  dateTo: filters.dateTo ?? "",
                }).toString()
              }`}
            >
              CSV Export
            </a>
          </div>
          <form
            action="/admin/dashboard"
            class="grid gap-3 md:grid-cols-[1fr_220px_220px_160px_160px_auto]"
            method="get"
          >
            <input
              class="input-field"
              name="q"
              placeholder="Suche nach Name, E-Mail oder Kurs"
              type="text"
              value={filters.q ?? ""}
            />
            <select class="select-field" name="status">
              <option
                selected={(filters.status ?? "all") === "all"}
                value="all"
              >
                Status: Alle
              </option>
              <option
                selected={filters.status === "submitted"}
                value="submitted"
              >
                {toRegistrationStatusLabel("submitted")}
              </option>
              <option
                selected={filters.status === "pending_review"}
                value="pending_review"
              >
                {toRegistrationStatusLabel("pending_review")}
              </option>
              <option
                selected={filters.status === "waitlisted"}
                value="waitlisted"
              >
                {toRegistrationStatusLabel("waitlisted")}
              </option>
              <option selected={filters.status === "approved"} value="approved">
                {toRegistrationStatusLabel("approved")}
              </option>
              <option selected={filters.status === "rejected"} value="rejected">
                {toRegistrationStatusLabel("rejected")}
              </option>
              <option
                selected={filters.status === "cancelled"}
                value="cancelled"
              >
                {toRegistrationStatusLabel("cancelled")}
              </option>
            </select>
            <select class="select-field" name="courseId">
              <option
                selected={(filters.courseId ?? "all") === "all"}
                value="all"
              >
                Kurs: Alle
              </option>
              {filterCourses.map((course) => (
                <option
                  key={course.id}
                  selected={filters.courseId === course.id}
                  value={course.id}
                >
                  {course.title}
                </option>
              ))}
            </select>
            <input
              class="input-field"
              name="dateFrom"
              type="date"
              value={filters.dateFrom ?? ""}
            />
            <input
              class="input-field"
              name="dateTo"
              type="date"
              value={filters.dateTo ?? ""}
            />
            <div class="flex items-center gap-2">
              <button class="btn-primary px-3 py-2 text-xs" type="submit">
                Filtern
              </button>
              <a
                class="btn-secondary px-3 py-2 text-xs"
                href="/admin/dashboard"
              >
                Reset
              </a>
            </div>
          </form>
        </section>

        <section class="site-card p-4 sm:p-5">
          <h2 class="text-2xl font-semibold">Anmeldungen</h2>
          <div class="mt-4 overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="text-meta border-b border-slate-200">
                <tr>
                  <th class="px-3 py-2 font-semibold">Eingang</th>
                  <th class="px-3 py-2 font-semibold">Teilnehmer</th>
                  <th class="px-3 py-2 font-semibold">Kurs</th>
                  <th class="px-3 py-2 font-semibold">Status</th>
                  <th class="px-3 py-2 font-semibold">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0
                  ? (
                    <tr>
                      <td class="text-body-muted px-3 py-4" colSpan={5}>
                        Keine Anmeldungen für die gewählten Filter gefunden.
                      </td>
                    </tr>
                  )
                  : null}
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    class="border-b border-slate-100 last:border-0"
                  >
                    <td class="px-3 py-3">
                      {new Date(row.submittedAt).toLocaleString("de-DE")}
                    </td>
                    <td class="px-3 py-3">
                      <div class="font-semibold">
                        {row.firstName} {row.lastName}
                      </div>
                      <div class="text-body-muted">{row.email}</div>
                    </td>
                    <td class="px-3 py-3">{row.courseTitle}</td>
                    <td class="px-3 py-3">
                      <span
                        class={statusClasses[row.status] ??
                          "status-badge status-cancelled"}
                      >
                        {toRegistrationStatusLabel(row.status)}
                      </span>
                    </td>
                    <td class="px-3 py-3">
                      <a
                        class="btn-secondary px-3 py-2 text-xs"
                        href={`/admin/registrations/${row.id}`}
                      >
                        Öffnen
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
