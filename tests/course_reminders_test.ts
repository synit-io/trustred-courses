import { assertEquals } from "@std/assert";
import { upsertCourse } from "../lib/courses/repository.ts";
import {
  createRegistration,
  listRegistrationsByCourse,
} from "../lib/registrations/repository.ts";
import { listEmailLogsByRegistration } from "../lib/email/repository.ts";
import {
  __setEmailSenderForTests,
  processCourseReminders,
} from "../lib/email/service.ts";
import type { Course, Registration } from "../lib/types.ts";
import { setupKvTest } from "./test_utils.ts";

function reminderCourse(): Course {
  return {
    id: "course-reminder",
    title: "Erste Hilfe Reminder",
    description: "Mit Erinnerung",
    location: "Kusel",
    startsAt: "2026-04-10T08:00:00.000Z",
    endsAt: "2026-04-10T16:00:00.000Z",
    registrationOpensAt: "2026-03-01T08:00:00.000Z",
    registrationClosesAt: "2026-04-05T08:00:00.000Z",
    capacity: 10,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: 2,
    createdAt: "2026-03-01T08:00:00.000Z",
  };
}

function reminderRegistration(
  id: string,
  status: Registration["status"],
): Registration {
  return {
    id,
    courseId: "course-reminder",
    firstName: "Max",
    lastName: id,
    street: "Musterweg",
    houseNumber: "1",
    postalCode: "12345",
    city: "Kusel",
    email: `${id}@example.org`,
    phone: "0123456",
    status,
    waitingListPosition: status === "waitlisted" ? 1 : null,
    consentAccepted: true,
    submittedAt: "2026-03-20T10:00:00.000Z",
    doubleOptInRequestedAt: "2026-03-20T09:55:00.000Z",
    doubleOptInConfirmedAt: "2026-03-20T09:57:00.000Z",
    reviewedAt: "2026-03-20T11:00:00.000Z",
    reviewedBy: "admin-1",
    adminMessage: null,
    internalNotes: null,
  };
}

Deno.test("course reminders are sent once to approved attendees on configured day", async () => {
  const { cleanup } = await setupKvTest("course-reminders-");
  const recipients: string[] = [];
  __setEmailSenderForTests((recipient) => {
    recipients.push(recipient);
    return Promise.resolve({ ok: true });
  });

  try {
    await upsertCourse(reminderCourse());
    await createRegistration(reminderRegistration("approved-1", "approved"));
    await createRegistration(reminderRegistration("approved-2", "approved"));
    await createRegistration(
      reminderRegistration("waitlisted-1", "waitlisted"),
    );

    const sent = await processCourseReminders(
      new Date("2026-04-08T07:00:00.000Z"),
    );
    assertEquals(sent, 2);
    assertEquals(recipients.length, 2);

    const sentAgain = await processCourseReminders(
      new Date("2026-04-08T12:00:00.000Z"),
    );
    assertEquals(sentAgain, 0);

    const approvedLogs = await listEmailLogsByRegistration("approved-1");
    assertEquals(
      approvedLogs.some((entry) => entry.templateKey === "course_reminder"),
      true,
    );
    const waitlistedLogs = await listEmailLogsByRegistration("waitlisted-1");
    assertEquals(waitlistedLogs.length, 0);

    const registrations = await listRegistrationsByCourse("course-reminder");
    assertEquals(registrations.length, 3);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});
