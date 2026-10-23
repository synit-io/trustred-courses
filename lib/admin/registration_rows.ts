import { listCourses } from "../courses/repository.ts";
import type { Course, Registration, RegistrationStatus } from "../types.ts";
import { listRegistrations } from "../registrations/repository.ts";
import { getKv } from "../kv/client.ts";
import { appDateKey } from "../time.ts";
import { type CurrencyRevenue, summarizeRevenue } from "./course_summaries.ts";

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
  total: number;
  stats: {
    total: number;
    pending: number;
    waitlisted: number;
    approved: number;
  };
  page: number;
  pageSize: number;
}

interface RegistrationProjection {
  courseId: string;
  status: RegistrationStatus;
  firstName: string;
  lastName: string;
  email: string;
}

function matches(
  row: RegistrationProjection & { submittedAt: string; courseTitle: string },
  filters: RegistrationDashboardFilters,
): boolean {
  if (
    filters.status && filters.status !== "all" && row.status !== filters.status
  ) return false;
  if (
    filters.courseId && filters.courseId !== "all" &&
    row.courseId !== filters.courseId
  ) return false;
  const date = appDateKey(row.submittedAt);
  if (
    !date || filters.dateFrom && date < filters.dateFrom ||
    filters.dateTo && date > filters.dateTo
  ) return false;
  const q = filters.q?.trim().toLowerCase();
  return !q ||
    `${row.firstName} ${row.lastName} ${row.email} ${row.courseTitle}`
      .toLowerCase().includes(q);
}

async function ensureSubmissionIndex(): Promise<void> {
  const kv = await getKv();
  const marker = await kv.get(["admin_registration_submission_index", 1]);
  if (marker.value) return;
  // New writers maintain the index atomically. Checked backfill preserves a
  // concurrent writer's newer projection and can safely restart after a crash.
  for await (
    const entry of kv.list<Registration>({ prefix: ["registrations"] })
  ) {
    const r = entry.value;
    await kv.atomic().check(entry).set(
      ["registrations_by_submitted", r.submittedAt, r.id],
      {
        courseId: r.courseId,
        status: r.status,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
      },
    ).commit();
  }
  await kv.set(marker.key, true);
}

export async function queryRegistrationRows(
  filters: RegistrationDashboardFilters,
  pagination?: { page: number; pageSize: number },
): Promise<RegistrationRowsResult> {
  await ensureSubmissionIndex();
  const kv = await getKv();
  const courses = await listCourses();
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const selected: string[] = [];
  const page = Math.max(1, Math.floor(pagination?.page ?? 1));
  const pageSize = pagination
    ? Math.max(1, Math.min(100, Math.floor(pagination.pageSize)))
    : Infinity;
  const start = pagination ? (page - 1) * pageSize : 0;
  const stats = { total: 0, pending: 0, waitlisted: 0, approved: 0 };
  const byCourse = filters.courseId && filters.courseId !== "all"
    ? filters.courseId
    : null;
  const byStatus = filters.status && filters.status !== "all"
    ? filters.status
    : null;
  const prefix = byCourse
    ? ["registrations_by_course", byCourse]
    : byStatus
    ? ["registrations_by_status", byStatus]
    : ["registrations_by_submitted"];
  for await (
    const entry of kv.list<RegistrationProjection | string>({ prefix }, {
      reverse: true,
    })
  ) {
    const id = String(entry.key.at(-1));
    const submittedAt = String(entry.key.at(-2));
    let projection: RegistrationProjection;
    if (byCourse || byStatus) {
      projection = {
        courseId: byCourse ?? String(entry.value),
        status: (byCourse ? entry.value : byStatus) as RegistrationStatus,
        firstName: "",
        lastName: "",
        email: "",
      };
      if (filters.q?.trim()) {
        const indexed = await kv.get<RegistrationProjection>([
          "registrations_by_submitted",
          submittedAt,
          id,
        ]);
        if (!indexed.value) continue;
        projection = indexed.value;
      }
    } else {
      projection = entry.value as RegistrationProjection;
    }
    const row = {
      ...projection,
      submittedAt,
      courseTitle: courseMap.get(projection.courseId)?.title ??
        "Unbekannter Kurs",
    };
    if (!matches(row, filters)) continue;
    if (stats.total >= start && selected.length < pageSize) selected.push(id);
    stats.total++;
    if (row.status === "pending_review") stats.pending++;
    if (row.status === "waitlisted") stats.waitlisted++;
    if (row.status === "approved") stats.approved++;
  }
  const rows: RegistrationRow[] = [];
  for (const id of selected) {
    const entry = await kv.get<Registration>(["registrations", id]);
    if (entry.value) {
      rows.push({
        ...entry.value,
        courseTitle: courseMap.get(entry.value.courseId)?.title ??
          "Unbekannter Kurs",
      });
    }
  }
  return { rows, courses, total: stats.total, stats, page, pageSize };
}

// Export needs every matching row and full-course totals regardless of row
// filters. Read each registration once, then derive both views from that data.
export async function loadRegistrationExport(
  filters: RegistrationDashboardFilters,
): Promise<{
  rows: RegistrationRow[];
  revenueByCourseId: Map<string, CurrencyRevenue[]>;
}> {
  const [registrations, courses] = await Promise.all([
    listRegistrations(),
    listCourses(),
  ]);
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const byCourse = new Map<string, Registration[]>();
  for (const registration of registrations) {
    const group = byCourse.get(registration.courseId) ?? [];
    group.push(registration);
    byCourse.set(registration.courseId, group);
  }
  const rows = registrations.map((r) => ({
    ...r,
    courseTitle: courseMap.get(r.courseId)?.title ?? "Unbekannter Kurs",
  })).filter((r) => matches(r, filters)).sort((a, b) =>
    b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id)
  );
  return {
    rows,
    revenueByCourseId: new Map(
      [...byCourse].map(([id, records]) => [id, summarizeRevenue(records)]),
    ),
  };
}
