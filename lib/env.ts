import { loadSync } from "jsr:@std/dotenv@0.225.5";

function loadDotEnvIfPresent(): void {
  for (const envPath of [".env", ".env.local"]) {
    try {
      loadSync({ envPath, export: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }
}

loadDotEnvIfPresent();

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface EnvConfig {
  appName: string;
  appBaseUrl: string;
  authCookieName: string;
  authMagicLinkBindingCookieName: string;
  authCookieSecure: boolean;
  authRateLimitMaxAttempts: number;
  authRateLimitWindowMinutes: number;
  authRateLimitBlockMinutes: number;
  logLevel: string;
  logFormat: string;
  authDevExposeMagicLink: boolean;
  magicLinkTtlMinutes: number;
  registrationDoubleOptInTtlHours: number;
  sessionIdleTtlDays: number;
  sessionAbsoluteTtlDays: number;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecure: boolean;
  mailFromAddress: string;
  mailFromName: string;
  mailAdminNotificationTo: string;
  initialAdminEmail: string;
  legalOrganizationName: string;
  legalRepresentative: string;
  legalStreet: string;
  legalPostalCode: string;
  legalCity: string;
  legalEmail: string;
  legalPhone: string;
  embedAllowedOrigins: string;
  paypalEnvironment: "sandbox" | "live";
  paypalClientId: string;
  paypalClientSecret: string;
}

export const env: EnvConfig = {
  appName: Deno.env.get("APP_NAME") ?? "Aid Org Courses",
  appBaseUrl: Deno.env.get("APP_BASE_URL") ?? "http://localhost:8000",
  authCookieName: Deno.env.get("AUTH_COOKIE_NAME") ?? "session",
  authMagicLinkBindingCookieName:
    Deno.env.get("AUTH_MAGIC_LINK_BINDING_COOKIE_NAME") ?? "ml_bind",
  authCookieSecure: Deno.env.get("AUTH_COOKIE_SECURE") === "true",
  authRateLimitMaxAttempts: optionalNumber("AUTH_RATE_LIMIT_MAX_ATTEMPTS", 5),
  authRateLimitWindowMinutes: optionalNumber(
    "AUTH_RATE_LIMIT_WINDOW_MINUTES",
    15,
  ),
  authRateLimitBlockMinutes: optionalNumber(
    "AUTH_RATE_LIMIT_BLOCK_MINUTES",
    15,
  ),
  logLevel: Deno.env.get("LOG_LEVEL") ?? "info",
  logFormat: Deno.env.get("LOG_FORMAT") ?? "json",
  authDevExposeMagicLink:
    Deno.env.get("AUTH_DEV_EXPOSE_MAGIC_LINK") !== "false",
  magicLinkTtlMinutes: optionalNumber("MAGIC_LINK_TTL_MINUTES", 15),
  registrationDoubleOptInTtlHours: optionalNumber(
    "REGISTRATION_DOUBLE_OPT_IN_TTL_HOURS",
    48,
  ),
  sessionIdleTtlDays: optionalNumber("SESSION_IDLE_TTL_DAYS", 7),
  sessionAbsoluteTtlDays: optionalNumber("SESSION_ABSOLUTE_TTL_DAYS", 30),
  smtpHost: Deno.env.get("SMTP_HOST") ?? "",
  smtpPort: optionalNumber("SMTP_PORT", 587),
  smtpUser: Deno.env.get("SMTP_USER") ?? "",
  smtpPass: Deno.env.get("SMTP_PASS") ?? "",
  smtpSecure: Deno.env.get("SMTP_SECURE") === "true",
  mailFromAddress: Deno.env.get("MAIL_FROM_ADDRESS") ?? "",
  mailFromName: Deno.env.get("MAIL_FROM_NAME") ?? "Aid Org Courses",
  mailAdminNotificationTo: Deno.env.get("MAIL_ADMIN_NOTIFICATION_TO") ?? "",
  initialAdminEmail: Deno.env.get("INITIAL_ADMIN_EMAIL") ?? "admin@example.org",
  legalOrganizationName: Deno.env.get("LEGAL_ORGANIZATION_NAME") ??
    "Aid Org Courses",
  legalRepresentative: Deno.env.get("LEGAL_REPRESENTATIVE") ?? "Max Mustermann",
  legalStreet: Deno.env.get("LEGAL_STREET") ?? "Musterstrasse 1",
  legalPostalCode: Deno.env.get("LEGAL_POSTAL_CODE") ?? "12345",
  legalCity: Deno.env.get("LEGAL_CITY") ?? "Musterstadt",
  legalEmail: Deno.env.get("LEGAL_EMAIL") ?? "kontakt@example.org",
  legalPhone: Deno.env.get("LEGAL_PHONE") ?? "+49 000 000000",
  embedAllowedOrigins: Deno.env.get("EMBED_ALLOWED_ORIGINS") ?? "*",
  paypalEnvironment: Deno.env.get("PAYPAL_ENVIRONMENT") === "live"
    ? "live"
    : "sandbox",
  paypalClientId: Deno.env.get("PAYPAL_CLIENT_ID") ?? "",
  paypalClientSecret: Deno.env.get("PAYPAL_CLIENT_SECRET") ?? "",
};

export function ensureSmtpConfig(): void {
  required("SMTP_HOST");
  required("SMTP_USER");
  required("SMTP_PASS");
  required("MAIL_FROM_ADDRESS");
}

export function ensurePayPalConfig(): void {
  required("PAYPAL_CLIENT_ID");
  required("PAYPAL_CLIENT_SECRET");
}

export function isLocalDebugBypassEnabled(): boolean {
  if (!env.authDevExposeMagicLink) return false;

  const deploymentId = (Deno.env.get("DENO_DEPLOYMENT_ID") ?? "").trim();
  const nodeEnv = (Deno.env.get("NODE_ENV") ?? "").trim().toLowerCase();
  if (deploymentId || nodeEnv === "production") {
    return false;
  }

  try {
    const host = new URL(env.appBaseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" ||
      host.endsWith(".localhost");
  } catch {
    return false;
  }
}

export function frameAncestorsDirectiveValue(): string {
  const raw = env.embedAllowedOrigins.trim();
  if (!raw) return "'self'";
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return "'self'";
  if (parts.includes("*")) return "*";
  return parts.join(" ");
}
