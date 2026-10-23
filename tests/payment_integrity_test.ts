import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { Hono } from "hono";
import { upsertCourse } from "../lib/courses/repository.ts";
import { __setEmailSenderForTests } from "../lib/email/service.ts";
import { __setKvFactoryForTests } from "../lib/kv/client.ts";
import { env } from "../lib/env.ts";
import {
  getPendingPaidRegistration,
  getPendingPaidRegistrationEntry,
  type PendingPaidRegistration,
  savePendingPaidRegistration,
  updatePendingPaidRegistration,
} from "../lib/payments/paypal.ts";
import {
  processPendingPayPalPayments,
  reconcilePendingPaidRegistration,
} from "../lib/payments/service.ts";
import {
  getRegistrationById,
  listRegistrationsByCourse,
} from "../lib/registrations/repository.ts";
import type { Course } from "../lib/types.ts";
import type { AppEnv } from "../src/app/context.ts";
import { registrationCreateRoute } from "../src/routes/api/registrations/create/route.ts";
import { registrationPayPalCancelRoute } from "../src/routes/api/registrations/paypal/cancel/route.ts";
import { registrationPayPalReturnRoute } from "../src/routes/api/registrations/paypal/return/route.ts";
import { setupKvTest } from "./test_utils.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => resolve = done);
  return { resolve, promise };
}

function course(): Course {
  return {
    id: "paid-course",
    title: "Course",
    description: "Description",
    location: "Berlin",
    startsAt: "2099-01-01T08:00:00.000Z",
    endsAt: "2099-01-01T17:00:00.000Z",
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity: 1,
    waitingListEnabled: true,
    reminderDaysBefore: null,
    status: "active",
    pricingType: "paid",
    feeAmountCents: 1000,
    feeCurrency: "EUR",
    createdAt: new Date().toISOString(),
  };
}

function pending(
  id = "pending",
  email = "paid@example.org",
): PendingPaidRegistration {
  return {
    id,
    courseId: "paid-course",
    registrationId: `registration-${id}`,
    registrationInput: {
      courseId: "paid-course",
      firstName: "Paid",
      lastName: "Participant",
      street: "Street",
      houseNumber: "1",
      postalCode: "10115",
      city: "Berlin",
      email,
      phone: "",
      consentAccepted: true,
    },
    confirmationToken: `confirmation-${id}`,
    paypalOrderId: `order-${id}`,
    status: "checkout_created",
    feeAmountCents: 1000,
    feeCurrency: "EUR",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

function payload(payment: PendingPaidRegistration, status = "COMPLETED") {
  return {
    id: payment.paypalOrderId,
    status: "COMPLETED",
    purchase_units: [{
      custom_id: payment.id,
      payments: {
        captures: [{
          id: `capture-${payment.id}`,
          status,
          amount: { value: "10.00", currency_code: "EUR" },
        }],
      },
    }],
  };
}

async function setup() {
  const context = await setupKvTest("payment-integrity-");
  const previousFetch = globalThis.fetch;
  const previousHeader = env.trustedClientIpHeader;
  const previousDemo = Deno.env.get("DEMO_MODE");
  const previousClient = Deno.env.get("PAYPAL_CLIENT_ID");
  const previousSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
  env.trustedClientIpHeader = "";
  Deno.env.set("DEMO_MODE", "false");
  Deno.env.set("PAYPAL_CLIENT_ID", "test-client");
  Deno.env.set("PAYPAL_CLIENT_SECRET", "test-secret");
  __setEmailSenderForTests(() => Promise.resolve({ ok: true }));
  await upsertCourse(course());
  return {
    ...context,
    cleanup: async () => {
      globalThis.fetch = previousFetch;
      env.trustedClientIpHeader = previousHeader;
      for (
        const [key, value] of [["DEMO_MODE", previousDemo], [
          "PAYPAL_CLIENT_ID",
          previousClient,
        ], ["PAYPAL_CLIENT_SECRET", previousSecret]]
      ) {
        if (value === undefined) Deno.env.delete(key!);
        else Deno.env.set(key!, value);
      }
      __setEmailSenderForTests(null);
      await context.cleanup();
    },
  };
}

const peer = { remoteAddr: { hostname: "192.0.2.1" } };
function callbackApp() {
  const app = new Hono<AppEnv>();
  app.route("/paypal", registrationPayPalReturnRoute);
  app.route("/paypal", registrationPayPalCancelRoute);
  return app;
}
function mockPayPal(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      return Promise.resolve(Response.json({ access_token: "test-token" }));
    }
    return Promise.resolve(handler(url, init));
  };
}

Deno.test("cancel before capture removes checkout; cancel during capture preserves correlation and finalized replay is safe", async () => {
  const { cleanup } = await setup();
  const started = deferred();
  const release = deferred();
  let calls = 0;
  try {
    const payment = pending();
    await savePendingPaidRegistration(payment);
    const app = callbackApp();
    mockPayPal(async () => {
      calls++;
      started.resolve();
      await release.promise;
      return Response.json(payload(payment));
    });
    const result = app.request(
      "/paypal/return?state=pending&token=order-pending",
      undefined,
      peer,
    );
    await started.promise;
    const cancel = await app.request(
      "/paypal/cancel?state=pending&token=order-pending",
      undefined,
      peer,
    );
    assertStringIncludes(cancel.headers.get("Location")!, "verarbeitet");
    assertEquals(
      (await getPendingPaidRegistration("pending"))?.status,
      "capture_started",
    );
    release.resolve();
    assertStringIncludes(
      (await result).headers.get("Location")!,
      "payment_success=1",
    );
    assertEquals(
      (await getPendingPaidRegistration("pending"))?.status,
      "finalized",
    );
    assert(await getRegistrationById(payment.registrationId));
    const replay = await app.request(
      "/paypal/return?state=pending&token=order-pending",
      undefined,
      peer,
    );
    assertStringIncludes(replay.headers.get("Location")!, "payment_success=1");
    assertEquals(calls, 1);
    const wrongOrder = await app.request(
      "/paypal/return?state=pending&token=other-order",
      undefined,
      peer,
    );
    assertStringIncludes(wrongOrder.headers.get("Location")!, "course_error=");
    const after = await app.request(
      "/paypal/cancel?state=pending&token=order-pending",
      undefined,
      peer,
    );
    assertStringIncludes(after.headers.get("Location")!, "payment_success=1");
    const uncaptured = pending("uncaptured", "other@example.org");
    await savePendingPaidRegistration(uncaptured);
    await app.request(
      "/paypal/cancel?state=uncaptured&token=order-uncaptured",
      undefined,
      peer,
    );
    await app.request(
      "/paypal/return?state=uncaptured&token=order-uncaptured",
      undefined,
      peer,
    );
    assertEquals(await getPendingPaidRegistration("uncaptured"), null);
    assertEquals(calls, 1);
  } finally {
    release.resolve();
    await cleanup();
  }
});

Deno.test("concurrent identical HTTP submissions reserve one checkout before provider order creation", async () => {
  const { cleanup } = await setup();
  const started = deferred();
  const release = deferred();
  let creates = 0;
  try {
    mockPayPal(async (_url, init) => {
      creates++;
      const body = JSON.parse(String(init?.body));
      assert(body.purchase_units[0].custom_id);
      started.resolve();
      await release.promise;
      return Response.json({
        id: "created-order",
        links: [{
          rel: "approve",
          href:
            "https://www.sandbox.paypal.com/checkoutnow?token=created-order",
        }],
      });
    });
    const app = new Hono<AppEnv>().route("/create", registrationCreateRoute);
    const form = () =>
      new URLSearchParams({
        ...pending().registrationInput,
        consentAccepted: "on",
      });
    const first = app.request(
      "/create",
      { method: "POST", body: form() },
      peer,
    );
    await started.promise;
    const second = await app.request("/create", {
      method: "POST",
      body: form(),
    }, peer);
    assertStringIncludes(second.headers.get("Location")!, "course_error=");
    assertEquals(creates, 1);
    release.resolve();
    assertStringIncludes(
      (await first).headers.get("Location")!,
      "sandbox.paypal.com",
    );
    assertEquals(creates, 1);
  } finally {
    release.resolve();
    await cleanup();
  }
});

Deno.test("separately captured legacy duplicate retains payment for review without another participant", async () => {
  const { kv, cleanup } = await setup();
  try {
    const first = pending("first");
    const second = pending("second");
    // Simulate pre-upgrade orders, which did not reserve a fingerprint.
    await kv.set(["pending_paid_registrations", first.id], first);
    await kv.set(["pending_paid_registrations", second.id], second);
    mockPayPal((url) =>
      Response.json(payload(url.includes("order-first") ? first : second))
    );
    assertEquals(
      (await reconcilePendingPaidRegistration(first.id, true))?.status,
      "finalized",
    );
    await assertRejects(() =>
      reconcilePendingPaidRegistration(second.id, true)
    );
    const duplicate = await getPendingPaidRegistration(second.id);
    assertEquals(duplicate?.status, "requires_review");
    assertEquals(duplicate?.capture?.captureId, "capture-second");
    assertEquals(duplicate?.registrationId, second.registrationId);
    assertEquals((await listRegistrationsByCourse("paid-course")).length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("pending settlement is saved and reconciled after checkout expiry without a browser return", async () => {
  const { cleanup } = await setup();
  let captures = 0;
  let reads = 0;
  const payment = pending();
  try {
    await savePendingPaidRegistration(payment);
    mockPayPal((url) => {
      if (url.endsWith("/capture")) {
        captures++;
        return Response.json(payload(payment, "PENDING"));
      }
      reads++;
      return Response.json(payload(payment));
    });
    const first = await reconcilePendingPaidRegistration(payment.id, true);
    assertEquals(first?.status, "settlement_pending");
    assertEquals(first?.capture?.captureId, "capture-pending");
    assertEquals(await getRegistrationById(payment.registrationId), null);
    const entry = await getPendingPaidRegistrationEntry(payment.id);
    assert(entry.value);
    assert(
      await updatePendingPaidRegistration({
        ...entry.value,
        expiresAt: "2020-01-01T00:00:00.000Z",
        reconcileAfter: "2020-01-01T00:00:00.000Z",
      }, entry),
    );
    assertEquals(await processPendingPayPalPayments(), 1);
    const recovered = await getPendingPaidRegistration(payment.id);
    assertEquals(recovered?.status, "finalized");
    assertEquals(recovered?.registrationId, payment.registrationId);
    assertEquals(recovered?.confirmationToken, payment.confirmationToken);
    assertEquals(
      (await getRegistrationById(payment.registrationId))?.paymentCaptureId,
      "capture-pending",
    );
    assertEquals(captures, 1);
    assertEquals(reads, 1);
    assertEquals(await processPendingPayPalPayments(), 0);
  } finally {
    await cleanup();
  }
});

Deno.test("unknown capture outcome survives a transport failure and provider lookup recovers it", async () => {
  const { cleanup } = await setup();
  let captures = 0;
  const payment = pending();
  try {
    await savePendingPaidRegistration(payment);
    mockPayPal((url) => {
      if (url.endsWith("/capture")) {
        captures++;
        throw new Error("simulated transport disconnect");
      }
      return Response.json(payload(payment));
    });
    await assertRejects(() =>
      reconcilePendingPaidRegistration(payment.id, true)
    );
    const unknown = await getPendingPaidRegistrationEntry(payment.id);
    assertEquals(unknown.value?.status, "capture_started");
    assert(unknown.value);
    assert(
      await updatePendingPaidRegistration({
        ...unknown.value,
        reconcileAfter: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }, unknown),
    );
    await processPendingPayPalPayments();
    assertEquals(
      (await getPendingPaidRegistration(payment.id))?.status,
      "finalized",
    );
    assertEquals(captures, 1);
    assert(await getRegistrationById(payment.registrationId));
  } finally {
    await cleanup();
  }
});

Deno.test("expired untouched checkout never captures and releases its reservation during cleanup", async () => {
  const { cleanup } = await setup();
  let calls = 0;
  try {
    const expired = { ...pending(), expiresAt: "2020-01-01T00:00:00.000Z" };
    await savePendingPaidRegistration(expired);
    mockPayPal(() => {
      calls++;
      throw new Error("must not contact provider");
    });
    await assertRejects(() =>
      reconcilePendingPaidRegistration(expired.id, true)
    );
    assertEquals(calls, 0);
    assertEquals(await processPendingPayPalPayments(), 1);
    assertEquals(await getPendingPaidRegistration(expired.id), null);
    await savePendingPaidRegistration(pending("replacement"));
  } finally {
    await cleanup();
  }
});

Deno.test("public registration rejects mailbox syntax aliases and shares case-normalized recipient budgets", async () => {
  const { cleanup } = await setup();
  try {
    await upsertCourse({
      ...course(),
      pricingType: "free",
      feeAmountCents: null,
      feeCurrency: null,
    });
    const app = new Hono<AppEnv>().route("/create", registrationCreateRoute);
    const post = (email: string) =>
      app.request("/create", {
        method: "POST",
        body: new URLSearchParams({
          ...pending().registrationInput,
          email,
          consentAccepted: "on",
        }),
      }, peer);
    for (
      const alias of [
        "Display <paid@example.org>",
        "paid(comment)@example.org",
        "group:paid@example.org;",
        "paid@example.org,other@example.org",
      ]
    ) {
      assertStringIncludes(
        decodeURIComponent((await post(alias)).headers.get("Location")!),
        "ungültig",
      );
    }
    for (let index = 0; index < 5; index++) {
      const response = await post(
        index % 2 ? " PAID@EXAMPLE.ORG " : "paid@example.org",
      );
      assertEquals(response.headers.has("Retry-After"), false);
    }
    assert((await post("Paid@Example.Org")).headers.has("Retry-After"));
    assertEquals((await listRegistrationsByCourse("paid-course")).length, 1);
    assertStringIncludes(
      (await post("paid+different@example.org")).headers.get("Location")!,
      "doi_sent=1",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("public registration peer-IP budget applies without proxy headers and ignores forwarded spoofing", async () => {
  const { cleanup } = await setup();
  try {
    await upsertCourse({
      ...course(),
      pricingType: "free",
      feeAmountCents: null,
      feeCurrency: null,
    });
    const app = new Hono<AppEnv>().route("/create", registrationCreateRoute);
    const post = (index: number, connection = peer) =>
      app.request("/create", {
        method: "POST",
        headers: { "x-forwarded-for": `198.51.100.${index}` },
        body: new URLSearchParams({
          ...pending().registrationInput,
          email: `person${index}@example.org`,
          consentAccepted: "on",
        }),
      }, connection);
    for (let index = 0; index < 20; index++) {
      assertEquals((await post(index)).headers.has("Retry-After"), false);
    }
    assert((await post(20)).headers.has("Retry-After"));
    assertStringIncludes(
      (await post(21, { remoteAddr: { hostname: "192.0.2.2" } })).headers.get(
        "Location",
      )!,
      "doi_sent=1",
    );
    env.trustedClientIpHeader = "x-real-ip";
    assertStringIncludes(
      decodeURIComponent((await post(22)).headers.get("Location")!),
      "Anfrageadresse",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PayPal callback peer budgets are independent and missing configured proxy headers fail closed", async () => {
  const { cleanup } = await setup();
  try {
    const app = callbackApp();
    const path = "/paypal/cancel?state=missing&token=missing";
    for (let index = 0; index < 60; index++) {
      assertEquals(
        (await app.request(path, undefined, peer)).headers.has("Retry-After"),
        false,
      );
    }
    assert(
      (await app.request(path, undefined, peer)).headers.has("Retry-After"),
    );
    assertEquals(
      (await app.request(path, undefined, {
        remoteAddr: { hostname: "192.0.2.2" },
      })).headers.has("Retry-After"),
      false,
    );
    env.trustedClientIpHeader = "x-real-ip";
    assertStringIncludes(
      (await app.request(path, undefined, peer)).headers.get("Location")!,
      "Anfrageadresse",
    );
    assertEquals(
      (await app.request(
        path,
        { headers: { "x-real-ip": "198.51.100.1" } },
        peer,
      )).headers.has("Retry-After"),
      false,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("delayed reconciliation failure cannot overwrite a newer worker's completed capture", async () => {
  const { kv, cleanup } = await setup();
  const payment = pending();
  let failAfterProvider = false;
  try {
    await savePendingPaidRegistration(payment);
    const proxy = new Proxy(kv, {
      get(target, property) {
        if (property === "get") {
          return async (
            key: Deno.KvKey,
            options?: { consistency?: Deno.KvConsistencyLevel },
          ) => {
            if (failAfterProvider && key[0] === "course_revision") {
              failAfterProvider = false;
              const current = await target.get<PendingPaidRegistration>([
                "pending_paid_registrations",
                payment.id,
              ]);
              assert(current.value);
              await target.atomic().check(current)
                .set(current.key, {
                  ...current.value,
                  status: "captured",
                  reconcileOwner: "newer-worker",
                  capture: {
                    orderId: payment.paypalOrderId,
                    captureId: "newer-capture",
                    status: "COMPLETED",
                    customId: payment.id,
                    amountCents: 1000,
                    currency: "EUR",
                  },
                })
                .set(["course_revision", payment.courseId], crypto.randomUUID())
                .commit();
              throw new Error(
                "transient read failure after another worker completed capture",
              );
            }
            return await target.get(key, options);
          };
        }
        const member = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    __setKvFactoryForTests(() => Promise.resolve(proxy));
    mockPayPal(() => {
      failAfterProvider = true;
      return Response.json(payload(payment, "PENDING"));
    });
    await assertRejects(() =>
      reconcilePendingPaidRegistration(payment.id, true)
    );
    const winner = await getPendingPaidRegistration(payment.id);
    assertEquals(winner?.status, "captured");
    assertEquals(winner?.capture?.status, "COMPLETED");
    assertEquals(winner?.capture?.captureId, "newer-capture");
    assertEquals(winner?.reconcileOwner, "newer-worker");
  } finally {
    await cleanup();
  }
});

Deno.test("legacy live checkouts block a new identical reservation and stale course pricing is rejected", async () => {
  const { kv, cleanup } = await setup();
  try {
    const legacy = pending("legacy");
    await kv.set(["pending_paid_registrations", legacy.id], legacy);
    await assertRejects(() => savePendingPaidRegistration(pending("new")));
    assertEquals(await getPendingPaidRegistration("new"), null);
    await upsertCourse({ ...course(), feeAmountCents: 1200 });
    await assertRejects(() =>
      savePendingPaidRegistration(pending("repriced", "another@example.org"))
    );
    assertEquals(await getPendingPaidRegistration("repriced"), null);
  } finally {
    await cleanup();
  }
});

Deno.test("expired legacy checkout is inspected rather than deleted or newly captured", async () => {
  const { kv, cleanup } = await setup();
  let captureCalls = 0;
  try {
    const legacy = {
      ...pending("legacy"),
      expiresAt: "2020-01-01T00:00:00.000Z",
    };
    await kv.set(["pending_paid_registrations", legacy.id], legacy);
    mockPayPal((url) => {
      if (url.endsWith("/capture")) {
        captureCalls++;
        throw new Error("legacy recovery must read before capturing");
      }
      return Response.json(payload(legacy));
    });
    assertEquals(await processPendingPayPalPayments(), 1);
    assertEquals(
      (await getPendingPaidRegistration(legacy.id))?.status,
      "finalized",
    );
    assertEquals(
      (await getRegistrationById(legacy.registrationId))?.paymentCaptureId,
      "capture-legacy",
    );
    const unknown = {
      ...pending("legacy-unknown", "unknown@example.org"),
      expiresAt: "2020-01-01T00:00:00.000Z",
    };
    await kv.set(["pending_paid_registrations", unknown.id], unknown);
    mockPayPal((url) => {
      if (url.endsWith("/capture")) {
        captureCalls++;
        throw new Error("must not create a new legacy charge");
      }
      return Response.json({
        id: unknown.paypalOrderId,
        status: "APPROVED",
        purchase_units: [{ custom_id: unknown.id }],
      });
    });
    await processPendingPayPalPayments();
    assertEquals(
      (await getPendingPaidRegistration(unknown.id))?.status,
      "requires_review",
    );
    assertEquals(captureCalls, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("unrelated course revision conflict leaves a captured payment retryable", async () => {
  const { kv, cleanup } = await setup();
  let conflictOnce = true;
  let captures = 0;
  const payment = pending();
  try {
    await savePendingPaidRegistration(payment);
    const proxy = new Proxy(kv, {
      get(target, property) {
        if (property === "atomic") {
          return () => {
            const transaction = target.atomic();
            let createsRegistration = false;
            const wrapped = new Proxy(transaction, {
              get(tx, method) {
                if (method === "set") {
                  return (
                    key: Deno.KvKey,
                    value: unknown,
                    options?: { expireIn?: number },
                  ) => {
                    if (key[0] === "registrations") createsRegistration = true;
                    tx.set(key, value, options);
                    return wrapped;
                  };
                }
                if (method === "commit") {
                  return async () => {
                    if (createsRegistration && conflictOnce) {
                      conflictOnce = false;
                      await target.set(
                        ["course_revision", payment.courseId],
                        crypto.randomUUID(),
                      );
                    }
                    return await tx.commit();
                  };
                }
                const member = Reflect.get(tx, method, tx);
                if (typeof member !== "function") return member;
                return (...args: unknown[]) => {
                  const result = member.apply(tx, args);
                  return result === tx ? wrapped : result;
                };
              },
            });
            return wrapped;
          };
        }
        const member = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    __setKvFactoryForTests(() => Promise.resolve(proxy));
    mockPayPal(() => {
      captures++;
      return Response.json(payload(payment));
    });
    await assertRejects(
      () => reconcilePendingPaidRegistration(payment.id, true),
      Error,
      "gleichzeitig",
    );
    const retry = await getPendingPaidRegistrationEntry(payment.id);
    assertEquals(retry.value?.status, "captured");
    assert(retry.value);
    assert(
      await updatePendingPaidRegistration({
        ...retry.value,
        reconcileAfter: new Date(0).toISOString(),
      }, retry),
    );
    await processPendingPayPalPayments();
    assertEquals(
      (await getPendingPaidRegistration(payment.id))?.status,
      "finalized",
    );
    assertEquals((await listRegistrationsByCourse(payment.courseId)).length, 1);
    assertEquals(captures, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("legacy pending settlement recovery removes its old checkout TTL", async () => {
  const { kv, cleanup } = await setup();
  try {
    const legacy = {
      ...pending("legacy-ttl"),
      expiresAt: "2020-01-01T00:00:00.000Z",
    };
    await kv.set(["pending_paid_registrations", legacy.id], legacy, {
      expireIn: 500,
    });
    mockPayPal(() => Response.json(payload(legacy, "PENDING")));
    await processPendingPayPalPayments();
    await new Promise((done) => setTimeout(done, 600));
    assertEquals(
      (await getPendingPaidRegistration(legacy.id))?.status,
      "settlement_pending",
    );
    assertEquals(
      (await getPendingPaidRegistration(legacy.id))?.capture?.captureId,
      "capture-legacy-ttl",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("cancel callback preserves legacy uncertain capture correlation for provider reconciliation", async () => {
  const { kv, cleanup } = await setup();
  try {
    const legacy = {
      ...pending("legacy-cancel"),
      expiresAt: "2020-01-01T00:00:00.000Z",
    };
    await kv.set(["pending_paid_registrations", legacy.id], legacy);
    const app = callbackApp();
    const response = await app.request(
      `/paypal/cancel?state=${legacy.id}&token=${legacy.paypalOrderId}`,
      undefined,
      peer,
    );
    assertStringIncludes(
      response.headers.get("Location")!,
      "payment_pending=1",
    );
    assertEquals(
      (await getPendingPaidRegistration(legacy.id))?.paypalOrderId,
      legacy.paypalOrderId,
    );
    mockPayPal(() => Response.json(payload(legacy)));
    await processPendingPayPalPayments();
    assertEquals(
      (await getPendingPaidRegistration(legacy.id))?.status,
      "finalized",
    );
    assert(await getRegistrationById(legacy.registrationId));
  } finally {
    await cleanup();
  }
});

Deno.test("stale legacy cleanup scan cannot steal a newer capture claim", async () => {
  const { kv, cleanup } = await setup();
  let providerCalls = 0;
  try {
    const legacy = {
      ...pending("stale-scan"),
      expiresAt: "2020-01-01T00:00:00.000Z",
    };
    await kv.set(["pending_paid_registrations", legacy.id], legacy);
    const claimed = {
      ...legacy,
      status: "capture_started" as const,
      captureStateVersion: 1 as const,
      reconcileOwner: "newer-worker",
      reconcileAfter: "2099-01-01T00:00:00.000Z",
    };
    let intercept = true;
    const proxy = new Proxy(kv, {
      get(target, property) {
        if (property === "list") {
          return (
            selector: Deno.KvListSelector,
            options?: Deno.KvListOptions,
          ) => {
            const source = target.list(selector, options);
            if (
              intercept && "prefix" in selector &&
              selector.prefix[0] === "pending_paid_registrations"
            ) {
              intercept = false;
              return (async function* () {
                for await (const entry of source) {
                  await target.set(entry.key, claimed);
                  yield entry;
                }
              })();
            }
            return source;
          };
        }
        const member = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    __setKvFactoryForTests(() => Promise.resolve(proxy));
    mockPayPal(() => {
      providerCalls++;
      return Response.json(payload(legacy));
    });
    await processPendingPayPalPayments();
    assertEquals(await getPendingPaidRegistration(legacy.id), claimed);
    assertEquals(providerCalls, 0);
  } finally {
    await cleanup();
  }
});
