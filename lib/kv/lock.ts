import { getKv } from "./client.ts";

interface LockRecord {
  owner: string;
  expiresAt: number;
}

const LOCK_TTL_MS = 15_000;

export interface KvLockLease {
  /** Fence the final write against lease expiry or another owner taking over. */
  check(tx: Deno.AtomicOperation): Deno.AtomicOperation;
}

export async function withKvLock<T>(
  name: Deno.KvKey,
  operation: (lease: KvLockLease) => Promise<T>,
): Promise<T> {
  const kv = await getKv();
  const key: Deno.KvKey = ["locks", ...name];
  const owner = crypto.randomUUID();
  let acquired: Deno.KvEntry<LockRecord> | null = null;

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
        acquired = {
          key,
          value: { owner, expiresAt: now + LOCK_TTL_MS },
          versionstamp: commit.versionstamp,
        };
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  if (!acquired) {
    throw new Error("Vorgang ist ausgelastet. Bitte erneut versuchen.");
  }

  try {
    const lease = acquired;
    return await operation({
      check(tx) {
        if (lease.value.expiresAt <= Date.now()) {
          throw new Error("Vorgang ist abgelaufen. Bitte erneut versuchen.");
        }
        return tx.check(lease);
      },
    });
  } finally {
    const current = await kv.get<LockRecord>(key, { consistency: "strong" });
    if (current.value?.owner === owner) {
      await kv.atomic().check(current).delete(key).commit();
    }
  }
}
