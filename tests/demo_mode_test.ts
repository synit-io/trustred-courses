import { assert, assertEquals, assertRejects } from "@std/assert";
import { listCourses } from "../lib/courses/repository.ts";
import { DEMO_ACCOUNTS } from "../lib/demo/accounts.ts";
import {
  DEMO_COURSE_ID_PREFIX,
  DEMO_EMAIL_DOMAINS,
  generateDemoDataset,
} from "../lib/demo/generator.ts";
import { DemoModeDisabledError, seedDemoData } from "../lib/demo/seed.ts";
import {
  enqueueEmailOutbox,
  listDueEmailOutbox,
  listEmailLogsByRegistration,
} from "../lib/email/repository.ts";
import {
  __setEmailSenderForTests,
  processEmailOutboxBatch,
  sendRegistrationEventEmails,
} from "../lib/email/service.ts";
import { isDemoMode } from "../lib/env.ts";
import { getPublicHomeSnapshot } from "../lib/public_snapshot/service.ts";
import { listRegistrationsByCourse } from "../lib/registrations/repository.ts";
import type { Course, Registration } from "../lib/types.ts";
import { getUserByEmail } from "../lib/users/repository.ts";
import { setupKvTest } from "./test_utils.ts";

function withDemoMode<T>(enabled: boolean, run: () => Promise<T>): Promise<T> {
  const previous = Deno.env.get("DEMO_MODE");
  Deno.env.set("DEMO_MODE", enabled ? "true" : "false");
  return run().finally(() => {
    if (previous === undefined) Deno.env.delete("DEMO_MODE");
    else Deno.env.set("DEMO_MODE", previous);
  });
}

function sampleCourse(): Course {
  return {
    id: "course-demo-test",
    title: "Erste Hilfe Basis",
    description: "Kurs",
    location: "Berlin",
    startsAt: "2099-04-10T08:00:00.000Z",
    endsAt: "2099-04-10T16:00:00.000Z",
    registrationOpensAt: "2020-01-01T00:00:00.000Z",
    registrationClosesAt: "2099-01-01T00:00:00.000Z",
    capacity: 10,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: new Date().toISOString(),
  };
}

function sampleRegistration(): Registration {
  const now = new Date().toISOString();
  return {
    id: "reg-demo-test",
    courseId: "course-demo-test",
    firstName: "Max",
    lastName: "Mustermann",
    street: "Hauptstrasse",
    houseNumber: "10",
    postalCode: "10115",
    city: "Berlin",
    email: "max@example.org",
    phone: "",
    status: "approved",
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

Deno.test("isDemoMode reads DEMO_MODE live", async () => {
  await withDemoMode(true, () => {
    assertEquals(isDemoMode(), true);
    return Promise.resolve();
  });
  await withDemoMode(false, () => {
    assertEquals(isDemoMode(), false);
    return Promise.resolve();
  });
});

Deno.test("DEMO_MODE suppresses direct mail even with an injected sender", async () => {
  const { cleanup } = await setupKvTest("demo-mail-direct-");
  let senderCalls = 0;
  __setEmailSenderForTests(() => {
    senderCalls += 1;
    return Promise.resolve({ ok: true });
  });
  try {
    await withDemoMode(true, async () => {
      await sendRegistrationEventEmails(
        sampleRegistration(),
        sampleCourse(),
        "approved",
      );
    });
    assertEquals(senderCalls, 0);
    const logs = await listEmailLogsByRegistration("reg-demo-test");
    assertEquals(logs.length, 1);
    assertEquals(logs[0].deliveryStatus, "suppressed");
    assertEquals(logs[0].errorMessage, null);
    assertEquals((await listDueEmailOutbox()).length, 0);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("DEMO_MODE drains the outbox without contacting a sender", async () => {
  const { cleanup } = await setupKvTest("demo-mail-outbox-");
  let senderCalls = 0;
  __setEmailSenderForTests(() => {
    senderCalls += 1;
    return Promise.resolve({ ok: false, error: "should not be called" });
  });
  try {
    await enqueueEmailOutbox({
      registrationId: "reg-demo-test",
      templateKey: "approved",
      recipientEmail: "max@example.org",
      subject: "Zusage",
      text: "Text",
      html: "<p>Text</p>",
      attempt: 0,
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
      lastError: null,
    });
    const processed = await withDemoMode(
      true,
      () => processEmailOutboxBatch(10),
    );
    assertEquals(processed, 1);
    assertEquals(senderCalls, 0);
    assertEquals((await listDueEmailOutbox()).length, 0);
    const logs = await listEmailLogsByRegistration("reg-demo-test");
    assertEquals(logs.length, 1);
    assertEquals(logs[0].deliveryStatus, "suppressed");
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("demo generator produces valid, reserved-domain data", () => {
  const now = new Date("2026-09-11T12:00:00.000Z");
  const dataset = generateDemoDataset({
    courses: 40,
    seed: 7,
    now,
    actorUserId: "actor-1",
  });
  const again = generateDemoDataset({
    courses: 40,
    seed: 7,
    now,
    actorUserId: "actor-1",
  });

  assertEquals(dataset.courses.length, 40);
  assert(dataset.registrations.length > 0);
  assertEquals(
    dataset.courses.map((course) => course.title),
    again.courses.map((course) => course.title),
    "same seed must reproduce the same content shape",
  );
  assertEquals(new Set(dataset.courses.map((c) => c.id)).size, 40);

  for (const course of dataset.courses) {
    assert(course.id.startsWith(DEMO_COURSE_ID_PREFIX));
    assert(Date.parse(course.endsAt) > Date.parse(course.startsAt));
    if (course.pricingType === "paid") {
      assert((course.feeAmountCents ?? 0) > 0);
      assertEquals(course.feeCurrency, "EUR");
    }
    const registrations = dataset.registrations.filter((entry) =>
      entry.courseId === course.id
    );
    if (course.status === "draft") assertEquals(registrations.length, 0);
    const approved = registrations.filter((entry) =>
      entry.status === "approved"
    );
    assert(approved.length <= course.capacity, "approved within capacity");
    const waitlisted = registrations
      .filter((entry) => entry.status === "waitlisted")
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    waitlisted.forEach((entry, index) => {
      assertEquals(entry.waitingListPosition, index + 1);
    });
    if (waitlisted.length > 0) assert(course.waitingListEnabled);
    assertEquals(
      new Set(registrations.map((entry) => entry.email)).size,
      registrations.length,
      "emails unique per course",
    );
    for (const registration of registrations) {
      const domain = registration.email.split("@")[1];
      assert(
        (DEMO_EMAIL_DOMAINS as readonly string[]).includes(domain),
        `reserved domain expected, got ${domain}`,
      );
      assert(Date.parse(registration.submittedAt) < now.getTime());
      if (course.pricingType === "paid") {
        assertEquals(registration.paymentStatus, "paid");
        assertEquals(registration.paymentProvider, "demo");
      } else {
        assertEquals(registration.paymentStatus, "not_required");
      }
      const audits = dataset.auditLogs.filter((log) =>
        log.entityId === registration.id
      );
      assert(audits.length >= 1);
      if (registration.status !== "submitted") {
        assert(audits.some((log) => log.action === "registration.submitted"));
      }
    }
  }
  for (const log of dataset.emailLogs) {
    assertEquals(log.deliveryStatus, "suppressed");
  }
});

Deno.test("seedDemoData refuses to run without DEMO_MODE", async () => {
  const { cleanup } = await setupKvTest("demo-seed-refuse-");
  try {
    await withDemoMode(false, async () => {
      await assertRejects(
        () => seedDemoData({ courses: 2, seed: 1 }),
        DemoModeDisabledError,
      );
    });
    assertEquals((await listCourses()).length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("seedDemoData appends data on every run and rebuilds snapshots", async () => {
  const { cleanup } = await setupKvTest("demo-seed-run-");
  try {
    const first = await withDemoMode(
      true,
      () => seedDemoData({ courses: 6, seed: 11 }),
    );
    const second = await withDemoMode(
      true,
      () => seedDemoData({ courses: 6, seed: 12 }),
    );
    assertEquals(first.courses, 6);
    assertEquals(second.courses, 6);

    const courses = await listCourses();
    assertEquals(courses.length, 12);

    let storedRegistrations = 0;
    for (const course of courses) {
      storedRegistrations +=
        (await listRegistrationsByCourse(course.id)).length;
    }
    assertEquals(
      storedRegistrations,
      first.registrations + second.registrations,
    );

    const snapshot = await getPublicHomeSnapshot();
    const visible = courses.filter((course) => course.status === "active");
    assert(visible.length > 0);
    assertEquals(snapshot.courses.length, visible.length);

    for (const account of DEMO_ACCOUNTS) {
      const user = await getUserByEmail(account.email);
      assert(user, `${account.email} created`);
      assertEquals(user.role, account.role);
    }
  } finally {
    await cleanup();
  }
});
