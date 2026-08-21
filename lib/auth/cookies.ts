import {
  buildBindingClearCookie,
  buildBindingSetCookie,
  buildSessionClearCookie as buildSessionClearCookieBase,
  buildSessionSetCookie as buildSessionSetCookieBase,
  getCookie,
} from "@synitio/kv-magic-link-auth";
import { env } from "../env.ts";

function cookieConfig() {
  return {
    sessionCookieName: env.authCookieName,
    bindingCookieName: env.authMagicLinkBindingCookieName,
    secure: env.authCookieSecure,
    sessionAbsoluteTtlDays: env.sessionAbsoluteTtlDays,
  };
}

export { getCookie };

export function buildSessionSetCookie(sessionId: string): string {
  return buildSessionSetCookieBase(sessionId, cookieConfig());
}

export function buildSessionClearCookie(): string {
  return buildSessionClearCookieBase(cookieConfig());
}

export function buildMagicLinkBindingSetCookie(
  value: string,
  maxAgeSeconds: number,
): string {
  return buildBindingSetCookie(value, maxAgeSeconds, cookieConfig());
}

export function buildMagicLinkBindingClearCookie(): string {
  return buildBindingClearCookie(cookieConfig());
}
