import { assert, assertEquals, assertRejects } from "@std/assert";
import { Hono } from "hono";
import { listAuditLogsByEntity } from "../lib/audit/repository.ts";
import { getCourseById, upsertCourse } from "../lib/courses/repository.ts";
import {
  getCourseChangeEntry,
  processCourseNotificationEvents,
  saveCourseChangeChecked,
} from "../lib/courses/service.ts";
import {
  __setEmailSenderForTests,
  processEmailOutboxBatch,
} from "../lib/email/service.ts";
import { __setKvFactoryForTests } from "../lib/kv/client.ts";
import { createRegistration } from "../lib/registrations/repository.ts";
import type { Course, EmailOutboxJob, Registration } from "../lib/types.ts";
import type { AppEnv } from "../src/app/context.ts";
import { adminCoursesCloseRoute } from "../src/routes/api/admin/courses/[id]/close/route.ts";
import { adminCoursesUpdateRoute } from "../src/routes/api/admin/courses/[id]/update/route.ts";
import { setupKvTest } from "./test_utils.ts";

const fixed = "2020-01-01T00:00:00.000Z";
function course(): Course {
  return {
    id: "course",
    title: "Course",
    description: "Course description",
    location: "Before",
    startsAt: "2099-01-01T10:00:00.000Z",
    endsAt: "2099-01-01T12:00:00.000Z",
    registrationOpensAt: fixed,
    registrationClosesAt: "2098-01-01T00:00:00.000Z",
    capacity: 10,
    pricingType: "free",
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: fixed,
  };
}
function registration(id: string): Registration {
  return {
    id,
    courseId: "course",
    firstName: id,
    lastName: "Test",
    street: "Street",
    houseNumber: "1",
    postalCode: "10115",
    city: "Berlin",
    email: `${id}@example.org`,
    phone: "",
    status: "approved",
    waitingListPosition: null,
    consentAccepted: true,
    submittedAt: fixed,
    doubleOptInRequestedAt: fixed,
    doubleOptInConfirmedAt: fixed,
    reviewedAt: fixed,
    reviewedBy: "admin",
    adminMessage: null,
    internalNotes: null,
  };
}
async function count(kv: Deno.Kv, prefix: string): Promise<number> {
  let total = 0;
  for await (const _entry of kv.list({ prefix: [prefix] })) total++;
  return total;
}
async function change(
  next: Course,
  action: "course.updated" | "course.closed" = "course.updated",
) {
  const previous = await getCourseChangeEntry("course");
  assert(previous.value);
  await saveCourseChangeChecked(
    { ...previous, value: previous.value },
    next,
    "admin",
    action,
  );
}
function app() {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => {
    c.set("sessionUser", {
      id: "admin",
      role: "admin",
      email: "admin@example.org",
    });
    await next();
  });
  return a.route("/courses", adminCoursesUpdateRoute).route(
    "/courses",
    adminCoursesCloseRoute,
  );
}
function form(): FormData {
  const result = new FormData();
  for (
    const [key, value] of Object.entries({
      title: "Course",
      description: "Course description",
      location: "After",
      startsAt: "2099-01-01T11:00",
      endsAt: "2099-01-01T13:00",
      registrationOpensAt: "2020-01-01T01:00",
      registrationClosesAt: "2098-01-01T01:00",
      capacity: "10",
      pricingType: "free",
      status: "active",
      waitingListEnabled: "on",
    })
  ) result.set(key, value);
  return result;
}

Deno.test("course commit durably records audit and bounded fanout before any worker runs", async () => {
  const { kv, cleanup } = await setupKvTest("course-events-bounded");
  try {
    await upsertCourse(course());
    await createRegistration(registration("a"));
    await createRegistration(registration("b"));
    await createRegistration({ ...registration("c"), status: "cancelled" });
    await createRegistration({
      ...registration("d"),
      submittedAt: "2099-01-01T00:00:00.000Z",
    });
    await change({ ...course(), location: "After" });
    assertEquals((await getCourseById("course"))?.location, "After");
    assertEquals(
      (await listAuditLogsByEntity("course", "course")).map((log) =>
        log.action
      ),
      ["course.updated"],
    );
    assertEquals(await count(kv, "course_notification_events"), 1);
    assertEquals(await count(kv, "email_outbox"), 0);
    let hydration = 0;
    const proxy = new Proxy(kv, {
      get(target, key) {
        if (key === "get") {
          return (...args: Parameters<Deno.Kv["get"]>) => {
            if (args[0][0] === "registrations") hydration++;
            return Reflect.apply(target.get, target, args);
          };
        }
        const member = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    __setKvFactoryForTests(() => Promise.resolve(proxy));
    assertEquals(await processCourseNotificationEvents(1, 2), 1);
    assertEquals(hydration, 2);
    assertEquals(await count(kv, "email_outbox"), 2);
    assertEquals(await count(kv, "course_notification_events"), 1);
    assertEquals(await processCourseNotificationEvents(1, 2), 1);
    assertEquals(hydration, 3);
    assertEquals(await count(kv, "course_notification_events"), 0);
    assertEquals(await count(kv, "email_outbox"), 2);
    assertEquals(
      (await listAuditLogsByEntity("course", "course")).map((log) => log.action)
        .sort(),
      ["course.attendees_update_queued", "course.updated"],
    );
  } finally {
    await cleanup();
  }
});

Deno.test("fanout restart after queued job before event checkpoint creates one durable delivery intent", async () => {
  const { kv, cleanup } = await setupKvTest("course-event-crash");
  try {
    await upsertCourse(course());
    await createRegistration(registration("a"));
    await change({ ...course(), status: "archived" }, "course.closed");
    let failCheckpoint = true;
    const proxy = new Proxy(kv, {
      get(target, key) {
        if (key === "atomic") {
          return () => {
            const tx = target.atomic();
            let checkpoint = false;
            const wrapped = new Proxy(tx, {
              get(operation, property) {
                const member = Reflect.get(operation, property, operation);
                if (property === "set" || property === "delete") {
                  return (...args: unknown[]) => {
                    if (
                      (args[0] as Deno.KvKey)[0] ===
                        "course_notification_events"
                    ) checkpoint = true;
                    Reflect.apply(member, operation, args);
                    return wrapped;
                  };
                }
                if (property === "commit") {
                  return () => {
                    if (checkpoint && failCheckpoint) {
                      failCheckpoint = false;
                      throw new Error(
                        "simulated process exit before checkpoint",
                      );
                    }
                    return operation.commit();
                  };
                }
                if (typeof member === "function") {
                  return (...args: unknown[]) => {
                    const result = Reflect.apply(member, operation, args);
                    return result === operation ? wrapped : result;
                  };
                }
                return member;
              },
            });
            return wrapped;
          };
        }
        const member = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    __setKvFactoryForTests(() => Promise.resolve(proxy));
    await assertRejects(
      () => processCourseNotificationEvents(1),
      Error,
      "simulated process exit",
    );
    assertEquals(await count(kv, "email_outbox"), 1);
    assertEquals(await count(kv, "course_notification_events"), 1);
    __setKvFactoryForTests(() => Promise.resolve(kv));
    await kv.set(["registrations", "a"], {
      ...registration("a"),
      status: "cancelled",
    });
    await Promise.all([
      processCourseNotificationEvents(1),
      processCourseNotificationEvents(1),
    ]);
    assertEquals(await count(kv, "email_outbox"), 1);
    assertEquals(await count(kv, "email_outbox_events"), 1);
    assertEquals(await count(kv, "course_notification_events"), 0);
    assertEquals(
      (await listAuditLogsByEntity("course", "course")).filter((log) =>
        log.action === "course.attendees_cancelled_queued"
      ).length,
      1,
    );
    const queuedAudit = (await listAuditLogsByEntity("course", "course")).find((
      log,
    ) => log.action === "course.attendees_cancelled_queued");
    assertEquals(JSON.parse(queuedAudit!.newValue!).recipientCount, 1);
    let sends = 0;
    __setEmailSenderForTests(() => {
      sends++;
      return Promise.resolve({ ok: true });
    });
    await processEmailOutboxBatch(10);
    await processEmailOutboxBatch(10);
    assertEquals(sends, 1);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("stale admin edit commits neither source overwrite nor audit nor notification event", async () => {
  const { kv, cleanup } = await setupKvTest("course-event-conflict");
  try {
    await upsertCourse(course());
    const original = await getCourseChangeEntry("course");
    assert(original.value);
    await upsertCourse({ ...course(), title: "Concurrent edit" });
    await assertRejects(
      () =>
        saveCourseChangeChecked(
          { ...original, value: original.value! },
          { ...course(), location: "Lost edit" },
          "admin",
          "course.updated",
        ),
      Error,
      "zwischenzeitlich",
    );
    assertEquals((await getCourseById("course"))?.title, "Concurrent edit");
    assertEquals(await count(kv, "audit_logs"), 0);
    assertEquals(await count(kv, "course_notification_events"), 0);
    await change({ ...course(), title: "Description-only edit" });
    assertEquals(await count(kv, "audit_logs"), 1);
    assertEquals(await count(kv, "course_notification_events"), 0);
  } finally {
    await cleanup();
  }
});

Deno.test("actual update route recovers notification after postcommit fanout failure and close is idempotent", async () => {
  const { kv, cleanup } = await setupKvTest("course-event-route");
  let sends = 0;
  __setEmailSenderForTests(() => {
    sends++;
    return Promise.resolve({ ok: true });
  });
  try {
    await upsertCourse(course());
    await createRegistration(registration("a"));
    let fail = true;
    const proxy = new Proxy(kv, {
      get(target, key) {
        if (key === "list") {
          return (
            selector: Deno.KvListSelector,
            options?: Deno.KvListOptions,
          ) => {
            if (
              fail && "prefix" in selector &&
              selector.prefix[0] === "course_notification_events"
            ) {
              fail = false;
              throw new Error("fanout unavailable");
            }
            return target.list(selector, options);
          };
        }
        const member = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    __setKvFactoryForTests(() => Promise.resolve(proxy));
    const a = app();
    const response = await a.request("/courses/course/update", {
      method: "POST",
      body: form(),
    });
    assert(response.headers.get("Location")?.includes("course_updated=1"));
    assertEquals((await getCourseById("course"))?.location, "After");
    assertEquals(sends, 0);
    assertEquals(await count(kv, "course_notification_events"), 1);
    assertEquals(await processCourseNotificationEvents(), 1);
    await processEmailOutboxBatch();
    assertEquals(sends, 1);
    const close = await a.request("/courses/course/close", { method: "POST" });
    assert(close.headers.get("Location")?.includes("course_closed=1"));
    assertEquals(sends, 2);
    await a.request("/courses/course/close", { method: "POST" });
    assertEquals(sends, 2);
    for await (
      const job of kv.list<EmailOutboxJob>({ prefix: ["email_outbox"] })
    ) assertEquals(job.value.templateKey, "course_cancelled");
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("escaped course audit and event envelopes are refused before any source mutation", async () => {
  for (const field of ["description", "location"] as const) {
    const { kv, cleanup } = await setupKvTest("course-event-envelope");
    try {
      const original = {
        ...course(),
        [field]: "\\".repeat(field === "location" ? 33000 : 11000),
      };
      if (field === "location") await kv.set(["courses", "course"], original); // untouched legacy record
      else await upsertCourse(original);
      const before = await getCourseChangeEntry("course");
      assert(before.value);
      const next = {
        ...original,
        location: "After",
      };
      await assertRejects(
        () =>
          saveCourseChangeChecked(
            { ...before, value: before.value! },
            next,
            "admin",
            "course.updated",
          ),
        Error,
        field === "location"
          ? "Benachrichtigungsereignis"
          : "Änderungsprotokoll",
      );
      assertEquals(
        (await getCourseChangeEntry("course")).versionstamp,
        before.versionstamp,
      );
      assertEquals(await count(kv, "audit_logs"), 0);
      assertEquals(await count(kv, "course_notification_events"), 0);
    } finally {
      await cleanup();
    }
  }
});

Deno.test("legacy HTML expansion and new title/location limits reject before source/audit/event writes", async () => {
  const { kv, cleanup } = await setupKvTest("course-mail-template-bound");
  try {
    const legacy = { ...course(), location: "&".repeat(8000) };
    await kv.set(["courses", "course"], legacy);
    const before = await getCourseChangeEntry("course");
    assert(before.value);
    await assertRejects(
      () =>
        saveCourseChangeChecked(
          { ...before, value: before.value! },
          { ...course(), location: "After" },
          "admin",
          "course.updated",
        ),
      Error,
      "E-Mail-Vorlage",
    );
    assertEquals(
      (await getCourseChangeEntry("course")).versionstamp,
      before.versionstamp,
    );
    assertEquals(await count(kv, "audit_logs"), 0);
    assertEquals(await count(kv, "course_notification_events"), 0);
    await assertRejects(
      () => upsertCourse({ ...course(), title: "A".repeat(1025) }),
      Error,
      "Kurstitel",
    );
    await assertRejects(
      () => upsertCourse({ ...course(), location: "A".repeat(2049) }),
      Error,
      "Kursort",
    );
    assertEquals(
      (await getCourseChangeEntry("course")).versionstamp,
      before.versionstamp,
    );
  } finally {
    await cleanup();
  }
});
