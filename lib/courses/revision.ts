import { getKv } from "../kv/client.ts";

// All course and registration writes share this fence, including deletions.
// Readers capture it before deriving state and check it when publishing.
export async function getCourseRevisionEntry(
  courseId: string,
): Promise<Deno.KvEntryMaybe<string>> {
  const kv = await getKv();
  return await kv.get<string>(["course_revision", courseId], {
    consistency: "strong",
  });
}

export function bumpCourseRevision(
  tx: Deno.AtomicOperation,
  revision: Deno.KvEntryMaybe<string>,
): Deno.AtomicOperation {
  return tx.check(revision).set(revision.key, crypto.randomUUID());
}
