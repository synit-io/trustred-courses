import { getKv } from "../kv/client.ts";

interface RateLimitBucket {
  count: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function enforceRateLimit(
  scope: string,
  identity: string,
  maxAttempts: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const key: Deno.KvKey = ["security", "rate_limit", scope, identity];
  const kv = await getKv();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await kv.get<RateLimitBucket>(key, {
      consistency: "strong",
    });
    const count = current.value?.count ?? 0;
    if (count >= maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    }

    const commit = await kv.atomic()
      .check(current)
      .set(key, { count: count + 1 }, { expireIn: windowMs })
      .commit();
    if (commit.ok) {
      return {
        allowed: true,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    }
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.ceil(windowMs / 1000),
  };
}
