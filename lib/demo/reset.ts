import { env, isDemoMode } from "../env.ts";
import { getKv } from "../kv/client.ts";
import { withKvLock } from "../kv/lock.ts";
import { logger } from "../observability/logger.ts";
import { DEMO_COURSE_ID_PREFIX } from "./generator.ts";
import {
  DemoModeDisabledError,
  type DemoSeedOptions,
  type DemoSeedSummary,
  seedDemoData,
} from "./seed.ts";

/** Fixed seed so every reset produces the same demo storyline. */
export const DEMO_RESET_SEED = 4711;

const DEMO_STATE_KEY: Deno.KvKey = ["demo_state", "last_reset"];
const RESET_LOCK_NAME: Deno.KvKey = ["demo_reset"];
const DELETE_BATCH_SIZE = 500;

export interface DemoResetState {
  resetAt: string;
  courses: number;
  registrations: number;
  trigger: "boot" | "cron" | "manual";
}

export interface DemoResetSummary extends DemoSeedSummary {
  deletedKeys: number;
  resetAt: string;
}

function isResetLockKey(key: Deno.KvKey): boolean {
  return key.length === RESET_LOCK_NAME.length + 1 && key[0] === "locks" &&
    RESET_LOCK_NAME.every((part, index) => key[index + 1] === part);
}

async function wipeAllKeys(kv: Deno.Kv): Promise<number> {
  let deleted = 0;
  let batch: Deno.KvKey[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    let tx = kv.atomic();
    for (const key of batch) tx = tx.delete(key);
    await tx.commit();
    deleted += batch.length;
    batch = [];
  };

  for await (const entry of kv.list({ prefix: [] })) {
    if (isResetLockKey(entry.key)) continue;
    batch.push(entry.key);
    if (batch.length >= DELETE_BATCH_SIZE) await flush();
  }
  await flush();
  return deleted;
}

function resetSeedOptions(options: DemoSeedOptions): DemoSeedOptions {
  return {
    courses: options.courses ?? env.demoModeResetCourses,
    seed: options.seed ?? DEMO_RESET_SEED,
    minRegistrations: options.minRegistrations,
    maxRegistrations: options.maxRegistrations,
    now: options.now,
  };
}

export async function getDemoResetState(): Promise<DemoResetState | null> {
  const kv = await getKv();
  const entry = await kv.get<DemoResetState>(DEMO_STATE_KEY);
  return entry.value;
}

/**
 * Wipes the whole KV store and rebuilds the demo dataset from scratch.
 * Everyone is logged out (sessions are part of the wipe). Refuses to run
 * unless DEMO_MODE=true.
 */
export async function resetDemoData(
  options: DemoSeedOptions = {},
  trigger: DemoResetState["trigger"] = "manual",
): Promise<DemoResetSummary> {
  if (!isDemoMode()) throw new DemoModeDisabledError();

  return await withKvLock(RESET_LOCK_NAME, async () => {
    const kv = await getKv();
    const startedAt = performance.now();
    const deletedKeys = await wipeAllKeys(kv);
    const summary = await seedDemoData(resetSeedOptions(options));
    const resetAt = new Date().toISOString();
    const state: DemoResetState = {
      resetAt,
      courses: summary.courses,
      registrations: summary.registrations,
      trigger,
    };
    await kv.set(DEMO_STATE_KEY, state);
    logger.info("demo.reset.completed", {
      trigger,
      deletedKeys,
      courses: summary.courses,
      registrations: summary.registrations,
      durationMs: Number((performance.now() - startedAt).toFixed(1)),
    });
    return { ...summary, deletedKeys, resetAt };
  });
}

/**
 * First boot of a demo instance: seed once when no demo course exists yet.
 * Later boots keep whatever the last reset produced.
 */
export async function ensureDemoDataOnBoot(): Promise<
  "seeded" | "present" | "skipped"
> {
  if (!isDemoMode()) return "skipped";
  const kv = await getKv();
  for await (const entry of kv.list({ prefix: ["courses"] })) {
    const id = String(entry.key.at(-1));
    if (id.startsWith(DEMO_COURSE_ID_PREFIX)) return "present";
  }
  const summary = await withKvLock(
    RESET_LOCK_NAME,
    () => seedDemoData(resetSeedOptions({})),
  );
  await kv.set(
    DEMO_STATE_KEY,
    {
      resetAt: new Date().toISOString(),
      courses: summary.courses,
      registrations: summary.registrations,
      trigger: "boot",
    } satisfies DemoResetState,
  );
  logger.info("demo.bootstrap.seeded", {
    courses: summary.courses,
    registrations: summary.registrations,
  });
  return "seeded";
}
