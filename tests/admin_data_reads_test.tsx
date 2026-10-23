import { assert, assertEquals } from "@std/assert";
import { Hono } from "hono";
import { getCourseSummaryById } from "../lib/admin/course_summaries.ts";
import { queryRegistrationRows } from "../lib/admin/registration_rows.ts";
import { upsertCourse } from "../lib/courses/repository.ts";
import {
  createRegistration,
  getRegistrationEntryById,
  updateRegistrationChecked,
} from "../lib/registrations/repository.ts";
import { __setKvFactoryForTests } from "../lib/kv/client.ts";
import {
  insertAuditLogRecords,
  listAuditLogsByEntityPaginated,
} from "../lib/audit/repository.ts";
import {
  insertEmailLogRecords,
  listEmailLogsByRegistrationPaginated,
} from "../lib/email/repository.ts";
import type { Course, Registration } from "../lib/types.ts";
import type { AppEnv } from "../src/app/context.ts";
import { adminCourseDetailPage } from "../src/routes/admin/courses/[id]/page.tsx";
import { adminRegistrationDetailPage } from "../src/routes/admin/registrations/[id]/page.tsx";
import {
  adminRegistrationsExportRoute,
  csvEscape,
} from "../src/routes/api/admin/exports/registrations/route.ts";
import { setupKvTest } from "./test_utils.ts";

const fixed = "2026-01-01T00:00:00.000Z";
function course(id: string): Course {
  return {
    id,
    title: `Course ${id}`,
    description: "Test",
    location: "Berlin",
    startsAt: "2099-01-01T10:00:00.000Z",
    endsAt: "2099-01-01T12:00:00.000Z",
    registrationOpensAt: fixed,
    registrationClosesAt: "2098-01-01T00:00:00.000Z",
    capacity: 10,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: fixed,
  };
}
function registration(id: string, courseId: string): Registration {
  return {
    id,
    courseId,
    firstName: "First",
    lastName: "Last",
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
function app() {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => {
    c.setRenderer((content) => c.html(content));
    await next();
  });
  return a;
}
function instrument(kv: Deno.Kv) {
  const reads: string[] = [];
  const scans: string[] = [];
  const proxy = new Proxy(kv, {
    get(target, key) {
      if (key === "get") {
        return (...args: Parameters<Deno.Kv["get"]>) => {
          reads.push(JSON.stringify(args[0]));
          return Reflect.apply(target.get, target, args);
        };
      }
      if (key === "list") {
        return (...args: Parameters<Deno.Kv["list"]>) => {
          scans.push(JSON.stringify(args[0]));
          return Reflect.apply(target.list, target, args);
        };
      }
      const member = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  __setKvFactoryForTests(() => Promise.resolve(proxy));
  return { reads, scans };
}

Deno.test("targeted summaries and dashboard pagination avoid unrelated hydration", async () => {
  const { kv, cleanup } = await setupKvTest("admin_reads_");
  try {
    await upsertCourse(course("a"));
    await upsertCourse(course("b"));
    for (let i = 0; i < 12; i++) {
      await createRegistration(
        registration(String(i).padStart(2, "0"), i < 6 ? "a" : "b"),
      );
    }
    await kv.delete(["registrations_by_submitted", fixed, "05"]); // legacy registration without global index
    const observed = instrument(kv);
    assertEquals((await getCourseSummaryById("a"))?.registrationCount, 6);
    assert(
      !observed.scans.some((key) =>
        key.includes('"registrations_by_course","b"')
      ),
    );
    assertEquals(
      observed.reads.filter((key) => key.startsWith('["courses"')).length,
      1,
    );
    observed.reads.length = 0;
    const first = await queryRegistrationRows({ courseId: "a" }, {
      page: 1,
      pageSize: 2,
    });
    const second = await queryRegistrationRows({ courseId: "a" }, {
      page: 2,
      pageSize: 2,
    });
    assertEquals(first.total, 6);
    assertEquals(first.rows.map((r) => r.id), ["05", "04"]);
    assertEquals(second.rows.map((r) => r.id), ["03", "02"]);
    assertEquals(
      observed.reads.filter((key) => key.startsWith('["registrations"')).length,
      4,
    );
    assertEquals(
      observed.reads.filter((key) => key.startsWith('["courses"')).length,
      4,
    );
    assertEquals(first.rows[0].courseTitle, "Course a");
    assertEquals(
      (await queryRegistrationRows({
        q: "First",
        status: "approved",
        courseId: "b",
      }, { page: 1, pageSize: 2 })).total,
      6,
    );
    // Newly written status projections remain correct after migration readiness.
    const previous = await getRegistrationEntryById("05");
    assert(previous.value);
    assert(
      await updateRegistrationChecked(previous as Deno.KvEntry<Registration>, {
        ...previous.value,
        status: "cancelled",
      }),
    );
    assertEquals(
      (await queryRegistrationRows({ status: "cancelled" })).rows.map((r) =>
        r.id
      ),
      ["05"],
    );
    assertEquals((await queryRegistrationRows({ q: "Course b" })).total, 6);
    await createRegistration({
      ...registration("last-millisecond", "a"),
      submittedAt: "2026-05-01T21:59:59.999Z",
    });
    await createRegistration({
      ...registration("next-day", "a"),
      submittedAt: "2026-05-01T22:00:00.000Z",
    });
    assertEquals(
      (await queryRegistrationRows({
        dateFrom: "2026-05-01",
        dateTo: "2026-05-01",
      })).rows.map((r) => r.id),
      ["last-millisecond"],
    );
  } finally {
    await cleanup();
  }
});

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

Deno.test("historical currency groups survive fee edits and filtered CSV keeps full course totals", async () => {
  const { cleanup } = await setupKvTest("currency_history_");
  try {
    await upsertCourse({
      ...course("paid"),
      pricingType: "paid",
      feeAmountCents: 5000,
      feeCurrency: "USD",
    });
    await createRegistration({
      ...registration("euro", "paid"),
      firstName: "First\rLast",
      paymentStatus: "paid",
      paymentAmountCents: 5000,
      paymentCurrency: "EUR",
    });
    await createRegistration({
      ...registration("dollar", "paid"),
      paymentStatus: "paid",
      paymentAmountCents: 7000,
      paymentCurrency: "USD",
    });
    const groups = (await getCourseSummaryById("paid"))?.revenueByCurrency;
    assertEquals(groups, [{
      currency: "EUR",
      totalRevenueCents: 5000,
      paidRegistrationCount: 1,
    }, { currency: "USD", totalRevenueCents: 7000, paidRegistrationCount: 1 }]);
    await upsertCourse({ ...course("paid"), pricingType: "free" });
    const a = app().route("/admin", adminCourseDetailPage).route(
      "/export",
      adminRegistrationsExportRoute,
    );
    const html = await (await a.request("/admin/courses/paid")).text();
    const revenue = html.slice(html.indexOf("Gesamtumsatz"));
    assert(revenue.includes("50,00"));
    assert(revenue.includes("70,00"));
    const csv = parseCsv(
      await (await a.request("/export/registrations.csv?q=euro")).text(),
    );
    assertEquals(csv.length, 2);
    assertEquals(csv[0].length, 19);
    assertEquals(csv[1].length, 19);
    assertEquals(csv[1][2], "First\rLast");
    assertEquals(csv[1][16], "");
    assertEquals(JSON.parse(csv[1][18]), { EUR: 5000, USD: 7000 });
    assertEquals(csvEscape("=SUM(A1)"), "'=SUM(A1)");
    assertEquals(csvEscape("ordinary"), "ordinary");
    await upsertCourse(course("unknown"));
    await createRegistration({
      ...registration("unknown", "unknown"),
      paymentStatus: "paid",
      paymentAmountCents: 123,
      paymentCurrency: null,
    });
    const unknown = parseCsv(
      await (await a.request("/export/registrations.csv?q=unknown")).text(),
    );
    assertEquals(unknown[1][16], "");
    assertEquals(unknown[1][17], "");
    assertEquals(JSON.parse(unknown[1][18]), { UNKNOWN: 123 });
  } finally {
    await cleanup();
  }
});

Deno.test("complete merged chronology reaches oldest records with bounded page hydration", async () => {
  const { kv, cleanup } = await setupKvTest("full_history_");
  try {
    await upsertCourse(course("a"));
    await createRegistration(registration("r", "a"));
    for (let base = 0; base < 501; base += 50) {
      const ids = Array.from(
        { length: Math.min(50, 501 - base) },
        (_, j) => base + j,
      );
      await insertAuditLogRecords(ids.map((i) => ({
        id: `audit-${i}`,
        actorUserId: null,
        entityType: "registration",
        entityId: "r",
        action: "registration.approve",
        oldValue: null,
        newValue: JSON.stringify({
          adminMessage: i === 0 ? "OLDEST_AUDIT" : "note",
        }),
        createdAt: new Date(Date.parse(fixed) + i * 1000).toISOString(),
      })));
      await insertEmailLogRecords(ids.map((i) => ({
        id: `email-${i}`,
        registrationId: "r",
        templateKey: "approved",
        recipientEmail: "r@example.org",
        subject: i === 0 ? "OLDEST_EMAIL" : "mail",
        deliveryStatus: "sent",
        sentAt: new Date(Date.parse(fixed) + i * 1000).toISOString(),
        errorMessage: null,
        attempt: 1,
      })));
    }
    const observed = instrument(kv);
    const a = app().route("/registration", adminRegistrationDetailPage);
    const html = await (await a.request("/registration/r?timelinePage=126"))
      .text();
    assert(html.includes("OLDEST_AUDIT"));
    assert(html.includes("OLDEST_EMAIL"));
    assert(html.includes("1002 Einträge"));
    assertEquals(
      observed.reads.filter((key) =>
        key.startsWith('["audit_logs"') || key.startsWith('["email_logs"')
      ).length,
      2,
    );
    observed.reads.length = 0;
    assertEquals(
      (await listAuditLogsByEntityPaginated("registration", "r", 501, 1))
        .items[0].id,
      "audit-0",
    );
    assertEquals(
      (await listEmailLogsByRegistrationPaginated("r", 501, 1)).items[0].id,
      "email-0",
    );
    assertEquals(observed.reads.length, 2);
  } finally {
    await cleanup();
  }
});
