import { ensurePayPalConfig, env } from "../env.ts";
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
}): Promise<PayPalCheckoutOrderResult> {
  const accessToken = await paypalAccessToken();
  const response = await fetch(`${paypalApiBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
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
        Prefer: "return=representation",
      },
    },
  );
  if (!response.ok) {
    throw new Error("PayPal-Zahlung konnte nicht abgeschlossen werden.");
  }
  const payload = await response.json() as {
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
  };

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

const PENDING_REGISTRATION_TTL_MS = 60 * 60 * 1000;

export async function savePendingPaidRegistration(
  pending: PendingPaidRegistration,
): Promise<void> {
  const kv = await getKv();
  await kv.set(["pending_paid_registrations", pending.id], pending, {
    expireIn: PENDING_REGISTRATION_TTL_MS,
  });
}

export async function getPendingPaidRegistration(
  id: string,
): Promise<PendingPaidRegistration | null> {
  const kv = await getKv();
  const entry = await kv.get<PendingPaidRegistration>([
    "pending_paid_registrations",
    id,
  ], { consistency: "strong" });
  return entry.value ?? null;
}

export async function deletePendingPaidRegistration(id: string): Promise<void> {
  const kv = await getKv();
  await kv.delete(["pending_paid_registrations", id]);
}
