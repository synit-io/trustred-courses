import { resetDemoData } from "../demo/reset.ts";
import { parseCronSchedule } from "../demo/schedule.ts";
import { env, isDemoResetEnabled } from "../env.ts";
import { processCourseReminders } from "../email/service.ts";
import { listEmailOutboxHealth } from "../email/repository.ts";
import { processPendingPayPalPayments } from "../payments/service.ts";
import { processCourseNotificationEvents } from "../courses/service.ts";
import { cleanupOldDeadLetters, drainEmailOutbox } from "./maintenance.ts";

type CronGlobal = typeof globalThis & { __aid_org_cron_registered__?: boolean };

export function registerCronJobs(): void {
  const runtimeGlobal = globalThis as CronGlobal;
  if (runtimeGlobal.__aid_org_cron_registered__) return;
  runtimeGlobal.__aid_org_cron_registered__ = true;

  if (typeof Deno.cron !== "function") {
    console.warn("[cron] Deno.cron is not available in this runtime");
    return;
  }

  Deno.cron("email-outbox-retry", "*/5 * * * *", async () => {
    try {
      const processed = await drainEmailOutbox();
      if (processed > 0) {
        console.log(`[cron] processed email outbox jobs: ${processed}`);
      }
      console.log("[cron] email outbox health", await listEmailOutboxHealth());
    } catch (error) {
      console.error("[cron] email-outbox-retry failed", error);
    }
  });

  Deno.cron("email-dead-letter-cleanup", "0 3 * * *", async () => {
    try {
      const removed = await cleanupOldDeadLetters();
      if (removed > 0) {
        console.log(`[cron] cleaned terminal email failures: ${removed}`);
      }
    } catch (error) {
      console.error("[cron] email-dead-letter-cleanup failed", error);
    }
  });

  Deno.cron("paypal-payment-recovery", "*/5 * * * *", async () => {
    try {
      const processed = await processPendingPayPalPayments();
      if (processed > 0) {
        console.log(`[cron] reconciled PayPal payments: ${processed}`);
      }
    } catch (error) {
      console.error("[cron] paypal-payment-recovery failed", error);
    }
  });

  Deno.cron("course-notification-recovery", "*/5 * * * *", async () => {
    try {
      const processed = await processCourseNotificationEvents();
      if (processed > 0) {
        console.log(
          `[cron] advanced course notification batches: ${processed}`,
        );
        await drainEmailOutbox();
      }
    } catch (error) {
      console.error("[cron] course-notification-recovery failed", error);
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

  if (isDemoResetEnabled()) {
    if (!parseCronSchedule(env.demoModeResetCron)) {
      console.error(
        `[cron] invalid DEMO_MODE_RESET_CRON "${env.demoModeResetCron}", automatic demo reset disabled`,
      );
      return;
    }
    try {
      Deno.cron("demo-reset", env.demoModeResetCron, async () => {
        try {
          const summary = await resetDemoData({}, "cron");
          console.log(
            `[cron] demo reset: ${summary.deletedKeys} keys wiped, ${summary.courses} courses, ${summary.registrations} registrations`,
          );
        } catch (error) {
          console.error("[cron] demo-reset failed", error);
        }
      });
      console.log(`[cron] demo reset scheduled: ${env.demoModeResetCron}`);
    } catch (error) {
      console.error(
        `[cron] invalid DEMO_MODE_RESET_CRON "${env.demoModeResetCron}"`,
        error,
      );
    }
  }
}
