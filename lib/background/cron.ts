import { getKv } from "../kv/client.ts";
import {
  processCourseReminders,
  processEmailOutboxBatch,
} from "../email/service.ts";

type CronGlobal = typeof globalThis & { __aid_org_cron_registered__?: boolean };

async function cleanupOldOutbox(maxAgeDays = 14): Promise<number> {
  const kv = await getKv();
  let removed = 0;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  for await (
    const entry of kv.list<{ createdAt: string }>({ prefix: ["email_outbox"] })
  ) {
    if (Date.parse(entry.value.createdAt) <= cutoff) {
      await kv.delete(entry.key);
      removed += 1;
    }
  }

  return removed;
}

export function registerCronJobs(): void {
  const runtimeGlobal = globalThis as CronGlobal;
  if (runtimeGlobal.__aid_org_cron_registered__) return;
  runtimeGlobal.__aid_org_cron_registered__ = true;

  if (typeof Deno.cron !== "function") {
    console.warn("[cron] Deno.cron is not available in this runtime");
    return;
  }

  Deno.cron("email-outbox-retry", "0 * * * *", async () => {
    try {
      const processed = await processEmailOutboxBatch(20);
      if (processed > 0) {
        console.log(`[cron] processed email outbox jobs: ${processed}`);
      }
    } catch (error) {
      console.error("[cron] email-outbox-retry failed", error);
    }
  });

  Deno.cron("email-outbox-cleanup", "0 3 * * *", async () => {
    try {
      const removed = await cleanupOldOutbox();
      if (removed > 0) {
        console.log(`[cron] cleaned old outbox jobs: ${removed}`);
      }
    } catch (error) {
      console.error("[cron] email-outbox-cleanup failed", error);
    }
  });

  Deno.cron("course-reminders", "0 7 * * *", async () => {
    try {
      const sent = await processCourseReminders();
      if (sent > 0) {
        console.log(`[cron] sent course reminders: ${sent}`);
      }
    } catch (error) {
      console.error("[cron] course-reminders failed", error);
    }
  });
}
