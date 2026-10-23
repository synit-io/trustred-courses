import {
  bumpCourseRevision,
  getCourseRevisionEntry,
} from "../courses/revision.ts";
import { parseMailbox } from "../email/mailbox.ts";
import type { Course } from "../types.ts";
import { getCourseById } from "../courses/repository.ts";
import { addAuditLogToAtomic, createAuditLog } from "../audit/repository.ts";
import {
  createDoubleOptInOutboxJob,
  createRegistrationConfirmationOutboxJobs,
  createRegistrationEventOutboxJob,
  processEmailOutboxBatch,
  sendRegistrationEventEmails,
} from "../email/service.ts";
import type { RegistrationEmailEvent } from "../email/templates.ts";
import { env } from "../env.ts";
import { getKv } from "../kv/client.ts";
import { withKvLock } from "../kv/lock.ts";
import { logger } from "../observability/logger.ts";
import type {
  EmailOutboxJob,
  Registration,
  RegistrationDoubleOptInToken,
} from "../types.ts";
import { normalizeEmail } from "../users/repository.ts";
import {
  countRegistrationsByStatus,
  getRegistrationById,
  getRegistrationEntryById,
  listRegistrationsByCourse,
  recalculateWaitlistPositions,
  updateRegistrationChecked,
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
  provider: "paypal" | "demo";
  captureId: string;
  amountCents: number;
  currency: string;
  paidAt: string;
}

export class DuplicateRegistrationError extends Error {}

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
    throw new DuplicateRegistrationError(
      "Eine identische Anmeldung mit diesen Daten existiert bereits für diesen Kurs.",
    );
  }
}

export async function registrationFingerprint(
  input: RegistrationInput,
): Promise<string> {
  return await sha256Hex([
    input.courseId,
    normalizeEmail(input.email),
    normalizeText(input.firstName),
    normalizeText(input.lastName),
    normalizeText(input.street),
    normalizeText(input.houseNumber),
    normalizeText(input.postalCode),
    normalizeText(input.city),
    normalizeText(input.phone),
  ].join("\u0000"));
}

async function ensureRegistrationCanBeSubmittedUnlocked(
  input: RegistrationInput,
): Promise<void> {
  const course = await getCourseById(input.courseId);
  if (!course || course.status !== "active") {
    throw new Error("Kurs nicht verfügbar.");
  }
  if (!isRegistrationWindowOpen(course)) {
    throw new Error("Anmeldezeitraum für diesen Kurs ist geschlossen.");
  }
  const approvedCount = await countRegistrationsByStatus(
    input.courseId,
    "approved",
  );
  if (approvedCount >= course.capacity && !course.waitingListEnabled) {
    throw new Error("Kurs ist ausgebucht und hat keine Warteliste.");
  }
  await ensureNoDuplicateRegistration(input);
}

export async function ensureRegistrationCanBeSubmitted(
  input: RegistrationInput,
): Promise<void> {
  await withKvLock(
    ["registration_course", input.courseId],
    () => ensureRegistrationCanBeSubmittedUnlocked(input),
  );
}

export function isRegistrationWindowOpen(
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

async function persistNewRegistration(
  registration: Registration,
  fingerprint: string,
  auditAction: string,
  token: {
    hash: string;
    record: RegistrationDoubleOptInToken;
    ttlMs: number;
  } | undefined,
  guards: {
    course: Deno.KvEntryMaybe<Course>;
    revision: Deno.KvEntryMaybe<string>;
    pendingPaidRegistrationId?: string;
  },
  outboxJob?: EmailOutboxJob,
): Promise<void> {
  const kv = await getKv();
  const fingerprintKey: Deno.KvKey = [
    "registration_fingerprints",
    registration.courseId,
    fingerprint,
  ];
  const fingerprintEntry = await kv.get<string>(fingerprintKey, {
    consistency: "strong",
  });
  if (fingerprintEntry.value && fingerprintEntry.value !== registration.id) {
    throw new DuplicateRegistrationError(
      "Eine identische Anmeldung mit diesen Daten existiert bereits für diesen Kurs.",
    );
  }

  const pendingFingerprintEntry = await kv.get<string>([
    "pending_paid_registration_fingerprints",
    registration.courseId,
    fingerprint,
  ]);
  if (
    pendingFingerprintEntry.value &&
    pendingFingerprintEntry.value !== guards.pendingPaidRegistrationId
  ) {
    throw new DuplicateRegistrationError(
      "Eine identische Anmeldung oder Zahlung ist bereits vorhanden.",
    );
  }
  const auditLog = createAuditLog({
    actorUserId: null,
    entityType: "registration",
    entityId: registration.id,
    action: auditAction,
    oldValue: null,
    newValue: JSON.stringify({ status: registration.status }),
  });
  if (!guards.course.value) throw new Error("Kurs nicht verfügbar.");
  let tx = bumpCourseRevision(
    kv.atomic().check(guards.course).check(pendingFingerprintEntry),
    guards.revision,
  )
    .set([
      "registrations_by_submitted",
      registration.submittedAt,
      registration.id,
    ], {
      courseId: registration.courseId,
      status: registration.status,
      firstName: registration.firstName,
      lastName: registration.lastName,
      email: registration.email,
    })
    .set(["registrations", registration.id], registration)
    .set(
      [
        "registrations_by_course",
        registration.courseId,
        registration.submittedAt,
        registration.id,
      ],
      registration.status,
    )
    .set(
      [
        "registrations_by_status",
        registration.status,
        registration.submittedAt,
        registration.id,
      ],
      registration.courseId,
    );
  if (!fingerprintEntry.value) {
    tx = tx.check(fingerprintEntry).set(fingerprintKey, registration.id);
  }
  if (token) {
    tx = tx.set(["registration_optin_current", registration.id], token.hash)
      .set(
        ["registration_optin_tokens", token.hash],
        token.record,
        { expireIn: token.ttlMs },
      );
  }
  tx = addAuditLogToAtomic(tx, auditLog);
  if (outboxJob?.eventKey) {
    tx = tx
      .set(["email_outbox", outboxJob.id], outboxJob)
      .set(["email_outbox_events", outboxJob.eventKey], outboxJob.id);
  }
  if (!(await tx.commit()).ok) {
    throw new Error(
      "Anmeldung oder Kurs wurde gleichzeitig geändert. Bitte erneut versuchen.",
    );
  }
}

export async function submitRegistration(
  input: RegistrationInput,
): Promise<Registration> {
  const email = parseMailbox(input.email);
  if (!email) throw new Error("E-Mail-Adresse ist ungültig.");
  input = { ...input, email };
  const { registration, course } = await withKvLock(
    ["registration_course", input.courseId],
    async () => {
      const kv = await getKv();
      const revision = await getCourseRevisionEntry(input.courseId);
      const courseEntry = await kv.get<Course>(["courses", input.courseId]);
      await ensureRegistrationCanBeSubmittedUnlocked(input);
      const course = courseEntry.value;
      if (!course) throw new Error("Kurs nicht verfügbar.");
      const approvedCount = await countRegistrationsByStatus(
        input.courseId,
        "approved",
      );
      const waitlisted = await listRegistrationsByCourse(input.courseId);
      const openSeats = Math.max(course.capacity - approvedCount, 0);
      const status: Registration["status"] =
        openSeats > 0 || !course.waitingListEnabled
          ? "pending_review"
          : "waitlisted";
      const waitingListPosition = status === "waitlisted"
        ? waitlisted.filter((entry) => entry.status === "waitlisted").length + 1
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
      await persistNewRegistration(
        registration,
        await registrationFingerprint(input),
        "registration.submitted",
        undefined,
        { course: courseEntry, revision },
      );
      return { registration, course };
    },
  );
  await sendRegistrationEventEmails(
    registration,
    course,
    "registration_received",
  );
  await sendRegistrationEventEmails(registration, course, registration.status);
  return registration;
}

export interface DoubleOptInSubmissionOptions {
  registrationId?: string;
  confirmationToken?: string;
  skipEligibilityRecheck?: boolean;
  pendingPaidRegistrationId?: string;
}

export async function submitRegistrationWithDoubleOptIn(
  input: RegistrationInput,
  payment?: RegistrationPaymentDetails,
  options: DoubleOptInSubmissionOptions = {},
): Promise<{ registration: Registration; confirmationUrl: string }> {
  const email = parseMailbox(input.email);
  if (!email) throw new Error("E-Mail-Adresse ist ungültig.");
  input = { ...input, email };
  if (!input.consentAccepted) {
    throw new Error("Datenschutz-Einwilligung ist erforderlich.");
  }
  const token = options.confirmationToken ?? randomToken();
  const confirmationUrl = `${env.appBaseUrl}/api/registrations/confirm?token=${
    encodeURIComponent(token)
  }`;
  const result = await withKvLock(
    ["registration_course", input.courseId],
    async () => {
      const kv = await getKv();
      const revision = await getCourseRevisionEntry(input.courseId);
      const courseEntry = await kv.get<Course>(["courses", input.courseId]);
      const existing = options.registrationId
        ? await getRegistrationById(options.registrationId)
        : null;
      const course = courseEntry.value;
      if (!course) throw new Error("Kurs nicht verfügbar.");
      if (existing) {
        if (
          !isSameRegistrationFingerprint(existing, input) ||
          existing.courseId !== input.courseId ||
          (payment && existing.paymentCaptureId !== payment.captureId)
        ) {
          throw new DuplicateRegistrationError(
            "Zahlung konnte keiner eindeutigen Anmeldung zugeordnet werden.",
          );
        }
        return { registration: existing, course };
      }
      if (!options.skipEligibilityRecheck) {
        await ensureRegistrationCanBeSubmittedUnlocked(input);
      } else {
        await ensureNoDuplicateRegistration(input);
      }

      const now = new Date().toISOString();
      const registration: Registration = {
        id: options.registrationId ?? crypto.randomUUID(),
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
      const ttlMs = env.registrationDoubleOptInTtlHours * 60 * 60 * 1000;
      const tokenHash = await sha256Hex(token);
      await persistNewRegistration(
        registration,
        await registrationFingerprint(input),
        "registration.double_opt_in_requested",
        {
          hash: tokenHash,
          ttlMs,
          record: {
            registrationId: registration.id,
            courseId: registration.courseId,
            emailNormalized: normalizeEmail(registration.email),
            createdAt: now,
            expiresAt: new Date(Date.now() + ttlMs).toISOString(),
            usedAt: null,
          },
        },
        {
          course: courseEntry,
          revision,
          pendingPaidRegistrationId: options.pendingPaidRegistrationId,
        },
        createDoubleOptInOutboxJob(
          registration,
          course,
          confirmationUrl,
          tokenHash,
        ),
      );
      return { registration, course };
    },
  );
  await processEmailOutboxBatch(20);
  return { registration: result.registration, confirmationUrl };
}

/** Reissue a confirmation on the existing submission, including paid submissions. */
export async function reissueRegistrationDoubleOptIn(
  courseId: string,
  emailRaw: string,
): Promise<string[]> {
  const email = parseMailbox(emailRaw);
  if (!email) return [];
  const kv = await getKv();
  const matches = (await listRegistrationsByCourse(courseId)).filter((entry) =>
    entry.status === "submitted" && !entry.doubleOptInConfirmedAt &&
    normalizeEmail(entry.email) === email
  ).slice(0, 20);
  const urls: string[] = [];
  for (const match of matches) {
    const revision = await getCourseRevisionEntry(courseId);
    const courseEntry = await kv.get<Course>(["courses", courseId]);
    const registrationEntry = await getRegistrationEntryById(match.id);
    const registration = registrationEntry.value;
    if (
      !courseEntry.value || !registration ||
      registration.status !== "submitted" ||
      registration.doubleOptInConfirmedAt ||
      normalizeEmail(registration.email) !== email ||
      Date.parse(registration.doubleOptInRequestedAt) > Date.now() - 60_000
    ) continue;
    const current = await kv.get<string>([
      "registration_optin_current",
      registration.id,
    ]);
    const token = randomToken();
    const hash = await sha256Hex(token);
    const now = new Date().toISOString();
    const ttlMs = env.registrationDoubleOptInTtlHours * 60 * 60 * 1000;
    const confirmationUrl =
      `${env.appBaseUrl}/api/registrations/confirm?token=${
        encodeURIComponent(token)
      }`;
    const next = { ...registration, doubleOptInRequestedAt: now };
    const job = createDoubleOptInOutboxJob(
      next,
      courseEntry.value,
      confirmationUrl,
      hash,
    );
    job.eventKey = `registration_doi:${registration.id}:${hash}`;
    let tx = bumpCourseRevision(
      kv.atomic().check(courseEntry).check(registrationEntry).check(current),
      revision,
    )
      .set(["registrations", registration.id], next)
      .set(["registration_optin_current", registration.id], hash)
      .set(
        ["registration_optin_tokens", hash],
        {
          registrationId: registration.id,
          courseId,
          emailNormalized: email,
          createdAt: now,
          expiresAt: new Date(Date.now() + ttlMs).toISOString(),
          usedAt: null,
        } satisfies RegistrationDoubleOptInToken,
        { expireIn: ttlMs },
      )
      .set(["email_outbox", job.id], job)
      .set(["email_outbox_events", job.eventKey], job.id);
    if (current.value) {
      tx = tx.delete(["registration_optin_tokens", current.value]);
    }
    tx = addAuditLogToAtomic(
      tx,
      createAuditLog({
        actorUserId: null,
        entityType: "registration",
        entityId: registration.id,
        action: "registration.double_opt_in_reissued",
        oldValue: null,
        newValue: JSON.stringify({ requestedAt: now }),
      }),
    );
    if ((await tx.commit()).ok) urls.push(confirmationUrl);
  }
  await processEmailOutboxBatch(20);
  return urls;
}

export async function confirmRegistrationDoubleOptIn(
  tokenRaw: string,
): Promise<Registration | null> {
  const token = tokenRaw.trim();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const kv = await getKv();
  const initialTokenEntry = await kv.get<RegistrationDoubleOptInToken>([
    "registration_optin_tokens",
    tokenHash,
  ], { consistency: "strong" });
  if (!initialTokenEntry.value) return null;

  const result = await withKvLock(
    ["registration_course", initialTokenEntry.value.courseId],
    async () => {
      const revision = await getCourseRevisionEntry(
        initialTokenEntry.value!.courseId,
      );
      const courseEntry = await kv.get<Course>([
        "courses",
        initialTokenEntry.value!.courseId,
      ]);
      const tokenEntry = await kv.get<RegistrationDoubleOptInToken>([
        "registration_optin_tokens",
        tokenHash,
      ], { consistency: "strong" });
      if (!tokenEntry.value) return null;
      const now = Date.now();
      if (
        tokenEntry.value.usedAt ||
        Date.parse(tokenEntry.value.expiresAt) <= now
      ) return null;

      const registrationEntry = await getRegistrationEntryById(
        tokenEntry.value.registrationId,
      );
      if (!registrationEntry.value) return null;
      const registration = registrationEntry.value;
      const currentToken = await kv.get<string>([
        "registration_optin_current",
        registration.id,
      ]);
      if (currentToken.value && currentToken.value !== tokenHash) return null;
      if (
        normalizeEmail(registration.email) !== tokenEntry.value.emailNormalized
      ) return null;

      const usedToken = {
        ...tokenEntry.value,
        usedAt: new Date(now).toISOString(),
      };
      if (
        registration.doubleOptInConfirmedAt ||
        registration.status !== "submitted"
      ) {
        const consumed = await kv.atomic()
          .check(tokenEntry)
          .set(["registration_optin_tokens", tokenHash], usedToken, {
            expireIn: 24 * 60 * 60 * 1000,
          })
          .commit();
        return consumed.ok ? { registration, course: null } : null;
      }

      const course = courseEntry.value;
      if (
        !course ||
        (course.status !== "active" && registration.paymentStatus !== "paid")
      ) {
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
      const status = course.status !== "active" || openSeats > 0 ||
          !course.waitingListEnabled
        ? "pending_review"
        : "waitlisted";
      const waitingListPosition = status === "waitlisted"
        ? courseRegistrations.filter((entry) => entry.status === "waitlisted")
          .length + 1
        : null;
      const activated: Registration = {
        ...registration,
        status,
        waitingListPosition,
        doubleOptInConfirmedAt: new Date(now).toISOString(),
      };
      const confirmedAudit = createAuditLog({
        actorUserId: null,
        entityType: "registration",
        entityId: activated.id,
        action: "registration.double_opt_in_confirmed",
        oldValue: JSON.stringify({ status: registration.status }),
        newValue: JSON.stringify({ status, waitingListPosition }),
      });
      const submittedAudit = createAuditLog({
        actorUserId: null,
        entityType: "registration",
        entityId: activated.id,
        action: "registration.submitted",
        oldValue: null,
        newValue: JSON.stringify({ status, waitingListPosition }),
      });
      let tx = bumpCourseRevision(kv.atomic().check(courseEntry), revision)
        .check(currentToken)
        .check(tokenEntry)
        .check(registrationEntry)
        .set(["registration_optin_tokens", tokenHash], usedToken, {
          expireIn: 24 * 60 * 60 * 1000,
        })
        .set(["registrations", activated.id], activated)
        .set([
          "registrations_by_submitted",
          activated.submittedAt,
          activated.id,
        ], {
          courseId: activated.courseId,
          status: activated.status,
          firstName: activated.firstName,
          lastName: activated.lastName,
          email: activated.email,
        })
        .set(
          [
            "registrations_by_course",
            activated.courseId,
            activated.submittedAt,
            activated.id,
          ],
          activated.status,
        )
        .delete([
          "registrations_by_status",
          registration.status,
          registration.submittedAt,
          registration.id,
        ])
        .set(
          [
            "registrations_by_status",
            activated.status,
            activated.submittedAt,
            activated.id,
          ],
          activated.courseId,
        );
      tx = addAuditLogToAtomic(tx, confirmedAudit);
      tx = addAuditLogToAtomic(tx, submittedAudit);
      for (
        const job of createRegistrationConfirmationOutboxJobs(activated, course)
      ) {
        tx = tx.set(["email_outbox", job.id], job)
          .set(["email_outbox_events", job.eventKey!], job.id);
      }
      if (!(await tx.commit()).ok) return null;
      return { registration: activated, course };
    },
  );
  if (!result) return null;
  if (result.course) {
    try {
      await rebuildPublicSnapshotsForCourse(result.registration.courseId);
    } catch (error) {
      logger.error("registration.snapshot_rebuild_failed", {
        registrationId: result.registration.id,
        error,
      });
    }
    await processEmailOutboxBatch(20);
  }
  return result.registration;
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
  const initial = await getRegistrationById(input.registrationId);
  if (!initial) {
    throw new Error("Anmeldung nicht gefunden.");
  }
  const result = await withKvLock(
    ["registration_course", initial.courseId],
    async (lease) => {
      const kv = await getKv();
      const revision = await getCourseRevisionEntry(initial.courseId);
      const courseEntry = await kv.get<Course>(["courses", initial.courseId]);
      const registrationEntry = await getRegistrationEntryById(
        input.registrationId,
      );
      if (!registrationEntry.value) {
        throw new Error("Anmeldung nicht gefunden.");
      }
      const registration = registrationEntry.value;
      if (!isActionAllowed(registration.status, input.action)) {
        throw new Error("Aktion für den aktuellen Status nicht erlaubt.");
      }
      const course = courseEntry.value;
      if (!course) throw new Error("Kurs nicht gefunden.");

      const nowIso = new Date().toISOString();
      let nextStatus = registration.status;
      let nextWaitingListPosition = registration.waitingListPosition;
      if (input.action === "approve" || input.action === "promote") {
        const approvedCount = await countRegistrationsByStatus(
          course.id,
          "approved",
        );
        const alreadyApproved = registration.status === "approved" ? 1 : 0;
        if (course.capacity - (approvedCount - alreadyApproved) <= 0) {
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
        if (!course.waitingListEnabled) {
          throw new Error("Warteliste ist für diesen Kurs deaktiviert.");
        }
        const courseRegistrations = await listRegistrationsByCourse(course.id);
        nextStatus = "waitlisted";
        nextWaitingListPosition = courseRegistrations.filter((entry) =>
          entry.status === "waitlisted" && entry.id !== registration.id
        ).length + 1;
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
      const auditLog = createAuditLog({
        actorUserId: input.actorUserId,
        entityType: "registration",
        entityId: next.id,
        action: `registration.${input.action}`,
        oldValue: JSON.stringify({
          status: registration.status,
          waitingListPosition: registration.waitingListPosition,
          adminMessage: registration.adminMessage,
          internalNotes: registration.internalNotes,
        }),
        newValue: JSON.stringify({
          status: next.status,
          waitingListPosition: next.waitingListPosition,
          adminMessage: next.adminMessage,
          internalNotes: next.internalNotes,
        }),
      });
      const emailEvent: RegistrationEmailEvent = input.action === "approve"
        ? "approved"
        : input.action === "reject"
        ? "rejected"
        : input.action === "waitlist"
        ? "waitlisted"
        : input.action === "promote"
        ? "promoted"
        : "cancelled";
      const outboxJob = createRegistrationEventOutboxJob(
        next,
        course,
        emailEvent,
        `registration_action:${auditLog.id}`,
        input.adminMessage,
      );
      if (
        !(await updateRegistrationChecked(
          registrationEntry,
          next,
          auditLog,
          outboxJob,
          { course: courseEntry, revision, lease },
        ))
      ) {
        throw new Error(
          "Anmeldung wurde gleichzeitig geändert. Bitte erneut versuchen.",
        );
      }
      await recalculateWaitlistPositions(registration.courseId);
      const refreshed = await getRegistrationById(registration.id);
      if (!refreshed) {
        throw new Error("Aktualisierte Anmeldung konnte nicht geladen werden.");
      }
      return { previous: registration, next: refreshed, course };
    },
  );
  try {
    await rebuildPublicSnapshotsForCourse(result.next.courseId);
  } catch (error) {
    logger.error("registration.snapshot_rebuild_failed", {
      registrationId: result.next.id,
      error,
    });
  }

  await processEmailOutboxBatch(20);

  return { previous: result.previous, next: result.next };
}
