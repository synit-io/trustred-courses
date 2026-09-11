import { insertAuditLogRecords } from "../audit/repository.ts";
import { upsertCourse } from "../courses/repository.ts";
import { insertEmailLogRecords } from "../email/repository.ts";
import { env, isDemoMode } from "../env.ts";
import { rebuildAllPublicSnapshots } from "../public_snapshot/service.ts";
import { createRegistration } from "../registrations/repository.ts";
import { createUserFromEmail } from "../users/repository.ts";
import { DEMO_ACCOUNTS, DEMO_ADMIN_ACCOUNT } from "./accounts.ts";
import { type DemoDataset, generateDemoDataset } from "./generator.ts";

export class DemoModeDisabledError extends Error {
  constructor() {
    super(
      "Demo-Seed ist nur mit DEMO_MODE=true erlaubt. DEMO_MODE deaktiviert außerdem jeden E-Mail-Versand.",
    );
    this.name = "DemoModeDisabledError";
  }
}

export interface DemoSeedOptions {
  courses?: number;
  minRegistrations?: number;
  maxRegistrations?: number;
  seed?: number;
  now?: Date;
}

export interface DemoSeedSummary {
  courses: number;
  registrations: number;
  auditLogs: number;
  emailLogs: number;
  accounts: string[];
}

const KV_BATCH_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Adds a fresh batch of demo courses, registrations and history to the KV
 * store. Safe to run any number of times; every run appends new records.
 *
 * Refuses to run unless DEMO_MODE=true, which also disables all outgoing
 * mail, so seeded (undeliverable) addresses can never be contacted.
 */
export async function seedDemoData(
  options: DemoSeedOptions = {},
): Promise<DemoSeedSummary> {
  if (!isDemoMode()) {
    throw new DemoModeDisabledError();
  }

  await createUserFromEmail(env.initialAdminEmail, "super_admin");
  const accounts = [] as string[];
  let actorUserId: string | null = null;
  for (const account of DEMO_ACCOUNTS) {
    const user = await createUserFromEmail(account.email, account.role);
    accounts.push(user.email);
    if (account.email === DEMO_ADMIN_ACCOUNT.email) actorUserId = user.id;
  }

  const dataset: DemoDataset = generateDemoDataset({
    courses: options.courses ?? 8,
    minRegistrations: options.minRegistrations,
    maxRegistrations: options.maxRegistrations,
    seed: options.seed,
    now: options.now,
    actorUserId,
  });

  for (const course of dataset.courses) {
    await upsertCourse(course);
  }
  for (const registration of dataset.registrations) {
    await createRegistration(registration);
  }
  for (const batch of chunk(dataset.auditLogs, KV_BATCH_SIZE)) {
    await insertAuditLogRecords(batch);
  }
  for (const batch of chunk(dataset.emailLogs, KV_BATCH_SIZE)) {
    await insertEmailLogRecords(batch);
  }

  await rebuildAllPublicSnapshots();

  return {
    courses: dataset.courses.length,
    registrations: dataset.registrations.length,
    auditLogs: dataset.auditLogs.length,
    emailLogs: dataset.emailLogs.length,
    accounts,
  };
}
