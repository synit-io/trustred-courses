import { getKv } from "../kv/client.ts";
import { normalizeCoursePricing } from "../courses/repository.ts";
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

async function ensureHomeSnapshot(kv: Deno.Kv): Promise<PublicHomeSnapshot> {
  const entry = await kv.get<PublicHomeSnapshot>(["public_snapshot", "home"]);
  if (entry.value) {
    return entry.value;
  }
  return await rebuildAllPublicSnapshots();
}

async function upsertCourseIntoHomeSnapshot(
  kv: Deno.Kv,
  detailSnapshot: PublicCourseDetailSnapshot,
): Promise<PublicHomeSnapshot> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let homeEntry = await kv.get<PublicHomeSnapshot>(
      ["public_snapshot", "home"],
      { consistency: "strong" },
    );
    if (!homeEntry.value) {
      await ensureHomeSnapshot(kv);
      homeEntry = await kv.get<PublicHomeSnapshot>(
        ["public_snapshot", "home"],
        { consistency: "strong" },
      );
    }
    const nextCourses = (homeEntry.value?.courses ?? []).filter((course) =>
      course.id !== detailSnapshot.course.id
    );
    if (isVisibleOnPublicHome(detailSnapshot.course)) {
      nextCourses.push({
        ...detailSnapshot.course,
        seats: detailSnapshot.seats,
      });
    }
    const nextHome: PublicHomeSnapshot = {
      generatedAt: detailSnapshot.generatedAt,
      courses: sortHomeCourses(nextCourses),
    };
    const commit = await kv.atomic()
      .check(homeEntry)
      .set(
        ["public_snapshot", "meta"],
        {
          schemaVersion: 1,
          generatedAt: detailSnapshot.generatedAt,
        } satisfies PublicSnapshotMeta,
      )
      .set(["public_snapshot", "home"], nextHome)
      .set(
        ["public_snapshot", "course", detailSnapshot.course.id],
        detailSnapshot,
      )
      .commit();
    if (commit.ok) return nextHome;
  }
  throw new Error("Public snapshot update conflicted repeatedly.");
}

async function removeCourseFromSnapshots(
  kv: Deno.Kv,
  courseId: string,
): Promise<PublicHomeSnapshot> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let homeEntry = await kv.get<PublicHomeSnapshot>(
      ["public_snapshot", "home"],
      { consistency: "strong" },
    );
    if (!homeEntry.value) {
      await ensureHomeSnapshot(kv);
      homeEntry = await kv.get<PublicHomeSnapshot>(
        ["public_snapshot", "home"],
        { consistency: "strong" },
      );
    }
    const generatedAt = new Date().toISOString();
    const nextHome: PublicHomeSnapshot = {
      generatedAt,
      courses: (homeEntry.value?.courses ?? []).filter((course) =>
        course.id !== courseId
      ),
    };
    const commit = await kv.atomic()
      .check(homeEntry)
      .set(
        ["public_snapshot", "meta"],
        {
          schemaVersion: 1,
          generatedAt,
        } satisfies PublicSnapshotMeta,
      )
      .set(["public_snapshot", "home"], nextHome)
      .delete(["public_snapshot", "course", courseId])
      .commit();
    if (commit.ok) return nextHome;
  }
  throw new Error("Public snapshot removal conflicted repeatedly.");
}

export async function rebuildPublicHomeSnapshot(): Promise<PublicHomeSnapshot> {
  const kv = await getKv();
  const generatedAt = new Date().toISOString();
  const courses = await listCoursesStrong(kv);
  const activeCourses = courses.filter((course) =>
    isVisibleOnPublicHome(course)
  );
  const detailSnapshots = await Promise.all(
    activeCourses.map((course) =>
      buildCourseDetailSnapshot(kv, course, generatedAt)
    ),
  );

  const homeSnapshot: PublicHomeSnapshot = {
    generatedAt,
    courses: sortHomeCourses(detailSnapshots.map((detail) => ({
      ...detail.course,
      seats: detail.seats,
    }))),
  };

  const tx = kv.atomic()
    .set(
      ["public_snapshot", "meta"],
      {
        schemaVersion: 1,
        generatedAt,
      } satisfies PublicSnapshotMeta,
    )
    .set(["public_snapshot", "home"], homeSnapshot);

  for (const detail of detailSnapshots) {
    tx.set(["public_snapshot", "course", detail.course.id], detail);
  }

  await tx.commit();
  return homeSnapshot;
}

export async function rebuildPublicCourseSnapshot(
  courseId: string,
): Promise<PublicCourseDetailSnapshot | null> {
  const kv = await getKv();
  const course = await readCourseStrong(kv, courseId);
  if (!course || course.status !== "active") {
    await removeCourseFromSnapshots(kv, courseId);
    return null;
  }

  const snapshot = await buildCourseDetailSnapshot(
    kv,
    course,
    new Date().toISOString(),
  );
  await kv.set(["public_snapshot", "course", courseId], snapshot);
  return snapshot;
}

export async function rebuildPublicSnapshotsForCourse(
  courseId: string,
): Promise<PublicCourseDetailSnapshot | null> {
  const kv = await getKv();
  const course = await readCourseStrong(kv, courseId);
  if (!course || course.status !== "active") {
    await removeCourseFromSnapshots(kv, courseId);
    return null;
  }

  const detail = await buildCourseDetailSnapshot(
    kv,
    course,
    new Date().toISOString(),
  );
  await upsertCourseIntoHomeSnapshot(kv, detail);
  return detail;
}

export async function rebuildAllPublicSnapshots(): Promise<PublicHomeSnapshot> {
  return await rebuildPublicHomeSnapshot();
}

export async function getPublicHomeSnapshot(): Promise<PublicHomeSnapshot> {
  const kv = await getKv();
  const entry = await kv.get<PublicHomeSnapshot>(["public_snapshot", "home"]);
  if (entry.value) {
    return {
      ...entry.value,
      courses: entry.value.courses
        .map((course) => ({
          ...normalizePublicCourseSnapshot(course),
          seats: course.seats,
        }))
        .filter((course) => isVisibleOnPublicHome(course)),
    };
  }
  return await rebuildAllPublicSnapshots();
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
