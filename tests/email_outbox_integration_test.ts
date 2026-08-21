import { assertEquals } from "@std/assert";
import {
  listDueEmailOutbox,
  listEmailLogsByRegistration,
} from "../lib/email/repository.ts";
import {
  __setEmailSenderForTests,
  EMAIL_OUTBOX_MAX_ATTEMPTS,
  processEmailOutboxBatch,
  sendCourseBroadcastEmails,
  sendRegistrationEventEmails,
} from "../lib/email/service.ts";
import type { Course, Registration } from "../lib/types.ts";
import { setupKvTest } from "./test_utils.ts";

function demoCourse(): Course {
  return {
    id: "course-1",
    title: "Erste Hilfe Basis",
    description: "Kurs",
    location: "Berlin",
    startsAt: "2026-04-10T08:00:00.000Z",
    endsAt: "2026-04-10T16:00:00.000Z",
    registrationOpensAt: "2020-01-01T00:00:00.000Z",
    registrationClosesAt: "2099-01-01T00:00:00.000Z",
    capacity: 10,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: new Date().toISOString(),
  };
}

function demoRegistration(): Registration {
  return {
    id: "reg-1",
    courseId: "course-1",
    firstName: "Max",
    lastName: "Mustermann",
    street: "Hauptstrasse",
    houseNumber: "10",
    postalCode: "10115",
    city: "Berlin",
    email: "max@example.org",
    phone: "+4912345",
    status: "pending_review",
    waitingListPosition: null,
    consentAccepted: true,
    submittedAt: new Date().toISOString(),
    doubleOptInRequestedAt: new Date().toISOString(),
    doubleOptInConfirmedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    adminMessage: null,
    internalNotes: null,
  };
}

Deno.test("outbox retry queue processes failed delivery and succeeds later", async () => {
  const { cleanup } = await setupKvTest("outbox-retry-");
  let callCount = 0;
  __setEmailSenderForTests(() => {
    callCount += 1;
    if (callCount === 1) {
      return Promise.resolve({ ok: false, error: "smtp down" });
    }
    return Promise.resolve({ ok: true });
  });

  try {
    const registration = demoRegistration();
    const course = demoCourse();

    await sendRegistrationEventEmails(registration, course, "approved");

    const queued = await listDueEmailOutbox(
      new Date("2099-01-01T00:00:00.000Z"),
    );
    assertEquals(queued.length, 1);

    const processed = await processEmailOutboxBatch(
      10,
      new Date("2099-01-01T00:00:00.000Z"),
    );
    assertEquals(processed, 1);

    const queuedAfter = await listDueEmailOutbox(
      new Date("2099-01-01T00:00:00.000Z"),
    );
    assertEquals(queuedAfter.length, 0);

    const logs = await listEmailLogsByRegistration(registration.id);
    assertEquals(logs.length, 2);
    assertEquals(logs.some((entry) => entry.deliveryStatus === "failed"), true);
    assertEquals(logs.some((entry) => entry.deliveryStatus === "sent"), true);
    assertEquals(logs.some((entry) => entry.attempt === 2), true);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("outbox retries stop at max attempts with backoff queue", async () => {
  const { cleanup } = await setupKvTest("outbox-max-attempt-");
  __setEmailSenderForTests(() => {
    return Promise.resolve({ ok: false, error: "permanent failure" });
  });

  try {
    const registration = demoRegistration();
    const course = demoCourse();

    await sendRegistrationEventEmails(registration, course, "approved");

    for (let i = 0; i < EMAIL_OUTBOX_MAX_ATTEMPTS + 2; i++) {
      await processEmailOutboxBatch(10, new Date("2099-01-01T00:00:00.000Z"));
    }

    const queuedAfter = await listDueEmailOutbox(
      new Date("2099-01-01T00:00:00.000Z"),
    );
    assertEquals(queuedAfter.length, 0);

    const logs = await listEmailLogsByRegistration(registration.id);
    assertEquals(
      logs.some((entry) =>
        entry.deliveryStatus === "failed" &&
        entry.attempt === EMAIL_OUTBOX_MAX_ATTEMPTS
      ),
      true,
    );
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("course cancellation broadcasts only to approved attendees", async () => {
  const { cleanup } = await setupKvTest("course-cancel-broadcast-");
  const recipients: string[] = [];
  __setEmailSenderForTests((recipient) => {
    recipients.push(recipient);
    return Promise.resolve({ ok: true });
  });

  try {
    const course = demoCourse();
    const approved = {
      ...demoRegistration(),
      id: "reg-approved",
      email: "approved@example.org",
      status: "approved" as const,
    };
    const waitlisted = {
      ...demoRegistration(),
      id: "reg-waitlisted",
      email: "waitlisted@example.org",
      status: "waitlisted" as const,
      waitingListPosition: 1,
    };

    const sent = await sendCourseBroadcastEmails(
      [approved, waitlisted],
      course,
      "course_cancelled",
    );

    assertEquals(sent, 1);
    assertEquals(recipients, ["approved@example.org"]);

    const logs = await listEmailLogsByRegistration(approved.id);
    assertEquals(
      logs.some((entry) => entry.templateKey === "course_cancelled"),
      true,
    );
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("critical course update broadcasts to approved attendees", async () => {
  const { cleanup } = await setupKvTest("course-update-broadcast-");
  const recipients: string[] = [];
  __setEmailSenderForTests((recipient) => {
    recipients.push(recipient);
    return Promise.resolve({ ok: true });
  });

  try {
    const course = {
      ...demoCourse(),
      location: "Hamburg",
      startsAt: "2026-04-11T10:00:00.000Z",
    };
    const approved = {
      ...demoRegistration(),
      id: "reg-approved-update",
      email: "approved-update@example.org",
      status: "approved" as const,
    };

    const sent = await sendCourseBroadcastEmails(
      [approved],
      course,
      "course_critical_update",
      {
        location: { before: "Berlin", after: "Hamburg" },
        startsAt: {
          before: "2026-04-10T08:00:00.000Z",
          after: "2026-04-11T10:00:00.000Z",
        },
      },
    );

    assertEquals(sent, 1);
    assertEquals(recipients, ["approved-update@example.org"]);

    const logs = await listEmailLogsByRegistration(approved.id);
    assertEquals(
      logs.some((entry) => entry.templateKey === "course_critical_update"),
      true,
    );
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});
