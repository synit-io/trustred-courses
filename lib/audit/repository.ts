import { getKv } from "../kv/client.ts";
import type { AuditLog } from "../types.ts";

export interface AuditLogPage {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export async function appendAuditLog(
  entry: Omit<AuditLog, "id" | "createdAt">,
): Promise<AuditLog> {
  const kv = await getKv();
  const now = new Date().toISOString();
  const log: AuditLog = {
    id: crypto.randomUUID(),
    createdAt: now,
    ...entry,
  };

  await kv.atomic()
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
    )
    .commit();

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
