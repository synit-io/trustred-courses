import { assertEquals } from "@std/assert";
import { listCourseSummaries } from "../lib/admin/course_summaries.ts";
import { upsertCourse } from "../lib/courses/repository.ts";
import { createRegistration } from "../lib/registrations/repository.ts";
import type { Course, Registration } from "../lib/types.ts";
import { setupKvTest } from "./test_utils.ts";

function courseFixture(): Course {
  return {
    id: "course-summary",
    title: "Erste Hilfe Kompakt",
    description: "Tageskurs",
    location: "Berlin",
    startsAt: "2026-05-01T08:00:00.000Z",
    endsAt: "2026-05-01T16:00:00.000Z",
    registrationOpensAt: "2026-04-01T08:00:00.000Z",
    registrationClosesAt: "2026-04-30T08:00:00.000Z",
    capacity: 10,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: "2026-03-01T08:00:00.000Z",
  };
}

function registrationFixture(
  id: string,
  status: Registration["status"],
  payment?: { amountCents: number; currency?: string },
): Registration {
  return {
    id,
    courseId: "course-summary",
    firstName: "Max",
    lastName: `Tester-${id}`,
    street: "Musterweg",
    houseNumber: "1",
    postalCode: "12345",
    city: "Berlin",
    email: `${id}@example.org`,
    phone: "0123456789",
    status,
    waitingListPosition: status === "waitlisted" ? 1 : null,
    consentAccepted: true,
    submittedAt: `2026-03-0${id.slice(-1)}T08:00:00.000Z`,
    doubleOptInRequestedAt: `2026-03-0${id.slice(-1)}T07:55:00.000Z`,
    doubleOptInConfirmedAt: `2026-03-0${id.slice(-1)}T07:58:00.000Z`,
    reviewedAt: status === "submitted"
      ? null
      : `2026-03-0${id.slice(-1)}T09:00:00.000Z`,
    reviewedBy: status === "submitted" ? null : "admin-1",
    adminMessage: null,
    internalNotes: null,
    paymentStatus: payment ? "paid" : "not_required",
    paymentProvider: payment ? "paypal" : null,
    paymentCaptureId: payment ? `capture-${id}` : null,
    paymentAmountCents: payment ? payment.amountCents : null,
    paymentCurrency: payment ? payment.currency ?? "EUR" : null,
    paymentPaidAt: payment ? `2026-03-0${id.slice(-1)}T08:30:00.000Z` : null,
  };
}

Deno.test("course summaries aggregate registrations and seats", async () => {
  const ctx = await setupKvTest("course-summaries-");

  try {
    await upsertCourse(courseFixture());
    await createRegistration(
      registrationFixture("reg-1", "approved", { amountCents: 4990 }),
    );
    await createRegistration(
      registrationFixture("reg-2", "approved", { amountCents: 4990 }),
    );
    await createRegistration(registrationFixture("reg-3", "waitlisted"));
    await createRegistration(registrationFixture("reg-4", "pending_review"));

    const summaries = await listCourseSummaries();
    assertEquals(summaries.length, 1);
    assertEquals(summaries[0]?.registrationCount, 4);
    assertEquals(summaries[0]?.attendeeCount, 2);
    assertEquals(summaries[0]?.waitlistedCount, 1);
    assertEquals(summaries[0]?.availableSlots, 8);
    assertEquals(summaries[0]?.paidRegistrationCount, 2);
    assertEquals(summaries[0]?.totalRevenueCents, 9980);
  } finally {
    await ctx.cleanup();
  }
});
