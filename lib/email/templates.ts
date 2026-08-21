import { env } from "../env.ts";
import type { Course, Registration } from "../types.ts";

export type RegistrationEmailEvent =
  | "registration_received"
  | "pending_review"
  | "waitlisted"
  | "approved"
  | "rejected"
  | "promoted"
  | "cancelled";

export type CourseBroadcastEvent =
  | "course_cancelled"
  | "course_critical_update"
  | "course_reminder";

export interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

export interface CourseChangeDetails {
  location?: { before: string; after: string };
  startsAt?: { before: string; after: string };
  endsAt?: { before: string; after: string };
}

interface HtmlEmailOptions {
  title: string;
  eyebrow?: string;
  intro: string;
  statusTone?: "info" | "success" | "warning" | "danger" | "neutral";
  facts?: Array<{ label: string; value: string }>;
  callout?: string;
  action?: { label: string; href: string };
  detailsList?: string[];
  footerNote?: string;
}

function formatCourseDate(value: string | null): string {
  if (!value) return "Nicht angegeben";
  return new Date(value).toLocaleString("de-DE");
}

function courseFacts(course: Course): Array<{ label: string; value: string }> {
  return [
    { label: "Kurs", value: course.title },
    { label: "Ort", value: course.location },
    { label: "Beginn", value: formatCourseDate(course.startsAt) },
    { label: "Ende", value: formatCourseDate(course.endsAt) },
    {
      label: "Anmeldung bis",
      value: formatCourseDate(course.registrationClosesAt),
    },
  ];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderFactsHtml(
  facts: Array<{ label: string; value: string }>,
): string {
  return facts.map((fact) =>
    `<tr><td style="padding:0 0 10px;vertical-align:top;font-weight:700;color:#131b22;width:132px;">${
      escapeHtml(fact.label)
    }</td><td style="padding:0 0 10px;color:#24313d;">${
      escapeHtml(fact.value)
    }</td></tr>`
  ).join("");
}

function renderListHtml(items: string[]): string {
  return items.map((item) =>
    `<li style="margin:0 0 8px 18px;color:#24313d;">${escapeHtml(item)}</li>`
  ).join("");
}

function renderTextFacts(
  facts: Array<{ label: string; value: string }>,
): string[] {
  return facts.map((fact) => `${fact.label}: ${fact.value}`);
}

function toneTokens(
  tone: HtmlEmailOptions["statusTone"] = "neutral",
): { bg: string; border: string; fg: string; label: string } {
  if (tone === "success") {
    return {
      bg: "#f0fdf4",
      border: "#86efac",
      fg: "#166534",
      label: "Status: Bestätigt",
    };
  }
  if (tone === "warning") {
    return {
      bg: "#fffbeb",
      border: "#fcd34d",
      fg: "#b45309",
      label: "Status: Aufmerksamkeit erforderlich",
    };
  }
  if (tone === "danger") {
    return {
      bg: "#fef2f2",
      border: "#fca5a5",
      fg: "#b91c1c",
      label: "Status: Wichtige Änderung",
    };
  }
  if (tone === "info") {
    return {
      bg: "#eff6ff",
      border: "#93c5fd",
      fg: "#1d4ed8",
      label: "Status: Information",
    };
  }
  return {
    bg: "#f8fafc",
    border: "#cbd5e1",
    fg: "#475569",
    label: "Status: Hinweis",
  };
}

function renderHtmlEmail(options: HtmlEmailOptions): string {
  const facts = options.facts ?? [];
  const details = options.detailsList ?? [];
  const tone = toneTokens(options.statusTone);

  return `
<!doctype html>
<html lang="de">
  <body style="margin:0;padding:0;background:#f8fafc;font-family:'Source Sans 3','Segoe UI',Arial,sans-serif;color:#334155;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${
    escapeHtml(options.intro)
  }</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;">
            <tr>
              <td style="height:4px;border-radius:999px;background:#dc2626;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:18px 6px 0;color:#64748b;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
                ${escapeHtml(options.eyebrow ?? env.appName)}
              </td>
            </tr>
            <tr>
              <td style="padding-top:10px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:18px;background:#ffffff;">
                  <tr>
                    <td style="padding:28px 28px 24px;">
                      <div style="display:inline-flex;align-items:center;border:1px solid ${tone.border};border-radius:999px;background:${tone.bg};padding:6px 12px;color:${tone.fg};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">
                        ${escapeHtml(tone.label)}
                      </div>
                      <div style="font-family:Oswald,'Arial Narrow',Arial,sans-serif;font-size:30px;line-height:1.1;color:#131b22;font-weight:700;">
                        ${escapeHtml(options.title)}
                      </div>
                      <p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#334155;">
                        ${escapeHtml(options.intro)}
                      </p>
                      ${
    options.callout
      ? `<div style="margin-top:18px;border:1px solid ${tone.border};border-radius:12px;background:${tone.bg};padding:14px 16px;color:${tone.fg};font-size:15px;line-height:1.55;">${
        escapeHtml(options.callout)
      }</div>`
      : ""
  }
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top:16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:14px;background:#ffffff;">
                  <tr>
                    <td style="padding:22px 24px;">
                      <div style="font-family:Oswald,'Arial Narrow',Arial,sans-serif;font-size:22px;line-height:1.1;color:#131b22;font-weight:700;">
                        Kursdetails
                      </div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:16px;font-size:15px;line-height:1.5;">
                        ${renderFactsHtml(facts)}
                      </table>
                      ${
    details.length > 0
      ? `<div style="margin-top:8px;font-family:Oswald,'Arial Narrow',Arial,sans-serif;font-size:20px;line-height:1.1;color:#131b22;font-weight:700;">Wichtige Hinweise</div><ul style="margin:12px 0 0;padding:0 0 0 4px;font-size:15px;line-height:1.6;">${
        renderListHtml(details)
      }</ul>`
      : ""
  }
                      ${
    options.action
      ? `<div style="margin-top:22px;"><a href="${
        escapeHtml(options.action.href)
      }" style="display:inline-block;border-radius:10px;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;">${
        escapeHtml(options.action.label)
      }</a></div>`
      : ""
  }
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 0;color:#475569;font-size:13px;line-height:1.6;">
                <strong style="color:#131b22;">${
    escapeHtml(env.legalOrganizationName)
  }</strong><br/>
                Kontakt: <a href="mailto:${
    escapeHtml(env.legalEmail)
  }" style="color:#b91c1c;text-decoration:underline;">${
    escapeHtml(env.legalEmail)
  }</a>
                ${
    env.legalPhone ? `<br/>Telefon: ${escapeHtml(env.legalPhone)}` : ""
  }
                ${
    options.footerNote ? `<br/><br/>${escapeHtml(options.footerNote)}` : ""
  }
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

function renderTextEmail(options: HtmlEmailOptions): string {
  const lines = [
    options.title,
    "",
    options.statusTone
      ? `Status: ${
        toneTokens(options.statusTone).label.replace("Status: ", "")
      }`
      : "",
    options.statusTone ? "" : "",
    options.intro,
    "",
    "Kursdetails:",
    ...(options.facts ? renderTextFacts(options.facts) : []),
  ];

  if (options.callout) {
    lines.push("", options.callout);
  }

  if (options.detailsList && options.detailsList.length > 0) {
    lines.push("", "Wichtige Hinweise:");
    lines.push(...options.detailsList.map((item) => `- ${item}`));
  }

  if (options.action) {
    lines.push("", `${options.action.label}: ${options.action.href}`);
  }

  lines.push(
    "",
    `${env.legalOrganizationName}`,
    `Kontakt: ${env.legalEmail}`,
  );
  if (env.legalPhone) lines.push(`Telefon: ${env.legalPhone}`);
  if (options.footerNote) lines.push("", options.footerNote);

  return lines.join("\n");
}

function buildTemplate(
  options: HtmlEmailOptions,
  subject: string,
): EmailTemplate {
  return {
    subject,
    text: renderTextEmail(options),
    html: renderHtmlEmail(options),
  };
}

function registrationActionUrl(course: Course): string {
  return `${env.appBaseUrl.replace(/\/$/, "")}/courses/${course.id}`;
}

export function renderRegistrationDoubleOptInTemplate(
  reg: Registration,
  course: Course,
  confirmUrl: string,
): EmailTemplate {
  const subject = `Bitte E-Mail-Adresse bestätigen: ${course.title}`;
  return buildTemplate({
    eyebrow: env.appName,
    title: `Anmeldung bestätigen`,
    intro:
      `Hallo ${reg.firstName} ${reg.lastName}, bitte bestätige deine E-Mail-Adresse, damit wir deine Kursanmeldung weiterverarbeiten können.`,
    facts: courseFacts(course),
    callout:
      "Erst nach der Bestätigung deiner E-Mail-Adresse wird die Anmeldung verbindlich in unserem System erfasst.",
    action: {
      label: "E-Mail-Adresse bestätigen",
      href: confirmUrl,
    },
    detailsList: [
      "Prüfe bitte alle Kursdaten noch einmal vor der Bestätigung.",
      "Wenn du diese Anmeldung nicht selbst gestartet hast, kannst du diese Nachricht ignorieren.",
    ],
    footerNote: "Diese Nachricht wurde automatisch erzeugt.",
  }, subject);
}

export function renderRegistrationTemplate(
  event: RegistrationEmailEvent,
  reg: Registration,
  course: Course,
  customMessage?: string,
): EmailTemplate {
  const actionUrl = registrationActionUrl(course);
  const eventBody: Record<
    RegistrationEmailEvent,
    {
      subject: string;
      title: string;
      intro: string;
      statusTone?: HtmlEmailOptions["statusTone"];
      callout?: string;
      detailsList?: string[];
      action?: { label: string; href: string };
    }
  > = {
    registration_received: {
      subject: `Eingang deiner Anmeldung: ${course.title}`,
      title: "Anmeldung eingegangen",
      intro:
        `Hallo ${reg.firstName} ${reg.lastName}, deine Anmeldung ist bei uns eingegangen.`,
      statusTone: "info",
      callout:
        "Du erhältst weitere Informationen per E-Mail, sobald es für deine Anmeldung etwas Neues gibt.",
      detailsList: [
        "Bitte bewahre diese E-Mail für deine Unterlagen auf.",
        "Änderungen am Kurs werden dir ebenfalls per E-Mail mitgeteilt.",
      ],
      action: { label: "Kursdetails ansehen", href: actionUrl },
    },
    pending_review: {
      subject: `Anmeldung in Prüfung: ${course.title}`,
      title: "Anmeldung in Prüfung",
      intro:
        `Hallo ${reg.firstName} ${reg.lastName}, deine Anmeldung wird aktuell geprüft.`,
      statusTone: "warning",
    },
    waitlisted: {
      subject: `Warteliste: ${course.title}`,
      title: "Du stehst auf der Warteliste",
      statusTone: "warning",
      intro: reg.waitingListPosition
        ? `Hallo ${reg.firstName} ${reg.lastName}, aktuell bist du auf der Warteliste eingetragen. Deine Position: ${reg.waitingListPosition}.`
        : `Hallo ${reg.firstName} ${reg.lastName}, aktuell bist du auf der Warteliste eingetragen.`,
      callout:
        "Sobald ein Platz frei wird oder sich dein Status ändert, melden wir uns automatisch.",
      detailsList: [
        "Bitte prüfe dein E-Mail-Postfach regelmäßig.",
        "Du musst im Moment nichts weiter tun.",
      ],
      action: { label: "Kursdetails ansehen", href: actionUrl },
    },
    approved: {
      subject: `Zusage: ${course.title}`,
      title: "Teilnahme bestätigt",
      statusTone: "success",
      intro:
        `Hallo ${reg.firstName} ${reg.lastName}, deine Teilnahme wurde bestätigt.`,
      callout:
        "Bitte plane den Termin verbindlich ein und informiere uns frühzeitig, falls du doch verhindert bist.",
      detailsList: [
        "Bringe bei Bedarf relevante persönliche Unterlagen oder Hinweise mit.",
        "Änderungen zu Zeit oder Ort kommunizieren wir automatisch per E-Mail.",
      ],
      action: { label: "Kursdetails ansehen", href: actionUrl },
    },
    rejected: {
      subject: `Rückmeldung zur Anmeldung: ${course.title}`,
      title: "Anmeldung konnte nicht bestätigt werden",
      statusTone: "danger",
      intro:
        `Hallo ${reg.firstName} ${reg.lastName}, deine Anmeldung wurde leider abgelehnt.`,
      callout:
        "Wenn du Rückfragen hast oder an einem späteren Termin teilnehmen möchtest, melde dich bitte direkt bei uns.",
      action: { label: "Kursdetails ansehen", href: actionUrl },
    },
    promoted: {
      subject: `Nachgerückt: ${course.title}`,
      title: "Du bist nachgerückt",
      statusTone: "success",
      intro:
        `Hallo ${reg.firstName} ${reg.lastName}, du bist von der Warteliste in die Teilnehmerliste nachgerückt.`,
      callout:
        "Dein Platz ist jetzt bestätigt. Bitte prüfe die Kursdaten noch einmal sorgfältig.",
      detailsList: [
        "Der Kurs findet zu den unten aufgeführten Daten statt.",
        "Falls du den Platz nicht wahrnehmen kannst, gib uns bitte schnell Bescheid.",
      ],
      action: { label: "Kursdetails ansehen", href: actionUrl },
    },
    cancelled: {
      subject: `Anmeldung storniert: ${course.title}`,
      title: "Anmeldung storniert",
      statusTone: "neutral",
      intro:
        `Hallo ${reg.firstName} ${reg.lastName}, deine Anmeldung wurde storniert.`,
      callout:
        "Falls dies nicht deinem Wunsch entspricht, nimm bitte Kontakt mit uns auf.",
      action: { label: "Kursdetails ansehen", href: actionUrl },
    },
  };

  const selected = eventBody[event];
  const detailsList = [
    ...(selected.detailsList ?? []),
    ...(customMessage?.trim()
      ? [`Zusätzliche Nachricht vom Team: ${customMessage.trim()}`]
      : []),
  ];
  return buildTemplate({
    eyebrow: env.appName,
    title: selected.title,
    intro: selected.intro,
    statusTone: selected.statusTone,
    facts: courseFacts(course),
    callout: selected.callout,
    detailsList,
    action: selected.action,
    footerNote:
      "Diese Nachricht wurde automatisch aus dem Kursportal versendet.",
  }, selected.subject);
}

export function renderCourseBroadcastTemplate(
  event: CourseBroadcastEvent,
  reg: Registration,
  course: Course,
  changes?: CourseChangeDetails,
): EmailTemplate {
  if (event === "course_reminder") {
    return buildTemplate({
      eyebrow: env.appName,
      title: "Kurserinnerung",
      intro: `Hallo ${reg.firstName} ${reg.lastName}, dein Kurs startet bald.`,
      statusTone: "info",
      facts: courseFacts(course),
      callout: course.reminderDaysBefore
        ? `Diese Erinnerung wurde ${course.reminderDaysBefore} Tag${
          course.reminderDaysBefore === 1 ? "" : "e"
        } vor Kursbeginn geplant.`
        : "Diese Erinnerung wurde für deinen bevorstehenden Kurs versendet.",
      detailsList: [
        "Bitte prüfe Ort und Uhrzeit noch einmal rechtzeitig vor dem Termin.",
        "Falls du doch verhindert bist, gib uns bitte so früh wie möglich Bescheid.",
      ],
      action: {
        label: "Kursdetails ansehen",
        href: registrationActionUrl(course),
      },
      footerNote:
        "Diese Benachrichtigung dient als Erinnerung an deinen Termin.",
    }, `Erinnerung: ${course.title} startet bald`);
  }

  if (event === "course_cancelled") {
    return buildTemplate({
      eyebrow: env.appName,
      title: "Kurs wurde abgesagt",
      statusTone: "danger",
      intro:
        `Hallo ${reg.firstName} ${reg.lastName}, der gebuchte Kurs wurde leider abgesagt.`,
      facts: courseFacts(course),
      callout:
        "Bitte nimm bei Rückfragen direkt Kontakt mit uns auf. Falls es einen Ersatztermin gibt, informieren wir dich separat.",
      detailsList: [
        "Die unten aufgeführten Kursdaten gelten nur zur Referenz der abgesagten Veranstaltung.",
        "Bitte antworte auf diese E-Mail nur, wenn du konkrete Rückfragen hast.",
      ],
      footerNote: "Diese Benachrichtigung betrifft eine wichtige Kursänderung.",
    }, `Kurs abgesagt: ${course.title}`);
  }

  const detailsList: string[] = [];
  if (changes?.location) {
    detailsList.push(
      `Ort: ${changes.location.before} -> ${changes.location.after}`,
    );
  }
  if (changes?.startsAt) {
    detailsList.push(
      `Beginn: ${formatCourseDate(changes.startsAt.before)} -> ${
        formatCourseDate(changes.startsAt.after)
      }`,
    );
  }
  if (changes?.endsAt) {
    detailsList.push(
      `Ende: ${formatCourseDate(changes.endsAt.before)} -> ${
        formatCourseDate(changes.endsAt.after)
      }`,
    );
  }

  return buildTemplate({
    eyebrow: env.appName,
    title: "Wichtige Kursänderung",
    statusTone: "warning",
    intro:
      `Hallo ${reg.firstName} ${reg.lastName}, es gibt wichtige Änderungen zu deinem Kurs.`,
    facts: courseFacts(course),
    callout:
      "Bitte prüfe die aktualisierten Kursdaten sorgfältig, damit du zum richtigen Zeitpunkt am richtigen Ort erscheinst.",
    detailsList,
    action: {
      label: "Kursdetails ansehen",
      href: registrationActionUrl(course),
    },
    footerNote:
      "Diese Benachrichtigung wurde wegen einer relevanten Kursänderung versendet.",
  }, `Aktualisierung zum Kurs: ${course.title}`);
}
