import { getKv } from "../kv/client.ts";
import type { Course } from "../types.ts";

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
  const kv = await getKv();
  await kv.set(["courses", course.id], normalizeCoursePricing(course));
}

export async function deleteCourseById(courseId: string): Promise<boolean> {
  const kv = await getKv();
  const existing = await kv.get<Course>(["courses", courseId], {
    consistency: "strong",
  });
  if (!existing.value) {
    return false;
  }
  await kv.delete(["courses", courseId]);
  return true;
}
