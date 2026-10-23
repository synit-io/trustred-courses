import { ensurePayPalConfig, env } from "../env.ts";
import {
  bumpCourseRevision,
  getCourseRevisionEntry,
} from "../courses/revision.ts";
import {
  isRegistrationWindowOpen,
  registrationFingerprint,
} from "../registrations/service.ts";
import type { Course } from "../types.ts";
import { getKv } from "../kv/client.ts";

export interface PaidRegistrationInput {
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

export interface PendingPaidRegistration {
  id: string;
  courseId: string;
  registrationInput: PaidRegistrationInput;
  paypalOrderId: string;
  status:
    | "creating"
    | "checkout_created"
    | "capture_started"
    | "settlement_pending"
    | "captured"
    | "finalized"
    | "requires_review";
  fingerprint?: string;
  reconcileAfter?: string;
  reconcileOwner?: string;
  /** Marks checkouts whose first capture is durably claimed by this version. */
  captureStateVersion?: 1;
  lastError?: string | null;
  registrationId: string;
  confirmationToken: string;
  capture?: PayPalCaptureResult;
  capturePaidAt?: string;
  feeAmountCents: number;
  feeCurrency: string;
  createdAt: string;
  expiresAt: string;
}

export interface PayPalCheckoutOrderResult {
  orderId: string;
  approvalUrl: string;
}

export interface PayPalCaptureResult {
  orderId: string;
  captureId: string;
  status: string;
  customId: string | null;
  amountCents: number;
  currency: string;
}

function isAllowedPayPalApprovalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (env.paypalEnvironment === "live") {
    return host === "www.paypal.com" || host === "paypal.com";
  }
  return host === "www.sandbox.paypal.com" ||
    host === "sandbox.paypal.com";
}

function assertPayPalApprovalUrl(urlRaw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlRaw);
  } catch {
    throw new Error(
      "PayPal-Bestellanlage lieferte eine ungültige Freigabe-URL.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error("PayPal-Freigabe-URL muss HTTPS verwenden.");
  }
  if (!isAllowedPayPalApprovalHost(parsed.hostname)) {
    throw new Error("PayPal-Freigabe-URL enthält einen ungültigen Host.");
  }
}

function paypalApiBaseUrl(): string {
  return env.paypalEnvironment === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function centsToPayPalValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

function toCents(value: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Ungültiger Zahlungsbetrag von PayPal.");
  }
  return Math.round(amount * 100);
}

async function paypalAccessToken(): Promise<string> {
  ensurePayPalConfig();
  const credentials = btoa(`${env.paypalClientId}:${env.paypalClientSecret}`);
  const response = await fetch(`${paypalApiBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    throw new Error("PayPal-Authentifizierung fehlgeschlagen.");
  }
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("PayPal-Authentifizierung lieferte kein Zugriffstoken.");
  }
  return payload.access_token;
}

export async function createPayPalCheckoutOrder(input: {
  orderReference: string;
  amountCents: number;
  currency: string;
  title: string;
  returnUrl: string;
  cancelUrl: string;
  requestId: string;
}): Promise<PayPalCheckoutOrderResult> {
  const accessToken = await paypalAccessToken();
  const response = await fetch(`${paypalApiBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "PayPal-Request-Id": input.requestId,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        custom_id: input.orderReference,
        description: input.title,
        amount: {
          currency_code: input.currency,
          value: centsToPayPalValue(input.amountCents),
        },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
            user_action: "PAY_NOW",
            brand_name: env.appName,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error("PayPal-Bestellanlage fehlgeschlagen.");
  }

  const payload = await response.json() as {
    id?: string;
    links?: Array<{ rel?: string; href?: string }>;
  };
  const orderId = payload.id ?? "";
  const approvalUrl =
    payload.links?.find((entry) =>
      entry.rel === "payer-action" || entry.rel === "approve"
    )?.href ?? "";
  if (!orderId || !approvalUrl) {
    throw new Error("PayPal-Bestellanlage lieferte keine Freigabe-URL.");
  }
  assertPayPalApprovalUrl(approvalUrl);

  return { orderId, approvalUrl };
}

export async function capturePayPalOrder(
  orderId: string,
  requestId: string,
): Promise<PayPalCaptureResult> {
  const accessToken = await paypalAccessToken();
  const response = await fetch(
    `${paypalApiBaseUrl()}/v2/checkout/orders/${
      encodeURIComponent(orderId)
    }/capture`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "PayPal-Request-Id": requestId,
        Prefer: "return=representation",
      },
    },
  );
  if (!response.ok) {
    throw new Error("PayPal-Zahlung konnte nicht abgeschlossen werden.");
  }
  return parsePayPalCapture(await response.json(), orderId);
}

interface PayPalOrderPayload {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    custom_id?: string;
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { value?: string; currency_code?: string };
      }>;
    };
  }>;
}

function parsePayPalCapture(
  payload: PayPalOrderPayload,
  orderId: string,
): PayPalCaptureResult {
  const purchaseUnit = payload.purchase_units?.[0];
  const capture = purchaseUnit?.payments?.captures?.[0];
  const currency = capture?.amount?.currency_code?.toUpperCase() ?? "";
  const value = capture?.amount?.value ?? "";
  const captureId = capture?.id ?? "";
  const status = capture?.status ?? payload.status ?? "";

  if (!captureId || !currency || !value) {
    throw new Error("PayPal-Antwort enthält keine bestätigte Zahlung.");
  }

  return {
    orderId: payload.id ?? orderId,
    captureId,
    status,
    customId: purchaseUnit?.custom_id ?? null,
    amountCents: toCents(value),
    currency,
  };
}

/** Read settlement without depending on a browser return or checkout expiry. */
export async function getPayPalOrderCapture(
  orderId: string,
): Promise<PayPalCaptureResult | null> {
  const token = await paypalAccessToken();
  const response = await fetch(
    `${paypalApiBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    throw new Error("PayPal-Zahlungsstatus konnte nicht geladen werden.");
  }
  const payload = await response.json() as PayPalOrderPayload;
  if (payload.id !== orderId) throw new Error("Ungültige PayPal-Bestellung.");
  if (!payload.purchase_units?.[0]?.payments?.captures?.length) return null;
  return parsePayPalCapture(payload, orderId);
}

export function pendingPaymentFingerprintKey(
  courseId: string,
  fingerprint: string,
): Deno.KvKey {
  return ["pending_paid_registration_fingerprints", courseId, fingerprint];
}

export async function savePendingPaidRegistration(
  pending: PendingPaidRegistration,
): Promise<void> {
  const kv = await getKv();
  const revision = await getCourseRevisionEntry(pending.courseId);
  const course = await kv.get<Course>(["courses", pending.courseId]);
  if (!course.value || course.value.status !== "active") {
    throw new Error("Kurs nicht verfügbar.");
  }
  if (
    !isRegistrationWindowOpen(course.value) ||
    course.value.pricingType !== "paid" ||
    course.value.feeAmountCents !== pending.feeAmountCents ||
    course.value.feeCurrency?.toUpperCase() !==
      pending.feeCurrency.toUpperCase()
  ) {
    throw new Error(
      "Kurszahlung oder Anmeldezeitraum wurde geändert. Bitte lade den Kurs erneut.",
    );
  }
  const fingerprint = await registrationFingerprint(pending.registrationInput);
  const claim = await kv.get<string>(
    pendingPaymentFingerprintKey(pending.courseId, fingerprint),
  );
  const existingRegistration = await kv.get<string>([
    "registration_fingerprints",
    pending.courseId,
    fingerprint,
  ]);
  const existingPending = await kv.get<PendingPaidRegistration>([
    "pending_paid_registrations",
    pending.id,
  ]);
  if (claim.value || existingRegistration.value || existingPending.value) {
    throw new Error(
      "Eine identische Anmeldung oder Zahlung ist bereits vorhanden. Bitte nutze den vorhandenen Zahlungs- oder Bestätigungslink.",
    );
  }
  // Existing checkouts predate fingerprint reservations. The revision captured
  // before this scan fences a concurrent legacy finalization or cancellation.
  for await (
    const existing of kv.list<PendingPaidRegistration>({
      prefix: ["pending_paid_registrations"],
    })
  ) {
    if (existing.value.courseId !== pending.courseId) continue;
    const existingFingerprint = existing.value.fingerprint ??
      await registrationFingerprint(existing.value.registrationInput);
    if (existingFingerprint === fingerprint) {
      throw new Error(
        "Eine identische Anmeldung oder Zahlung ist bereits vorhanden.",
      );
    }
  }
  const stored = { ...pending, fingerprint, captureStateVersion: 1 as const };
  const result = await bumpCourseRevision(
    kv.atomic().check(course).check(claim).check(existingRegistration).check(
      existingPending,
    ),
    revision,
  )
    .set(["pending_paid_registrations", pending.id], stored)
    .set(
      ["pending_paid_registrations_by_course", pending.courseId, pending.id],
      true,
    )
    .set(claim.key, pending.id)
    .commit();
  if (!result.ok) {
    throw new Error(
      "Anmeldung oder Kurs wurde gleichzeitig geändert. Bitte erneut versuchen.",
    );
  }
}

export async function getPendingPaidRegistrationEntry(
  id: string,
): Promise<Deno.KvEntryMaybe<PendingPaidRegistration>> {
  return await (await getKv()).get<PendingPaidRegistration>([
    "pending_paid_registrations",
    id,
  ], { consistency: "strong" });
}

export async function updatePendingPaidRegistration(
  pending: PendingPaidRegistration,
  expected?: Deno.KvEntryMaybe<PendingPaidRegistration>,
): Promise<boolean> {
  const kv = await getKv();
  const current = expected ?? await getPendingPaidRegistrationEntry(pending.id);
  if (!current.value) return false;
  const previous = current.value;
  const rank: Record<PendingPaidRegistration["status"], number> = {
    creating: 0,
    checkout_created: 1,
    capture_started: 2,
    settlement_pending: 3,
    captured: 4,
    finalized: 5,
    requires_review: 5,
  };
  if (
    previous.feeAmountCents !== pending.feeAmountCents ||
    previous.feeCurrency !== pending.feeCurrency ||
    JSON.stringify(previous.registrationInput) !==
      JSON.stringify(pending.registrationInput) ||
    (previous.capture?.status === "COMPLETED" &&
      JSON.stringify(previous.capture) !== JSON.stringify(pending.capture)) ||
    previous.courseId !== pending.courseId ||
    previous.registrationId !== pending.registrationId ||
    previous.confirmationToken !== pending.confirmationToken ||
    (previous.paypalOrderId &&
      previous.paypalOrderId !== pending.paypalOrderId) ||
    rank[pending.status] < rank[previous.status] ||
    (previous.status === "requires_review" &&
      pending.status !== "requires_review") ||
    (previous.status === "finalized" && pending.status !== "finalized")
  ) return false;
  const revision = await getCourseRevisionEntry(pending.courseId);
  // Recovery states deliberately have no TTL: uncertain provider outcomes must survive outages.
  return (await bumpCourseRevision(kv.atomic().check(current), revision)
    .set(current.key, {
      ...pending,
      capturePaidAt: previous.capturePaidAt ??
        (pending.capture?.status === "COMPLETED"
          ? new Date().toISOString()
          : undefined),
      fingerprint: previous.fingerprint ?? pending.fingerprint,
      captureStateVersion: previous.captureStateVersion ??
        pending.captureStateVersion,
    })
    .set(
      ["pending_paid_registrations_by_course", pending.courseId, pending.id],
      true,
    )
    .commit()).ok;
}

export async function hasPendingPaidRegistrationsForCourse(
  courseId: string,
): Promise<boolean> {
  const kv = await getKv();
  for await (
    const entry of kv.list<boolean>({
      prefix: ["pending_paid_registrations_by_course", courseId],
    }, { limit: 1 })
  ) {
    if (entry.value) return true;
  }
  return false;
}

export async function getPendingPaidRegistration(
  id: string,
): Promise<PendingPaidRegistration | null> {
  return (await getPendingPaidRegistrationEntry(id)).value;
}

/** Only an uncaptured checkout can be removed; the checked read fences capture claims. */
export async function deletePendingPaidRegistration(
  id: string,
  orderId?: string,
): Promise<boolean> {
  const kv = await getKv();
  const current = await getPendingPaidRegistrationEntry(id);
  const pending = current.value;
  if (
    !pending || (orderId && pending.paypalOrderId !== orderId) ||
    (pending.status !== "creating" && pending.status !== "checkout_created") ||
    (pending.status === "checkout_created" && pending.captureStateVersion !== 1)
  ) return false;
  const revision = await getCourseRevisionEntry(pending.courseId);
  let tx = bumpCourseRevision(kv.atomic().check(current), revision)
    .delete(current.key)
    .delete([
      "pending_paid_registrations_by_course",
      pending.courseId,
      pending.id,
    ]);
  const fingerprint = pending.fingerprint ??
    await registrationFingerprint(pending.registrationInput);
  const claim = await kv.get<string>(
    pendingPaymentFingerprintKey(pending.courseId, fingerprint),
  );
  if (claim.value === pending.id) tx = tx.check(claim).delete(claim.key);
  return (await tx.commit()).ok;
}
