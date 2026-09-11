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

export async function listAuditLogsByEntity(
  entityType: string,
  entityId: string,
): Promise<AuditLog[]> {
  const page = await listAuditLogsByEntityPaginated(
    entityType,
    entityId,
    1,
    500,
  );
  return page.items;
}

export async function listAuditLogsByEntityPaginated(
  entityType: string,
  entityId: string,
  page = 1,
  pageSize = 10,
): Promise<AuditLogPage> {
  const kv = await getKv();
  const logs: AuditLog[] = [];

  for await (
    const indexEntry of kv.list<string>({
      prefix: ["audit_logs_by_entity", entityType, entityId],
    })
  ) {
    const logId = String(indexEntry.key.at(-1));
    const logEntry = await kv.get<AuditLog>(["audit_logs", logId]);
    if (logEntry.value) {
      logs.push(logEntry.value);
    }
  }

  const sorted = logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

export async function insertAuditLogRecords(logs: AuditLog[]): Promise<void> {
  if (logs.length === 0) return;
  const kv = await getKv();
  let tx = kv.atomic();
  for (const log of logs) {
    tx = addAuditLogToAtomic(tx, log);
  }
  await tx.commit();
}
