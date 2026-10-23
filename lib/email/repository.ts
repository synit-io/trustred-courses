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

export async function enqueueEmailOutboxOnce(
  eventKey: string,
  entry: Omit<EmailOutboxJob, "id" | "createdAt" | "eventKey">,
): Promise<EmailOutboxJob | null> {
  const kv = await getKv();
  const eventIndexKey: Deno.KvKey = ["email_outbox_events", eventKey];
  const existing = await kv.get<string>(eventIndexKey, {
    consistency: "strong",
  });
  if (existing.value) return null;
  const job: EmailOutboxJob = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    eventKey,
    leaseOwner: null,
    leaseExpiresAt: null,
    ...entry,
  };
  const commit = await kv.atomic()
    .check(existing)
    .set(["email_outbox", job.id], job)
    .set(eventIndexKey, job.id)
    .commit();
  return commit.ok ? job : null;
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

export async function claimDueEmailOutbox(
  limit: number,
  now = new Date(),
  excludedIds: ReadonlySet<string> = new Set(),
): Promise<EmailOutboxJob[]> {
  const kv = await getKv();
  const claimed: EmailOutboxJob[] = [];
  const leaseOwner = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  for await (
    const entry of kv.list<EmailOutboxJob>({ prefix: ["email_outbox"] })
  ) {
    if (claimed.length >= limit) break;
    const job = entry.value;
    if (excludedIds.has(job.id)) continue;
    if (Date.parse(job.nextAttemptAt) > now.getTime()) continue;
    if (
      job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > now.getTime()
    ) continue;
    const next = { ...job, leaseOwner, leaseExpiresAt };
    if ((await kv.atomic().check(entry).set(entry.key, next).commit()).ok) {
      claimed.push(next);
    }
  }
  return claimed;
}

/** Refresh ownership immediately before dispatch; a stale claim must never start mail. */
export async function renewClaimedEmailOutbox(
  job: EmailOutboxJob,
  now = new Date(),
): Promise<EmailOutboxJob | null> {
  const kv = await getKv();
  const current = await kv.get<EmailOutboxJob>(["email_outbox", job.id], {
    consistency: "strong",
  });
  if (
    !current.value || !job.leaseOwner ||
    current.value.leaseOwner !== job.leaseOwner ||
    !current.value.leaseExpiresAt ||
    Date.parse(current.value.leaseExpiresAt) <= now.getTime()
  ) return null;
  const renewed = {
    ...current.value,
    leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
  };
  return (await kv.atomic().check(current).set(current.key, renewed).commit())
      .ok
    ? renewed
    : null;
}

export async function deadLetterClaimedEmailOutbox(
  job: EmailOutboxJob,
): Promise<boolean> {
  const kv = await getKv();
  const current = await kv.get<EmailOutboxJob>(["email_outbox", job.id], {
    consistency: "strong",
  });
  if (!current.value || current.value.leaseOwner !== job.leaseOwner) {
    return false;
  }
  return (await kv.atomic().check(current)
    .set(["email_dead_letters", job.id], {
      ...job,
      leaseOwner: null,
      leaseExpiresAt: null,
      failedAt: new Date().toISOString(),
    }).delete(current.key).commit()).ok;
}

export async function listEmailOutboxHealth(now = new Date()): Promise<{
  pending: number;
  due: number;
  leased: number;
  oldestPendingAt: string | null;
  deadLetters: number;
}> {
  const kv = await getKv();
  let pending = 0;
  let due = 0;
  let leased = 0;
  let oldestPendingAt: string | null = null;
  let deadLetters = 0;
  for await (
    const { value } of kv.list<EmailOutboxJob>({ prefix: ["email_outbox"] })
  ) {
    pending++;
    if (Date.parse(value.nextAttemptAt) <= now.getTime()) due++;
    if (
      value.leaseExpiresAt && Date.parse(value.leaseExpiresAt) > now.getTime()
    ) leased++;
    if (!oldestPendingAt || value.createdAt < oldestPendingAt) {
      oldestPendingAt = value.createdAt;
    }
  }
  for await (const _entry of kv.list({ prefix: ["email_dead_letters"] })) {
    deadLetters++;
  }
  return { pending, due, leased, oldestPendingAt, deadLetters };
}

export async function deleteClaimedEmailOutbox(
  job: EmailOutboxJob,
): Promise<boolean> {
  const kv = await getKv();
  const current = await kv.get<EmailOutboxJob>(["email_outbox", job.id], {
    consistency: "strong",
  });
  if (!current.value || current.value.leaseOwner !== job.leaseOwner) {
    return false;
  }
  return (await kv.atomic().check(current).delete(current.key).commit()).ok;
}

export async function updateClaimedEmailOutbox(
  job: EmailOutboxJob,
): Promise<boolean> {
  const kv = await getKv();
  const current = await kv.get<EmailOutboxJob>(["email_outbox", job.id], {
    consistency: "strong",
  });
  if (!current.value || current.value.leaseOwner !== job.leaseOwner) {
    return false;
  }
  return (await kv.atomic().check(current).set(current.key, {
    ...job,
    leaseOwner: null,
    leaseExpiresAt: null,
  }).commit()).ok;
}

export interface EmailLogReference {
  id: string;
  sentAt: string;
}

export async function listEmailLogReferencesByRegistration(
  registrationId: string,
): Promise<EmailLogReference[]> {
  const kv = await getKv();
  const references: EmailLogReference[] = [];
  for await (
    const entry of kv.list({
      prefix: ["email_logs_by_registration", registrationId],
    }, { reverse: true })
  ) {
    references.push({
      id: String(entry.key.at(-1)),
      sentAt: String(entry.key.at(-2)),
    });
  }
  return references;
}

export async function hydrateEmailLogs(ids: string[]): Promise<EmailLog[]> {
  const kv = await getKv();
  const logs: EmailLog[] = [];
  for (const id of ids) {
    const entry = await kv.get<EmailLog>(["email_logs", id]);
    if (entry.value) logs.push(entry.value);
  }
  return logs;
}

export async function listEmailLogsByRegistration(
  registrationId: string,
): Promise<EmailLog[]> {
  const references = await listEmailLogReferencesByRegistration(registrationId);
  return await hydrateEmailLogs(references.map((r) => r.id));
}

export async function listEmailLogsByRegistrationPaginated(
  registrationId: string,
  page = 1,
  pageSize = 10,
): Promise<EmailLogPage> {
  const references = await listEmailLogReferencesByRegistration(registrationId);
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const start = (safePage - 1) * safePageSize;
  return {
    items: await hydrateEmailLogs(
      references.slice(start, start + safePageSize).map((r) => r.id),
    ),
    total: references.length,
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

export async function insertEmailLogRecords(logs: EmailLog[]): Promise<void> {
  if (logs.length === 0) return;
  const kv = await getKv();
  let tx = kv.atomic();
  for (const log of logs) {
    tx = tx
      .set(["email_logs", log.id], log)
      .set(
        ["email_logs_by_registration", log.registrationId, log.sentAt, log.id],
        log.deliveryStatus,
      );
  }
  await tx.commit();
}
