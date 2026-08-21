import { getKv } from "../kv/client.ts";
import type { EmailLog, EmailOutboxJob } from "../types.ts";

export interface EmailLogPage {
  items: EmailLog[];
  total: number;
  page: number;
  pageSize: number;
}

export async function appendEmailLog(
  entry: Omit<EmailLog, "id" | "sentAt" | "attempt"> & { attempt?: number },
): Promise<EmailLog> {
  const kv = await getKv();
  const log: EmailLog = {
    id: crypto.randomUUID(),
    sentAt: new Date().toISOString(),
    ...entry,
    attempt: entry.attempt ?? 1,
  };

  await kv.atomic()
    .set(["email_logs", log.id], log)
    .set(
      ["email_logs_by_registration", log.registrationId, log.sentAt, log.id],
      log.deliveryStatus,
    )
    .commit();

  return log;
}

export async function enqueueEmailOutbox(
  entry: Omit<EmailOutboxJob, "id" | "createdAt">,
): Promise<EmailOutboxJob> {
  const kv = await getKv();
  const job: EmailOutboxJob = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  };

  await kv.set(["email_outbox", job.id], job);
  return job;
}

export async function deleteEmailOutbox(jobId: string): Promise<void> {
  const kv = await getKv();
  await kv.delete(["email_outbox", jobId]);
}

export async function updateEmailOutbox(job: EmailOutboxJob): Promise<void> {
  const kv = await getKv();
  await kv.set(["email_outbox", job.id], job);
}

export async function listDueEmailOutbox(
  now = new Date(),
): Promise<EmailOutboxJob[]> {
  const kv = await getKv();
  const jobs: EmailOutboxJob[] = [];

  for await (
    const entry of kv.list<EmailOutboxJob>({ prefix: ["email_outbox"] })
  ) {
    if (Date.parse(entry.value.nextAttemptAt) <= now.getTime()) {
      jobs.push(entry.value);
    }
  }

  return jobs.sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt));
}

export async function listEmailLogsByRegistration(
  registrationId: string,
): Promise<EmailLog[]> {
  const page = await listEmailLogsByRegistrationPaginated(
    registrationId,
    1,
    500,
  );
  return page.items;
}

export async function listEmailLogsByRegistrationPaginated(
  registrationId: string,
  page = 1,
  pageSize = 10,
): Promise<EmailLogPage> {
  const kv = await getKv();
  const logs: EmailLog[] = [];

  for await (
    const idx of kv.list<string>({
      prefix: ["email_logs_by_registration", registrationId],
    })
  ) {
    const logId = String(idx.key.at(-1));
    const entry = await kv.get<EmailLog>(["email_logs", logId]);
    if (entry.value) {
      logs.push(entry.value);
    }
  }

  const sorted = logs.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const start = (safePage - 1) * safePageSize;
  const end = start + safePageSize;

  return {
    items: sorted.slice(start, end),
    total: sorted.length,
    page: safePage,
    pageSize: safePageSize,
  };
}

export async function hasCourseReminderBeenSent(
  registrationId: string,
  courseId: string,
  reminderDaysBefore: number,
): Promise<boolean> {
  const kv = await getKv();
  const entry = await kv.get<boolean>([
    "course_reminders_sent",
    courseId,
    reminderDaysBefore,
    registrationId,
  ], {
    consistency: "strong",
  });
  return entry.value === true;
}

export async function markCourseReminderSent(
  registrationId: string,
  courseId: string,
  reminderDaysBefore: number,
): Promise<void> {
  const kv = await getKv();
  await kv.set(
    ["course_reminders_sent", courseId, reminderDaysBefore, registrationId],
    true,
  );
}
