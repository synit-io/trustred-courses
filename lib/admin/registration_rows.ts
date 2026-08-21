import { getCourseById, listCourses } from "../courses/repository.ts";
import type { Course, Registration, RegistrationStatus } from "../types.ts";
import { listRegistrations } from "../registrations/repository.ts";

export interface RegistrationDashboardFilters {
  q?: string;
  status?: RegistrationStatus | "all";
  courseId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface RegistrationRow extends Registration {
  courseTitle: string;
}

export interface RegistrationRowsResult {
  rows: RegistrationRow[];
  courses: Course[];
}

function withinDateRange(
  submittedAt: string,
  dateFrom?: string,
  dateTo?: string,
): boolean {
  const ts = Date.parse(submittedAt);
  if (Number.isNaN(ts)) return false;
  if (dateFrom) {
    const fromTs = Date.parse(`${dateFrom}T00:00:00`);
    if (!Number.isNaN(fromTs) && ts < fromTs) return false;
  }
  if (dateTo) {
    const toTs = Date.parse(`${dateTo}T23:59:59`);
    if (!Number.isNaN(toTs) && ts > toTs) return false;
  }
  return true;
}

export async function queryRegistrationRows(
  filters: RegistrationDashboardFilters,
): Promise<RegistrationRowsResult> {
  const [registrations, courses] = await Promise.all([
    listRegistrations(500),
    listCourses(),
  ]);

  const rows = await Promise.all(
    registrations.map(async (registration) => {
      const course = await getCourseById(registration.courseId);
      return {
        ...registration,
        courseTitle: course?.title ?? "Unbekannter Kurs",
      } satisfies RegistrationRow;
    }),
  );

  const q = filters.q?.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (
      filters.status && filters.status !== "all" &&
      row.status !== filters.status
    ) {
      return false;
    }
    if (
      filters.courseId && filters.courseId !== "all" &&
      row.courseId !== filters.courseId
    ) {
      return false;
    }
    if (!withinDateRange(row.submittedAt, filters.dateFrom, filters.dateTo)) {
      return false;
    }
    if (q) {
      const haystack =
        `${row.firstName} ${row.lastName} ${row.email} ${row.courseTitle}`
          .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return {
    rows: filtered.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    courses,
  };
}
