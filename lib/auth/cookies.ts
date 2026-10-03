import {
  buildBindingClearCookie,
  buildBindingSetCookie,
  buildSessionClearCookie as buildSessionClearCookieBase,
  buildSessionSetCookie as buildSessionSetCookieBase,
  buildVerifyResponseHeaders,
  getCookie,
} from "@synitio/kv-magic-link-auth";
import { env } from "../env.ts";

function cookieConfig() {
  return {
    sessionCookieName: env.authCookieName,
    bindingCookieName: env.authMagicLinkBindingCookieName,
    secure: env.authCookieSecure,
  };
}

export { getCookie };

export function buildSessionSetCookie(
  sessionId: string,
  maxAgeSeconds: number,
): string {
  return buildSessionSetCookieBase(sessionId, {
    ...cookieConfig(),
    maxAgeSeconds,
  });
}

export function buildMagicLinkVerifyHeaders(
  location: string,
  cookies: readonly string[],
): Headers {
  return buildVerifyResponseHeaders(location, cookies);
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
