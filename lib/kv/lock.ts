import { getKv } from "./client.ts";

interface LockRecord {
  owner: string;
  expiresAt: number;
}

const LOCK_TTL_MS = 15_000;

export async function withKvLock<T>(
  name: Deno.KvKey,
  operation: () => Promise<T>,
): Promise<T> {
  const kv = await getKv();
  const key: Deno.KvKey = ["locks", ...name];
  const owner = crypto.randomUUID();
  let acquired = false;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await kv.get<LockRecord>(key, { consistency: "strong" });
    const now = Date.now();
    if (!current.value || current.value.expiresAt <= now) {
      const commit = await kv.atomic()
        .check(current)
        .set(key, { owner, expiresAt: now + LOCK_TTL_MS }, {
          expireIn: LOCK_TTL_MS,
        })
        .commit();
      if (commit.ok) {
        acquired = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  if (!acquired) {
    throw new Error("Vorgang ist ausgelastet. Bitte erneut versuchen.");
  }

  try {
    return await operation();
  } finally {
    const current = await kv.get<LockRecord>(key, { consistency: "strong" });
    if (current.value?.owner === owner) {
      await kv.atomic().check(current).delete(key).commit();
    }
  }
}
