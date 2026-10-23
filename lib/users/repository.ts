import { getKv } from "../kv/client.ts";
import { parseMailbox } from "../email/mailbox.ts";
import type { User, UserRole } from "../types.ts";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function upsertUser(user: User): Promise<void> {
  const kv = await getKv();
  const email = parseMailbox(user.email);
  if (!email || email !== user.emailNormalized) {
    throw new Error("E-Mail ungültig");
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const entries: [Deno.KvEntryMaybe<User>, Deno.KvEntryMaybe<string>] =
      await kv.getMany<[User, string]>([
        ["users", user.id],
        ["users_by_email", email],
      ], { consistency: "strong" });
    const [current, index] = entries;
    if (index.value && index.value !== user.id) {
      throw new Error("E-Mail bereits vergeben");
    }
    if (current.value && current.value.emailNormalized !== email) {
      throw new Error("E-Mail bestehender Konten kann nicht geändert werden");
    }
    if (
      (await kv.atomic().check(current, index)
        .set(current.key, { ...user, email })
        .set(index.key, user.id).commit()).ok
    ) return;
  }
  throw new Error("Benutzer konnte nicht gespeichert werden");
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const kv = await getKv();
  const emailNormalized = parseMailbox(email);
  if (!emailNormalized) return null;
  const idEntry = await kv.get<string>(["users_by_email", emailNormalized]);
  if (!idEntry.value) {
    return null;
  }

  const userEntry = await kv.get<User>(["users", idEntry.value]);
  return userEntry.value?.emailNormalized === emailNormalized
    ? userEntry.value
    : null;
}

export async function createUserFromEmail(
  email: string,
  role: UserRole,
): Promise<User> {
  const emailNormalized = parseMailbox(email);
  if (!emailNormalized) throw new Error("E-Mail ungültig");
  const kv = await getKv();
  const now = new Date().toISOString();
  const user: User = {
    id: crypto.randomUUID(),
    email: emailNormalized,
    emailNormalized,
    role,
    authVersion: 1,
    active: true,
    createdAt: now,
  };

  for (let attempt = 0; attempt < 10; attempt++) {
    const index = await kv.get<string>(["users_by_email", emailNormalized], {
      consistency: "strong",
    });
    if (index.value) {
      const existing = await getUserByEmail(emailNormalized);
      if (existing) return existing;
      // Repair an orphaned index only with its observed version.
    }
    if (
      (await kv.atomic().check(index)
        .set(["users", user.id], user)
        .set(index.key, user.id).commit()).ok
    ) return user;
  }
  throw new Error("Benutzer konnte nicht angelegt werden");
}

export async function ensureInitialAdminUser(
  email: string,
): Promise<"created" | "updated" | "noop"> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return "noop";
  }

  const existing = await getUserByEmail(normalized);
  if (!existing) {
    await createUserFromEmail(normalized, "super_admin");
    return "created";
  }

  if (existing.active && existing.role === "super_admin") {
    return "noop";
  }

  const updated: User = {
    ...existing,
    email: normalized,
    emailNormalized: normalized,
    role: "super_admin",
    active: true,
    authVersion: existing.authVersion + 1,
  };
  await upsertUser(updated);
  return "updated";
}

export async function ensureInitialAdminUserBootstrappedOnce(
  email: string,
): Promise<"created" | "updated" | "noop" | "already_bootstrapped"> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return "noop";
  }

  const kv = await getKv();
  const markerKey: Deno.KvKey = ["bootstrap", "initial_admin", normalized];
  const marker = await kv.get<boolean>(markerKey, { consistency: "strong" });
  if (marker.value === true) {
    return "already_bootstrapped";
  }

  const result = await ensureInitialAdminUser(normalized);
  await kv.set(markerKey, true);
  return result;
}

export async function getUserById(userId: string): Promise<User | null> {
  const kv = await getKv();
  const userEntry = await kv.get<User>(["users", userId]);
  return userEntry.value;
}

export async function deleteUserById(userId: string): Promise<boolean> {
  const kv = await getKv();
  for (let attempt = 0; attempt < 10; attempt++) {
    const userEntry = await kv.get<User>(["users", userId], {
      consistency: "strong",
    });
    if (!userEntry.value) return false;
    const index = await kv.get<string>([
      "users_by_email",
      userEntry.value.emailNormalized,
    ], { consistency: "strong" });
    let tx = kv.atomic().check(userEntry, index).delete(userEntry.key);
    if (index.value === userId) tx = tx.delete(index.key);
    if ((await tx.commit()).ok) return true;
  }
  throw new Error("Benutzer konnte nicht gelöscht werden");
}

export async function listUsers(): Promise<User[]> {
  const kv = await getKv();
  const users: User[] = [];

  for await (const entry of kv.list<User>({ prefix: ["users"] })) {
    users.push(entry.value);
  }

  return users.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
