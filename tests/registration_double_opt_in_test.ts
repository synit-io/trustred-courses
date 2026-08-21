import { assert, assertEquals, assertRejects } from "@std/assert";
import { listAuditLogsByEntityPaginated } from "../lib/audit/repository.ts";
import { queryRegistrationRows } from "../lib/admin/registration_rows.ts";
import { upsertCourse } from "../lib/courses/repository.ts";
import { listEmailLogsByRegistrationPaginated } from "../lib/email/repository.ts";
import { __setEmailSenderForTests } from "../lib/email/service.ts";
import { getRegistrationById } from "../lib/registrations/repository.ts";
import {
  applyRegistrationAction,
  confirmRegistrationDoubleOptIn,
  submitRegistrationWithDoubleOptIn,
} from "../lib/registrations/service.ts";
import type { Course } from "../lib/types.ts";
import { setupKvTest } from "./test_utils.ts";

function courseFixture(): Course {
  return {
    id: "course-doi",
    title: "Erste Hilfe DOI",
    description: "Ganztagskurs",
    location: "Mainz",
    startsAt: "2026-06-02T08:00:00.000Z",
    endsAt: "2026-06-02T17:00:00.000Z",
    registrationOpensAt: "2020-01-01T00:00:00.000Z",
    registrationClosesAt: "2099-01-01T00:00:00.000Z",
    capacity: 10,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: new Date().toISOString(),
  };
}

Deno.test("registration uses double-opt-in before activation", async () => {
  const { cleanup } = await setupKvTest("doi-flow-");
  __setEmailSenderForTests(() => Promise.resolve({ ok: true }));

  try {
    const course = courseFixture();
    await upsertCourse(course);

    const submitted = await submitRegistrationWithDoubleOptIn({
      courseId: course.id,
      firstName: "Mia",
      lastName: "Muster",
      street: "Ringstrasse",
      houseNumber: "8",
      postalCode: "55116",
      city: "Mainz",
      email: "mia@example.org",
      phone: "+496131234",
      consentAccepted: true,
    });

    assertEquals(submitted.registration.status, "submitted");
    assertEquals(submitted.registration.doubleOptInConfirmedAt, null);

    const dashboardBefore = await queryRegistrationRows({ status: "all" });
    assertEquals(dashboardBefore.rows.length, 1);
    assertEquals(dashboardBefore.rows[0]?.status, "submitted");

    const token =
      new URL(submitted.confirmationUrl).searchParams.get("token") ??
        "";
    const confirmed = await confirmRegistrationDoubleOptIn(token);

    assert(confirmed);
    assertEquals(confirmed.status, "pending_review");
    assert(confirmed.doubleOptInConfirmedAt !== null);

    const stored = await getRegistrationById(submitted.registration.id);
    assert(stored);
    assertEquals(stored.status, "pending_review");

    const dashboardAfter = await queryRegistrationRows({ status: "all" });
    assertEquals(dashboardAfter.rows.length, 1);

    const emailPage = await listEmailLogsByRegistrationPaginated(
      submitted.registration.id,
      1,
      20,
    );
    assert(
      emailPage.items.some((entry) =>
        entry.templateKey === "double_opt_in_confirmation"
      ),
    );
    assert(
      emailPage.items.some((entry) =>
        entry.templateKey === "registration_received"
      ),
    );
    assert(
      !emailPage.items.some((entry) => entry.templateKey === "pending_review"),
    );

    const auditPage = await listAuditLogsByEntityPaginated(
      "registration",
      submitted.registration.id,
      1,
      30,
    );
    assert(
      auditPage.items.some((entry) =>
        entry.action === "registration.double_opt_in_requested"
      ),
    );
    assert(
      auditPage.items.some((entry) =>
        entry.action === "registration.double_opt_in_confirmed"
      ),
    );
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("invalid double-opt-in token is rejected", async () => {
  const { cleanup } = await setupKvTest("doi-invalid-");
  try {
    const confirmed = await confirmRegistrationDoubleOptIn("invalid-token");
    assertEquals(confirmed, null);
  } finally {
    await cleanup();
  }
});

Deno.test("duplicate registration with same details is rejected", async () => {
  const { cleanup } = await setupKvTest("doi-duplicate-");
  let emailCalls = 0;
  __setEmailSenderForTests(() => {
    emailCalls += 1;
    return Promise.resolve({ ok: true });
  });

  try {
    const course = courseFixture();
    await upsertCourse(course);

    const input = {
      courseId: course.id,
      firstName: "Mia",
      lastName: "Muster",
      street: "Ringstrasse",
      houseNumber: "8",
      postalCode: "55116",
      city: "Mainz",
      email: "mia@example.org",
      phone: "+496131234",
      consentAccepted: true,
    } as const;

    const first = await submitRegistrationWithDoubleOptIn({ ...input });
    const emailLogsBefore = await listEmailLogsByRegistrationPaginated(
      first.registration.id,
      1,
      20,
    );
    assertEquals(emailCalls, 1);
    assertEquals(emailLogsBefore.items.length, 1);

    await assertRejects(
      () => submitRegistrationWithDoubleOptIn({ ...input }),
      Error,
      "identische Anmeldung",
    );
    const dashboardRows = await queryRegistrationRows({ status: "all" });
    assertEquals(dashboardRows.rows.length, 1);
    assertEquals(dashboardRows.rows[0]?.status, "submitted");
    const emailLogsAfter = await listEmailLogsByRegistrationPaginated(
      first.registration.id,
      1,
      20,
    );
    assertEquals(emailCalls, 1);
    assertEquals(emailLogsAfter.items.length, 1);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("admin can manually approve an unconfirmed registration and send the approval email", async () => {
  const { cleanup } = await setupKvTest("doi-admin-approve-");
  __setEmailSenderForTests(() => Promise.resolve({ ok: true }));

  try {
    const course = courseFixture();
    await upsertCourse(course);

    const submitted = await submitRegistrationWithDoubleOptIn({
      courseId: course.id,
      firstName: "Mia",
      lastName: "Muster",
      street: "Ringstrasse",
      houseNumber: "8",
      postalCode: "55116",
      city: "Mainz",
      email: "mia-approve@example.org",
      phone: "+496131234",
      consentAccepted: true,
    });

    const result = await applyRegistrationAction({
      registrationId: submitted.registration.id,
      action: "approve",
      actorUserId: "admin-1",
      adminMessage: "Manuell bestätigt.",
    });

    assertEquals(result.previous.status, "submitted");
    assertEquals(result.next.status, "approved");
    assert(result.next.doubleOptInConfirmedAt !== null);

    const dashboardRows = await queryRegistrationRows({ status: "all" });
    assertEquals(dashboardRows.rows.length, 1);
    assertEquals(dashboardRows.rows[0]?.status, "approved");

    const emailPage = await listEmailLogsByRegistrationPaginated(
      submitted.registration.id,
      1,
      20,
    );
    assert(
      emailPage.items.some((entry) =>
        entry.templateKey === "double_opt_in_confirmation"
      ),
    );
    assert(emailPage.items.some((entry) => entry.templateKey === "approved"));
    assert(
      !emailPage.items.some((entry) =>
        entry.templateKey === "registration_received"
      ),
    );

    const token =
      new URL(submitted.confirmationUrl).searchParams.get("token") ??
        "";
    const confirmedLater = await confirmRegistrationDoubleOptIn(token);
    assert(confirmedLater);
    assertEquals(confirmedLater.status, "approved");

    const emailPageAfterConfirm = await listEmailLogsByRegistrationPaginated(
      submitted.registration.id,
      1,
      20,
    );
    assertEquals(
      emailPageAfterConfirm.items.filter((entry) =>
        entry.templateKey === "approved"
      )
        .length,
      1,
    );
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("admin can manually reject an unconfirmed registration and send the rejection email", async () => {
  const { cleanup } = await setupKvTest("doi-admin-reject-");
  __setEmailSenderForTests(() => Promise.resolve({ ok: true }));

  try {
    const course = courseFixture();
    await upsertCourse(course);

    const submitted = await submitRegistrationWithDoubleOptIn({
      courseId: course.id,
      firstName: "Mia",
      lastName: "Muster",
      street: "Ringstrasse",
      houseNumber: "8",
      postalCode: "55116",
      city: "Mainz",
      email: "mia-reject@example.org",
      phone: "+496131234",
      consentAccepted: true,
    });

    const result = await applyRegistrationAction({
      registrationId: submitted.registration.id,
      action: "reject",
      actorUserId: "admin-1",
      adminMessage: "Manuell abgelehnt.",
    });

    assertEquals(result.previous.status, "submitted");
    assertEquals(result.next.status, "rejected");
    assert(result.next.doubleOptInConfirmedAt !== null);

    const dashboardRows = await queryRegistrationRows({ status: "all" });
    assertEquals(dashboardRows.rows.length, 1);
    assertEquals(dashboardRows.rows[0]?.status, "rejected");

    const emailPage = await listEmailLogsByRegistrationPaginated(
      submitted.registration.id,
      1,
      20,
    );
    assert(
      emailPage.items.some((entry) =>
        entry.templateKey === "double_opt_in_confirmation"
      ),
    );
    assert(emailPage.items.some((entry) => entry.templateKey === "rejected"));
    assert(
      !emailPage.items.some((entry) =>
        entry.templateKey === "registration_received"
      ),
    );

    const token =
      new URL(submitted.confirmationUrl).searchParams.get("token") ??
        "";
    const confirmedLater = await confirmRegistrationDoubleOptIn(token);
    assert(confirmedLater);
    assertEquals(confirmedLater.status, "rejected");

    const emailPageAfterConfirm = await listEmailLogsByRegistrationPaginated(
      submitted.registration.id,
      1,
      20,
    );
    assertEquals(
      emailPageAfterConfirm.items.filter((entry) =>
        entry.templateKey === "rejected"
      )
        .length,
      1,
    );
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("blank notes on a new admin action do not reuse historical notes", async () => {
  const { cleanup } = await setupKvTest("doi-admin-blank-notes-");
  __setEmailSenderForTests(() => Promise.resolve({ ok: true }));

  try {
    const course = courseFixture();
    await upsertCourse(course);

    const submitted = await submitRegistrationWithDoubleOptIn({
      courseId: course.id,
      firstName: "Mia",
      lastName: "Muster",
      street: "Ringstrasse",
      houseNumber: "8",
      postalCode: "55116",
      city: "Mainz",
      email: "mia-blank-notes@example.org",
      phone: "+496131234",
      consentAccepted: true,
    });

    await applyRegistrationAction({
      registrationId: submitted.registration.id,
      action: "approve",
      actorUserId: "admin-1",
      adminMessage: "Frühere öffentliche Nachricht",
      internalNotes: "Frühere interne Notiz",
    });

    const result = await applyRegistrationAction({
      registrationId: submitted.registration.id,
      action: "waitlist",
      actorUserId: "admin-1",
      adminMessage: "",
      internalNotes: "   ",
    });

    assertEquals(result.next.status, "waitlisted");
    assertEquals(result.next.adminMessage, null);
    assertEquals(result.next.internalNotes, null);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});
