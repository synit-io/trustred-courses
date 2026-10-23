import { getCourseById, listCourses } from "../courses/repository.ts";
import { listRegistrationsByCourse } from "../registrations/repository.ts";
import type { Course, Registration } from "../types.ts";

export interface CurrencyRevenue {
  currency: string;
  totalRevenueCents: number;
  paidRegistrationCount: number;
}

export interface CourseSummary {
  course: Course;
  registrations: Registration[];
  registrationCount: number;
  attendeeCount: number;
  waitlistedCount: number;
  availableSlots: number;
  paidRegistrationCount: number;
  revenueByCurrency: CurrencyRevenue[];
}

export function summarizeRevenue(
  registrations: Registration[],
): CurrencyRevenue[] {
  const groups = new Map<string, CurrencyRevenue>();
  for (const registration of registrations) {
    if (registration.paymentStatus !== "paid") continue;
    // Missing historical currency is explicit; never relabel it with today's fee.
    const currency = registration.paymentCurrency?.trim().toUpperCase() ||
      "UNKNOWN";
    const group = groups.get(currency) ?? {
      currency,
      totalRevenueCents: 0,
      paidRegistrationCount: 0,
    };
    const amount = Number(registration.paymentAmountCents ?? 0);
    if (Number.isFinite(amount) && amount > 0) {
      group.totalRevenueCents += amount;
    }
    group.paidRegistrationCount++;
    groups.set(currency, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency)
  );
}

async function summarizeCourse(course: Course): Promise<CourseSummary> {
  const registrations = await listRegistrationsByCourse(course.id);
  const attendeeCount =
    registrations.filter((r) => r.status === "approved").length;
  const waitlistedCount =
    registrations.filter((r) => r.status === "waitlisted").length;
  return {
    course,
    registrations,
    registrationCount: registrations.length,
    attendeeCount,
    waitlistedCount,
    availableSlots: Math.max(course.capacity - attendeeCount, 0),
    paidRegistrationCount:
      registrations.filter((r) => r.paymentStatus === "paid").length,
    revenueByCurrency: summarizeRevenue(registrations),
  };
}

export async function listCourseSummaries(): Promise<CourseSummary[]> {
  return await Promise.all((await listCourses()).map(summarizeCourse));
}

export async function getCourseSummaryById(
  courseId: string,
): Promise<CourseSummary | null> {
  const course = await getCourseById(courseId);
  return course ? await summarizeCourse(course) : null;
}
