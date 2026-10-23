import { getKv } from "../kv/client.ts";
import type { AuditLog } from "../types.ts";

export interface AuditLogPage {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export function createAuditLog(
  entry: Omit<AuditLog, "id" | "createdAt">,
): AuditLog {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  };
}

export function addAuditLogToAtomic(
  tx: Deno.AtomicOperation,
  log: AuditLog,
): Deno.AtomicOperation {
  return tx
    .set(["audit_logs", log.id], log)
    .set(
      [
        "audit_logs_by_entity",
        log.entityType,
        log.entityId,
        log.createdAt,
        log.id,
      ],
      log.action,
    );
}

export async function appendAuditLog(
  entry: Omit<AuditLog, "id" | "createdAt">,
): Promise<AuditLog> {
  const kv = await getKv();
  const log = createAuditLog(entry);

  await addAuditLogToAtomic(kv.atomic(), log).commit();

  return log;
}

export interface AuditLogReference {
  id: string;
  createdAt: string;
}

export async function listAuditLogReferencesByEntity(
  entityType: string,
  entityId: string,
): Promise<AuditLogReference[]> {
  const kv = await getKv();
  const references: AuditLogReference[] = [];
  for await (
    const entry of kv.list({
      prefix: ["audit_logs_by_entity", entityType, entityId],
    }, { reverse: true })
  ) {
    references.push({
      id: String(entry.key.at(-1)),
      createdAt: String(entry.key.at(-2)),
    });
  }
  return references;
}

export async function hydrateAuditLogs(ids: string[]): Promise<AuditLog[]> {
  const kv = await getKv();
  const logs: AuditLog[] = [];
  for (const id of ids) {
    const entry = await kv.get<AuditLog>(["audit_logs", id]);
    if (entry.value) logs.push(entry.value);
  }
  return logs;
}

export async function listAuditLogsByEntity(
  entityType: string,
  entityId: string,
): Promise<AuditLog[]> {
  const references = await listAuditLogReferencesByEntity(entityType, entityId);
  return await hydrateAuditLogs(references.map((reference) => reference.id));
}

export async function listAuditLogsByEntityPaginated(
  entityType: string,
  entityId: string,
  page = 1,
  pageSize = 10,
): Promise<AuditLogPage> {
  const references = await listAuditLogReferencesByEntity(entityType, entityId);
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const start = (safePage - 1) * safePageSize;
  return {
    items: await hydrateAuditLogs(
      references.slice(start, start + safePageSize).map((r) => r.id),
    ),
    total: references.length,
    page: safePage,
    pageSize: safePageSize,
  };
}

export async function insertAuditLogRecords(logs: AuditLog[]): Promise<void> {
  if (logs.length === 0) return;
  const kv = await getKv();
  let tx = kv.atomic();
  for (const log of logs) {
    tx = addAuditLogToAtomic(tx, log);
  }
  await tx.commit();
}
