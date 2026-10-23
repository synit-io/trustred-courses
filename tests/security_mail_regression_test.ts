import { assert, assertEquals } from "@std/assert";
import { Hono } from "hono";
import { validatedDebugLink } from "../lib/auth/debug_links.ts";
import { upsertCourse } from "../lib/courses/repository.ts";
import { env } from "../lib/env.ts";
import { parseMailbox } from "../lib/email/mailbox.ts";
import {
  enqueueEmailOutbox,
  listDueEmailOutbox,
  listEmailOutboxHealth,
} from "../lib/email/repository.ts";
import {
  __setEmailSenderForTests,
  EMAIL_OUTBOX_MAX_ATTEMPTS,
  processCourseReminders,
  processEmailOutboxBatch,
} from "../lib/email/service.ts";
import { createRegistration } from "../lib/registrations/repository.ts";
import {
  confirmRegistrationDoubleOptIn,
  reissueRegistrationDoubleOptIn,
  submitRegistrationWithDoubleOptIn,
} from "../lib/registrations/service.ts";
import type { Course, EmailOutboxJob, Registration } from "../lib/types.ts";
import { getUserByEmail, listUsers } from "../lib/users/repository.ts";
import type { AppEnv } from "../src/app/context.ts";
import { registerGlobalMiddleware } from "../src/app/middleware.tsx";
import { adminLoginPage } from "../src/routes/(site)/auth/login/page.tsx";
import { courseDetailsPage } from "../src/routes/(site)/courses/[courseId]/page.tsx";
import { adminUsersCreateRoute } from "../src/routes/api/admin/users/create/route.ts";
import { adminUsersDeleteRoute } from "../src/routes/api/admin/users/[id]/delete/route.ts";
import { setupKvTest } from "./test_utils.ts";

function courseFixture(): Course {
  return {
    id: "mail-course",
    title: "Mail course",
    description: "Course",
    location: "Berlin",
    startsAt: "2026-10-25T08:00:00.000Z",
    endsAt: "2026-10-25T10:00:00.000Z",
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity: 20,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function registrationFixture(): Registration {
  return {
    id: "mail-registration",
    courseId: "mail-course",
    firstName: "Alice",
    lastName: "Test",
    street: "Street",
    houseNumber: "1",
    postalCode: "10115",
    city: "Berlin",
    email: "alice@example.org",
    phone: "",
    status: "approved",
    waitingListPosition: null,
    consentAccepted: true,
    submittedAt: "2026-01-01T00:00:00.000Z",
    doubleOptInRequestedAt: "2026-01-01T00:00:00.000Z",
    doubleOptInConfirmedAt: "2026-01-01T00:00:00.000Z",
    reviewedAt: null,
    reviewedBy: null,
    adminMessage: null,
    internalNotes: null,
  };
}

function jobFixture(id: string): Omit<EmailOutboxJob, "id" | "createdAt"> {
  return {
    registrationId: id,
    templateKey: "approved",
    recipientEmail: `${id}@example.org`,
    subject: id,
    text: id,
    html: id,
    attempt: 0,
    nextAttemptAt: "2020-01-01T00:00:00.000Z",
    lastError: null,
  };
}

Deno.test("plain mailbox validation rejects parser aliases and retains supported address distinctions", () => {
  for (
    const invalid of [
      "x<victim@example.org>",
      "victim@example.org(comment)",
      "a@example.org,b@example.org",
      '"victim"@example.org',
      "Group:victim@example.org;",
      "a..b@example.org",
      "a@-example.org",
      "a@example.org\r\nbcc:other@example.org",
      "a@exämple.org",
    ]
  ) assertEquals(parseMailbox(invalid), null, invalid);
  assertEquals(
    parseMailbox(" Alice.Tag+Course@Example.ORG "),
    "alice.tag+course@example.org",
  );
  assertEquals(parseMailbox("alice.tag@example.org"), "alice.tag@example.org");
  assertEquals(parseMailbox("alicetag@example.org"), "alicetag@example.org");
});

Deno.test("concurrent authorized user creation reuses winner and legacy duplicate deletion preserves email owner", async () => {
  const { kv, cleanup } = await setupKvTest("mail-users-");
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("sessionUser", {
      id: "actor",
      email: "actor@example.org",
      role: "super_admin",
    });
    await next();
  });
  app.route("/create", adminUsersCreateRoute);
  app.route("/users", adminUsersDeleteRoute);
  try {
    const create = (email: string) =>
      app.request("/create", {
        method: "POST",
        body: new URLSearchParams({ email, role: "admin" }),
      });
    assertEquals((await create("display<user@example.org>")).status, 400);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => create("User@Example.org")),
    );
    assert(responses.every((response) => response.status === 303));
    assertEquals((await listUsers()).length, 1);
    const owner = await getUserByEmail("user@example.org");
    assert(owner);
    await kv.set(["users", "legacy-duplicate"], {
      ...owner,
      id: "legacy-duplicate",
    });
    const deleted = await app.request("/users/legacy-duplicate/delete", {
      method: "POST",
    });
    assertEquals(deleted.headers.get("location"), "/admin/users?deleted=1");
    assertEquals((await getUserByEmail("USER@example.org"))?.id, owner.id);
    assertEquals((await listUsers()).length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("outbox worker stops after lease takeover without dispatching its unstarted batch", async () => {
  const { kv, cleanup } = await setupKvTest("mail-lease-takeover-");
  const sends: string[] = [];
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => release = resolve);
  const started = new Promise<void>((resolve) => entered = resolve);
  __setEmailSenderForTests(async (_recipient, subject) => {
    sends.push(subject);
    if (sends.length === 1) {
      entered();
      await blocked;
    }
    return { ok: true };
  });
  try {
    await enqueueEmailOutbox(jobFixture("first"));
    await enqueueEmailOutbox(jobFixture("second"));
    const staleWorker = processEmailOutboxBatch(2);
    await started;
    assertEquals(await processEmailOutboxBatch(2), 1); // unleased second job may progress
    for await (
      const entry of kv.list<EmailOutboxJob>({ prefix: ["email_outbox"] })
    ) {
      await kv.set(entry.key, {
        ...entry.value,
        leaseExpiresAt: "2000-01-01T00:00:00.000Z",
      });
    }
    assertEquals(await processEmailOutboxBatch(2), 1);
    release();
    assertEquals(await staleWorker, 1);
    assertEquals(sends.length, 3); // in-flight SMTP is at-least-once; no stale second dispatch
    assertEquals((await listDueEmailOutbox(new Date("2099-01-01"))).length, 0);
  } finally {
    release();
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("outbox preserves ordinary retry and keeps terminal failure as a dead letter", async () => {
  const { cleanup } = await setupKvTest("mail-dead-letter-");
  __setEmailSenderForTests(() =>
    Promise.resolve({ ok: false, error: "offline" })
  );
  try {
    await enqueueEmailOutbox(jobFixture("retry"));
    assertEquals(await processEmailOutboxBatch(20), 1);
    assertEquals((await listEmailOutboxHealth()).pending, 1);
    for (let index = 1; index < EMAIL_OUTBOX_MAX_ATTEMPTS; index++) {
      await processEmailOutboxBatch(1, new Date("2099-01-01"));
    }
    const health = await listEmailOutboxHealth();
    assertEquals(health.pending, 0);
    assertEquals(health.deadLetters, 1);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

for (const legacy of [false, true]) {
  Deno.test(`DOI resend suppresses superseded ${legacy ? "legacy" : "current"} queued links`, async () => {
    const { kv, cleanup } = await setupKvTest("mail-doi-rotation-");
    const texts: string[] = [];
    __setEmailSenderForTests((_recipient, _subject, text) => {
      texts.push(text);
      return Promise.resolve(
        texts.length === 1 ? { ok: false, error: "offline" } : { ok: true },
      );
    });
    try {
      await upsertCourse({
        ...courseFixture(),
        startsAt: "2099-01-01T08:00:00Z",
      });
      const original = await submitRegistrationWithDoubleOptIn({
        ...registrationFixture(),
        consentAccepted: true,
      });
      for await (
        const entry of kv.list<EmailOutboxJob>({ prefix: ["email_outbox"] })
      ) {
        if (legacy) {
          await kv.set(entry.key, {
            ...entry.value,
            confirmationTokenHash: undefined,
          });
        }
      }
      await kv.set(["registrations", original.registration.id], {
        ...original.registration,
        doubleOptInRequestedAt: "2000-01-01T00:00:00Z",
      });
      const [replacement] = await reissueRegistrationDoubleOptIn(
        original.registration.courseId,
        original.registration.email,
      );
      assert(replacement);
      assertEquals(texts.length, 2);
      assert(texts[1].includes(replacement));
      await processEmailOutboxBatch(20, new Date(Date.now() + 180_000));
      assertEquals(texts.length, 2);
      assertEquals(
        (await listDueEmailOutbox(new Date("2099-01-01"))).length,
        0,
      );
      const oldToken = new URL(original.confirmationUrl).searchParams.get(
        "token",
      )!;
      assertEquals(await confirmRegistrationDoubleOptIn(oldToken), null);
      assert(
        await confirmRegistrationDoubleOptIn(
          new URL(replacement).searchParams.get("token")!,
        ),
      );
    } finally {
      __setEmailSenderForTests(null);
      await cleanup();
    }
  });
}

Deno.test("a valid legacy DOI outbox retry still delivers its current token", async () => {
  const { kv, cleanup } = await setupKvTest("mail-doi-legacy-");
  let sends = 0;
  __setEmailSenderForTests(() =>
    Promise.resolve(
      ++sends === 1 ? { ok: false, error: "offline" } : { ok: true },
    )
  );
  try {
    await upsertCourse({
      ...courseFixture(),
      startsAt: "2099-01-01T08:00:00Z",
    });
    const original = await submitRegistrationWithDoubleOptIn({
      ...registrationFixture(),
      consentAccepted: true,
    });
    for await (
      const entry of kv.list<EmailOutboxJob>({ prefix: ["email_outbox"] })
    ) {
      await kv.set(entry.key, {
        ...entry.value,
        confirmationTokenHash: undefined,
      });
    }
    // Pre-upgrade registrations also lacked the current-token pointer.
    await kv.delete(["registration_optin_current", original.registration.id]);
    assertEquals(
      await processEmailOutboxBatch(20, new Date(Date.now() + 180_000)),
      1,
    );
    assertEquals(sends, 2);
    assertEquals((await listDueEmailOutbox(new Date("2099-01-01"))).length, 0);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

for (
  const change of [
    "cancelled",
    "rescheduled",
    "archived",
    "still-approved",
  ] as const
) {
  Deno.test(`reminder retry revalidates ${change} attendance and schedule`, async () => {
    const { kv, cleanup } = await setupKvTest("mail-reminder-eligibility-");
    let sends = 0;
    __setEmailSenderForTests(() =>
      Promise.resolve(
        ++sends === 1 ? { ok: false, error: "offline" } : { ok: true },
      )
    );
    try {
      const course = courseFixture();
      const registration = registrationFixture();
      await upsertCourse(course);
      await createRegistration(registration);
      assertEquals(
        await processCourseReminders(new Date("2026-10-23T07:00:00Z")),
        1,
      );
      assertEquals(sends, 1);
      if (change === "cancelled") {
        await kv.set(["registrations", registration.id], {
          ...registration,
          status: "cancelled",
        });
      }
      if (change === "rescheduled") {
        await upsertCourse({ ...course, startsAt: "2026-10-26T08:00:00Z" });
      }
      if (change === "archived") {
        await upsertCourse({ ...course, status: "archived" });
      }
      // Bring the ordinary generated retry due without altering eligibility time.
      for await (
        const entry of kv.list<EmailOutboxJob>({ prefix: ["email_outbox"] })
      ) {
        await kv.set(entry.key, {
          ...entry.value,
          nextAttemptAt: "2026-10-23T07:02:00Z",
        });
      }
      assertEquals(
        await processEmailOutboxBatch(10, new Date("2026-10-23T07:03:00Z")),
        1,
      );
      assertEquals(sends, change === "still-approved" ? 2 : 1);
      assertEquals(
        (await listDueEmailOutbox(new Date("2099-01-01"))).length,
        0,
      );
    } finally {
      __setEmailSenderForTests(null);
      await cleanup();
    }
  });
}

Deno.test("reminders use calendar days across the Berlin daylight-saving transition", async () => {
  const { cleanup } = await setupKvTest("mail-reminder-dst-");
  let sends = 0;
  __setEmailSenderForTests(() => {
    sends++;
    return Promise.resolve({ ok: true });
  });
  try {
    await upsertCourse({
      ...courseFixture(),
      startsAt: "2026-03-30T22:30:00Z",
      reminderDaysBefore: 2,
    });
    await createRegistration(registrationFixture());
    // Start is Tuesday 00:30 CEST. Its two-day reminder is Sunday, although
    // subtracting 48 hours would produce Saturday 23:30 CET.
    assertEquals(
      await processCourseReminders(new Date("2026-03-29T10:00:00Z")),
      1,
    );
    assertEquals(sends, 1);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});

Deno.test("production pages reject query debug links while local pages accept only expected application links", async () => {
  const { cleanup } = await setupKvTest("mail-debug-pages-");
  const previous = {
    base: env.appBaseUrl,
    debug: env.authDevExposeMagicLink,
    node: Deno.env.get("NODE_ENV"),
    demo: Deno.env.get("DEMO_MODE"),
    deploy: Deno.env.get("DENO_DEPLOYMENT_ID"),
  };
  const app = new Hono<AppEnv>();
  registerGlobalMiddleware(app);
  app.route("/admin", adminLoginPage);
  app.route("/courses", courseDetailsPage);
  try {
    await upsertCourse(courseFixture());
    Deno.env.set("DEMO_MODE", "false");
    Deno.env.set("NODE_ENV", "production");
    env.appBaseUrl = "https://courses.example.org";
    env.authDevExposeMagicLink = false;
    for (
      const value of [
        "https://attacker.example/login?token=x",
        "https://courses.example.org/api/auth/magic-link/verify?token=x",
      ]
    ) {
      const login = await (await app.request(
        `/admin/login?debug=${encodeURIComponent(value)}`,
      )).text();
      const course = await (await app.request(
        `/courses/mail-course?doi_sent=1&confirm_debug=${
          encodeURIComponent(value)
        }`,
      )).text();
      assert(!login.includes("Jetzt einloggen"));
      assert(!course.includes("Dev-Link zur Bestätigung"));
      assert(!login.includes("attacker.example"));
      assert(!course.includes("attacker.example"));
    }
    env.appBaseUrl = "http://localhost:8000";
    env.authDevExposeMagicLink = true;
    Deno.env.delete("NODE_ENV");
    Deno.env.delete("DENO_DEPLOYMENT_ID");
    const valid =
      "http://localhost:8000/api/auth/magic-link/verify?token=valid";
    assertEquals(
      validatedDebugLink(valid, "/api/auth/magic-link/verify"),
      valid,
    );
    for (
      const invalid of [
        "//attacker.example/api/auth/magic-link/verify?token=x",
        "http://a@localhost:8000/api/auth/magic-link/verify?token=x",
        "/api/auth/logout?token=x",
        "/api/auth/magic-link/verify",
      ]
    ) {
      assertEquals(
        validatedDebugLink(invalid, "/api/auth/magic-link/verify"),
        null,
      );
    }
    const login = await (await app.request(
      `/admin/login?debug=${encodeURIComponent(valid)}`,
    )).text();
    assert(login.includes("Jetzt einloggen"));
    const confirm =
      "http://localhost:8000/api/registrations/confirm?token=valid";
    const course = await (await app.request(
      `/courses/mail-course?doi_sent=1&confirm_debug=${
        encodeURIComponent(confirm)
      }`,
    )).text();
    assert(course.includes("Dev-Link zur Bestätigung"));
    assert(course.includes('action="/api/registrations/resend-confirmation"'));
  } finally {
    env.appBaseUrl = previous.base;
    env.authDevExposeMagicLink = previous.debug;
    for (
      const [key, value] of [["NODE_ENV", previous.node], [
        "DEMO_MODE",
        previous.demo,
      ], ["DENO_DEPLOYMENT_ID", previous.deploy]]
    ) {
      if (value === undefined) Deno.env.delete(key!);
      else Deno.env.set(key!, value);
    }
    await cleanup();
  }
});
