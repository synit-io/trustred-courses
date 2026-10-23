import { getKv } from "../kv/client.ts";
import { logger } from "../observability/logger.ts";
import {
  DuplicateRegistrationError,
  submitRegistrationWithDoubleOptIn,
} from "../registrations/service.ts";
import {
  capturePayPalOrder,
  deletePendingPaidRegistration,
  getPayPalOrderCapture,
  getPendingPaidRegistrationEntry,
  type PayPalCaptureResult,
  type PendingPaidRegistration,
  updatePendingPaidRegistration,
} from "./paypal.ts";

class PaymentReviewRequiredError extends Error {}

function validateCapture(
  pending: PendingPaidRegistration,
  capture: PayPalCaptureResult,
): void {
  if (
    capture.orderId !== pending.paypalOrderId ||
    capture.customId !== pending.id ||
    capture.amountCents !== pending.feeAmountCents ||
    capture.currency !== pending.feeCurrency.toUpperCase()
  ) {
    throw new PaymentReviewRequiredError(
      "PayPal-Zahlung stimmt nicht mit Bestellung, Referenz oder Kursgebühr überein.",
    );
  }
}

/** All network effects follow a durable, checked capture claim. */
export async function reconcilePendingPaidRegistration(
  id: string,
  browserReturn = false,
): Promise<PendingPaidRegistration | null> {
  let entry = await getPendingPaidRegistrationEntry(id);
  let pending = entry.value;
  if (
    !pending || pending.status === "finalized" ||
    pending.status === "requires_review"
  ) return pending;
  const wasCheckout = pending.status === "checkout_created";
  if (pending.status === "creating") return pending;
  if (wasCheckout && !browserReturn) return pending;
  if (wasCheckout && Date.parse(pending.expiresAt) <= Date.now()) {
    throw new Error("Zahlungssitzung ist abgelaufen.");
  }
  if (
    !wasCheckout && pending.reconcileAfter &&
    Date.parse(pending.reconcileAfter) > Date.now()
  ) return pending;
  const claimed: PendingPaidRegistration = {
    ...pending,
    status: wasCheckout ? "capture_started" : pending.status,
    reconcileOwner: crypto.randomUUID(),
    captureStateVersion: wasCheckout ? 1 : pending.captureStateVersion,
    reconcileAfter: new Date(Date.now() + 60_000).toISOString(),
    lastError: null,
  };
  if (!await updatePendingPaidRegistration(claimed, entry)) {
    return (await getPendingPaidRegistrationEntry(id)).value;
  }
  entry = await getPendingPaidRegistrationEntry(id);
  pending = entry.value!;
  if (pending.reconcileOwner !== claimed.reconcileOwner) return pending;
  let observedCapture: PayPalCaptureResult | undefined;
  try {
    let capture = pending.status === "captured" ? pending.capture : undefined;
    if (!capture) {
      capture = wasCheckout
        ? await capturePayPalOrder(
          pending.paypalOrderId,
          `capture-${pending.id}`,
        )
        : await getPayPalOrderCapture(pending.paypalOrderId) ?? undefined;
      // A transport failure may precede the provider accepting capture. Read first,
      // then repeat the same order with its original idempotency key if necessary.
      if (!capture && pending.captureStateVersion !== 1) {
        throw new PaymentReviewRequiredError(
          "Legacy-Zahlung benötigt manuelle Prüfung: kein verifizierter Capture-Status.",
        );
      }
      if (!capture) {
        capture = await capturePayPalOrder(
          pending.paypalOrderId,
          `capture-${pending.id}`,
        );
      }
    }
    observedCapture = capture;
    validateCapture(pending, capture);
    const settled = capture.status === "COMPLETED";
    const terminalFailure = [
      "DECLINED",
      "DENIED",
      "FAILED",
      "REFUNDED",
      "REVERSED",
    ].includes(capture.status);
    const captured: PendingPaidRegistration = {
      ...pending,
      capture,
      status: settled
        ? "captured"
        : terminalFailure
        ? "requires_review"
        : "settlement_pending",
      reconcileAfter: new Date(Date.now() + 60_000).toISOString(),
      lastError: terminalFailure ? `PayPal-Status: ${capture.status}` : null,
    };
    if (!await updatePendingPaidRegistration(captured, entry)) {
      return (await getPendingPaidRegistrationEntry(id)).value;
    }
    if (!settled) {
      if (terminalFailure) {
        logger.error("payment.manual_review_required", {
          pendingId: pending.id,
          paypalOrderId: pending.paypalOrderId,
          captureId: capture.captureId,
          providerStatus: capture.status,
        });
      }
      return captured;
    }
    entry = await getPendingPaidRegistrationEntry(id);
    pending = entry.value!;
    if (
      pending.reconcileOwner !== claimed.reconcileOwner ||
      pending.status !== "captured"
    ) return pending;
    const created = await submitRegistrationWithDoubleOptIn(
      pending.registrationInput,
      {
        provider: "paypal",
        captureId: capture.captureId,
        amountCents: capture.amountCents,
        currency: capture.currency,
        paidAt: pending.capturePaidAt ?? new Date().toISOString(),
      },
      {
        registrationId: pending.registrationId,
        confirmationToken: pending.confirmationToken,
        skipEligibilityRecheck: true,
        pendingPaidRegistrationId: pending.id,
      },
    );
    const finalized: PendingPaidRegistration = {
      ...pending,
      status: "finalized",
      registrationId: created.registration.id,
      lastError: null,
    };
    await updatePendingPaidRegistration(finalized, entry);
    return (await getPendingPaidRegistrationEntry(id)).value;
  } catch (error) {
    // Only this worker's last checked version may record its failure. A slower
    // provider response must never replace a newer worker's settled capture.
    if (
      entry.value && entry.value.reconcileOwner === claimed.reconcileOwner &&
      entry.value.status !== "finalized"
    ) {
      const message = error instanceof Error ? error.message : String(error);
      await updatePendingPaidRegistration({
        ...entry.value,
        capture: observedCapture ?? entry.value.capture,
        status: error instanceof DuplicateRegistrationError ||
            error instanceof PaymentReviewRequiredError
          ? "requires_review"
          : entry.value.status,
        lastError: message,
        reconcileAfter: new Date(Date.now() + 60_000).toISOString(),
      }, entry);
    }
    logger.error("payment.reconciliation_failed", { pendingId: id, error });
    throw error;
  }
}

/** Scheduled recovery is independent of browser cookies, return links and checkout TTL. */
export async function processPendingPayPalPayments(
  limit = 20,
): Promise<number> {
  const kv = await getKv();
  let processed = 0;
  for await (
    const entry of kv.list<PendingPaidRegistration>({
      prefix: ["pending_paid_registrations"],
    })
  ) {
    if (processed >= limit) break;
    const pending = entry.value;
    if (
      (pending.status === "creating" ||
        pending.status === "checkout_created") &&
      Date.parse(pending.expiresAt) <= Date.now()
    ) {
      if (
        pending.status === "checkout_created" &&
        pending.captureStateVersion !== 1
      ) {
        // Older releases did not persist a capture claim or pending response.
        // Expiry therefore cannot prove that this order was never charged.
        const current = await getPendingPaidRegistrationEntry(pending.id);
        if (
          current.value?.status === "checkout_created" &&
          current.value.captureStateVersion !== 1 &&
          Date.parse(current.value.expiresAt) <= Date.now() &&
          await updatePendingPaidRegistration({
            ...current.value,
            status: "capture_started",
            reconcileAfter: new Date(0).toISOString(),
          }, current)
        ) {
          try {
            await reconcilePendingPaidRegistration(pending.id);
          } catch { /* Preserve for retry or manual review. */ }
        }
      } else {
        await deletePendingPaidRegistration(pending.id);
      }
      processed++;
    } else if (
      ["capture_started", "settlement_pending", "captured"].includes(
        pending.status,
      ) &&
      (!pending.reconcileAfter ||
        Date.parse(pending.reconcileAfter) <= Date.now())
    ) {
      try {
        await reconcilePendingPaidRegistration(pending.id);
      } catch { /* Durable retry state already saved. */ }
      processed++;
    }
  }
  return processed;
}
