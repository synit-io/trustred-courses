import { listCourses } from "../courses/repository.ts";
import { listRegistrationsByCourse } from "../registrations/repository.ts";
import type { Course, Registration } from "../types.ts";

export interface CourseSummary {
  course: Course;
  registrations: Registration[];
  registrationCount: number;
  attendeeCount: number;
  waitlistedCount: number;
  availableSlots: number;
  paidRegistrationCount: number;
  totalRevenueCents: number;
}

export async function listCourseSummaries(): Promise<CourseSummary[]> {
  const courses = await listCourses();

  const summaries = await Promise.all(
    courses.map(async (course) => {
      const registrations = await listRegistrationsByCourse(course.id);
      const attendeeCount = registrations.filter((registration) =>
        registration.status === "approved"
      ).length;
      const waitlistedCount = registrations.filter((registration) =>
        registration.status === "waitlisted"
      ).length;
      const paidRegistrations = registrations.filter((registration) =>
        registration.paymentStatus === "paid"
      );
      const totalRevenueCents = paidRegistrations.reduce(
        (sum, registration) => {
          const amount = Number(registration.paymentAmountCents ?? 0);
          return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
        },
        0,
      );

      return {
        course,
        registrations,
        registrationCount: registrations.length,
        attendeeCount,
        waitlistedCount,
        availableSlots: Math.max(course.capacity - attendeeCount, 0),
        paidRegistrationCount: paidRegistrations.length,
        totalRevenueCents,
      } satisfies CourseSummary;
    }),
  );

  return summaries.sort((a, b) =>
    a.course.startsAt.localeCompare(b.course.startsAt)
  );
}

export async function getCourseSummaryById(
  courseId: string,
): Promise<CourseSummary | null> {
  const summaries = await listCourseSummaries();
  return summaries.find((summary) => summary.course.id === courseId) ?? null;
}
