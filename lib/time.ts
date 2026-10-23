import { env } from "./env.ts";

function localParts(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.appTimeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const field = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === name)!.value;
  return `${field("year")}-${field("month")}-${field("day")}T${field("hour")}:${
    field("minute")
  }:${field("second")}`;
}

/** Interpret a wall-clock input in the organization zone, never the host zone.
 * Reject nonexistent and ambiguous DST wall times rather than guessing. */
export function parseAppLocalDateTime(value: string): string | null {
  const input = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(input)) {
    return null;
  }
  const normalized = input.length === 16 ? `${input}:00` : input;
  const naive = Date.parse(`${normalized}Z`);
  if (
    !Number.isFinite(naive) ||
    new Date(naive).toISOString().slice(0, 19) !== normalized
  ) return null;

  const offsets = new Set<number>();
  // Nearby instants cover both offsets around a transition, without depending
  // on a platform-specific default timezone or assuming a one-hour DST shift.
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = naive + hours * 3_600_000;
    offsets.add(Date.parse(`${localParts(new Date(sample))}Z`) - sample);
  }
  const matches = [...offsets].map((offset) => naive - offset).filter((ts) =>
    localParts(new Date(ts)) === normalized
  );
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}

export function formatAppDatetimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : localParts(date).slice(0, 16);
}

export function appDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : localParts(date).slice(0, 10);
}

export function formatAppDateTime(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString("de-DE", {
    ...options,
    timeZone: env.appTimeZone,
  });
}
