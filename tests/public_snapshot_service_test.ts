import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  getPublicCourseDetailSnapshot,
  getPublicHomeSnapshot,
  rebuildAllPublicSnapshots,
  rebuildPublicSnapshotsForCourse,
} from "../lib/public_snapshot/service.ts";
import { upsertCourse } from "../lib/courses/repository.ts";
import { __setEmailSenderForTests } from "../lib/email/service.ts";
import {
  createRegistration,
  getRegistrationById,
} from "../lib/registrations/repository.ts";
import { applyRegistrationAction } from "../lib/registrations/service.ts";
import type { Course, Registration } from "../lib/types.ts";
import { futureIso, setupKvTest } from "./test_utils.ts";

function courseFixture(
  id: string,
  status: Course["status"] = "active",
  capacity = 10,
): Course {
  return {
    id,
    title: `Course ${id}`,
    description: "Public snapshot test course",
    location: "Berlin",
    startsAt: futureIso(60, 8),
    endsAt: futureIso(60, 16),
    registrationOpensAt: "2020-01-01T00:00:00.000Z",
    registrationClosesAt: "2099-01-01T00:00:00.000Z",
    capacity,
    status,
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: new Date().toISOString(),
  };
}

function registrationFixture(
  id: string,
  courseId: string,
  status: Registration["status"],
): Registration {
  return {
    id,
    courseId,
    firstName: "Max",
    lastName: "Mustermann",
    street: "Hauptstrasse",
    houseNumber: "1",
    postalCode: "10115",
    city: "Berlin",
    email: `${id}@example.org`,
    phone: "+49301234",
    status,
    waitingListPosition: status === "waitlisted" ? 1 : null,
    consentAccepted: true,
    submittedAt: `2026-03-${id.slice(-2)}T10:00:00.000Z`,
    doubleOptInRequestedAt: `2026-03-${id.slice(-2)}T10:00:00.000Z`,
    doubleOptInConfirmedAt: `2026-03-${id.slice(-2)}T10:00:00.000Z`,
    reviewedAt: status === "approved"
      ? `2026-03-${id.slice(-2)}T11:00:00.000Z`
      : null,
    reviewedBy: status === "approved" ? "admin-1" : null,
    adminMessage: null,
    internalNotes: null,
  };
}

Deno.test("public snapshots contain active public courses with precomputed seats", async () => {
  const { cleanup } = await setupKvTest("public_snapshot_home_");

  try {
    await upsertCourse(courseFixture("course-active-a", "active", 5));
    await upsertCourse(courseFixture("course-active-b", "active", 3));
    await upsertCourse(courseFixture("course-draft", "draft", 4));

    await createRegistration(
      registrationFixture("reg-01", "course-active-a", "approved"),
    );
    await createRegistration(
      registrationFixture("reg-02", "course-active-a", "approved"),
    );
    await createRegistration(
      registrationFixture("reg-03", "course-active-a", "pending_review"),
    );
    await createRegistration(
      registrationFixture("reg-04", "course-active-b", "waitlisted"),
    );

    const home = await rebuildAllPublicSnapshots();

    assertEquals(home.courses.map((course) => course.id), [
      "course-active-a",
      "course-active-b",
    ]);
    assertEquals(home.courses[0]?.seats.approved, 2);
    assertEquals(home.courses[0]?.seats.available, 3);
    assertEquals(home.courses[1]?.seats.approved, 0);
    assertEquals(home.courses[1]?.seats.available, 3);

    const detail = await getPublicCourseDetailSnapshot("course-active-a");
    assert(detail);
    assertEquals(detail.seats.approved, 2);
    assertEquals(detail.seats.total, 5);
  } finally {
    await cleanup();
  }
});

Deno.test("public snapshot seat counts update after admin approval and course archive", async () => {
  const { cleanup } = await setupKvTest("public_snapshot_updates_");

  try {
    __setEmailSenderForTests(() => Promise.resolve({ ok: true }));
    const course = courseFixture("course-hot", "active", 1);
    const otherCourse = courseFixture("course-cold", "active", 4);
    await upsertCourse(course);
    await upsertCourse(otherCourse);
    await createRegistration(
      registrationFixture("reg-10", course.id, "pending_review"),
    );
    await createRegistration(
      registrationFixture("reg-11", otherCourse.id, "approved"),
    );

    await rebuildPublicSnapshotsForCourse(course.id);
    await rebuildPublicSnapshotsForCourse(otherCourse.id);

    const beforeApprove = await getPublicCourseDetailSnapshot(course.id);
    assert(beforeApprove);
    assertEquals(beforeApprove.seats.approved, 0);
    assertEquals(beforeApprove.seats.available, 1);

    await applyRegistrationAction({
      registrationId: "reg-10",
      action: "approve",
      actorUserId: "admin-1",
    });

    const afterApprove = await getPublicCourseDetailSnapshot(course.id);
    assert(afterApprove);
    assertEquals(afterApprove.seats.approved, 1);
    assertEquals(afterApprove.seats.available, 0);
    assertEquals(afterApprove.seats.full, true);

    const homeAfterApprove = await getPublicHomeSnapshot();
    assertEquals(
      homeAfterApprove.courses.map((entry) => entry.id),
      ["course-cold", "course-hot"],
    );
    assertEquals(
      homeAfterApprove.courses.find((entry) => entry.id === "course-cold")
        ?.seats
        .approved,
      1,
    );

    await upsertCourse({
      ...course,
      status: "archived",
    });
    await rebuildPublicSnapshotsForCourse(course.id);

    const archivedDetail = await getPublicCourseDetailSnapshot(course.id);
    assertEquals(archivedDetail, null);

    const home = await getPublicHomeSnapshot();
    assertEquals(home.courses.map((entry) => entry.id), ["course-cold"]);

    const storedRegistration = await getRegistrationById("reg-10");
    assert(storedRegistration);
    assertEquals(storedRegistration.status, "approved");
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("public home snapshot excludes courses that already started", async () => {
  const { cleanup } = await setupKvTest("public_snapshot_past_courses_");

  try {
    await upsertCourse({
      ...courseFixture("course-past", "active", 8),
      startsAt: "2020-01-01T08:00:00.000Z",
      endsAt: "2020-01-01T16:00:00.000Z",
    });
    await upsertCourse({
      ...courseFixture("course-future", "active", 8),
      startsAt: "2099-06-10T08:00:00.000Z",
      endsAt: "2099-06-10T16:00:00.000Z",
    });

    const home = await rebuildAllPublicSnapshots();

    assertEquals(home.courses.map((course) => course.id), ["course-future"]);

    const cachedHome = await getPublicHomeSnapshot();
    assertEquals(cachedHome.courses.map((course) => course.id), [
      "course-future",
    ]);
  } finally {
    await cleanup();
  }
});

Deno.test("public publication and repair exceed aggregate value and transaction limits", async () => {
  const { kv, cleanup } = await setupKvTest("public_large_catalogue_");
  try {
    // More than 800 KiB in aggregate also exceeds one KV transaction's limit.
    for (let i = 0; i < 100; i++) {
      const course = {
        ...courseFixture(`large-${String(i).padStart(3, "0")}`),
        description: "Course description ".repeat(500),
      };
      await upsertCourse(course);
      await rebuildPublicSnapshotsForCourse(course.id);
    }
    assertEquals((await getPublicHomeSnapshot()).courses.length, 100);
    assertEquals((await rebuildAllPublicSnapshots()).courses.length, 100);
    await kv.delete(["public_snapshot", "card", "large-099"]);
    assertEquals((await rebuildAllPublicSnapshots()).courses.length, 100);
    // The old aggregate remains a supported migration input, never a source write.
    await kv.delete(["public_snapshot", "meta"]);
    await kv.set(["public_snapshot", "home"], {
      generatedAt: "2020-01-01T00:00:00Z",
      courses: [],
    });
    assertEquals((await getPublicHomeSnapshot()).courses.length, 100);
  } finally {
    await cleanup();
  }
});

Deno.test("every snapshot rebuild rejects a derivation from an older source revision", async () => {
  const { __setKvFactoryForTests } = await import("../lib/kv/client.ts");
  const { rebuildPublicCourseSnapshot, rebuildPublicHomeSnapshot } =
    await import("../lib/public_snapshot/service.ts");
  for (
    const rebuild of [
      () => rebuildPublicSnapshotsForCourse("race"),
      () => rebuildPublicCourseSnapshot("race"),
      () => rebuildPublicHomeSnapshot(),
    ]
  ) {
    const { kv, cleanup } = await setupKvTest("snapshot_revision_");
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pause!: () => void;
    const paused = new Promise<void>((resolve) => {
      pause = resolve;
    });
    try {
      await upsertCourse(courseFixture("race"));
      await rebuildAllPublicSnapshots();
      let intercept = true;
      const proxy = new Proxy(kv, {
        get(target, key) {
          if (key === "list") {
            return (
              selector: Deno.KvListSelector,
              options?: Deno.KvListOptions,
            ) => {
              const iterator = target.list(selector, options);
              if (
                intercept && "prefix" in selector &&
                selector.prefix[0] === "registrations_by_course"
              ) {
                intercept = false;
                return (async function* () {
                  for await (const entry of iterator) yield entry;
                  pause();
                  await released;
                })();
              }
              return iterator;
            };
          }
          const member = Reflect.get(target, key, target);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      __setKvFactoryForTests(() => Promise.resolve(proxy));
      const older = rebuild();
      await paused;
      await createRegistration(
        registrationFixture("reg-10", "race", "approved"),
      );
      await rebuildPublicSnapshotsForCourse("race");
      release();
      await older;
      assertEquals(
        (await getPublicHomeSnapshot()).courses[0].seats.approved,
        1,
      );
      assertEquals(
        (await getPublicCourseDetailSnapshot("race"))?.seats.approved,
        1,
      );
    } finally {
      release();
      await cleanup();
    }
  }
});

Deno.test("oversized UTF-8 course text is rejected before changing source or published snapshots", async () => {
  const { kv, cleanup } = await setupKvTest("snapshot_single_value_boundary_");
  try {
    const course = courseFixture("boundary");
    await upsertCourse(course);
    await rebuildPublicSnapshotsForCourse(course.id);
    const before = await kv.get(["courses", course.id]);
    const published = await getPublicCourseDetailSnapshot(course.id);
    // 28 KiB of valid Unicode text, despite fewer than 24 Ki characters.
    await assertRejects(
      () => upsertCourse({ ...course, description: "🚑".repeat(7000) }),
      Error,
      "kürze",
    );
    assertEquals(
      (await kv.get(["courses", course.id])).versionstamp,
      before.versionstamp,
    );
    assertEquals(await getPublicCourseDetailSnapshot(course.id), published);
    await assertRejects(
      () =>
        upsertCourse({
          ...courseFixture("new-boundary"),
          description: "a".repeat(65193),
        }),
      Error,
      "kürze",
    );
    assertEquals((await kv.get(["courses", "new-boundary"])).value, null);
  } finally {
    await cleanup();
  }
});
