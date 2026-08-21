import { getCourseById } from "../courses/repository.ts";
import { appendAuditLog } from "../audit/repository.ts";
import {
  sendRegistrationDoubleOptInEmail,
  sendRegistrationEventEmails,
} from "../email/service.ts";
import type { RegistrationEmailEvent } from "../email/templates.ts";
import { env } from "../env.ts";
import { getKv } from "../kv/client.ts";
import type { Registration, RegistrationDoubleOptInToken } from "../types.ts";
import { normalizeEmail } from "../users/repository.ts";
import {
  countRegistrationsByStatus,
  createRegistration,
  getRegistrationById,
  listRegistrationsByCourse,
  recalculateWaitlistPositions,
  updateRegistration,
} from "./repository.ts";
import { rebuildPublicSnapshotsForCourse } from "../public_snapshot/service.ts";

export interface RegistrationInput {
  courseId: string;
  firstName: string;
  lastName: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  consentAccepted: boolean;
}

export interface RegistrationPaymentDetails {
  provider: "paypal";
  captureId: string;
  amountCents: number;
  currency: string;
  paidAt: string;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function isSameRegistrationFingerprint(
  existing: Registration,
  input: RegistrationInput,
): boolean {
  return normalizeEmail(existing.email) === normalizeEmail(input.email) &&
    normalizeText(existing.firstName) === normalizeText(input.firstName) &&
    normalizeText(existing.lastName) === normalizeText(input.lastName) &&
    normalizeText(existing.street) === normalizeText(input.street) &&
    normalizeText(existing.houseNumber) === normalizeText(input.houseNumber) &&
    normalizeText(existing.postalCode) === normalizeText(input.postalCode) &&
    normalizeText(existing.city) === normalizeText(input.city) &&
    normalizeText(existing.phone) === normalizeText(input.phone);
}

async function ensureNoDuplicateRegistration(
  input: RegistrationInput,
): Promise<void> {
  const existing = await listRegistrationsByCourse(input.courseId);
  const duplicate = existing.find((entry) =>
    isSameRegistrationFingerprint(entry, input)
  );
  if (duplicate) {
    throw new Error(
      "Eine identische Anmeldung mit diesen Daten existiert bereits für diesen Kurs.",
    );
  }
}

export async function ensureRegistrationCanBeSubmitted(
  input: RegistrationInput,
): Promise<void> {
  const course = await getCourseById(input.courseId);
  if (!course || course.status !== "active") {
    throw new Error("Kurs nicht verfügbar.");
  }
  if (!isRegistrationWindowOpen(course)) {
    throw new Error("Anmeldezeitraum für diesen Kurs ist geschlossen.");
  }
  await ensureNoDuplicateRegistration(input);
}

function isRegistrationWindowOpen(
  course: {
    startsAt: string;
    registrationOpensAt: string | null;
    registrationClosesAt: string | null;
  },
  now = Date.now(),
): boolean {
  const startsAtTs = Date.parse(course.startsAt);
  if (!Number.isNaN(startsAtTs) && now >= startsAtTs) {
    return false;
  }

  if (course.registrationOpensAt) {
    const openTs = Date.parse(course.registrationOpensAt);
    if (!Number.isNaN(openTs) && now < openTs) {
      return false;
    }
  }

  if (course.registrationClosesAt) {
    const closeTs = Date.parse(course.registrationClosesAt);
    if (!Number.isNaN(closeTs) && now > closeTs) {
      return false;
    }
  }

  return true;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function randomToken(bytes = 32): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function activateSubmittedRegistration(
  registration: Registration,
): Promise<Registration> {
  const course = await getCourseById(registration.courseId);
  if (!course || course.status !== "active") {
    throw new Error("Kurs nicht verfügbar.");
  }

  const approvedCount = await countRegistrationsByStatus(
    registration.courseId,
    "approved",
  );
  const courseRegistrations = await listRegistrationsByCourse(
    registration.courseId,
  );
  const openSeats = Math.max(course.capacity - approvedCount, 0);

  const status = openSeats > 0 ? "pending_review" : "waitlisted";
  const waitingListPosition = status === "waitlisted"
    ? courseRegistrations.filter((entry) => entry.status === "waitlisted")
      .length +
      1
    : null;

  const activated: Registration = {
    ...registration,
    status,
    waitingListPosition,
    doubleOptInConfirmedAt: new Date().toISOString(),
  };

  await updateRegistration(registration, activated);
  await appendAuditLog({
    actorUserId: null,
    entityType: "registration",
    entityId: activated.id,
    action: "registration.double_opt_in_confirmed",
    oldValue: JSON.stringify({ status: registration.status }),
    newValue: JSON.stringify({
      status: activated.status,
      waitingListPosition: activated.waitingListPosition,
    }),
  });
  await appendAuditLog({
    actorUserId: null,
    entityType: "registration",
    entityId: activated.id,
    action: "registration.submitted",
    oldValue: null,
    newValue: JSON.stringify({
      status: activated.status,
      waitingListPosition: activated.waitingListPosition,
    }),
  });

  await sendRegistrationEventEmails(activated, course, "registration_received");
  await sendRegistrationEventEmails(activated, course, status);
  return activated;
}

export async function submitRegistration(
  input: RegistrationInput,
): Promise<Registration> {
  await ensureRegistrationCanBeSubmitted(input);
  const course = await getCourseById(input.courseId);
  if (!course) {
    throw new Error("Kurs nicht verfügbar.");
  }

  const approvedCount = await countRegistrationsByStatus(
    input.courseId,
    "approved",
  );
  const waitlisted = await listRegistrationsByCourse(input.courseId);
  const openSeats = Math.max(course.capacity - approvedCount, 0);

  const status = openSeats > 0 ? "pending_review" : "waitlisted";
  const waitingListPosition = status === "waitlisted"
    ? waitlisted.filter((registration) => registration.status === "waitlisted")
      .length + 1
    : null;

  const now = new Date().toISOString();
  const registration: Registration = {
    id: crypto.randomUUID(),
    courseId: input.courseId,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    street: input.street.trim(),
    houseNumber: input.houseNumber.trim(),
    postalCode: input.postalCode.trim(),
    city: input.city.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    status,
    waitingListPosition,
    consentAccepted: input.consentAccepted,
    submittedAt: now,
    doubleOptInRequestedAt: now,
    doubleOptInConfirmedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    adminMessage: null,
    internalNotes: null,
    paymentStatus: "not_required",
    paymentProvider: null,
    paymentCaptureId: null,
    paymentAmountCents: null,
    paymentCurrency: null,
    paymentPaidAt: null,
  };

  await createRegistration(registration);
  await appendAuditLog({
    actorUserId: null,
    entityType: "registration",
    entityId: registration.id,
    action: "registration.submitted",
    oldValue: null,
    newValue: JSON.stringify({
      status: registration.status,
      waitingListPosition: registration.waitingListPosition,
    }),
  });
  await sendRegistrationEventEmails(
    registration,
    course,
    "registration_received",
  );
  await sendRegistrationEventEmails(registration, course, status);
  return registration;
}

export async function submitRegistrationWithDoubleOptIn(
  input: RegistrationInput,
  payment?: RegistrationPaymentDetails,
): Promise<{ registration: Registration; confirmationUrl: string }> {
  await ensureRegistrationCanBeSubmitted(input);
  const course = await getCourseById(input.courseId);
  if (!course) {
    throw new Error("Kurs nicht verfügbar.");
  }
  if (!input.consentAccepted) {
    throw new Error("Datenschutz-Einwilligung ist erforderlich.");
  }

  const now = new Date().toISOString();
  const registration: Registration = {
    id: crypto.randomUUID(),
    courseId: input.courseId,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    street: input.street.trim(),
    houseNumber: input.houseNumber.trim(),
    postalCode: input.postalCode.trim(),
    city: input.city.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    status: "submitted",
    waitingListPosition: null,
    consentAccepted: input.consentAccepted,
    submittedAt: now,
    doubleOptInRequestedAt: now,
    doubleOptInConfirmedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    adminMessage: null,
    internalNotes: null,
    paymentStatus: payment ? "paid" : "not_required",
    paymentProvider: payment?.provider ?? null,
    paymentCaptureId: payment?.captureId ?? null,
    paymentAmountCents: payment?.amountCents ?? null,
    paymentCurrency: payment?.currency ?? null,
    paymentPaidAt: payment?.paidAt ?? null,
  };

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const ttlMs = env.registrationDoubleOptInTtlHours * 60 * 60 * 1000;
  const tokenRecord: RegistrationDoubleOptInToken = {
    registrationId: registration.id,
    courseId: registration.courseId,
    emailNormalized: normalizeEmail(registration.email),
    createdAt: now,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    usedAt: null,
  };

  await createRegistration(registration);
  const kv = await getKv();
  await kv.set(["registration_optin_tokens", tokenHash], tokenRecord, {
    expireIn: ttlMs,
  });

  await appendAuditLog({
    actorUserId: null,
    entityType: "registration",
    entityId: registration.id,
    action: "registration.double_opt_in_requested",
    oldValue: null,
    newValue: JSON.stringify({ status: registration.status }),
  });

  const confirmationUrl = `${env.appBaseUrl}/api/registrations/confirm?token=${
    encodeURIComponent(token)
  }`;
  await sendRegistrationDoubleOptInEmail(registration, course, confirmationUrl);
  return { registration, confirmationUrl };
}

export async function confirmRegistrationDoubleOptIn(
  tokenRaw: string,
): Promise<Registration | null> {
  const token = tokenRaw.trim();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const kv = await getKv();
  const tokenEntry = await kv.get<RegistrationDoubleOptInToken>([
    "registration_optin_tokens",
    tokenHash,
  ], { consistency: "strong" });
  if (!tokenEntry.value) return null;

  const now = Date.now();
  if (
    tokenEntry.value.usedAt ||
    Date.parse(tokenEntry.value.expiresAt) <= now
  ) {
    return null;
  }

  const registration = await getRegistrationById(
    tokenEntry.value.registrationId,
  );
  if (!registration) return null;
  if (normalizeEmail(registration.email) !== tokenEntry.value.emailNormalized) {
    return null;
  }

  const commit = await kv.atomic()
    .check({
      key: ["registration_optin_tokens", tokenHash],
      versionstamp: tokenEntry.versionstamp,
    })
    .set(
      ["registration_optin_tokens", tokenHash],
      { ...tokenEntry.value, usedAt: new Date(now).toISOString() },
      { expireIn: 24 * 60 * 60 * 1000 },
    )
    .commit();
  if (!commit.ok) return null;

  if (registration.doubleOptInConfirmedAt) {
    return registration;
  }
  if (registration.status !== "submitted") {
    return registration;
  }
  return await activateSubmittedRegistration(registration);
}

export type RegistrationAction =
  | "approve"
  | "reject"
  | "waitlist"
  | "promote"
  | "cancel";

const REGISTRATION_ACTION_TRANSITIONS: Readonly<
  Record<Registration["status"], readonly RegistrationAction[]>
> = {
  submitted: ["approve", "reject"],
  pending_review: ["approve", "reject", "waitlist", "cancel"],
  waitlisted: ["promote", "reject", "cancel"],
  approved: ["waitlist", "cancel"],
  rejected: [],
  cancelled: [],
};

const REGISTRATION_EMAIL_EVENTS_BY_STATUS: Readonly<
  Partial<Record<Registration["status"], readonly RegistrationEmailEvent[]>>
> = {
  pending_review: ["registration_received"],
  waitlisted: ["waitlisted"],
  approved: ["approved"],
  rejected: ["rejected"],
  cancelled: ["cancelled"],
};

export interface RegistrationActionInput {
  registrationId: string;
  action: RegistrationAction;
  actorUserId: string;
  adminMessage?: string;
  internalNotes?: string;
}

function normalizeOptionalNote(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function isActionAllowed(
  currentStatus: Registration["status"],
  action: RegistrationAction,
): boolean {
  return REGISTRATION_ACTION_TRANSITIONS[currentStatus].includes(action);
}

export function availableRegistrationActions(
  status: Registration["status"],
): RegistrationAction[] {
  return [...REGISTRATION_ACTION_TRANSITIONS[status]];
}

export function allowedEmailEventsForRegistrationStatus(
  status: Registration["status"],
): RegistrationEmailEvent[] {
  return [...(REGISTRATION_EMAIL_EVENTS_BY_STATUS[status] ?? [])];
}

export function isRegistrationEmailEventAllowed(
  status: Registration["status"],
  event: RegistrationEmailEvent,
): boolean {
  return allowedEmailEventsForRegistrationStatus(status).includes(event);
}

export async function applyRegistrationAction(
  input: RegistrationActionInput,
): Promise<{ previous: Registration; next: Registration }> {
  const registration = await getRegistrationById(input.registrationId);
  if (!registration) {
    throw new Error("Anmeldung nicht gefunden.");
  }

  if (!isActionAllowed(registration.status, input.action)) {
    throw new Error("Aktion für den aktuellen Status nicht erlaubt.");
  }

  const course = await getCourseById(registration.courseId);
  if (!course) {
    throw new Error("Kurs nicht gefunden.");
  }

  const nowIso = new Date().toISOString();
  let nextStatus = registration.status;
  let nextWaitingListPosition: number | null = registration.waitingListPosition;

  if (input.action === "approve" || input.action === "promote") {
    const approvedCount = await countRegistrationsByStatus(
      course.id,
      "approved",
    );
    const alreadyApproved = registration.status === "approved" ? 1 : 0;
    const openSeats = course.capacity - (approvedCount - alreadyApproved);
    if (openSeats <= 0) {
      throw new Error(
        "Keine freien Platze verfügbar. Bitte auf Warteliste setzen.",
      );
    }
    nextStatus = "approved";
    nextWaitingListPosition = null;
  } else if (input.action === "reject") {
    nextStatus = "rejected";
    nextWaitingListPosition = null;
  } else if (input.action === "cancel") {
    nextStatus = "cancelled";
    nextWaitingListPosition = null;
  } else if (input.action === "waitlist") {
    const courseRegistrations = await listRegistrationsByCourse(course.id);
    const waitlistedCount = courseRegistrations
      .filter((entry) =>
        entry.status === "waitlisted" && entry.id !== registration.id
      )
      .length;
    nextStatus = "waitlisted";
    nextWaitingListPosition = waitlistedCount + 1;
  }

  const next: Registration = {
    ...registration,
    status: nextStatus,
    waitingListPosition: nextWaitingListPosition,
    doubleOptInConfirmedAt: registration.status === "submitted"
      ? nowIso
      : registration.doubleOptInConfirmedAt,
    reviewedAt: nowIso,
    reviewedBy: input.actorUserId,
    adminMessage: normalizeOptionalNote(input.adminMessage),
    internalNotes: normalizeOptionalNote(input.internalNotes),
  };

  await updateRegistration(registration, next);
  await recalculateWaitlistPositions(registration.courseId);

  const refreshed = await getRegistrationById(registration.id);
  if (!refreshed) {
    throw new Error("Aktualisierte Anmeldung konnte nicht geladen werden.");
  }
  await rebuildPublicSnapshotsForCourse(registration.courseId);

  if (input.action === "approve") {
    await sendRegistrationEventEmails(
      refreshed,
      course,
      "approved",
      input.adminMessage,
    );
  } else if (input.action === "reject") {
    await sendRegistrationEventEmails(
      refreshed,
      course,
      "rejected",
      input.adminMessage,
    );
  } else if (input.action === "waitlist") {
    await sendRegistrationEventEmails(
      refreshed,
      course,
      "waitlisted",
      input.adminMessage,
    );
  } else if (input.action === "promote") {
    await sendRegistrationEventEmails(
      refreshed,
      course,
      "promoted",
      input.adminMessage,
    );
  } else if (input.action === "cancel") {
    await sendRegistrationEventEmails(
      refreshed,
      course,
      "cancelled",
      input.adminMessage,
    );
  }

  return { previous: registration, next: refreshed };
}
