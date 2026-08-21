import type { AuditLogPage } from "@/lib/audit/repository.ts";
import {
  allowedEmailEventsForRegistrationStatus,
  availableRegistrationActions,
  type RegistrationAction,
} from "@/lib/registrations/service.ts";
import type { Course } from "@/lib/types.ts";
import type { RegistrationEmailEvent } from "@/lib/email/templates.ts";

const sensitiveQueryKeys = new Set([
  "token",
  "state",
  "debug",
  "confirm_debug",
  "redirectTo",
]);

export function availableActions(status: string): RegistrationAction[] {
  if (
    status !== "submitted" &&
    status !== "pending_review" &&
    status !== "waitlisted" &&
    status !== "approved" &&
    status !== "rejected" &&
    status !== "cancelled"
  ) {
    return [];
  }

  return availableRegistrationActions(status);
}

export function toDefaultEvent(status: string): RegistrationEmailEvent {
  if (
    status === "submitted" ||
    status === "pending_review" ||
    status === "waitlisted" ||
    status === "approved" ||
    status === "rejected" ||
    status === "cancelled"
  ) {
    return allowedEmailEventsForRegistrationStatus(status)[0] ??
      "registration_received";
  }

  return "registration_received";
}

export function resendEventOptionsForStatus(
  status: string,
): RegistrationEmailEvent[] {
  if (
    status !== "submitted" &&
    status !== "pending_review" &&
    status !== "waitlisted" &&
    status !== "approved" &&
    status !== "rejected" &&
    status !== "cancelled"
  ) {
    return [];
  }

  return allowedEmailEventsForRegistrationStatus(status);
}

export function parsePage(value: string | null): number {
  const numeric = Number(value ?? "1");
  return Number.isFinite(numeric) && numeric >= 1 ? Math.floor(numeric) : 1;
}

export function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "***";
  if (local.length <= 2) return `${local[0] ?? "*"}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

export function redactQueryForLogs(url: URL): string {
  if (!url.search) return "";
  const params = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    params.set(key, sensitiveQueryKeys.has(key) ? "[redacted]" : value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function extractRequestIp(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("fly-client-ip"),
    headers.get("x-client-ip"),
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function capacityView(total: number, approved: number): {
  total: number;
  approved: number;
  available: number;
  lowCapacity: boolean;
  full: boolean;
} {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeApproved = Math.max(0, Math.floor(approved));
  const available = Math.max(safeTotal - safeApproved, 0);
  const lowThreshold = Math.max(1, Math.ceil(safeTotal * 0.1));
  return {
    total: safeTotal,
    approved: safeApproved,
    available,
    lowCapacity: available > 0 && available <= lowThreshold,
    full: available === 0,
  };
}

export function slugifyCourseTitle(title: string): string {
  const transliterated = title
    .replaceAll(/[Ää]/g, "ae")
    .replaceAll(/[Öö]/g, "oe")
    .replaceAll(/[Üü]/g, "ue")
    .replaceAll("ß", "ss")
    .replaceAll("ẞ", "ss");

  return title
      .trim()
      .length === 0
    ? ""
    : transliterated
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/(^-|-$)/g, "")
      .slice(0, 42);
}

function parseLocalDateTimeToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function parseCoursePayload(form: FormData): {
  title: string;
  location: string;
  description: string;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  capacity: number;
  pricingType: "free" | "paid";
  feeAmountCents: number | null;
  feeCurrency: string | null;
  status: "active" | "draft" | "archived";
  waitingListEnabled: boolean;
  reminderDaysBefore: number | null;
} {
  const readString = (key: string): string => {
    const raw = form.get(key);
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new Error(`Feld fehlt: ${key}`);
    }
    return raw.trim();
  };

  const title = readString("title");
  const location = readString("location");
  const description = readString("description");

  const startsAtRaw = readString("startsAt");
  const endsAtRaw = readString("endsAt");
  const registrationOpensAtRaw = readString("registrationOpensAt");
  const registrationClosesAtRaw = readString("registrationClosesAt");

  const startsAt = parseLocalDateTimeToIso(startsAtRaw);
  const endsAt = parseLocalDateTimeToIso(endsAtRaw);
  const registrationOpensAt = parseLocalDateTimeToIso(registrationOpensAtRaw);
  const registrationClosesAt = parseLocalDateTimeToIso(registrationClosesAtRaw);

  if (!startsAt || !endsAt || !registrationOpensAt || !registrationClosesAt) {
    throw new Error("ungültiges Datum für Kurs oder Anmeldezeitraum.");
  }
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error("Kursende muss nach dem Kursbeginn liegen.");
  }
  if (Date.parse(registrationClosesAt) <= Date.parse(registrationOpensAt)) {
    throw new Error("Anmeldungsende muss nach Anmeldungsstart liegen.");
  }
  if (Date.parse(registrationClosesAt) > Date.parse(startsAt)) {
    throw new Error("Anmeldungsende muss vor dem Kursbeginn liegen.");
  }

  const capacityRaw = readString("capacity");
  const capacity = Number(capacityRaw);
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error("Kapazität muss eine ganze Zahl >= 1 sein.");
  }

  const pricingTypeRaw = String(form.get("pricingType") ?? "free")
    .trim()
    .toLowerCase();
  if (pricingTypeRaw !== "free" && pricingTypeRaw !== "paid") {
    throw new Error("ungültiger Kurspreis-Typ.");
  }

  let feeAmountCents: number | null = null;
  let feeCurrency: string | null = null;
  if (pricingTypeRaw === "paid") {
    const feeAmountRaw = readString("feeAmount");
    const feeAmount = Number(feeAmountRaw.replace(",", "."));
    if (!Number.isFinite(feeAmount) || feeAmount <= 0) {
      throw new Error("Kursgebühr muss größer als 0 sein.");
    }
    feeAmountCents = Math.round(feeAmount * 100);
    const rawCurrencyInput = String(form.get("feeCurrency") ?? "")
      .trim()
      .toUpperCase();
    const rawCurrency = rawCurrencyInput || "EUR";
    if (!/^[A-Z]{3}$/.test(rawCurrency)) {
      throw new Error("Währung muss ein ISO-4217 Code mit 3 Buchstaben sein.");
    }
    feeCurrency = rawCurrency;
  }

  const statusRaw = readString("status");
  if (
    statusRaw !== "active" && statusRaw !== "draft" && statusRaw !== "archived"
  ) {
    throw new Error("ungültiger Kursstatus.");
  }

  const reminderRaw = form.get("reminderDaysBefore");
  let reminderDaysBefore: number | null = null;
  if (typeof reminderRaw === "string" && reminderRaw.trim() !== "") {
    const parsedReminder = Number(reminderRaw.trim());
    if (
      !Number.isInteger(parsedReminder) || parsedReminder < 1 ||
      parsedReminder > 60
    ) {
      throw new Error(
        "Erinnerungstage müssen eine ganze Zahl zwischen 1 und 60 sein.",
      );
    }
    reminderDaysBefore = parsedReminder;
  }

  return {
    title,
    location,
    description,
    startsAt,
    endsAt,
    registrationOpensAt,
    registrationClosesAt,
    capacity,
    pricingType: pricingTypeRaw,
    feeAmountCents,
    feeCurrency,
    status: statusRaw,
    waitingListEnabled: form.get("waitingListEnabled") === "on",
    reminderDaysBefore,
  };
}

export function formatCourseFee(
  amountCents: number | null | undefined,
  currency: string | null | undefined,
  locale = "de-DE",
): string {
  if (!Number.isFinite(amountCents) || !currency) {
    return "Kostenfrei";
  }
  const amount = Number(amountCents) / 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}

export function formatIsoForDatetimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${
    pad(date.getDate())
  }T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function registrationWindowState(
  course: Pick<
    Course,
    "startsAt" | "registrationOpensAt" | "registrationClosesAt" | "status"
  >,
): { label: string; className: string; open: boolean } {
  if (course.status !== "active") {
    return {
      label: "Geschlossen",
      className: "status-badge status-rejected",
      open: false,
    };
  }

  const now = Date.now();
  const startsAt = Date.parse(course.startsAt);
  if (!Number.isNaN(startsAt) && now >= startsAt) {
    return {
      label: "Gestartet",
      className: "status-badge status-info",
      open: false,
    };
  }

  if (course.registrationOpensAt) {
    const opensAt = Date.parse(course.registrationOpensAt);
    if (!Number.isNaN(opensAt) && now < opensAt) {
      return {
        label: "Noch nicht offen",
        className: "status-badge status-pending",
        open: false,
      };
    }
  }

  if (course.registrationClosesAt) {
    const closesAt = Date.parse(course.registrationClosesAt);
    if (!Number.isNaN(closesAt) && now > closesAt) {
      return {
        label: "Anmeldung beendet",
        className: "status-badge status-rejected",
        open: false,
      };
    }
  }

  return {
    label: "Offen",
    className: "status-badge status-approved",
    open: true,
  };
}

function buildPageHref(
  queryString: string,
  key: "auditPage" | "commPage" | "timelinePage",
  nextPage: number,
  registrationId: string,
): string {
  const params = new URLSearchParams(queryString);
  if (nextPage <= 1) {
    params.delete(key);
  } else {
    params.set(key, String(nextPage));
  }
  const next = params.toString();
  return `/admin/registrations/${registrationId}${next ? `?${next}` : ""}`;
}

function totalPages(page: { total: number; pageSize: number }): number {
  return Math.max(1, Math.ceil(page.total / page.pageSize));
}

export function buildPagerLinks(
  page: Pick<AuditLogPage, "total" | "page" | "pageSize">,
  pageParamKey: "auditPage" | "commPage" | "timelinePage",
  queryString: string,
  registrationId: string,
): {
  pages: number;
  prevHref: string;
  nextHref: string;
} {
  const pages = totalPages(page);
  const prevPage = Math.max(1, page.page - 1);
  const nextPage = Math.min(pages, page.page + 1);

  return {
    pages,
    prevHref: buildPageHref(
      queryString,
      pageParamKey,
      prevPage,
      registrationId,
    ),
    nextHref: buildPageHref(
      queryString,
      pageParamKey,
      nextPage,
      registrationId,
    ),
  };
}
