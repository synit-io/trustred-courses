import { assert, assertEquals } from "@std/assert";
import {
  appendAuditLog,
  listAuditLogsByEntity,
} from "../lib/audit/repository.ts";
import { __setKvFactoryForTests } from "../lib/kv/client.ts";

Deno.test("audit logs are persisted and listed by entity", async () => {
  const kvPath = await Deno.makeTempFile({
    prefix: "audit-test-",
    suffix: ".sqlite",
  });
  const kv = await Deno.openKv(kvPath);

  __setKvFactoryForTests(() => Promise.resolve(kv));

  try {
    await appendAuditLog({
      actorUserId: "user-1",
      entityType: "registration",
      entityId: "reg-1",
      action: "registration.submitted",
      oldValue: null,
      newValue: '{"status":"pending_review"}',
    });

    await appendAuditLog({
      actorUserId: "user-2",
      entityType: "registration",
      entityId: "reg-1",
      action: "registration.approve",
      oldValue: '{"status":"pending_review"}',
      newValue: '{"status":"approved"}',
    });

    const logs = await listAuditLogsByEntity("registration", "reg-1");
    assertEquals(logs.length, 2);
    assert(logs.some((entry) => entry.action === "registration.approve"));
    assert(logs.some((entry) => entry.action === "registration.submitted"));
  } finally {
    __setKvFactoryForTests(null);
    kv.close();
    await Deno.remove(kvPath).catch(() => {});
  }
});
