import { listAuditLogsByEntity } from "@/lib/audit/repository.ts";
import { getCourseById } from "@/lib/courses/repository.ts";
import { listEmailLogsByRegistration } from "@/lib/email/repository.ts";
import { getRegistrationById } from "@/lib/registrations/repository.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { LogPager } from "@/src/components/ui/log-pager.tsx";
import {
  LOG_PAGE_SIZE,
  statusClasses,
  toRegistrationActionLabel,
  toRegistrationEmailEventLabel,
  toRegistrationStatusLabel,
} from "@/src/routes/shared/constants.ts";
import {
  availableActions,
  parsePage,
  resendEventOptionsForStatus,
  toDefaultEvent,
} from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

interface TimelineItem {
  id: string;
  ts: string;
  title: string;
  label: string;
  tone: "neutral" | "success" | "warning" | "danger";
  details: string[];
}

function timelineDetailClass(detail: string): string {
  if (detail.startsWith("Nachricht an Teilnehmer:")) {
    return "timeline-detail timeline-detail-public";
  }
  if (detail.startsWith("Interne Notiz:")) {
    return "timeline-detail timeline-detail-internal";
  }
  return "timeline-detail";
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function labelForAuditAction(action: string): {
  title: string;
  label: string;
  tone: TimelineItem["tone"];
} {
  if (action === "registration.double_opt_in_requested") {
    return {
      title: "Double-Opt-in angefordert",
      label: "System",
      tone: "neutral",
    };
  }
  if (action === "registration.double_opt_in_confirmed") {
    return {
      title: "Double-Opt-in bestätigt",
      label: "System",
      tone: "success",
    };
  }
  if (action === "registration.submitted") {
    return {
      title: "Anmeldung eingegangen",
      label: "Status",
      tone: "success",
    };
  }
  if (action === "registration.resend_email") {
    return {
      title: "E-Mail manuell erneut versendet",
      label: "E-Mail",
      tone: "neutral",
    };
  }
  if (action.startsWith("registration.")) {
    const raw = action.replace("registration.", "");
    const map: Record<string, string> = {
      approve: "Status auf Zugesagt gesetzt",
      reject: "Status auf Abgelehnt gesetzt",
      waitlist: "Status auf Warteliste gesetzt",
      promote: "Von Warteliste zu Zugesagt geändert",
      cancel: "Status auf Storniert gesetzt",
    };
    return {
      title: map[raw] ?? action,
      label: "Status",
      tone: raw === "reject" || raw === "cancel"
        ? "danger"
        : raw === "waitlist"
        ? "warning"
        : "success",
    };
  }
  return { title: action, label: "Historie", tone: "neutral" };
}

function toneClass(tone: TimelineItem["tone"]): string {
  if (tone === "success") return "status-badge status-approved";
  if (tone === "warning") return "status-badge status-waitlisted";
  if (tone === "danger") return "status-badge status-rejected";
  return "status-badge status-cancelled";
}

function buildAuditTimelineItem(
  log: {
    id: string;
    createdAt: string;
    action: string;
    oldValue: string | null;
    newValue: string | null;
  },
): TimelineItem {
  const oldValue = parseJsonObject(log.oldValue);
  const newValue = parseJsonObject(log.newValue);
  const meta = labelForAuditAction(log.action);
  const details: string[] = [];

  if (log.action === "registration.resend_email") {
    const event = stringifyValue(newValue?.event);
    if (event) {
      details.push(`Vorlage: ${toRegistrationEmailEventLabel(event)}`);
    }
  } else {
    const nextStatus = stringifyValue(newValue?.status);
    if (nextStatus) {
      details.push(`Status: ${toRegistrationStatusLabel(nextStatus)}`);
    }

    const oldMessage = stringifyValue(oldValue?.adminMessage);
    const newMessage = stringifyValue(newValue?.adminMessage);
    if (newMessage && newMessage !== oldMessage) {
      details.push(`Nachricht an Teilnehmer: ${newMessage}`);
    }

    const oldNotes = stringifyValue(oldValue?.internalNotes);
    const newNotes = stringifyValue(newValue?.internalNotes);
    if (newNotes && newNotes !== oldNotes) {
      details.push(`Interne Notiz: ${newNotes}`);
    }

    const waitPos = stringifyValue(newValue?.waitingListPosition);
    if (waitPos) {
      details.push(`Wartelistenposition: ${waitPos}`);
    }
  }

  return {
    id: `audit-${log.id}`,
    ts: log.createdAt,
    title: meta.title,
    label: meta.label,
    tone: meta.tone,
    details,
  };
}

function buildEmailTimelineItem(
  log: {
    id: string;
    sentAt: string;
    subject: string;
    templateKey: string;
    recipientEmail: string;
    deliveryStatus: string;
    attempt: number;
    errorMessage: string | null;
  },
): TimelineItem {
  const success = log.deliveryStatus === "sent";
  const details = [
    `Vorlage: ${toRegistrationEmailEventLabel(log.templateKey)}`,
    `Empfänger: ${log.recipientEmail}`,
    `Betreff: ${log.subject}`,
    `Versuch: ${log.attempt}`,
  ];
  if (log.errorMessage) {
    details.push(`Fehler: ${log.errorMessage}`);
  }

  return {
    id: `email-${log.id}`,
    ts: log.sentAt,
    title: success ? "E-Mail versendet" : "E-Mail fehlgeschlagen",
    label: "E-Mail",
    tone: success ? "success" : "danger",
    details,
  };
}

function paginateTimeline(
  items: TimelineItem[],
  page: number,
  pageSize: number,
) {
  const safePage = Math.max(1, Math.floor(page));
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page: safePage,
    pageSize,
  };
}

export const adminRegistrationDetailPage = new Hono<AppEnv>().get(
  "/:id",
  async (c) => {
    const registration = await getRegistrationById(c.req.param("id"));
    if (!registration) return c.text("Anmeldung nicht gefunden", 404);

    const [course, auditLogs, emailLogs] = await Promise.all([
      getCourseById(registration.courseId),
      listAuditLogsByEntity("registration", registration.id),
      listEmailLogsByRegistration(registration.id),
    ]);

    const updated = c.req.query("updated") === "1";
    const resent = c.req.query("resent") === "1";
    const error = c.req.query("error");
    const queryString = new URL(c.req.url).searchParams.toString();
    const resendOptions = resendEventOptionsForStatus(registration.status);

    const timelineItems = [
      ...auditLogs.map(buildAuditTimelineItem),
      ...emailLogs.map(buildEmailTimelineItem),
    ].sort((a, b) => b.ts.localeCompare(a.ts));
    const timelinePage = paginateTimeline(
      timelineItems,
      parsePage(c.req.query("timelinePage") ?? null),
      LOG_PAGE_SIZE,
    );

    return c.render(
      <div class="space-y-6">
        <section class="hero-panel">
          <p class="page-eyebrow">
            Anmeldungsdetails
          </p>
          <h1 class="mt-2 text-3xl font-bold">
            {registration.firstName} {registration.lastName}
          </h1>
          <p class="text-body mt-2 text-sm">
            Kurs: <strong>{course?.title ?? "Unbekannter Kurs"}</strong>{" "}
            <span
              class={statusClasses[registration.status] ??
                "status-badge status-cancelled"}
            >
              {toRegistrationStatusLabel(registration.status)}
            </span>
          </p>
        </section>

        {updated
          ? (
            <p class="callout-success">
              Status wurde aktualisiert.
            </p>
          )
          : null}
        {resent
          ? (
            <p class="callout-success">
              E-Mail wurde erneut versendet.
            </p>
          )
          : null}
        {error
          ? (
            <p class="callout-danger">
              Aktion fehlgeschlagen: {error}
            </p>
          )
          : null}

        <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section class="site-card p-5">
            <h2 class="text-2xl font-semibold">Teilnehmerdaten</h2>
            <dl class="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt class="font-semibold">Vorname</dt>
                <dd>{registration.firstName}</dd>
              </div>
              <div>
                <dt class="font-semibold">Nachname</dt>
                <dd>{registration.lastName}</dd>
              </div>
              <div>
                <dt class="font-semibold">E-Mail</dt>
                <dd>{registration.email}</dd>
              </div>
              <div>
                <dt class="font-semibold">Telefon</dt>
                <dd>{registration.phone || "-"}</dd>
              </div>
              <div>
                <dt class="font-semibold">Straße</dt>
                <dd>{registration.street} {registration.houseNumber}</dd>
              </div>
              <div>
                <dt class="font-semibold">Ort</dt>
                <dd>{registration.postalCode} {registration.city}</dd>
              </div>
              <div class="sm:col-span-2">
                <dt class="font-semibold">Letzte Nachricht an Teilnehmer</dt>
                <dd>{registration.adminMessage || "-"}</dd>
              </div>
              <div class="sm:col-span-2">
                <dt class="font-semibold">Interne Notiz</dt>
                <dd>{registration.internalNotes || "-"}</dd>
              </div>
            </dl>
          </section>

          <aside class="space-y-4">
            <section class="site-card p-5">
              <h2 class="text-2xl font-semibold">Statusaktion</h2>
              {availableActions(registration.status).length === 0
                ? (
                  <p class="text-body-muted mt-3 text-sm">
                    Für den aktuellen Status sind keine Aktionen verfügbar.
                  </p>
                )
                : (
                  <form
                    action={`/api/admin/registrations/${registration.id}/action`}
                    class="mt-3 space-y-3"
                    method="post"
                  >
                    <label class="block text-sm" htmlFor="action">
                      <span class="mb-1 block font-semibold">Aktion</span>
                      <select
                        class="select-field"
                        id="action"
                        name="action"
                        required
                      >
                        {availableActions(registration.status).map((action) => (
                          <option key={action} value={action}>
                            {toRegistrationActionLabel(action)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label class="block text-sm" htmlFor="adminMessage">
                      <span class="mb-1 block font-semibold">
                        Nachricht an Teilnehmer
                      </span>
                      <span class="text-meta mb-2 block text-xs">
                        Startet bewusst leer, damit die Nachricht zum neuen
                        Status passt.
                      </span>
                      <textarea
                        class="input-field min-h-24"
                        id="adminMessage"
                        name="adminMessage"
                      />
                    </label>
                    <label class="block text-sm" htmlFor="internalNotes">
                      <span class="mb-1 block font-semibold">
                        Interne Notiz
                      </span>
                      <span class="text-meta mb-2 block text-xs">
                        Frühere Notizen werden nicht übernommen und können bei
                        Bedarf neu formuliert werden.
                      </span>
                      <textarea
                        class="input-field min-h-24"
                        id="internalNotes"
                        name="internalNotes"
                      />
                    </label>
                    <button
                      class="btn-primary w-full px-4 py-2 text-sm"
                      type="submit"
                    >
                      Status aktualisieren
                    </button>
                  </form>
                )}
            </section>

            <section class="site-card p-5">
              <h2 class="text-2xl font-semibold">E-Mail erneut senden</h2>
              {resendOptions.length === 0
                ? (
                  <p class="text-body-muted mt-3 text-sm">
                    Für diesen Status kann keine Status-E-Mail erneut versendet
                    werden.
                  </p>
                )
                : (
                  <form
                    action={`/api/admin/registrations/${registration.id}/resend`}
                    class="mt-3 space-y-3"
                    method="post"
                  >
                    <label class="block text-sm" htmlFor="event">
                      <span class="mb-1 block font-semibold">Vorlage</span>
                      <select class="select-field" id="event" name="event">
                        {resendOptions.map((event) => (
                          <option
                            key={event}
                            selected={event ===
                              toDefaultEvent(registration.status)}
                            value={event}
                          >
                            {toRegistrationEmailEventLabel(event)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      class="btn-secondary w-full px-4 py-2 text-sm"
                      type="submit"
                    >
                      E-Mail senden
                    </button>
                  </form>
                )}
            </section>
          </aside>
        </div>

        <section class="site-card p-5">
          <h2 class="text-2xl font-semibold">Verlauf</h2>
          <p class="text-body-muted mt-1 text-sm">
            Gemeinsame Timeline aus Statusänderungen, Notizen und versendeten
            E-Mails.
          </p>
          <ul class="mt-4 space-y-3 text-sm">
            {timelinePage.items.length === 0
              ? (
                <li class="text-body-muted">
                  Noch keine Einträge für diese Anmeldung vorhanden.
                </li>
              )
              : null}
            {timelinePage.items.map((item) => (
              <li
                class="fact-surface p-3"
                key={item.id}
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="font-semibold">{item.title}</p>
                  <span class={toneClass(item.tone)}>{item.label}</span>
                </div>
                <p class="text-body-muted mt-1">
                  {new Date(item.ts).toLocaleString("de-DE")}
                </p>
                {item.details.length > 0
                  ? (
                    <ul class="text-body mt-2 space-y-1 text-xs">
                      {item.details.map((detail) => (
                        <li class={timelineDetailClass(detail)} key={detail}>
                          {detail}
                        </li>
                      ))}
                    </ul>
                  )
                  : null}
              </li>
            ))}
          </ul>
          <LogPager
            page={timelinePage}
            pageParamKey="timelinePage"
            queryString={queryString}
            registrationId={registration.id}
          />
        </section>
      </div>,
    );
  },
);
