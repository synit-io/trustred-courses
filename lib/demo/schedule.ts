import { env, isDemoMode } from "../env.ts";

/**
 * Minimal 5-field cron support (minute hour day-of-month month day-of-week),
 * matching what `Deno.cron` accepts: `*`, lists, ranges and steps. Used to
 * validate `DEMO_MODE_RESET_CRON`, describe it in German and compute the next
 * run for the demo banner. Cron runs in UTC.
 */

interface CronField {
  values: Set<number>;
  wildcard: boolean;
  /** Set when the field is exactly `*\/n`. */
  step: number | null;
}

export interface CronSchedule {
  expression: string;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

const WEEKDAYS_DE = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

function parseField(raw: string, min: number, max: number): CronField | null {
  const values = new Set<number>();
  let wildcard = false;
  let step: number | null = null;
  const parts = raw.split(",");
  if (parts.length === 1 && parts[0] === "*") {
    for (let v = min; v <= max; v += 1) values.add(v);
    return { values, wildcard: true, step: null };
  }
  for (const part of parts) {
    const [range, stepRaw] = part.split("/");
    const stepValue = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(stepValue) || stepValue < 1) return null;
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
      if (parts.length === 1 && stepRaw !== undefined) step = stepValue;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
      lo = a;
      hi = b;
    } else {
      const single = Number(range);
      if (!Number.isInteger(single)) return null;
      lo = single;
      hi = stepRaw === undefined ? single : max;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += stepValue) values.add(v);
  }
  if (values.size === 0) return null;
  if (values.size === max - min + 1 && step === null) wildcard = true;
  return { values, wildcard, step };
}

export function parseCronSchedule(expression: string): CronSchedule | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dayOfMonth = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12);
  const dayOfWeek = parseField(fields[4].replaceAll("7", "0"), 0, 6);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  return {
    expression: expression.trim(),
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
  };
}

function dayMatches(schedule: CronSchedule, date: Date): boolean {
  const dom = schedule.dayOfMonth.values.has(date.getUTCDate());
  const dow = schedule.dayOfWeek.values.has(date.getUTCDay());
  if (schedule.dayOfMonth.wildcard && schedule.dayOfWeek.wildcard) return true;
  if (schedule.dayOfMonth.wildcard) return dow;
  if (schedule.dayOfWeek.wildcard) return dom;
  return dom || dow;
}

/** Next run strictly after `from`, or null when nothing matches within a year. */
export function nextCronRun(schedule: CronSchedule, from: Date): Date | null {
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;

  while (cursor.getTime() <= limit) {
    if (!schedule.month.values.has(cursor.getUTCMonth() + 1)) {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(schedule, cursor)) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!schedule.hour.values.has(cursor.getUTCHours())) {
      cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!schedule.minute.values.has(cursor.getUTCMinutes())) {
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
      continue;
    }
    return cursor;
  }
  return null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function single(field: CronField): number | null {
  return field.values.size === 1 ? [...field.values][0] : null;
}

/** Regular interval in minutes, or null for irregular schedules. */
export function cronIntervalMinutes(schedule: CronSchedule): number | null {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = schedule;
  const restWild = dayOfMonth.wildcard && month.wildcard && dayOfWeek.wildcard;
  if (restWild && hour.wildcard) {
    if (minute.wildcard) return 1;
    if (minute.step) return minute.step;
    if (single(minute) !== null) return 60;
  }
  if (restWild && single(minute) !== null) {
    if (hour.step) return hour.step * 60;
    if (single(hour) !== null) return 24 * 60;
  }
  if (
    dayOfMonth.wildcard && month.wildcard && single(dayOfWeek) !== null &&
    single(minute) !== null && single(hour) !== null
  ) return 7 * 24 * 60;
  return null;
}

/** German description like "alle 30 Minuten" or "täglich um 03:00 Uhr (UTC)". */
export function describeCronSchedule(schedule: CronSchedule): string {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = schedule;
  const restWild = dayOfMonth.wildcard && month.wildcard && dayOfWeek.wildcard;
  const m = single(minute);
  const h = single(hour);

  if (restWild && hour.wildcard) {
    if (minute.wildcard) return "jede Minute";
    if (minute.step) return `alle ${minute.step} Minuten`;
    if (m !== null) {
      return m === 0 ? "jede volle Stunde" : `stündlich um Minute ${m}`;
    }
  }
  if (restWild && m !== null) {
    if (hour.step) return `alle ${hour.step} Stunden`;
    if (h !== null) return `täglich um ${pad(h)}:${pad(m)} Uhr (UTC)`;
  }
  if (
    dayOfMonth.wildcard && month.wildcard && !dayOfWeek.wildcard &&
    m !== null && h !== null
  ) {
    const days = [...dayOfWeek.values].sort().map((d) => WEEKDAYS_DE[d]);
    return `${days.join(", ")} um ${pad(h)}:${pad(m)} Uhr (UTC)`;
  }
  return `nach Zeitplan "${schedule.expression}" (UTC)`;
}

/** "in 12 Minuten", "in 2 Stunden 5 Minuten", "in unter einer Minute". */
export function formatCountdown(target: Date, now: Date): string {
  const totalMinutes = Math.floor((target.getTime() - now.getTime()) / 60_000);
  if (totalMinutes < 1) return "in unter einer Minute";
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(days === 1 ? "1 Tag" : `${days} Tagen`);
  if (hours > 0) parts.push(hours === 1 ? "1 Stunde" : `${hours} Stunden`);
  if (minutes > 0 && days === 0) {
    parts.push(minutes === 1 ? "1 Minute" : `${minutes} Minuten`);
  }
  return `in ${parts.join(" ")}`;
}

export function formatBerlinTime(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date) + " Uhr";
}

export interface DemoResetInfo {
  enabled: boolean;
  expression: string;
  /** e.g. "alle 30 Minuten" */
  description: string;
  intervalMinutes: number | null;
  nextRunAt: Date | null;
  /** e.g. "in 12 Minuten" */
  countdown: string | null;
  /** e.g. "20:30 Uhr" (Europe/Berlin) */
  nextRunTime: string | null;
}

export function isDemoResetCronDisabled(expression: string): boolean {
  const value = expression.trim().toLowerCase();
  return value === "" || value === "off" || value === "false" ||
    value === "0";
}

/** Everything the UI needs to explain the automatic reset. */
export function getDemoResetInfo(now = new Date()): DemoResetInfo {
  const expression = env.demoModeResetCron;
  const disabled: DemoResetInfo = {
    enabled: false,
    expression,
    description: "",
    intervalMinutes: null,
    nextRunAt: null,
    countdown: null,
    nextRunTime: null,
  };
  if (!isDemoMode() || isDemoResetCronDisabled(expression)) return disabled;
  const schedule = parseCronSchedule(expression);
  if (!schedule) return disabled;
  const nextRunAt = nextCronRun(schedule, now);
  return {
    enabled: true,
    expression,
    description: describeCronSchedule(schedule),
    intervalMinutes: cronIntervalMinutes(schedule),
    nextRunAt,
    countdown: nextRunAt ? formatCountdown(nextRunAt, now) : null,
    nextRunTime: nextRunAt ? formatBerlinTime(nextRunAt) : null,
  };
}
