import { getKv } from "../kv/client.ts";
import type { Registration, RegistrationStatus } from "../types.ts";

export async function createRegistration(
  registration: Registration,
): Promise<void> {
  const kv = await getKv();
  await kv.atomic()
    .set(["registrations", registration.id], registration)
    .set(
      [
        "registrations_by_course",
        registration.courseId,
        registration.submittedAt,
        registration.id,
      ],
      registration.status,
    )
    .set([
      "registrations_by_status",
      registration.status,
      registration.submittedAt,
      registration.id,
    ], registration.courseId)
    .commit();
}

export async function listRegistrationsByCourse(
  courseId: string,
): Promise<Registration[]> {
  const kv = await getKv();
  const registrations: Registration[] = [];

  for await (
    const entry of kv.list<string>({
      prefix: ["registrations_by_course", courseId],
    })
  ) {
    const registrationId = String(entry.key.at(-1));
    const registrationEntry = await kv.get<Registration>([
      "registrations",
      registrationId,
    ]);
    if (registrationEntry.value) {
      registrations.push(registrationEntry.value);
    }
  }

  return registrations.sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt)
  );
}

export async function listRegistrations(limit = 200): Promise<Registration[]> {
  const kv = await getKv();
  const registrations: Registration[] = [];

  for await (
    const entry of kv.list<Registration>({ prefix: ["registrations"] })
  ) {
    registrations.push(entry.value);
    if (registrations.length >= limit) break;
  }

  return registrations.sort((a, b) =>
    b.submittedAt.localeCompare(a.submittedAt)
  );
}

export async function getRegistrationById(
  registrationId: string,
): Promise<Registration | null> {
  const kv = await getKv();
  const entry = await kv.get<Registration>(["registrations", registrationId], {
    consistency: "strong",
  });
  return entry.value;
}

export async function updateRegistration(
  previous: Registration,
  next: Registration,
): Promise<void> {
  const kv = await getKv();

  const tx = kv.atomic().set(["registrations", next.id], next);

  tx.set(
    ["registrations_by_course", next.courseId, next.submittedAt, next.id],
    next.status,
  );

  if (previous.status !== next.status) {
    tx.delete([
      "registrations_by_status",
      previous.status,
      previous.submittedAt,
      previous.id,
    ]);
    tx.set(
      ["registrations_by_status", next.status, next.submittedAt, next.id],
      next.courseId,
    );
  }

  await tx.commit();
}

export async function countRegistrationsByStatus(
  courseId: string,
  status: RegistrationStatus,
): Promise<number> {
  const registrations = await listRegistrationsByCourse(courseId);
  return registrations.filter((registration) => registration.status === status)
    .length;
}

export async function recalculateWaitlistPositions(
  courseId: string,
): Promise<void> {
  const registrations = await listRegistrationsByCourse(courseId);
  const waitlisted = registrations.filter((entry) =>
    entry.status === "waitlisted"
  )
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

  const kv = await getKv();
  const tx = kv.atomic();

  waitlisted.forEach((entry, index) => {
    const nextPosition = index + 1;
    if (entry.waitingListPosition !== nextPosition) {
      tx.set(
        ["registrations", entry.id],
        {
          ...entry,
          waitingListPosition: nextPosition,
        } satisfies Registration,
      );
    }
  });

  await tx.commit();
}
