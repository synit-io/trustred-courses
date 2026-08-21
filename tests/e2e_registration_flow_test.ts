import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  appendAuditLog,
  listAuditLogsByEntityPaginated,
} from "../lib/audit/repository.ts";
import { upsertCourse } from "../lib/courses/repository.ts";
import {
  listEmailLogsByRegistrationPaginated,
} from "../lib/email/repository.ts";
import { __setEmailSenderForTests } from "../lib/email/service.ts";
import { listRegistrationsByCourse } from "../lib/registrations/repository.ts";
import {
  applyRegistrationAction,
  submitRegistration,
} from "../lib/registrations/service.ts";
import type { Course } from "../lib/types.ts";
import { setupKvTest } from "./test_utils.ts";

function courseFixture(): Course {
  return {
    id: "course-e2e",
    title: "Erste Hilfe Intensiv",
    description: "Ganztagskurs",
    location: "Hamburg",
    startsAt: "2026-05-02T08:00:00.000Z",
    endsAt: "2026-05-02T17:00:00.000Z",
    registrationOpensAt: "2020-01-01T00:00:00.000Z",
    registrationClosesAt: "2099-01-01T00:00:00.000Z",
    capacity: 10,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: new Date().toISOString(),
  };
}

function registrationForm(courseId: string, email: string): FormData {
  const form = new FormData();
  form.set("courseId", courseId);
  form.set("firstName", "Anna");
  form.set("lastName", "Beispiel");
  form.set("street", "Ringstrasse");
  form.set("houseNumber", "2");
  form.set("postalCode", "20095");
  form.set("city", "Hamburg");
  form.set("email", email);
  form.set("phone", "+494012345");
  form.set("consentAccepted", "on");
  return form;
}

async function submitPublicRegistration(
  courseId: string,
  email: string,
): Promise<string> {
  const form = registrationForm(courseId, email);
  const response = await submitRegistration({
    courseId,
    firstName: String(form.get("firstName")),
    lastName: String(form.get("lastName")),
    street: String(form.get("street")),
    houseNumber: String(form.get("houseNumber")),
    postalCode: String(form.get("postalCode")),
    city: String(form.get("city")),
    email: String(form.get("email")),
    phone: String(form.get("phone")),
    consentAccepted: true,
  });

  assertEquals(response.status, "pending_review");
  const registrations = await listRegistrationsByCourse(courseId);
  const found = registrations.find((entry) => entry.email === email);
  if (!found) throw new Error("Registration missing after public submit");
  return found.id;
}

async function runAdminAction(
  registrationId: string,
  action: "approve" | "reject",
): Promise<void> {
  const result = await applyRegistrationAction({
    registrationId,
    action,
    actorUserId: "admin-1",
  });
  await appendAuditLog({
    actorUserId: "admin-1",
    entityType: "registration",
    entityId: result.next.id,
    action: `registration.${action}`,
    oldValue: JSON.stringify({ status: result.previous.status }),
    newValue: JSON.stringify({ status: result.next.status }),
  });
}

Deno.test("E2E flow: public register -> admin approve -> email and audit visible", async () => {
  const { cleanup } = await setupKvTest("e2e-approve-");
  __setEmailSenderForTests(() => Promise.resolve({ ok: true }));

  try {
    const course = courseFixture();
    await upsertCourse(course);

    const registrationId = await submitPublicRegistration(
      course.id,
      "anna-approve@example.org",
    );

    await runAdminAction(registrationId, "approve");

    const auditPage = await listAuditLogsByEntityPaginated(
      "registration",
      registrationId,
      1,
      20,
    );
    assert(
      auditPage.items.some((log) => log.action === "registration.submitted"),
    );
    assert(
      auditPage.items.some((log) => log.action === "registration.approve"),
    );

    const emailPage = await listEmailLogsByRegistrationPaginated(
      registrationId,
      1,
      20,
    );
    assert(
      emailPage.items.some((log) =>
        log.templateKey === "registration_received"
      ),
    );
    assert(
      !emailPage.items.some((log) => log.templateKey === "pending_review"),
    );
    assert(emailPage.items.some((log) => log.templateKey === "approved"));
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("E2E flow: public register -> admin reject -> email and audit visible", async () => {
  const { cleanup } = await setupKvTest("e2e-reject-");
  __setEmailSenderForTests(() => Promise.resolve({ ok: true }));

  try {
    const course = courseFixture();
    await upsertCourse(course);

    const registrationId = await submitPublicRegistration(
      course.id,
      "anna-reject@example.org",
    );

    await runAdminAction(registrationId, "reject");

    const auditPage = await listAuditLogsByEntityPaginated(
      "registration",
      registrationId,
      1,
      20,
    );
    assert(
      auditPage.items.some((log) => log.action === "registration.submitted"),
    );
    assert(auditPage.items.some((log) => log.action === "registration.reject"));

    const emailPage = await listEmailLogsByRegistrationPaginated(
      registrationId,
      1,
      20,
    );
    assert(
      emailPage.items.some((log) =>
        log.templateKey === "registration_received"
      ),
    );
    assert(
      !emailPage.items.some((log) => log.templateKey === "pending_review"),
    );
    assert(emailPage.items.some((log) => log.templateKey === "rejected"));
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("invalid admin transition does not send a mismatched email", async () => {
  const { cleanup } = await setupKvTest("e2e-invalid-transition-");
  let sendCount = 0;
  __setEmailSenderForTests(() => {
    sendCount += 1;
    return Promise.resolve({ ok: true });
  });

  try {
    const course = courseFixture();
    await upsertCourse(course);

    const registrationId = await submitPublicRegistration(
      course.id,
      "anna-invalid@example.org",
    );

    await runAdminAction(registrationId, "reject");
    const sendsAfterReject = sendCount;

    await assertRejects(
      () =>
        applyRegistrationAction({
          registrationId,
          action: "approve",
          actorUserId: "admin-1",
        }),
      Error,
      "Aktion für den aktuellen Status nicht erlaubt.",
    );

    assertEquals(sendCount, sendsAfterReject);

    const emailPage = await listEmailLogsByRegistrationPaginated(
      registrationId,
      1,
      20,
    );
    assertEquals(
      emailPage.items.filter((log) => log.templateKey === "approved").length,
      0,
    );
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});
