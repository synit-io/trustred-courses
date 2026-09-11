import type {
  AuditLog,
  Course,
  EmailLog,
  Registration,
  RegistrationStatus,
} from "../types.ts";

/**
 * Pure, side-effect free generator for realistic demo data.
 *
 * Everything produced here is safe to load into a public demo system:
 * - e-mail addresses only use RFC 2606 reserved domains (never deliverable)
 * - payments are marked with provider "demo"
 * - e-mail logs are recorded as "suppressed"
 *
 * Content is driven by a seeded PRNG so the *shape* of a dataset is
 * reproducible; record ids are always fresh UUIDs so repeated runs add data
 * instead of overwriting it.
 */

export interface DemoGeneratorOptions {
  /** Number of courses to generate. */
  courses: number;
  /** Lower bound of registrations per open/past course (default 4). */
  minRegistrations?: number;
  /** Upper bound of registrations per open/past course (default 28). */
  maxRegistrations?: number;
  /** PRNG seed. Same seed + same options = same content shape. */
  seed?: number;
  /** Reference time. Defaults to now. */
  now?: Date;
  /** User id recorded as actor for admin actions in audit logs. */
  actorUserId: string | null;
}

export interface DemoDataset {
  courses: Course[];
  registrations: Registration[];
  auditLogs: AuditLog[];
  emailLogs: EmailLog[];
}

export const DEMO_COURSE_ID_PREFIX = "demo-";
export const DEMO_EMAIL_DOMAINS = [
  "example.org",
  "example.net",
  "example.com",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = (seed >>> 0) || 0x9e3779b9;
  }

  /** mulberry32 */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  hex(length: number): string {
    let out = "";
    while (out.length < length) {
      out += Math.floor(this.next() * 16).toString(16);
    }
    return out;
  }
}

interface CourseTemplate {
  title: string;
  description: string;
  durationHours: number;
  capacity: [number, number];
  feeCents: number | null;
}

const COURSE_TEMPLATES: readonly CourseTemplate[] = [
  {
    title: "Erste-Hilfe Grundkurs",
    description:
      "Neun Unterrichtseinheiten Erste Hilfe für Einsatzkräfte, Übungsleiter und Interessierte. Anerkannt für Führerschein und Betrieb.",
    durationHours: 9,
    capacity: [12, 20],
    feeCents: 4500,
  },
  {
    title: "Erste Hilfe am Kind",
    description:
      "Notfälle bei Säuglingen und Kindern erkennen und sicher handeln. Für Jugendwarte, Eltern und Betreuungspersonen.",
    durationHours: 6,
    capacity: [10, 16],
    feeCents: 3900,
  },
  {
    title: "Brandschutzhelfer nach DGUV 205-023",
    description:
      "Theorie und praktische Löschübung mit Feuerlöscher und Löschdecke. Mit Teilnahmebescheinigung.",
    durationHours: 6,
    capacity: [10, 18],
    feeCents: 8900,
  },
  {
    title: "Sprechfunk und Digitalfunk",
    description:
      "Grundlagen des Sprechfunkverkehrs, Funkdisziplin und Gerätebedienung im Digitalfunk BOS.",
    durationHours: 8,
    capacity: [12, 24],
    feeCents: null,
  },
  {
    title: "Atemschutz Auffrischung",
    description:
      "Jährliche Wiederholung für Atemschutzgeräteträger mit Belastungsübung und Einsatzgrundsätzen.",
    durationHours: 4,
    capacity: [8, 12],
    feeCents: null,
  },
  {
    title: "Sanitätsdienst Aufbaukurs",
    description:
      "Vertiefung für Sanitätshelfer: Lagerung, Notfallmedikamente, Übergabe an den Rettungsdienst und Fallübungen.",
    durationHours: 16,
    capacity: [10, 16],
    feeCents: 12000,
  },
  {
    title: "Truppmann Modul 1",
    description:
      "Basisausbildung für neue Einsatzkräfte: Rechtsgrundlagen, Gerätekunde, Löscheinsatz und Unfallverhütung.",
    durationHours: 24,
    capacity: [16, 30],
    feeCents: null,
  },
  {
    title: "Hochwasser und Sandsackverbau",
    description:
      "Deichverteidigung, Sandsackverbau und Sicherung von Gebäuden bei Hochwasserlagen. Mit Praxisteil im Freien.",
    durationHours: 5,
    capacity: [12, 25],
    feeCents: null,
  },
  {
    title: "Psychosoziale Notfallversorgung",
    description:
      "Einführung in die PSNV für Einsatzkräfte: Belastungen erkennen, Kameraden unterstützen, Hilfe organisieren.",
    durationHours: 6,
    capacity: [10, 16],
    feeCents: 2500,
  },
  {
    title: "Jugendgruppenleiter Basisschulung",
    description:
      "Rechtliche Grundlagen, Aufsichtspflicht, Spielpädagogik und Planung von Gruppenstunden für die Jugendarbeit.",
    durationHours: 12,
    capacity: [10, 20],
    feeCents: null,
  },
  {
    title: "Rettungsschwimmen Silber",
    description:
      "Ausbildung zum Rettungsschwimmer: Rettungstechniken, Tauchen, Transportgriffe und Wiederbelebung.",
    durationHours: 20,
    capacity: [8, 14],
    feeCents: 6500,
  },
  {
    title: "Motorsägen Grundlehrgang",
    description:
      "Sicherer Umgang mit der Motorsäge nach DGUV Information 214-059, inklusive Schnitttechniken und Schutzausrüstung.",
    durationHours: 8,
    capacity: [6, 12],
    feeCents: 9900,
  },
  {
    title: "Fahrsicherheitstraining Einsatzfahrzeuge",
    description:
      "Fahren mit Sonderrechten, Bremsen und Ausweichen mit Einsatzfahrzeugen auf dem Verkehrsübungsplatz.",
    durationHours: 8,
    capacity: [6, 10],
    feeCents: 15000,
  },
  {
    title: "Gruppenführer Refresher",
    description:
      "Auffrischung für Führungskräfte: Lagefeststellung, Befehlsgebung, Einsatzstellenorganisation und Funk.",
    durationHours: 8,
    capacity: [10, 16],
    feeCents: null,
  },
  {
    title: "Gefahrgut Grundlagen (ABC)",
    description:
      "Erkennen von Gefahrstoffen, Kennzeichnung, Absperrbereiche und Erstmaßnahmen im ABC-Einsatz.",
    durationHours: 8,
    capacity: [12, 20],
    feeCents: null,
  },
  {
    title: "Drohnen im Einsatz",
    description:
      "Einweisung für Fernpiloten: Rechtslage, Einsatztaktik, Lageerkundung aus der Luft und Wärmebild.",
    durationHours: 4,
    capacity: [6, 12],
    feeCents: 4900,
  },
  {
    title: "Verpflegung im Einsatz",
    description:
      "Hygiene, Feldküche und Versorgung von Einsatzkräften bei Großlagen und Veranstaltungen.",
    durationHours: 4,
    capacity: [8, 16],
    feeCents: null,
  },
  {
    title: "Technische Hilfeleistung Verkehrsunfall",
    description:
      "Patientengerechte Rettung mit Spreizer und Schere, Sicherung der Einsatzstelle und Zusammenarbeit mit dem Rettungsdienst.",
    durationHours: 8,
    capacity: [12, 18],
    feeCents: null,
  },
] as const;

const LOCATIONS = [
  "Feuerwehrhaus Musterstadt",
  "Schulungszentrum Kusel",
  "Gerätehaus Oberdorf",
  "Rettungswache Nord",
  "THW-Unterkunft Weststadt",
  "Bürgerhaus Altstadt",
  "Ausbildungszentrum Landkreis",
  "DLRG-Station Seeufer",
  "Bergwacht-Hütte Talblick",
] as const;

const FIRST_NAMES = [
  "Anna",
  "Lukas",
  "Mia",
  "Jonas",
  "Lea",
  "Finn",
  "Emma",
  "Paul",
  "Sophie",
  "Elias",
  "Marie",
  "Noah",
  "Lena",
  "Felix",
  "Laura",
  "Ben",
  "Hannah",
  "Tim",
  "Sarah",
  "Max",
  "Julia",
  "Moritz",
  "Nele",
  "Jan",
  "Clara",
  "Tom",
  "Amelie",
  "Niklas",
  "Leonie",
  "David",
  "Johanna",
  "Simon",
  "Katharina",
  "Florian",
  "Lisa",
  "Tobias",
  "Mara",
  "Jonathan",
  "Frieda",
  "Ole",
] as const;

const LAST_NAMES = [
  "Müller",
  "Schmidt",
  "Schneider",
  "Fischer",
  "Weber",
  "Meyer",
  "Wagner",
  "Becker",
  "Schulz",
  "Hoffmann",
  "Koch",
  "Richter",
  "Klein",
  "Wolf",
  "Schröder",
  "Neumann",
  "Schwarz",
  "Braun",
  "Zimmermann",
  "Krüger",
  "Hartmann",
  "Lange",
  "Werner",
  "Krause",
  "Lehmann",
  "Köhler",
  "Herrmann",
  "Walter",
  "König",
  "Huber",
  "Kaiser",
  "Fuchs",
  "Peters",
  "Scholz",
  "Möller",
  "Weiß",
  "Jung",
  "Hahn",
  "Vogel",
  "Keller",
] as const;

const STREETS = [
  "Hauptstraße",
  "Bahnhofstraße",
  "Schulstraße",
  "Gartenweg",
  "Kirchgasse",
  "Am Sportplatz",
  "Lindenallee",
  "Bergstraße",
  "Waldweg",
  "Mühlenweg",
  "Ringstraße",
  "Feldstraße",
] as const;

const CITIES: readonly [string, string][] = [
  ["12345", "Musterstadt"],
  ["66869", "Kusel"],
  ["67655", "Kaiserslautern"],
  ["55116", "Mainz"],
  ["54290", "Trier"],
  ["56068", "Koblenz"],
  ["76829", "Landau"],
  ["67433", "Neustadt"],
  ["66424", "Homburg"],
  ["55543", "Bad Kreuznach"],
];

const ADMIN_MESSAGES = {
  approved: [
    "Willkommen! Bitte bringen Sie festes Schuhwerk und wetterfeste Kleidung mit.",
    "Ihre Teilnahme ist bestätigt. Treffpunkt ist 15 Minuten vor Beginn am Haupteingang.",
    "Zusage erteilt. Die Unterlagen erhalten Sie am ersten Kurstag.",
  ],
  rejected: [
    "Leider sind alle Plätze vergeben. Wir informieren Sie über neue Termine.",
    "Für diesen Kurs fehlt die Voraussetzung (Grundausbildung). Bitte melden Sie sich für den Grundkurs an.",
  ],
  cancelled: [
    "Auf Ihren Wunsch storniert. Gerne beim nächsten Termin.",
    "Storniert, da der Termin mit Ihrer Schicht kollidiert.",
  ],
  waitlisted: [
    "Sie stehen auf der Warteliste. Wir melden uns, sobald ein Platz frei wird.",
  ],
} as const;

const INTERNAL_NOTES = [
  "Telefonisch bestätigt.",
  "Mitglied der Jugendgruppe.",
  "Zahlung eingegangen, Beleg abgelegt.",
  "Rückfrage zur Kursvoraussetzung geklärt.",
  "Kommt zusammen mit zwei Kameraden aus Oberdorf.",
  "Nachrücker aus Warteliste.",
] as const;

type CourseKind = "open" | "upcoming" | "past" | "draft";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40);
}

function atHour(base: Date, dayOffset: number, hourUtc: number): Date {
  const date = new Date(base.getTime() + dayOffset * DAY_MS);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date;
}

function iso(date: Date): string {
  return date.toISOString();
}

function pickKind(rng: Rng): CourseKind {
  const roll = rng.next();
  if (roll < 0.55) return "open";
  if (roll < 0.7) return "upcoming";
  if (roll < 0.9) return "past";
  return "draft";
}

function buildCourse(
  rng: Rng,
  now: Date,
  kind: CourseKind,
): Course {
  const template = rng.pick(COURSE_TEMPLATES);
  const startHour = rng.pick([7, 8, 16, 17] as const);
  let startsAt: Date;
  let registrationOpensAt: Date;
  let registrationClosesAt: Date;
  let status: Course["status"];

  if (kind === "open") {
    startsAt = atHour(now, rng.int(4, 75), startHour);
    registrationOpensAt = atHour(now, -rng.int(3, 30), 6);
    registrationClosesAt = new Date(
      startsAt.getTime() - rng.int(1, 2) * DAY_MS,
    );
    status = "active";
  } else if (kind === "upcoming") {
    startsAt = atHour(now, rng.int(40, 120), startHour);
    registrationOpensAt = atHour(now, rng.int(2, 14), 6);
    registrationClosesAt = new Date(startsAt.getTime() - 2 * DAY_MS);
    status = "active";
  } else if (kind === "past") {
    startsAt = atHour(now, -rng.int(10, 120), startHour);
    registrationOpensAt = new Date(startsAt.getTime() - 40 * DAY_MS);
    registrationClosesAt = new Date(startsAt.getTime() - 2 * DAY_MS);
    status = "archived";
  } else {
    startsAt = atHour(now, rng.int(30, 90), startHour);
    registrationOpensAt = atHour(now, rng.int(7, 21), 6);
    registrationClosesAt = new Date(startsAt.getTime() - 2 * DAY_MS);
    status = "draft";
  }

  const endsAt = new Date(
    startsAt.getTime() + template.durationHours * HOUR_MS,
  );
  const paid = template.feeCents !== null && rng.chance(0.6);
  const slug = slugify(template.title);

  return {
    id: `${DEMO_COURSE_ID_PREFIX}${slug}-${crypto.randomUUID().slice(0, 8)}`,
    title: template.title,
    description: template.description,
    location: rng.pick(LOCATIONS),
    startsAt: iso(startsAt),
    endsAt: iso(endsAt),
    registrationOpensAt: iso(registrationOpensAt),
    registrationClosesAt: iso(registrationClosesAt),
    capacity: rng.int(template.capacity[0], template.capacity[1]),
    pricingType: paid ? "paid" : "free",
    feeAmountCents: paid ? template.feeCents : null,
    feeCurrency: paid ? "EUR" : null,
    status,
    waitingListEnabled: rng.chance(0.8),
    reminderDaysBefore: rng.pick([null, 1, 2, 3, 7] as const),
    createdAt: iso(new Date(registrationOpensAt.getTime() - 5 * DAY_MS)),
  };
}

interface StatusPlan {
  status: RegistrationStatus;
  /** Approved registrations that came in via the waiting list. */
  promoted: boolean;
}

function planStatuses(
  rng: Rng,
  course: Course,
  kind: CourseKind,
  minRegistrations: number,
  maxRegistrations: number,
): StatusPlan[] {
  const capacity = course.capacity;
  let approved: number;
  let waitlisted = 0;

  if (kind === "past") {
    approved = rng.int(Math.ceil(capacity * 0.6), capacity);
  } else {
    const fill = rng.next();
    if (fill < 0.3) {
      approved = capacity;
      waitlisted = course.waitingListEnabled ? rng.int(1, 6) : 0;
    } else if (fill < 0.5) {
      approved = Math.max(0, capacity - rng.int(1, 2));
    } else {
      approved = rng.int(
        Math.floor(capacity * 0.3),
        Math.floor(capacity * 0.8),
      );
    }
  }

  const pending = kind === "open" ? rng.int(0, 4) : 0;
  const submitted = kind === "open" ? rng.int(0, 2) : 0;
  const rejected = rng.int(0, 2);
  const cancelled = rng.int(0, 3);

  const plan: StatusPlan[] = [];
  const push = (status: RegistrationStatus, count: number) => {
    for (let i = 0; i < count; i += 1) {
      const promoted = status === "approved" && course.waitingListEnabled &&
        rng.chance(0.15);
      plan.push({ status, promoted });
    }
  };
  push("approved", approved);
  push("waitlisted", waitlisted);
  push("pending_review", pending);
  push("submitted", submitted);
  push("rejected", rejected);
  push("cancelled", cancelled);

  const capped = plan.slice(0, Math.max(0, maxRegistrations));
  while (capped.length < minRegistrations) {
    const approvedCount = capped.filter((entry) =>
      entry.status === "approved"
    ).length;
    if (approvedCount < capacity) {
      capped.push({ status: "approved", promoted: false });
    } else if (kind === "open") {
      capped.push({ status: "pending_review", promoted: false });
    } else {
      capped.push({ status: "cancelled", promoted: false });
    }
  }
  return capped;
}

interface Person {
  firstName: string;
  lastName: string;
  email: string;
}

function buildPerson(rng: Rng, used: Set<string>): Person {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    const key = `${firstName}|${lastName}`;
    if (used.has(key)) continue;
    used.add(key);
    const local = `${slugify(firstName)}.${slugify(lastName)}${
      rng.int(1, 999)
    }`;
    return {
      firstName,
      lastName,
      email: `${local}@${rng.pick(DEMO_EMAIL_DOMAINS)}`,
    };
  }
  const suffix = rng.hex(6);
  return {
    firstName: "Demo",
    lastName: `Person ${suffix}`,
    email: `demo.person.${suffix}@${rng.pick(DEMO_EMAIL_DOMAINS)}`,
  };
}

function auditEntry(
  registrationId: string,
  action: string,
  createdAt: Date,
  actorUserId: string | null,
  oldValue: Record<string, unknown> | null,
  newValue: Record<string, unknown>,
): AuditLog {
  return {
    id: crypto.randomUUID(),
    actorUserId,
    entityType: "registration",
    entityId: registrationId,
    action,
    oldValue: oldValue ? JSON.stringify(oldValue) : null,
    newValue: JSON.stringify(newValue),
    createdAt: iso(createdAt),
  };
}

function emailEntry(
  registration: Registration,
  templateKey: string,
  subject: string,
  sentAt: Date,
): EmailLog {
  return {
    id: crypto.randomUUID(),
    registrationId: registration.id,
    templateKey,
    recipientEmail: registration.email,
    subject,
    deliveryStatus: "suppressed",
    sentAt: iso(sentAt),
    errorMessage: null,
    attempt: 1,
  };
}

function buildRegistrations(
  rng: Rng,
  now: Date,
  course: Course,
  plan: StatusPlan[],
  actorUserId: string | null,
): {
  registrations: Registration[];
  auditLogs: AuditLog[];
  emailLogs: EmailLog[];
} {
  const registrations: Registration[] = [];
  const auditLogs: AuditLog[] = [];
  const emailLogs: EmailLog[] = [];
  const usedPeople = new Set<string>();

  const opensAt = Date.parse(course.registrationOpensAt ?? course.createdAt);
  const closesAt = Date.parse(course.registrationClosesAt ?? course.startsAt);
  const latest = Math.min(now.getTime() - 5 * MINUTE_MS, closesAt);
  const earliest = Math.min(opensAt, latest - HOUR_MS);

  const submissions = plan
    .map((entry) => ({
      entry,
      submittedAt: new Date(earliest + rng.next() * (latest - earliest)),
    }))
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());

  let waitingListPosition = 0;
  const paid = course.pricingType === "paid" &&
    (course.feeAmountCents ?? 0) > 0;

  for (const { entry, submittedAt } of submissions) {
    const person = buildPerson(rng, usedPeople);
    const [postalCode, city] = rng.pick(CITIES);
    const finalStatus = entry.status;
    const isWaitlisted = finalStatus === "waitlisted";
    const position = isWaitlisted ? ++waitingListPosition : null;

    const confirmedAt = new Date(
      submittedAt.getTime() + rng.int(2, 180) * MINUTE_MS,
    );
    const reviewedAt = new Date(
      confirmedAt.getTime() + rng.int(1, 120) * HOUR_MS,
    );
    const needsReview = finalStatus === "approved" ||
      finalStatus === "rejected" || finalStatus === "cancelled";
    const initialStatus: RegistrationStatus = isWaitlisted || entry.promoted
      ? "waitlisted"
      : "pending_review";
    const messagePool = finalStatus === "approved"
      ? ADMIN_MESSAGES.approved
      : finalStatus === "rejected"
      ? ADMIN_MESSAGES.rejected
      : finalStatus === "cancelled"
      ? ADMIN_MESSAGES.cancelled
      : finalStatus === "waitlisted"
      ? ADMIN_MESSAGES.waitlisted
      : null;
    const adminMessage = needsReview && messagePool && rng.chance(0.7)
      ? rng.pick(messagePool)
      : null;
    const internalNotes = needsReview && rng.chance(0.4)
      ? rng.pick(INTERNAL_NOTES)
      : null;

    const registration: Registration = {
      id: crypto.randomUUID(),
      courseId: course.id,
      firstName: person.firstName,
      lastName: person.lastName,
      street: rng.pick(STREETS),
      houseNumber: String(rng.int(1, 120)),
      postalCode,
      city,
      email: person.email,
      phone: rng.chance(0.7)
        ? `+49 ${rng.int(150, 179)} ${rng.int(1000000, 9999999)}`
        : "",
      status: finalStatus,
      waitingListPosition: position,
      consentAccepted: true,
      submittedAt: iso(submittedAt),
      doubleOptInRequestedAt: iso(submittedAt),
      doubleOptInConfirmedAt: finalStatus === "submitted"
        ? null
        : iso(confirmedAt),
      reviewedAt: needsReview ? iso(reviewedAt) : null,
      reviewedBy: needsReview ? actorUserId : null,
      adminMessage,
      internalNotes,
      paymentStatus: paid ? "paid" : "not_required",
      paymentProvider: paid ? "demo" : null,
      paymentCaptureId: paid ? `DEMO-${rng.hex(12).toUpperCase()}` : null,
      paymentAmountCents: paid ? course.feeAmountCents ?? null : null,
      paymentCurrency: paid ? course.feeCurrency ?? "EUR" : null,
      paymentPaidAt: paid
        ? iso(new Date(submittedAt.getTime() - 2 * MINUTE_MS))
        : null,
    };
    registrations.push(registration);

    auditLogs.push(
      auditEntry(
        registration.id,
        "registration.double_opt_in_requested",
        submittedAt,
        null,
        null,
        { status: "submitted" },
      ),
    );
    emailLogs.push(
      emailEntry(
        registration,
        "double_opt_in_confirmation",
        `Bitte bestätige deine Anmeldung: ${course.title}`,
        submittedAt,
      ),
    );
    if (finalStatus === "submitted") continue;

    auditLogs.push(
      auditEntry(
        registration.id,
        "registration.double_opt_in_confirmed",
        confirmedAt,
        null,
        { status: "submitted" },
        {
          status: initialStatus,
          waitingListPosition: initialStatus === "waitlisted"
            ? position ?? 1
            : null,
        },
      ),
      auditEntry(
        registration.id,
        "registration.submitted",
        new Date(confirmedAt.getTime() + 1000),
        null,
        null,
        {
          status: initialStatus,
          waitingListPosition: initialStatus === "waitlisted"
            ? position ?? 1
            : null,
        },
      ),
    );
    emailLogs.push(
      emailEntry(
        registration,
        "registration_received",
        `Anmeldung eingegangen: ${course.title}`,
        new Date(confirmedAt.getTime() + 2000),
      ),
    );
    if (initialStatus === "waitlisted") {
      emailLogs.push(
        emailEntry(
          registration,
          "waitlisted",
          `Warteliste: ${course.title}`,
          new Date(confirmedAt.getTime() + 3000),
        ),
      );
    }
    if (!needsReview) continue;

    const action = finalStatus === "approved"
      ? (entry.promoted ? "promote" : "approve")
      : finalStatus === "rejected"
      ? "reject"
      : "cancel";
    const emailEvent = finalStatus === "approved"
      ? (entry.promoted ? "promoted" : "approved")
      : finalStatus;
    auditLogs.push(
      auditEntry(
        registration.id,
        `registration.${action}`,
        reviewedAt,
        actorUserId,
        {
          status: initialStatus,
          waitingListPosition: initialStatus === "waitlisted" ? 1 : null,
          adminMessage: null,
          internalNotes: null,
        },
        {
          status: finalStatus,
          waitingListPosition: null,
          adminMessage,
          internalNotes,
        },
      ),
    );
    emailLogs.push(
      emailEntry(
        registration,
        emailEvent,
        `${
          finalStatus === "approved"
            ? "Zusage"
            : finalStatus === "rejected"
            ? "Absage"
            : "Stornierung"
        }: ${course.title}`,
        new Date(reviewedAt.getTime() + 1000),
      ),
    );
  }

  return { registrations, auditLogs, emailLogs };
}

export function generateDemoDataset(
  options: DemoGeneratorOptions,
): DemoDataset {
  const now = options.now ?? new Date();
  const rng = new Rng(options.seed ?? Math.floor(Math.random() * 0xffffffff));
  const minRegistrations = Math.max(0, options.minRegistrations ?? 4);
  const maxRegistrations = Math.max(
    minRegistrations,
    options.maxRegistrations ?? 28,
  );

  const dataset: DemoDataset = {
    courses: [],
    registrations: [],
    auditLogs: [],
    emailLogs: [],
  };

  for (let index = 0; index < Math.max(0, options.courses); index += 1) {
    const kind = pickKind(rng);
    const course = buildCourse(rng, now, kind);
    dataset.courses.push(course);
    if (kind === "upcoming" || kind === "draft") continue;

    const plan = planStatuses(
      rng,
      course,
      kind,
      minRegistrations,
      maxRegistrations,
    );
    const built = buildRegistrations(
      rng,
      now,
      course,
      plan,
      options.actorUserId,
    );
    dataset.registrations.push(...built.registrations);
    dataset.auditLogs.push(...built.auditLogs);
    dataset.emailLogs.push(...built.emailLogs);
  }

  return dataset;
}
