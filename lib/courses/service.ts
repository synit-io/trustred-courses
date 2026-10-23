import { addAuditLogToAtomic, createAuditLog } from "../audit/repository.ts";
import { enqueueEmailOutboxOnce } from "../email/repository.ts";
import {
  type CourseChangeDetails,
  renderCourseBroadcastTemplate,
} from "../email/templates.ts";
import { getKv } from "../kv/client.ts";
import type { Course, Registration } from "../types.ts";
import { normalizeCoursePricing } from "./repository.ts";
import { bumpCourseRevision, getCourseRevisionEntry } from "./revision.ts";
import {
  assertCourseDerivedStorageSize,
  assertCourseNotificationTemplateSize,
  assertCourseStorageSize,
} from "./storage.ts";

interface CourseNotificationEvent {
  id: string;
  createdAt: string;
  actorUserId: string;
  course: Course;
  event: "course_cancelled" | "course_critical_update";
  changes: CourseChangeDetails;
  cursor: { submittedAt: string; id: string } | null;
  recipientCount: number;
}

export async function getCourseChangeEntry(
  courseId: string,
): Promise<Deno.KvEntryMaybe<Course>> {
  return await (await getKv()).get<Course>(["courses", courseId], {
    consistency: "strong",
  });
}

function criticalChanges(previous: Course, next: Course): CourseChangeDetails {
  const changes: CourseChangeDetails = {};
  for (const key of ["location", "startsAt", "endsAt"] as const) {
    if (previous[key] !== next[key]) {
      changes[key] = { before: previous[key], after: next[key] };
    }
  }
  return changes;
}

/** Commit the source change, audit and durable fanout intent together. */
export async function saveCourseChangeChecked(
  previous: Deno.KvEntry<Course>,
  next: Course,
  actorUserId: string,
  action: "course.updated" | "course.closed",
): Promise<void> {
  if (previous.value.id !== next.id) {
    throw new Error("Kurs-ID darf nicht geändert werden");
  }
  const kv = await getKv();
  const normalized = normalizeCoursePricing(next);
  assertCourseStorageSize(normalized);
  const changes = criticalChanges(previous.value, normalized);
  const archivedNow = previous.value.status !== "archived" &&
    normalized.status === "archived";
  const audit = createAuditLog({
    actorUserId,
    entityType: "course",
    entityId: next.id,
    action,
    oldValue: JSON.stringify(previous.value),
    newValue: JSON.stringify(normalized),
  });
  const event: CourseNotificationEvent | null =
    archivedNow || Object.keys(changes).length > 0
      ? {
        id: crypto.randomUUID(),
        createdAt: audit.createdAt,
        actorUserId,
        course: normalized,
        event: archivedNow ? "course_cancelled" : "course_critical_update",
        changes,
        cursor: null,
        recipientCount: 0,
      }
      : null;
  if (event) {
    assertCourseDerivedStorageSize(event, "Das Benachrichtigungsereignis");
  }
  assertCourseDerivedStorageSize(audit, "Das Änderungsprotokoll");
  if (event) {
    // HTTP input bounds names to 100 characters; quotes maximize HTML escaping.
    // Reserve ample room below the KV limit for recipient/job metadata.
    const preview = renderCourseBroadcastTemplate(
      event.event,
      {
        firstName: '"'.repeat(100),
        lastName: '"'.repeat(100),
      },
      normalized,
      changes,
    );
    assertCourseNotificationTemplateSize(preview);
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const revision = await getCourseRevisionEntry(next.id);
    let tx = addAuditLogToAtomic(
      bumpCourseRevision(kv.atomic(), revision).check(previous).set(
        previous.key,
        normalized,
      ),
      audit,
    );
    if (event) {
      tx = tx.set(
        ["course_notification_events", event.createdAt, event.id],
        event,
      );
    }
    if ((await tx.commit()).ok) return;
    const current = await getCourseChangeEntry(next.id);
    if (current.versionstamp !== previous.versionstamp) {
      throw new Error(
        "Der Kurs wurde zwischenzeitlich geändert. Bitte lade die Seite neu.",
      );
    }
  }
  throw new Error(
    "Kursänderung steht im Konflikt mit anderen Änderungen. Bitte erneut versuchen.",
  );
}

/** Advance at most maxEvents batches, each hydrating at most batchSize rows.
 * Recipient eligibility is checked at fanout time, for registrations submitted
 * by event creation. Message content uses the committed event's course snapshot.
 * A crash can replay a batch; deterministic outbox identities prevent requeueing.
 */
export async function processCourseNotificationEvents(
  maxEvents = 10,
  batchSize = 50,
): Promise<number> {
  const kv = await getKv();
  const safeEvents = Math.max(1, Math.min(100, Math.floor(maxEvents)));
  const safeBatch = Math.max(1, Math.min(100, Math.floor(batchSize)));
  let advanced = 0;
  for await (
    const entry of kv.list<CourseNotificationEvent>({
      prefix: ["course_notification_events"],
    }, { limit: safeEvents })
  ) {
    const event = entry.value;
    const prefix: Deno.KvKey = ["registrations_by_course", event.course.id];
    const selector: Deno.KvListSelector = event.cursor
      ? {
        prefix,
        start: [...prefix, event.cursor.submittedAt, event.cursor.id],
      }
      : { prefix };
    const references: { submittedAt: string; id: string }[] = [];
    for await (const index of kv.list(selector, { limit: safeBatch + 2 })) {
      const reference = {
        submittedAt: String(index.key.at(-2)),
        id: String(index.key.at(-1)),
      };
      if (
        event.cursor && reference.submittedAt === event.cursor.submittedAt &&
        reference.id === event.cursor.id
      ) continue;
      // Index order makes every later registration outside this event's cutoff.
      if (reference.submittedAt > event.createdAt) break;
      references.push(reference);
      if (references.length > safeBatch) break;
    }
    const page = references.slice(0, safeBatch);
    let recipientCount = event.recipientCount;
    for (const reference of page) {
      const eventKey = `course_change:${event.id}:${reference.id}`;
      // A crash may leave a queued job with the cursor unchanged. Count its
      // durable identity even if attendance changed before replay.
      if ((await kv.get<string>(["email_outbox_events", eventKey])).value) {
        recipientCount++;
        continue;
      }
      const registration =
        (await kv.get<Registration>(["registrations", reference.id], {
          consistency: "strong",
        })).value;
      if (
        !registration || registration.courseId !== event.course.id ||
        registration.status !== "approved" ||
        registration.submittedAt > event.createdAt
      ) continue;
      const template = renderCourseBroadcastTemplate(
        event.event,
        registration,
        event.course,
        event.changes,
      );
      await enqueueEmailOutboxOnce(
        eventKey,
        {
          registrationId: registration.id,
          templateKey: event.event,
          recipientEmail: registration.email,
          ...template,
          attempt: 0,
          nextAttemptAt: new Date().toISOString(),
          lastError: null,
        },
      );
      recipientCount++;
    }
    const tx = kv.atomic().check(entry);
    if (references.length > safeBatch) {
      tx.set(
        entry.key,
        {
          ...event,
          cursor: page.at(-1)!,
          recipientCount,
        } satisfies CourseNotificationEvent,
      );
    } else {
      const audit = createAuditLog({
        actorUserId: event.actorUserId,
        entityType: "course",
        entityId: event.course.id,
        action: event.event === "course_cancelled"
          ? "course.attendees_cancelled_queued"
          : "course.attendees_update_queued",
        oldValue: null,
        newValue: JSON.stringify({
          eventId: event.id,
          recipientCount,
          changes: event.changes,
        }),
      });
      addAuditLogToAtomic(tx, audit).delete(entry.key);
    }
    if ((await tx.commit()).ok) advanced++;
  }
  return advanced;
}
