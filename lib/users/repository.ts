import { getKv } from "../kv/client.ts";
import type { User, UserRole } from "../types.ts";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function upsertUser(user: User): Promise<void> {
  const kv = await getKv();
  await kv.atomic()
    .set(["users", user.id], user)
    .set(["users_by_email", user.emailNormalized], user.id)
    .commit();
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const kv = await getKv();
  const emailNormalized = normalizeEmail(email);
  const idEntry = await kv.get<string>(["users_by_email", emailNormalized]);
  if (!idEntry.value) {
    return null;
  }

  const userEntry = await kv.get<User>(["users", idEntry.value]);
  return userEntry.value;
}

export async function createUserFromEmail(
  email: string,
  role: UserRole,
): Promise<User> {
  const existing = await getUserByEmail(email);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const user: User = {
    id: crypto.randomUUID(),
    email: email.trim(),
    emailNormalized: normalizeEmail(email),
    role,
    authVersion: 1,
    active: true,
    createdAt: now,
  };

  await upsertUser(user);
  return user;
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
  const userEntry = await kv.get<User>(["users", userId], {
    consistency: "strong",
  });
  if (!userEntry.value) {
    return false;
  }

  await kv.atomic()
    .delete(["users", userId])
    .delete(["users_by_email", userEntry.value.emailNormalized])
    .commit();
  return true;
}

export async function listUsers(): Promise<User[]> {
  const kv = await getKv();
  const users: User[] = [];

  for await (const entry of kv.list<User>({ prefix: ["users"] })) {
    users.push(entry.value);
  }

  return users.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
