import { getKv } from "../kv/client.ts";
import { processEmailOutboxBatch } from "../email/service.ts";

/** Bound one scheduler run, while allowing more than one small batch to drain. */
export async function drainEmailOutbox(
  maxBatches = 10,
  batchSize = 20,
): Promise<number> {
  let total = 0;
  for (let index = 0; index < maxBatches; index++) {
    const processed = await processEmailOutboxBatch(batchSize);
    total += processed;
    if (processed < batchSize) break;
  }
  return total;
}

/** Retention applies only to terminal failures, never pending or leased mail. */
export async function cleanupOldDeadLetters(
  maxAgeDays = 30,
  now = new Date(),
): Promise<number> {
  const kv = await getKv();
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  let removed = 0;
  for await (
    const entry of kv.list<{ failedAt: string }>({
      prefix: ["email_dead_letters"],
    })
  ) {
    if (Date.parse(entry.value.failedAt) <= cutoff) {
      if ((await kv.atomic().check(entry).delete(entry.key).commit()).ok) {
        removed++;
      }
    }
  }
  return removed;
}
