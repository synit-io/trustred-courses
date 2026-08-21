import { assertEquals } from "@std/assert";
import { getCourseById, upsertCourse } from "../lib/courses/repository.ts";
import {
  parseCoursePayload,
  slugifyCourseTitle,
} from "../src/routes/shared/helpers.ts";
import type { Course } from "../lib/types.ts";
import { setupKvTest } from "./test_utils.ts";

function baseCourseFixture(): Course {
  return {
    id: "course-pricing",
    title: "Erste Hilfe",
    description: "Grundlagen",
    location: "Berlin",
    startsAt: "2026-06-01T08:00:00.000Z",
    endsAt: "2026-06-01T16:00:00.000Z",
    registrationOpensAt: "2026-04-01T08:00:00.000Z",
    registrationClosesAt: "2026-05-20T08:00:00.000Z",
    capacity: 12,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: "2026-03-01T08:00:00.000Z",
  };
}

function buildCourseForm(): FormData {
  const form = new FormData();
  form.set("title", "Kurs");
  form.set("location", "Hamburg");
  form.set("description", "Beschreibung");
  form.set("startsAt", "2026-06-01T09:00");
  form.set("endsAt", "2026-06-01T17:00");
  form.set("registrationOpensAt", "2026-04-01T09:00");
  form.set("registrationClosesAt", "2026-05-20T09:00");
  form.set("capacity", "10");
  form.set("status", "active");
  return form;
}

Deno.test("course repository normalizes legacy free pricing defaults", async () => {
  const ctx = await setupKvTest("course-pricing-repo-");
  try {
    await upsertCourse(baseCourseFixture());
    const stored = await getCourseById("course-pricing");
    assertEquals(stored?.pricingType, "free");
    assertEquals(stored?.feeAmountCents, null);
    assertEquals(stored?.feeCurrency, null);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("parseCoursePayload parses paid fee fields", () => {
  const form = buildCourseForm();
  form.set("pricingType", "paid");
  form.set("feeAmount", "49.90");
  form.set("feeCurrency", "eur");

  const payload = parseCoursePayload(form);
  assertEquals(payload.pricingType, "paid");
  assertEquals(payload.feeAmountCents, 4990);
  assertEquals(payload.feeCurrency, "EUR");
});

Deno.test("parseCoursePayload defaults free courses to no fee", () => {
  const form = buildCourseForm();
  form.set("pricingType", "free");

  const payload = parseCoursePayload(form);
  assertEquals(payload.pricingType, "free");
  assertEquals(payload.feeAmountCents, null);
  assertEquals(payload.feeCurrency, null);
});

Deno.test("slugifyCourseTitle transliterates German umlauts for SEO friendly URLs", () => {
  assertEquals(
    slugifyCourseTitle("Erste Hilfe bei Kindernotfällen"),
    "erste-hilfe-bei-kindernotfaellen",
  );
  assertEquals(
    slugifyCourseTitle("ÜbergrößE & Spaß"),
    "uebergroesse-spass",
  );
});
