import { getKv } from "../kv/client.ts";

interface RateLimitBucket {
  count: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

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
  const normalizedIp = (ip ?? "unknown").trim() || "unknown";
  const key: Deno.KvKey = [
    "security",
    "rate_limit",
    "paypal",
    action,
    normalizedIp,
  ];
  const kv = await getKv();
  const current = await kv.get<RateLimitBucket>(key, { consistency: "strong" });
  const count = current.value?.count ?? 0;
  const max = maxAttempts(action);
  if (count >= max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.floor(WINDOW_MS / 1000),
    };
  }

  await kv.set(key, { count: count + 1 }, { expireIn: WINDOW_MS });
  return {
    allowed: true,
    retryAfterSeconds: Math.floor(WINDOW_MS / 1000),
  };
}
