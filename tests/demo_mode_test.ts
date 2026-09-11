import { assert, assertEquals, assertRejects } from "@std/assert";
import { Hono } from "hono";
import { listCourses, upsertCourse } from "../lib/courses/repository.ts";
import { DEMO_ACCOUNTS } from "../lib/demo/accounts.ts";
import {
  DEMO_COURSE_ID_PREFIX,
  DEMO_EMAIL_DOMAINS,
  generateDemoDataset,
} from "../lib/demo/generator.ts";
import {
  ensureDemoDataOnBoot,
  getDemoResetState,
  resetDemoData,
} from "../lib/demo/reset.ts";
import { DemoModeDisabledError, seedDemoData } from "../lib/demo/seed.ts";
import {
  enqueueEmailOutbox,
  listDueEmailOutbox,
  listEmailLogsByRegistration,
} from "../lib/email/repository.ts";
import {
  __setEmailSenderForTests,
  processEmailOutboxBatch,
  sendRegistrationEventEmails,
} from "../lib/email/service.ts";
import {
  cronIntervalMinutes,
  describeCronSchedule,
  formatCountdown,
  getDemoResetInfo,
  nextCronRun,
  parseCronSchedule,
} from "../lib/demo/schedule.ts";
import { env, isDemoMode } from "../lib/env.ts";
import { getPublicHomeSnapshot } from "../lib/public_snapshot/service.ts";
import { listRegistrationsByCourse } from "../lib/registrations/repository.ts";
import type { Course, Registration } from "../lib/types.ts";
import {
  createUserFromEmail,
  getUserByEmail,
} from "../lib/users/repository.ts";
import type { AppEnv } from "../src/app/context.ts";
import { adminCoursesDeleteRoute } from "../src/routes/api/admin/courses/[id]/delete/route.ts";
import { adminUsersDeleteRoute } from "../src/routes/api/admin/users/[id]/delete/route.ts";
import { setupKvTest } from "./test_utils.ts";

function withDemoMode<T>(enabled: boolean, run: () => Promise<T>): Promise<T> {
  const previous = Deno.env.get("DEMO_MODE");
  Deno.env.set("DEMO_MODE", enabled ? "true" : "false");
  return run().finally(() => {
    if (previous === undefined) Deno.env.delete("DEMO_MODE");
    else Deno.env.set("DEMO_MODE", previous);
  });
}

function sampleCourse(): Course {
  return {
    id: "course-demo-test",
    title: "Erste Hilfe Basis",
    description: "Kurs",
    location: "Berlin",
    startsAt: "2099-04-10T08:00:00.000Z",
    endsAt: "2099-04-10T16:00:00.000Z",
    registrationOpensAt: "2020-01-01T00:00:00.000Z",
    registrationClosesAt: "2099-01-01T00:00:00.000Z",
    capacity: 10,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: new Date().toISOString(),
  };
}

function sampleRegistration(): Registration {
  const now = new Date().toISOString();
  return {
    id: "reg-demo-test",
    courseId: "course-demo-test",
    firstName: "Max",
    lastName: "Mustermann",
    street: "Hauptstrasse",
    houseNumber: "10",
    postalCode: "10115",
    city: "Berlin",
    email: "max@example.org",
    phone: "",
    status: "approved",
    waitingListPosition: null,
    consentAccepted: true,
    submittedAt: now,
    doubleOptInRequestedAt: now,
    doubleOptInConfirmedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    adminMessage: null,
    internalNotes: null,
  };
}

Deno.test("isDemoMode reads DEMO_MODE live", async () => {
  await withDemoMode(true, () => {
    assertEquals(isDemoMode(), true);
    return Promise.resolve();
  });
  await withDemoMode(false, () => {
    assertEquals(isDemoMode(), false);
    return Promise.resolve();
  });
});

Deno.test("DEMO_MODE suppresses direct mail even with an injected sender", async () => {
  const { cleanup } = await setupKvTest("demo-mail-direct-");
  let senderCalls = 0;
  __setEmailSenderForTests(() => {
    senderCalls += 1;
    return Promise.resolve({ ok: true });
  });
  try {
    await withDemoMode(true, async () => {
      await sendRegistrationEventEmails(
        sampleRegistration(),
        sampleCourse(),
        "approved",
      );
    });
    assertEquals(senderCalls, 0);
    const logs = await listEmailLogsByRegistration("reg-demo-test");
    assertEquals(logs.length, 1);
    assertEquals(logs[0].deliveryStatus, "suppressed");
    assertEquals(logs[0].errorMessage, null);
    assertEquals((await listDueEmailOutbox()).length, 0);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("DEMO_MODE drains the outbox without contacting a sender", async () => {
  const { cleanup } = await setupKvTest("demo-mail-outbox-");
  let senderCalls = 0;
  __setEmailSenderForTests(() => {
    senderCalls += 1;
    return Promise.resolve({ ok: false, error: "should not be called" });
  });
  try {
    await enqueueEmailOutbox({
      registrationId: "reg-demo-test",
      templateKey: "approved",
      recipientEmail: "max@example.org",
      subject: "Zusage",
      text: "Text",
      html: "<p>Text</p>",
      attempt: 0,
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
      lastError: null,
    });
    const processed = await withDemoMode(
      true,
      () => processEmailOutboxBatch(10),
    );
    assertEquals(processed, 1);
    assertEquals(senderCalls, 0);
    assertEquals((await listDueEmailOutbox()).length, 0);
    const logs = await listEmailLogsByRegistration("reg-demo-test");
    assertEquals(logs.length, 1);
    assertEquals(logs[0].deliveryStatus, "suppressed");
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("demo generator produces valid, reserved-domain data", () => {
  const now = new Date("2026-09-11T12:00:00.000Z");
  const dataset = generateDemoDataset({
    courses: 40,
    seed: 7,
    now,
    actorUserId: "actor-1",
  });
  const again = generateDemoDataset({
    courses: 40,
    seed: 7,
    now,
    actorUserId: "actor-1",
  });

  assertEquals(dataset.courses.length, 40);
  assert(dataset.registrations.length > 0);
  assertEquals(
    dataset.courses.map((course) => course.title),
    again.courses.map((course) => course.title),
    "same seed must reproduce the same content shape",
  );
  assertEquals(new Set(dataset.courses.map((c) => c.id)).size, 40);

  for (const course of dataset.courses) {
    assert(course.id.startsWith(DEMO_COURSE_ID_PREFIX));
    assert(Date.parse(course.endsAt) > Date.parse(course.startsAt));
    if (course.pricingType === "paid") {
      assert((course.feeAmountCents ?? 0) > 0);
      assertEquals(course.feeCurrency, "EUR");
    }
    const registrations = dataset.registrations.filter((entry) =>
      entry.courseId === course.id
    );
    if (course.status === "draft") assertEquals(registrations.length, 0);
    const approved = registrations.filter((entry) =>
      entry.status === "approved"
    );
    assert(approved.length <= course.capacity, "approved within capacity");
    const waitlisted = registrations
      .filter((entry) => entry.status === "waitlisted")
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    waitlisted.forEach((entry, index) => {
      assertEquals(entry.waitingListPosition, index + 1);
    });
    if (waitlisted.length > 0) assert(course.waitingListEnabled);
    assertEquals(
      new Set(registrations.map((entry) => entry.email)).size,
      registrations.length,
      "emails unique per course",
    );
    for (const registration of registrations) {
      const domain = registration.email.split("@")[1];
      assert(
        (DEMO_EMAIL_DOMAINS as readonly string[]).includes(domain),
        `reserved domain expected, got ${domain}`,
      );
      assert(Date.parse(registration.submittedAt) < now.getTime());
      if (course.pricingType === "paid") {
        assertEquals(registration.paymentStatus, "paid");
        assertEquals(registration.paymentProvider, "demo");
      } else {
        assertEquals(registration.paymentStatus, "not_required");
      }
      const audits = dataset.auditLogs.filter((log) =>
        log.entityId === registration.id
      );
      assert(audits.length >= 1);
      if (registration.status !== "submitted") {
        assert(audits.some((log) => log.action === "registration.submitted"));
      }
    }
  }
  for (const log of dataset.emailLogs) {
    assertEquals(log.deliveryStatus, "suppressed");
  }
});

Deno.test("seedDemoData refuses to run without DEMO_MODE", async () => {
  const { cleanup } = await setupKvTest("demo-seed-refuse-");
  try {
    await withDemoMode(false, async () => {
      await assertRejects(
        () => seedDemoData({ courses: 2, seed: 1 }),
        DemoModeDisabledError,
      );
    });
    assertEquals((await listCourses()).length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("seedDemoData appends data on every run and rebuilds snapshots", async () => {
  const { cleanup } = await setupKvTest("demo-seed-run-");
  try {
    const first = await withDemoMode(
      true,
      () => seedDemoData({ courses: 6, seed: 11 }),
    );
    const second = await withDemoMode(
      true,
      () => seedDemoData({ courses: 6, seed: 12 }),
    );
    assertEquals(first.courses, 6);
    assertEquals(second.courses, 6);

    const courses = await listCourses();
    assertEquals(courses.length, 12);

    let storedRegistrations = 0;
    for (const course of courses) {
      storedRegistrations +=
        (await listRegistrationsByCourse(course.id)).length;
    }
    assertEquals(
      storedRegistrations,
      first.registrations + second.registrations,
    );

    const snapshot = await getPublicHomeSnapshot();
    const visible = courses.filter((course) => course.status === "active");
    assert(visible.length > 0);
    assertEquals(snapshot.courses.length, visible.length);

    for (const account of DEMO_ACCOUNTS) {
      const user = await getUserByEmail(account.email);
      assert(user, `${account.email} created`);
      assertEquals(user.role, account.role);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("resetDemoData wipes visitor data and rebuilds the demo state", async () => {
  const { kv, cleanup } = await setupKvTest("demo-reset-");
  try {
    await withDemoMode(true, () => seedDemoData({ courses: 3, seed: 5 }));
    await upsertCourse({ ...sampleCourse(), id: "visitor-course" });
    await kv.set(["sessions", "visitor-session"], { userId: "x" });
    const summary = await withDemoMode(
      true,
      () => resetDemoData({ courses: 4, seed: 6 }, "manual"),
    );

    assert(summary.deletedKeys > 0);
    assertEquals(summary.courses, 4);
    const courses = await listCourses();
    assertEquals(courses.length, 4);
    assert(
      courses.every((course) => course.id.startsWith(DEMO_COURSE_ID_PREFIX)),
    );
    assertEquals((await kv.get(["sessions", "visitor-session"])).value, null);
    assertEquals((await kv.get(["courses", "visitor-course"])).value, null);

    const state = await getDemoResetState();
    assert(state);
    assertEquals(state.trigger, "manual");
    assertEquals(state.courses, 4);
    assertEquals((await getPublicHomeSnapshot()).courses.length > 0, true);
    for (const account of DEMO_ACCOUNTS) {
      assert(await getUserByEmail(account.email));
    }
  } finally {
    await cleanup();
  }
});

Deno.test("resetDemoData refuses to run without DEMO_MODE", async () => {
  const { cleanup } = await setupKvTest("demo-reset-refuse-");
  try {
    await upsertCourse(sampleCourse());
    await withDemoMode(false, async () => {
      await assertRejects(() => resetDemoData(), DemoModeDisabledError);
    });
    assertEquals((await listCourses()).length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("ensureDemoDataOnBoot seeds once and is idempotent", async () => {
  const { cleanup } = await setupKvTest("demo-boot-");
  try {
    assertEquals(
      await withDemoMode(false, () => ensureDemoDataOnBoot()),
      "skipped",
    );
    assertEquals(
      await withDemoMode(true, () => ensureDemoDataOnBoot()),
      "seeded",
    );
    const count = (await listCourses()).length;
    assert(count > 0);
    assertEquals(
      await withDemoMode(true, () => ensureDemoDataOnBoot()),
      "present",
    );
    assertEquals((await listCourses()).length, count);
  } finally {
    await cleanup();
  }
});

function adminApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("sessionUser", {
      id: "admin-1",
      email: "admin@example.org",
      role: "super_admin",
    });
    await next();
  });
  return app;
}

Deno.test("DEMO_MODE blocks course deletion server-side", async () => {
  const { cleanup } = await setupKvTest("demo-guard-course-");
  try {
    await upsertCourse(sampleCourse());
    const app = adminApp();
    app.route("/", adminCoursesDeleteRoute);
    const response = await withDemoMode(
      true,
      async () =>
        await app.request("/course-demo-test/delete", { method: "POST" }),
    );
    assertEquals(response.status, 303);
    const location = response.headers.get("location") ?? "";
    assert(location.includes("course_error="));
    assert(decodeURIComponent(location).includes("Demo-Modus"));
    assertEquals((await listCourses()).length, 1);

    const allowed = await withDemoMode(
      false,
      async () =>
        await app.request("/course-demo-test/delete", { method: "POST" }),
    );
    assertEquals(
      allowed.headers.get("location"),
      "/admin/courses?course_deleted=1",
    );
    assertEquals((await listCourses()).length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("DEMO_MODE blocks user deletion server-side", async () => {
  const { cleanup } = await setupKvTest("demo-guard-user-");
  try {
    const target = await createUserFromEmail(
      "other-admin@example.org",
      "admin",
    );
    const app = adminApp();
    app.route("/", adminUsersDeleteRoute);
    const response = await withDemoMode(
      true,
      async () => await app.request(`/${target.id}/delete`, { method: "POST" }),
    );
    assertEquals(response.status, 303);
    assertEquals(
      response.headers.get("location"),
      "/admin/users?error=demo_mode",
    );
    assert(await getUserByEmail("other-admin@example.org"));
  } finally {
    await cleanup();
  }
});

Deno.test("cron schedule parser describes and predicts resets", () => {
  const now = new Date("2026-09-11T20:07:30.000Z");

  const every30 = parseCronSchedule("*/30 * * * *");
  assert(every30);
  assertEquals(describeCronSchedule(every30), "alle 30 Minuten");
  assertEquals(cronIntervalMinutes(every30), 30);
  assertEquals(
    nextCronRun(every30, now)?.toISOString(),
    "2026-09-11T20:30:00.000Z",
  );

  const hourly = parseCronSchedule("0 * * * *");
  assert(hourly);
  assertEquals(describeCronSchedule(hourly), "jede volle Stunde");
  assertEquals(cronIntervalMinutes(hourly), 60);
  assertEquals(
    nextCronRun(hourly, now)?.toISOString(),
    "2026-09-11T21:00:00.000Z",
  );

  const every6h = parseCronSchedule("0 */6 * * *");
  assert(every6h);
  assertEquals(describeCronSchedule(every6h), "alle 6 Stunden");
  assertEquals(cronIntervalMinutes(every6h), 360);
  assertEquals(
    nextCronRun(every6h, now)?.toISOString(),
    "2026-09-12T00:00:00.000Z",
  );

  const daily = parseCronSchedule("0 3 * * *");
  assert(daily);
  assertEquals(describeCronSchedule(daily), "täglich um 03:00 Uhr (UTC)");
  assertEquals(cronIntervalMinutes(daily), 1440);
  assertEquals(
    nextCronRun(daily, now)?.toISOString(),
    "2026-09-12T03:00:00.000Z",
  );

  const weekly = parseCronSchedule("30 8 * * 1");
  assert(weekly);
  assertEquals(describeCronSchedule(weekly), "Montag um 08:30 Uhr (UTC)");
  assertEquals(
    nextCronRun(weekly, now)?.toISOString(),
    "2026-09-14T08:30:00.000Z",
  );

  assertEquals(parseCronSchedule("*/30 * * *"), null);
  assertEquals(parseCronSchedule("61 * * * *"), null);
  assertEquals(parseCronSchedule("abc"), null);

  assertEquals(
    formatCountdown(new Date("2026-09-11T20:30:00.000Z"), now),
    "in 22 Minuten",
  );
  assertEquals(
    formatCountdown(new Date("2026-09-11T22:08:00.000Z"), now),
    "in 2 Stunden",
  );
  assertEquals(
    formatCountdown(new Date("2026-09-13T21:08:00.000Z"), now),
    "in 2 Tagen 1 Stunde",
  );
  assertEquals(
    formatCountdown(new Date("2026-09-11T20:08:00.000Z"), now),
    "in unter einer Minute",
  );
});

Deno.test("getDemoResetInfo reflects DEMO_MODE and the configured cron", async () => {
  const previousCron = env.demoModeResetCron;
  try {
    (env as { demoModeResetCron: string }).demoModeResetCron = "*/15 * * * *";
    const enabled = await withDemoMode(
      true,
      () => Promise.resolve(getDemoResetInfo()),
    );
    assertEquals(enabled.enabled, true);
    assertEquals(enabled.description, "alle 15 Minuten");
    assertEquals(enabled.intervalMinutes, 15);
    assert(enabled.countdown?.startsWith("in "));
    const disabled = await withDemoMode(
      false,
      () => Promise.resolve(getDemoResetInfo()),
    );
    assertEquals(disabled.enabled, false);
    (env as { demoModeResetCron: string }).demoModeResetCron = "off";
    const off = await withDemoMode(
      true,
      () => Promise.resolve(getDemoResetInfo()),
    );
    assertEquals(off.enabled, false);
  } finally {
    (env as { demoModeResetCron: string }).demoModeResetCron = previousCron;
  }
});
