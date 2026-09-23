import { assert, assertEquals } from "@std/assert";
import { Hono } from "hono";
import { queryRegistrationRows } from "../lib/admin/registration_rows.ts";
import { upsertCourse } from "../lib/courses/repository.ts";
import { env } from "../lib/env.ts";
import { enqueueEmailOutboxOnce } from "../lib/email/repository.ts";
import {
  __setEmailSenderForTests,
  processEmailOutboxBatch,
  renderAdminNotificationHtml,
} from "../lib/email/service.ts";
import {
  capturePayPalOrder,
  getPendingPaidRegistration,
  hasPendingPaidRegistrationsForCourse,
  savePendingPaidRegistration,
  updatePendingPaidRegistration,
} from "../lib/payments/paypal.ts";
import {
  getPublicHomeSnapshot,
  rebuildPublicSnapshotsForCourse,
} from "../lib/public_snapshot/service.ts";
import { enforceRateLimit } from "../lib/security/rate_limit.ts";
import {
  createRegistration,
  listRegistrationsByCourse,
} from "../lib/registrations/repository.ts";
import {
  applyRegistrationAction,
  submitRegistrationWithDoubleOptIn,
} from "../lib/registrations/service.ts";
import type { AppEnv } from "../src/app/context.ts";
import { registerGlobalMiddleware } from "../src/app/middleware.tsx";
import { adminUsersCreateRoute } from "../src/routes/api/admin/users/create/route.ts";
import { csvEscape } from "../src/routes/api/admin/exports/registrations/route.ts";
import type { Course, Registration } from "../lib/types.ts";
import { futureIso, setupKvTest } from "./test_utils.ts";

function courseFixture(id: string, capacity = 1): Course {
  return {
    id,
    title: `Course ${id}`,
    description: "Hardening test",
    location: "Berlin",
    startsAt: futureIso(60, 8),
    endsAt: futureIso(60, 17),
    registrationOpensAt: "2020-01-01T00:00:00.000Z",
    registrationClosesAt: "2099-01-01T00:00:00.000Z",
    capacity,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: new Date().toISOString(),
  };
}

function registrationFixture(
  id: string,
  courseId: string,
  status: Registration["status"] = "pending_review",
): Registration {
  const now = new Date().toISOString();
  return {
    id,
    courseId,
    firstName: "Test",
    lastName: id,
    street: "Street",
    houseNumber: "1",
    postalCode: "10115",
    city: "Berlin",
    email: `${id}@example.org`,
    phone: "",
    status,
    waitingListPosition: null,
    consentAccepted: true,
    submittedAt: now,
    doubleOptInRequestedAt: now,
    doubleOptInConfirmedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    adminMessage: null,
    internalNotes: null,
  };
}

Deno.test("concurrent approvals cannot exceed course capacity", async () => {
  const { cleanup } = await setupKvTest("approval-concurrency-");
  __setEmailSenderForTests(() => Promise.resolve({ ok: true }));
  try {
    const course = courseFixture("capacity-one");
    await upsertCourse(course);
    await createRegistration(registrationFixture("first", course.id));
    await createRegistration(registrationFixture("second", course.id));

    const results = await Promise.allSettled([
      applyRegistrationAction({
        registrationId: "first",
        action: "approve",
        actorUserId: "admin",
      }),
      applyRegistrationAction({
        registrationId: "second",
        action: "approve",
        actorUserId: "admin",
      }),
    ]);
    assertEquals(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const registrations = await listRegistrationsByCourse(course.id);
    assertEquals(
      registrations.filter((registration) => registration.status === "approved")
        .length,
      1,
    );
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("full course without waitlist rejects registration", async () => {
  const { cleanup } = await setupKvTest("no-waitlist-");
  try {
    const course = {
      ...courseFixture("no-waitlist"),
      waitingListEnabled: false,
    };
    await upsertCourse(course);
    await createRegistration(
      registrationFixture("approved", course.id, "approved"),
    );
    const result = await Promise.allSettled([
      submitRegistrationWithDoubleOptIn({
        courseId: course.id,
        firstName: "Blocked",
        lastName: "Participant",
        street: "Street",
        houseNumber: "2",
        postalCode: "10115",
        city: "Berlin",
        email: "blocked@example.org",
        phone: "",
        consentAccepted: true,
      }),
    ]);
    assertEquals(result[0]?.status, "rejected");
  } finally {
    await cleanup();
  }
});

Deno.test("outbox lease prevents concurrent duplicate delivery", async () => {
  const { cleanup } = await setupKvTest("outbox-lease-");
  let sends = 0;
  __setEmailSenderForTests(() => {
    sends += 1;
    return Promise.resolve({ ok: true });
  });
  try {
    await enqueueEmailOutboxOnce("event-once", {
      registrationId: "registration",
      templateKey: "approved",
      recipientEmail: "person@example.org",
      subject: "Subject",
      text: "Text",
      html: "<p>Text</p>",
      attempt: 0,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    await Promise.all([
      processEmailOutboxBatch(10),
      processEmailOutboxBatch(10),
    ]);
    assertEquals(sends, 1);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("concurrent snapshot updates preserve both courses", async () => {
  const { cleanup } = await setupKvTest("snapshot-concurrency-");
  try {
    await upsertCourse(courseFixture("snapshot-a", 5));
    await upsertCourse(courseFixture("snapshot-b", 5));
    await Promise.all([
      rebuildPublicSnapshotsForCourse("snapshot-a"),
      rebuildPublicSnapshotsForCourse("snapshot-b"),
    ]);
    const home = await getPublicHomeSnapshot();
    assertEquals(home.courses.map((course) => course.id), [
      "snapshot-a",
      "snapshot-b",
    ]);
  } finally {
    await cleanup();
  }
});

Deno.test("home snapshot order does not depend on update order", async () => {
  const { cleanup } = await setupKvTest("snapshot-order-");
  try {
    await upsertCourse(courseFixture("snapshot-a", 5));
    await upsertCourse(courseFixture("snapshot-b", 5));
    await rebuildPublicSnapshotsForCourse("snapshot-b");
    await rebuildPublicSnapshotsForCourse("snapshot-a");
    const home = await getPublicHomeSnapshot();
    assertEquals(home.courses.map((course) => course.id), [
      "snapshot-a",
      "snapshot-b",
    ]);
  } finally {
    await cleanup();
  }
});

Deno.test("registration query does not truncate after 500 records", async () => {
  const { cleanup } = await setupKvTest("registration-query-");
  try {
    const course = courseFixture("many", 600);
    await upsertCourse(course);
    await Promise.all(
      Array.from(
        { length: 501 },
        (_, index) =>
          createRegistration(
            registrationFixture(`registration-${index}`, course.id),
          ),
      ),
    );
    assertEquals(
      (await queryRegistrationRows({ status: "all" })).rows.length,
      501,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("payment state survives capture and finalization", async () => {
  const { cleanup } = await setupKvTest("payment-state-");
  try {
    const pending = {
      id: "pending",
      courseId: "course",
      registrationInput: {
        courseId: "course",
        firstName: "Paid",
        lastName: "Person",
        street: "Street",
        houseNumber: "1",
        postalCode: "10115",
        city: "Berlin",
        email: "paid@example.org",
        phone: "",
        consentAccepted: true,
      },
      paypalOrderId: "order",
      status: "checkout_created" as const,
      registrationId: "registration",
      confirmationToken: "confirmation",
      feeAmountCents: 1000,
      feeCurrency: "EUR",
      createdAt: new Date().toISOString(),
      expiresAt: futureIso(1, 8),
    };
    await savePendingPaidRegistration(pending);
    assert(await hasPendingPaidRegistrationsForCourse("course"));
    const capture = {
      orderId: "order",
      captureId: "capture",
      status: "COMPLETED",
      customId: "pending",
      amountCents: 1000,
      currency: "EUR",
    };
    assert(
      await updatePendingPaidRegistration({
        ...pending,
        status: "captured",
        capture,
      }),
    );
    assertEquals(
      (await getPendingPaidRegistration("pending"))?.capture,
      capture,
    );
    assert(
      await updatePendingPaidRegistration({
        ...pending,
        status: "finalized",
        capture,
      }),
    );
    assertEquals(
      (await getPendingPaidRegistration("pending"))?.status,
      "finalized",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PayPal capture uses a stable idempotency request ID", async () => {
  const originalFetch = globalThis.fetch;
  const previousClientId = Deno.env.get("PAYPAL_CLIENT_ID");
  const previousClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
  const requestIds: string[] = [];
  Deno.env.set("PAYPAL_CLIENT_ID", "client");
  Deno.env.set("PAYPAL_CLIENT_SECRET", "secret");
  globalThis.fetch = (_input, init) => {
    const authorization = new Headers(init?.headers).get("Authorization") ?? "";
    if (authorization.startsWith("Basic ")) {
      return Promise.resolve(Response.json({ access_token: "token" }));
    }
    requestIds.push(
      new Headers(init?.headers).get("PayPal-Request-Id") ?? "",
    );
    return Promise.resolve(Response.json({
      id: "order",
      status: "COMPLETED",
      purchase_units: [{
        custom_id: "pending",
        payments: {
          captures: [{
            id: "capture",
            status: "COMPLETED",
            amount: { value: "10.00", currency_code: "EUR" },
          }],
        },
      }],
    }));
  };
  try {
    await capturePayPalOrder("order", "capture-pending");
    assertEquals(requestIds, ["capture-pending"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousClientId === undefined) Deno.env.delete("PAYPAL_CLIENT_ID");
    else Deno.env.set("PAYPAL_CLIENT_ID", previousClientId);
    if (previousClientSecret === undefined) {
      Deno.env.delete("PAYPAL_CLIENT_SECRET");
    } else {
      Deno.env.set("PAYPAL_CLIENT_SECRET", previousClientSecret);
    }
  }
});

Deno.test("rate limit increments atomically", async () => {
  const { cleanup } = await setupKvTest("rate-limit-atomic-");
  try {
    const results = await Promise.all(
      Array.from(
        { length: 10 },
        () => enforceRateLimit("test", "identity", 3, 60_000),
      ),
    );
    assertEquals(results.filter((result) => result.allowed).length, 3);
  } finally {
    await cleanup();
  }
});

Deno.test("admin cannot create a super admin", async () => {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("sessionUser", {
      id: "admin",
      email: "admin@example.org",
      role: "admin",
    });
    await next();
  });
  app.route("/", adminUsersCreateRoute);
  const form = new FormData();
  form.set("email", "new@example.org");
  form.set("role", "super_admin");
  assertEquals(
    (await app.request("/", { method: "POST", body: form })).status,
    403,
  );
});

Deno.test("admin mutation rejects missing and foreign origins", async () => {
  const appOrigin = new URL(env.appBaseUrl).origin;
  const app = new Hono<AppEnv>();
  registerGlobalMiddleware(app);
  app.post("/api/admin/probe", (c) => c.text("ok"));
  assertEquals(
    (await app.request(`${appOrigin}/api/admin/probe`, {
      method: "POST",
    }))
      .status,
    403,
  );
  assertEquals(
    (await app.request(`${appOrigin}/api/admin/probe`, {
      method: "POST",
      headers: { Origin: "https://attacker.localhost" },
    })).status,
    403,
  );
  assertEquals(
    (await app.request(`${appOrigin}/api/admin/probe`, {
      method: "POST",
      headers: { Origin: appOrigin },
    })).status,
    401,
  );
});

Deno.test("HTML and CSV exports neutralize active content", () => {
  assertEquals(
    renderAdminNotificationHtml("Name: <a href=x>click</a>"),
    "<p>Name: &lt;a href=x&gt;click&lt;/a&gt;</p>",
  );
  assertEquals(
    csvEscape('=HYPERLINK("https://example.org")'),
    '"\'=HYPERLINK(""https://example.org"")"',
  );
  assertEquals(csvEscape("  @SUM(1,2)"), '"\'  @SUM(1,2)"');
});
