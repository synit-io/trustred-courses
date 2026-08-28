import {
  enforceRateLimit,
  type RateLimitResult,
} from "../security/rate_limit.ts";

const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = {
  create: 20,
  callback: 60,
} as const;

function maxAttempts(action: keyof typeof LIMITS): number {
  return LIMITS[action];
}

export async function enforcePayPalRateLimit(
  action: keyof typeof LIMITS,
  ip: string | null,
): Promise<RateLimitResult> {
  const normalizedIp = (ip ?? "unavailable").trim() || "unavailable";
  return await enforceRateLimit(
    `paypal:${action}`,
    normalizedIp,
    maxAttempts(action),
    WINDOW_MS,
  );
}
