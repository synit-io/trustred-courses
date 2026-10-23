import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { Hono } from "hono";
import {
  deleteCourseById,
  getCourseById,
  upsertCourse,
} from "../lib/courses/repository.ts";
import { env } from "../lib/env.ts";
import {
  __setEmailSenderForTests,
  processEmailOutboxBatch,
} from "../lib/email/service.ts";
import { __setKvFactoryForTests } from "../lib/kv/client.ts";
import { savePendingPaidRegistration } from "../lib/payments/paypal.ts";
import {
  createRegistration,
  getRegistrationById,
  listRegistrationsByCourse,
} from "../lib/registrations/repository.ts";
import {
  applyRegistrationAction,
  confirmRegistrationDoubleOptIn,
  reissueRegistrationDoubleOptIn,
  submitRegistrationWithDoubleOptIn,
} from "../lib/registrations/service.ts";
import type {
  Course,
  EmailOutboxJob,
  Registration,
  RegistrationDoubleOptInToken,
} from "../lib/types.ts";
import type { AppEnv } from "../src/app/context.ts";
import { adminCoursesDeleteRoute } from "../src/routes/api/admin/courses/[id]/delete/route.ts";
import { registrationResendConfirmationRoute } from "../src/routes/api/registrations/resend-confirmation/route.ts";
import { setupKvTest } from "./test_utils.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => resolve = done);
  return { resolve, promise };
}
function course(): Course {
  return {
    id: "integrity-course",
    title: "Course",
    description: "Description",
    location: "Berlin",
    startsAt: "2099-01-01T08:00:00.000Z",
    endsAt: "2099-01-01T17:00:00.000Z",
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity: 1,
    waitingListEnabled: true,
    reminderDaysBefore: null,
    status: "active",
    createdAt: new Date().toISOString(),
  };
}
function input(email = "person@example.org") {
  return {
    courseId: course().id,
    firstName: "First",
    lastName: "Last",
    street: "Street",
    houseNumber: "1",
    postalCode: "10115",
    city: "Berlin",
    email,
    phone: "",
    consentAccepted: true,
  };
}
function registration(id: string): Registration {
  const now = new Date().toISOString();
  return {
    ...input(`${id}@example.org`),
    id,
    status: "pending_review",
    waitingListPosition: null,
    submittedAt: now,
    doubleOptInRequestedAt: now,
    doubleOptInConfirmedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    adminMessage: null,
    internalNotes: null,
  };
}
function token(url: string): string {
  return new URL(url).searchParams.get("token")!;
}

async function setup() {
  const context = await setupKvTest("registration-integrity-");
  __setEmailSenderForTests(() => Promise.resolve({ ok: true }));
  await upsertCourse(course());
  return {
    ...context,
    cleanup: async () => {
      __setEmailSenderForTests(null);
      await context.cleanup();
    },
  };
}

Deno.test("expired real course lease cannot commit a stale capacity approval", async () => {
  const { kv, cleanup } = await setup();
  const scanned = deferred();
  const release = deferred();
  let intercept = true;
  try {
    await createRegistration(registration("first"));
    await createRegistration(registration("second"));
    const proxy = new Proxy(kv, {
      get(target, property) {
        if (property === "list") {
          return (
            selector: Deno.KvListSelector,
            options?: Deno.KvListOptions,
          ) => {
            const iterable = target.list(selector, options);
            if (
              intercept && "prefix" in selector &&
              JSON.stringify(selector.prefix) ===
                JSON.stringify(["registrations_by_course", course().id])
            ) {
              intercept = false;
              return (async function* () {
                for await (const entry of iterable) yield entry;
                scanned.resolve();
                await release.promise;
              })();
            }
            return iterable;
          };
        }
        const member = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    __setKvFactoryForTests(() => Promise.resolve(proxy));
    const first = applyRegistrationAction({
      registrationId: "first",
      action: "approve",
      actorUserId: "admin",
    });
    const firstOutcome = first.then(() => null, (error) => error);
    await scanned.promise;
    const lease = await kv.get<{ expiresAt: number }>([
      "locks",
      "registration_course",
      course().id,
    ]);
    assert(lease.value);
    await assertRejects(() =>
      applyRegistrationAction({
        registrationId: "second",
        action: "approve",
        actorUserId: "admin",
      })
    );
    await new Promise((done) =>
      setTimeout(done, Math.max(0, lease.value!.expiresAt - Date.now() + 100))
    );
    const second = await applyRegistrationAction({
      registrationId: "second",
      action: "approve",
      actorUserId: "admin",
    });
    assertEquals(second.next.status, "approved");
    release.resolve();
    assert(await firstOutcome instanceof Error);
    assertEquals(
      (await listRegistrationsByCourse(course().id)).filter((entry) =>
        entry.status === "approved"
      ).length,
      1,
    );
    assertEquals(
      (await getRegistrationById("first"))?.status,
      "pending_review",
    );
  } finally {
    release.resolve();
    await cleanup();
  }
});

Deno.test("expired paid DOI reissues on the same record through the public endpoint without another charge", async () => {
  const { kv, cleanup } = await setup();
  const previousHeader = env.trustedClientIpHeader;
  env.trustedClientIpHeader = "";
  let providerCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    providerCalls++;
    throw new Error("must not contact payment provider");
  };
  try {
    const submitted = await submitRegistrationWithDoubleOptIn(input(), {
      provider: "paypal",
      captureId: "paid-capture",
      amountCents: 1000,
      currency: "EUR",
      paidAt: new Date().toISOString(),
    });
    for await (
      const entry of kv.list<RegistrationDoubleOptInToken>({
        prefix: ["registration_optin_tokens"],
      })
    ) {
      await kv.set(entry.key, {
        ...entry.value,
        expiresAt: "2020-01-01T00:00:00.000Z",
      });
    }
    await kv.set(["registrations", submitted.registration.id], {
      ...submitted.registration,
      doubleOptInRequestedAt: "2020-01-01T00:00:00.000Z",
    });
    assertEquals(
      await confirmRegistrationDoubleOptIn(token(submitted.confirmationUrl)),
      null,
    );
    const links: string[] = [];
    __setEmailSenderForTests((_recipient, _subject, text) => {
      const match = text.match(
        /https?:\/\/\S+\/api\/registrations\/confirm\?token=\S+/,
      );
      if (match) links.push(match[0]);
      return Promise.resolve({ ok: true });
    });
    const app = new Hono<AppEnv>().route(
      "/resend",
      registrationResendConfirmationRoute,
    );
    const post = (email: string) =>
      app.request("/resend", {
        method: "POST",
        body: new URLSearchParams({ courseId: course().id, email }),
      }, { remoteAddr: { hostname: "192.0.2.1" } });
    const unavailable = await app.request("/resend", {
      method: "POST",
      body: new URLSearchParams({
        courseId: course().id,
        email: "person@example.org",
      }),
    });
    assertStringIncludes(unavailable.headers.get("Location")!, "doi_resent=1");
    assertEquals(links.length, 0);
    const response = await post(" PERSON@EXAMPLE.ORG ");
    assertStringIncludes(response.headers.get("Location")!, "doi_resent=1");
    assertEquals(links.length, 1);
    assertEquals(
      await confirmRegistrationDoubleOptIn(token(submitted.confirmationUrl)),
      null,
    );
    const activated = await confirmRegistrationDoubleOptIn(token(links[0]));
    assertEquals(activated?.id, submitted.registration.id);
    assertEquals(activated?.paymentCaptureId, "paid-capture");
    assertEquals((await listRegistrationsByCourse(course().id)).length, 1);
    assertEquals(providerCalls, 0);
    assertStringIncludes(
      (await post("unknown@example.org")).headers.get("Location")!,
      "doi_resent=1",
    );
    assertEquals(
      (await reissueRegistrationDoubleOptIn(course().id, "person@example.org"))
        .length,
      0,
    );
  } finally {
    globalThis.fetch = previousFetch;
    env.trustedClientIpHeader = previousHeader;
    await cleanup();
  }
});

Deno.test("confirmation commits participant and administrator mail before a postcommit dispatch failure", async () => {
  const { kv, cleanup } = await setup();
  const oldRecipient = env.mailAdminNotificationTo;
  env.mailAdminNotificationTo = "admin@example.org";
  try {
    const submitted = await submitRegistrationWithDoubleOptIn(input());
    let failDispatch = true;
    const proxy = new Proxy(kv, {
      get(target, property) {
        if (property === "list") {
          return (
            selector: Deno.KvListSelector,
            options?: Deno.KvListOptions,
          ) => {
            if (
              failDispatch && "prefix" in selector &&
              selector.prefix[0] === "email_outbox"
            ) {
              failDispatch = false;
              throw new Error("simulated failure before outbox dispatch");
            }
            return target.list(selector, options);
          };
        }
        const member = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    __setKvFactoryForTests(() => Promise.resolve(proxy));
    await assertRejects(() =>
      confirmRegistrationDoubleOptIn(token(submitted.confirmationUrl))
    );
    assertEquals(
      (await getRegistrationById(submitted.registration.id))?.status,
      "pending_review",
    );
    const queued: EmailOutboxJob[] = [];
    for await (
      const entry of kv.list<EmailOutboxJob>({ prefix: ["email_outbox"] })
    ) queued.push(entry.value);
    assertEquals(queued.map((job) => job.templateKey).sort(), [
      "admin_new_registration",
      "registration_received",
    ]);
    // Simulate restart; both durable intents were written before dispatch began.
    __setKvFactoryForTests(() => Promise.resolve(kv));
    for (const job of queued) {
      await kv.set(["email_outbox", job.id], {
        ...job,
        leaseOwner: null,
        leaseExpiresAt: null,
      });
    }
    const delivered: string[] = [];
    __setEmailSenderForTests((recipient) => {
      delivered.push(recipient);
      return Promise.resolve({ ok: true });
    });
    await processEmailOutboxBatch();
    assertEquals(delivered.sort(), ["admin@example.org", "person@example.org"]);
    assertEquals(
      await confirmRegistrationDoubleOptIn(token(submitted.confirmationUrl)),
      null,
    );
    await processEmailOutboxBatch();
    assertEquals(delivered.length, 2);
  } finally {
    env.mailAdminNotificationTo = oldRecipient;
    await cleanup();
  }
});

function pauseCourseDeletion(
  kv: Deno.Kv,
  paused: ReturnType<typeof deferred>,
  release: ReturnType<typeof deferred>,
  watchedPrefix = "courses",
  watchedMethod = "delete",
) {
  let intercept = true;
  return new Proxy(kv, {
    get(target, property) {
      if (property === "atomic") {
        return () => {
          const tx = target.atomic();
          let deletesCourse = false;
          const wrapped = new Proxy(tx, {
            get(transaction, method) {
              if (method === watchedMethod) {
                return (key: Deno.KvKey, ...args: unknown[]) => {
                  if (key[0] === watchedPrefix) deletesCourse = true;
                  const operation = Reflect.get(
                    transaction,
                    method,
                    transaction,
                  );
                  operation.apply(transaction, [key, ...args]);
                  return wrapped;
                };
              }
              if (method === "commit") {
                return async () => {
                  if (deletesCourse && intercept) {
                    intercept = false;
                    paused.resolve();
                    await release.promise;
                  }
                  return await transaction.commit();
                };
              }
              const member = Reflect.get(transaction, method, transaction);
              if (typeof member !== "function") return member;
              return (...args: unknown[]) => {
                const result = member.apply(transaction, args);
                return result === transaction ? wrapped : result;
              };
            },
          });
          return wrapped;
        };
      }
      const member = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

Deno.test("course deletion racing a submitted registration is rejected by the final transaction", async () => {
  const { kv, cleanup } = await setup();
  const paused = deferred();
  const release = deferred();
  try {
    __setKvFactoryForTests(() =>
      Promise.resolve(pauseCourseDeletion(kv, paused, release))
    );
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", {
        id: "admin",
        email: "admin@example.org",
        role: "admin",
      });
      await next();
    });
    app.route("/courses", adminCoursesDeleteRoute);
    const deleting = app.request(`/courses/${course().id}/delete`, {
      method: "POST",
    });
    await paused.promise;
    const submitted = await submitRegistrationWithDoubleOptIn(input());
    release.resolve();
    assertStringIncludes(
      (await deleting).headers.get("Location")!,
      "course_error=",
    );
    assert(await getCourseById(course().id));
    assertEquals(
      (await getRegistrationById(submitted.registration.id))?.status,
      "submitted",
    );
    assert(
      await confirmRegistrationDoubleOptIn(token(submitted.confirmationUrl)),
    );
  } finally {
    release.resolve();
    await cleanup();
  }
});

Deno.test("course deletion racing checkout reservation preserves its course and deletion winning rejects new references", async () => {
  const { kv, cleanup } = await setup();
  const paused = deferred();
  const release = deferred();
  try {
    __setKvFactoryForTests(() =>
      Promise.resolve(pauseCourseDeletion(kv, paused, release))
    );
    await upsertCourse({
      ...course(),
      pricingType: "paid",
      feeAmountCents: 1000,
      feeCurrency: "EUR",
    });
    const deleting = deleteCourseById(course().id);
    await paused.promise;
    await savePendingPaidRegistration({
      id: "pending",
      courseId: course().id,
      registrationInput: input(),
      paypalOrderId: "order",
      status: "checkout_created",
      registrationId: "paid-registration",
      confirmationToken: "token",
      feeAmountCents: 1000,
      feeCurrency: "EUR",
      createdAt: new Date().toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    release.resolve();
    assertEquals(await deleting, false);
    assert(await getCourseById(course().id));
    const emptyCourse = { ...course(), id: "empty" };
    await upsertCourse(emptyCourse);
    assertEquals(await deleteCourseById(emptyCourse.id), true);
    await assertRejects(() =>
      submitRegistrationWithDoubleOptIn({
        ...input(),
        courseId: emptyCourse.id,
      })
    );
    await assertRejects(() =>
      savePendingPaidRegistration({
        id: "other",
        courseId: emptyCourse.id,
        registrationInput: { ...input(), courseId: emptyCourse.id },
        paypalOrderId: "order-other",
        status: "checkout_created",
        registrationId: "other-registration",
        confirmationToken: "token",
        feeAmountCents: 1000,
        feeCurrency: "EUR",
        createdAt: new Date().toISOString(),
        expiresAt: "2099-01-01T00:00:00.000Z",
      })
    );
  } finally {
    release.resolve();
    await cleanup();
  }
});

Deno.test("deletion that commits before a paused registration or checkout write rejects the new reference", async () => {
  const { kv, cleanup } = await setup();
  let mailCalls = 0;
  __setEmailSenderForTests(() => {
    mailCalls++;
    return Promise.resolve({ ok: true });
  });
  try {
    for (const kind of ["registration", "checkout"] as const) {
      const paused = deferred();
      const release = deferred();
      const currentCourse = {
        ...course(),
        id: `delete-first-${kind}`,
        pricingType: "paid" as const,
        feeAmountCents: 1000,
        feeCurrency: "EUR",
      };
      __setKvFactoryForTests(() => Promise.resolve(kv));
      await upsertCourse(currentCourse);
      __setKvFactoryForTests(() =>
        Promise.resolve(
          pauseCourseDeletion(
            kv,
            paused,
            release,
            kind === "registration"
              ? "registrations"
              : "pending_paid_registrations",
            "set",
          ),
        )
      );
      const data = { ...input(), courseId: currentCourse.id };
      const creation = kind === "registration"
        ? submitRegistrationWithDoubleOptIn(data)
        : savePendingPaidRegistration({
          id: "checkout-rejected",
          courseId: currentCourse.id,
          registrationInput: data,
          paypalOrderId: "order",
          status: "checkout_created",
          registrationId: "new-registration",
          confirmationToken: "token",
          feeAmountCents: 1000,
          feeCurrency: "EUR",
          createdAt: new Date().toISOString(),
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      const outcome = creation.then(() => null, (error) => error);
      await paused.promise;
      assertEquals(await deleteCourseById(currentCourse.id), true);
      release.resolve();
      assert(await outcome instanceof Error);
      assertEquals(await getCourseById(currentCourse.id), null);
      assertEquals(
        (await listRegistrationsByCourse(currentCourse.id)).length,
        0,
      );
      assertEquals(
        (await kv.get(["pending_paid_registrations", "checkout-rejected"]))
          .value,
        null,
      );
    }
    assertEquals(mailCalls, 0);
  } finally {
    await cleanup();
  }
});
