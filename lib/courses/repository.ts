import { getKv } from "../kv/client.ts";
import type { Course } from "../types.ts";
import { bumpCourseRevision, getCourseRevisionEntry } from "./revision.ts";
import { assertCourseStorageSize } from "./storage.ts";

function normalizeCurrencyCode(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : "EUR";
}

function normalizeFeeAmountCents(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const numeric = Math.floor(Number(value));
  return numeric > 0 ? numeric : 0;
}

export function normalizeCoursePricing(course: Course): Course {
  const pricingType = course.pricingType === "paid" ? "paid" : "free";
  if (pricingType === "free") {
    return {
      ...course,
      pricingType,
      feeAmountCents: null,
      feeCurrency: null,
    };
  }

  const feeAmountCents = normalizeFeeAmountCents(course.feeAmountCents);
  if (feeAmountCents <= 0) {
    return {
      ...course,
      pricingType: "free",
      feeAmountCents: null,
      feeCurrency: null,
    };
  }

  return {
    ...course,
    pricingType,
    feeAmountCents,
    feeCurrency: normalizeCurrencyCode(course.feeCurrency),
  };
}

async function readCourseStrong(
  kv: Deno.Kv,
  key: Deno.KvKey,
  fallback: Course,
): Promise<Course> {
  const entry = await kv.get<Course>(key, { consistency: "strong" });
  return normalizeCoursePricing(entry.value ?? fallback);
}

export async function listActiveCourses(): Promise<Course[]> {
  const kv = await getKv();
  const entries: Course[] = [];

  for await (const entry of kv.list<Course>({ prefix: ["courses"] })) {
    const course = await readCourseStrong(kv, entry.key, entry.value);
    if (course.status === "active") {
      entries.push(course);
    }
  }

  return entries.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function listCourses(): Promise<Course[]> {
  const kv = await getKv();
  const entries: Course[] = [];

  for await (const entry of kv.list<Course>({ prefix: ["courses"] })) {
    entries.push(await readCourseStrong(kv, entry.key, entry.value));
  }

  return entries.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function getCourseById(courseId: string): Promise<Course | null> {
  const kv = await getKv();
  const entry = await kv.get<Course>(["courses", courseId], {
    consistency: "strong",
  });
  return entry.value ? normalizeCoursePricing(entry.value) : null;
}

export async function upsertCourse(course: Course): Promise<void> {
  const normalized = normalizeCoursePricing(course);
  assertCourseStorageSize(normalized);
  const kv = await getKv();
  for (let attempt = 0; attempt < 10; attempt++) {
    const revision = await getCourseRevisionEntry(course.id);
    const result = await bumpCourseRevision(kv.atomic(), revision)
      .set(["courses", course.id], normalized).commit();
    if (result.ok) return;
  }
  throw new Error("Course update conflicted repeatedly.");
}

export async function deleteCourseById(courseId: string): Promise<boolean> {
  const kv = await getKv();
  for (let attempt = 0; attempt < 10; attempt++) {
    const revision = await getCourseRevisionEntry(courseId);
    const existing = await kv.get<Course>(["courses", courseId], {
      consistency: "strong",
    });
    if (!existing.value) return false;
    for await (
      const _entry of kv.list({
        prefix: ["registrations_by_course", courseId],
      }, { limit: 1 })
    ) return false;
    for await (
      const _entry of kv.list({
        prefix: ["pending_paid_registrations_by_course", courseId],
      }, { limit: 1 })
    ) return false;
    // Older checkouts did not have the course reference index.
    for await (
      const entry of kv.list<{ courseId: string }>({
        prefix: ["pending_paid_registrations"],
      })
    ) {
      if (entry.value.courseId === courseId) return false;
    }
    const result = await bumpCourseRevision(kv.atomic(), revision)
      .check(existing).delete(existing.key).commit();
    if (result.ok) return true;
  }
  throw new Error("Course deletion conflicted repeatedly.");
}
