import { getKv } from "../kv/client.ts";
import { normalizeCoursePricing } from "../courses/repository.ts";
import { getCourseRevisionEntry } from "../courses/revision.ts";
import type { Course, Registration } from "../types.ts";

export interface PublicSeatSnapshot {
  total: number;
  approved: number;
  available: number;
  lowCapacity: boolean;
  full: boolean;
}

export interface PublicCourseSnapshot {
  id: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  capacity: number;
  pricingType: "free" | "paid";
  feeAmountCents: number | null;
  feeCurrency: string | null;
  waitingListEnabled: boolean;
  status: "active" | "draft" | "archived";
}

export interface PublicCourseCardSnapshot extends PublicCourseSnapshot {
  seats: PublicSeatSnapshot;
}

export interface PublicHomeSnapshot {
  generatedAt: string;
  courses: PublicCourseCardSnapshot[];
}

export interface PublicCourseDetailSnapshot {
  generatedAt: string;
  course: PublicCourseSnapshot;
  seats: PublicSeatSnapshot;
}

interface PublicSnapshotMeta {
  schemaVersion: number;
  generatedAt: string;
}

function normalizePublicCourseSnapshot(
  course: PublicCourseSnapshot,
): PublicCourseSnapshot {
  const pricingType = course.pricingType === "paid" ? "paid" : "free";
  if (pricingType === "free") {
    return {
      ...course,
      pricingType,
      feeAmountCents: null,
      feeCurrency: null,
    };
  }
  const feeAmountCents = Number.isFinite(course.feeAmountCents)
    ? Math.max(1, Math.floor(Number(course.feeAmountCents)))
    : 1;
  const feeCurrency = typeof course.feeCurrency === "string" &&
      /^[A-Z]{3}$/.test(course.feeCurrency.toUpperCase())
    ? course.feeCurrency.toUpperCase()
    : "EUR";
  return {
    ...course,
    pricingType,
    feeAmountCents,
    feeCurrency,
  };
}

function isVisibleOnPublicHome(
  course: Pick<PublicCourseSnapshot, "startsAt" | "status">,
): boolean {
  if (course.status !== "active") return false;
  const startsAt = Date.parse(course.startsAt);
  if (Number.isNaN(startsAt)) return false;
  return startsAt > Date.now();
}

function toPublicCourseSnapshot(course: Course): PublicCourseSnapshot {
  const normalized = normalizeCoursePricing(course);
  return {
    id: normalized.id,
    title: normalized.title,
    description: normalized.description,
    location: normalized.location,
    startsAt: normalized.startsAt,
    endsAt: normalized.endsAt,
    registrationOpensAt: normalized.registrationOpensAt,
    registrationClosesAt: normalized.registrationClosesAt,
    capacity: normalized.capacity,
    pricingType: normalized.pricingType ?? "free",
    feeAmountCents: normalized.feeAmountCents ?? null,
    feeCurrency: normalized.feeCurrency ?? null,
    waitingListEnabled: normalized.waitingListEnabled,
    status: normalized.status,
  };
}

function buildSeatSnapshot(
  total: number,
  approved: number,
): PublicSeatSnapshot {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeApproved = Math.max(0, Math.floor(approved));
  const available = Math.max(safeTotal - safeApproved, 0);
  const lowThreshold = Math.max(1, Math.ceil(safeTotal * 0.1));
  return {
    total: safeTotal,
    approved: safeApproved,
    available,
    lowCapacity: available > 0 && available <= lowThreshold,
    full: available === 0,
  };
}

async function readCourseStrong(
  kv: Deno.Kv,
  courseId: string,
): Promise<Course | null> {
  const entry = await kv.get<Course>(["courses", courseId], {
    consistency: "strong",
  });
  return entry.value ? normalizeCoursePricing(entry.value) : null;
}

async function listCoursesStrong(kv: Deno.Kv): Promise<Course[]> {
  const courses: Course[] = [];
  for await (const entry of kv.list<Course>({ prefix: ["courses"] })) {
    const courseId = String(entry.key.at(-1));
    const strong = await readCourseStrong(kv, courseId);
    if (strong) {
      courses.push(strong);
    }
  }
  return courses.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

async function listRegistrationsByCourseStrong(
  kv: Deno.Kv,
  courseId: string,
): Promise<Registration[]> {
  const registrations: Registration[] = [];
  for await (
    const entry of kv.list<string>({
      prefix: ["registrations_by_course", courseId],
    })
  ) {
    const registrationId = String(entry.key.at(-1));
    const registrationEntry = await kv.get<Registration>(
      ["registrations", registrationId],
      { consistency: "strong" },
    );
    if (registrationEntry.value) {
      registrations.push(registrationEntry.value);
    }
  }
  return registrations.sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt)
  );
}

async function buildCourseDetailSnapshot(
  kv: Deno.Kv,
  course: Course,
  generatedAt: string,
): Promise<PublicCourseDetailSnapshot> {
  const registrations = await listRegistrationsByCourseStrong(kv, course.id);
  const approvedCount =
    registrations.filter((registration) => registration.status === "approved")
      .length;

  return {
    generatedAt,
    course: toPublicCourseSnapshot(course),
    seats: buildSeatSnapshot(course.capacity, approvedCount),
  };
}

function sortHomeCourses(
  courses: PublicCourseCardSnapshot[],
): PublicCourseCardSnapshot[] {
  // Tie-break on id so equal start times keep one order, whichever update ran last.
  return [...courses].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)
  );
}

// Store each card separately: the catalogue and rebuild transaction may grow
// beyond the KV limits for one value/transaction without growing any one write.
async function publishCourseSnapshot(
  kv: Deno.Kv,
  courseId: string,
): Promise<PublicCourseDetailSnapshot | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const revision = await getCourseRevisionEntry(courseId);
    const course = await readCourseStrong(kv, courseId);
    const detail = course?.status === "active"
      ? await buildCourseDetailSnapshot(kv, course, new Date().toISOString())
      : null;
    const tx = kv.atomic().check(revision);
    if (detail) {
      tx.set(["public_snapshot", "course", courseId], detail);
    } else {
      tx.delete(["public_snapshot", "course", courseId]);
    }
    if (detail && isVisibleOnPublicHome(detail.course)) {
      tx.set(
        ["public_snapshot", "card", courseId],
        {
          ...detail.course,
          seats: detail.seats,
        } satisfies PublicCourseCardSnapshot,
      );
    } else {
      tx.delete(["public_snapshot", "card", courseId]);
    }
    if ((await tx.commit()).ok) return detail;
  }
  throw new Error("Public snapshot source changed repeatedly.");
}

async function readHomeCards(kv: Deno.Kv): Promise<PublicHomeSnapshot> {
  const courses: PublicCourseCardSnapshot[] = [];
  for await (
    const entry of kv.list<PublicCourseCardSnapshot>({
      prefix: ["public_snapshot", "card"],
    })
  ) {
    const course = normalizePublicCourseSnapshot(entry.value);
    if (isVisibleOnPublicHome(course)) {
      courses.push({ ...course, seats: entry.value.seats });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    courses: sortHomeCourses(courses),
  };
}

export async function rebuildPublicHomeSnapshot(): Promise<PublicHomeSnapshot> {
  const kv = await getKv();
  const ids = new Set((await listCoursesStrong(kv)).map((course) => course.id));
  // Include old card/detail keys so rebuild also repairs deletions and archives.
  for (const kind of ["card", "course"]) {
    for await (const entry of kv.list({ prefix: ["public_snapshot", kind] })) {
      ids.add(String(entry.key.at(-1)));
    }
  }
  for (const id of ids) await publishCourseSnapshot(kv, id);
  // Publish schema readiness only after migrating every source course. Keep the
  // previous aggregate as a read fallback until migration has completed.
  await kv.set(
    ["public_snapshot", "meta"],
    {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
    } satisfies PublicSnapshotMeta,
  );
  return await readHomeCards(kv);
}

export async function rebuildPublicCourseSnapshot(
  courseId: string,
): Promise<PublicCourseDetailSnapshot | null> {
  return await rebuildPublicSnapshotsForCourse(courseId);
}

export async function rebuildPublicSnapshotsForCourse(
  courseId: string,
): Promise<PublicCourseDetailSnapshot | null> {
  const kv = await getKv();
  const detail = await publishCourseSnapshot(kv, courseId);
  const meta = await kv.get<PublicSnapshotMeta>(["public_snapshot", "meta"]);
  if (meta.value?.schemaVersion !== 2) await rebuildPublicHomeSnapshot();
  return detail;
}

export async function rebuildAllPublicSnapshots(): Promise<PublicHomeSnapshot> {
  return await rebuildPublicHomeSnapshot();
}

export async function getPublicHomeSnapshot(): Promise<PublicHomeSnapshot> {
  const kv = await getKv();
  const meta = await kv.get<PublicSnapshotMeta>(["public_snapshot", "meta"]);
  if (meta.value?.schemaVersion === 2) return await readHomeCards(kv);
  try {
    return await rebuildAllPublicSnapshots();
  } catch (error) {
    const legacy = await kv.get<PublicHomeSnapshot>([
      "public_snapshot",
      "home",
    ]);
    if (!legacy.value) throw error;
    return {
      ...legacy.value,
      courses: legacy.value.courses.map((course) => ({
        ...normalizePublicCourseSnapshot(course),
        seats: course.seats,
      })).filter(isVisibleOnPublicHome),
    };
  }
}

export async function getPublicCourseDetailSnapshot(
  courseId: string,
): Promise<PublicCourseDetailSnapshot | null> {
  const kv = await getKv();
  const entry = await kv.get<PublicCourseDetailSnapshot>([
    "public_snapshot",
    "course",
    courseId,
  ]);
  if (entry.value) {
    return {
      ...entry.value,
      course: normalizePublicCourseSnapshot(entry.value.course),
    };
  }
  return await rebuildPublicCourseSnapshot(courseId);
}
