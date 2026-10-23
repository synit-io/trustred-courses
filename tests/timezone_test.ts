import { assertEquals, assertThrows } from "@std/assert";
import { env } from "../lib/env.ts";
import {
  appDateKey,
  formatAppDateTime,
  formatAppDatetimeLocal,
  parseAppLocalDateTime,
} from "../lib/time.ts";
import {
  formatIsoForDatetimeLocal,
  parseCoursePayload,
} from "../src/routes/shared/helpers.ts";

Deno.test("course wall times round-trip in the configured zone across seasons", () => {
  const previous = env.appTimeZone;
  env.appTimeZone = "Europe/Berlin";
  try {
    for (
      const [local, iso] of [
        ["2098-05-01T09:00", "2098-05-01T07:00:00.000Z"],
        ["2026-01-15T09:00", "2026-01-15T08:00:00.000Z"],
      ]
    ) {
      assertEquals(parseAppLocalDateTime(local), iso);
      assertEquals(formatIsoForDatetimeLocal(iso), local);
      assertEquals(formatAppDatetimeLocal(iso), local);
    }
    assertEquals(appDateKey("2026-05-01T22:30:00Z"), "2026-05-02");
    assertEquals(
      formatAppDateTime("2026-05-01T07:00:00Z", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      "09:00",
    );
    env.appTimeZone = "UTC";
    assertEquals(
      parseAppLocalDateTime("2026-05-01T09:00"),
      "2026-05-01T09:00:00.000Z",
    );
    assertEquals(appDateKey("2026-05-01T22:30:00Z"), "2026-05-01");
  } finally {
    env.appTimeZone = previous;
  }
});

Deno.test("invalid, missing and ambiguous local wall times cannot silently shift", () => {
  const previous = env.appTimeZone;
  env.appTimeZone = "Europe/Berlin";
  try {
    for (
      const value of [
        "2026-03-29T02:30", // Spring gap.
        "2026-10-25T02:30", // Two different instants in the autumn overlap.
        "2026-02-30T09:00",
        "2026-01-01T24:00",
        "2026-01-01T09:00Z",
        "",
      ]
    ) assertEquals(parseAppLocalDateTime(value), null, value);
    assertEquals(
      parseAppLocalDateTime("2026-03-29T03:00"),
      "2026-03-29T01:00:00.000Z",
    );
  } finally {
    env.appTimeZone = previous;
  }
});

Deno.test("course form stores organization-local instants and rejects DST ambiguity", () => {
  const previous = env.appTimeZone;
  env.appTimeZone = "Europe/Berlin";
  try {
    const form = new FormData();
    for (
      const [key, value] of Object.entries({
        title: "Course",
        location: "Berlin",
        description: "Description",
        startsAt: "2098-05-01T09:00",
        endsAt: "2098-05-01T17:00",
        registrationOpensAt: "2098-01-15T09:00",
        registrationClosesAt: "2098-04-30T17:00",
        capacity: "10",
        status: "active",
        pricingType: "free",
      })
    ) form.set(key, value);
    const parsed = parseCoursePayload(form);
    assertEquals(parsed.startsAt, "2098-05-01T07:00:00.000Z");
    assertEquals(parsed.registrationOpensAt, "2098-01-15T08:00:00.000Z");
    form.set("startsAt", "2026-10-25T02:30");
    assertThrows(() => parseCoursePayload(form), Error, "Zeitumstellung");
  } finally {
    env.appTimeZone = previous;
  }
});
