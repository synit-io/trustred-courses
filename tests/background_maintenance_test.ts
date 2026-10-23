import { assertEquals } from "@std/assert";
import {
  cleanupOldDeadLetters,
  drainEmailOutbox,
} from "../lib/background/maintenance.ts";
import { enqueueEmailOutboxOnce } from "../lib/email/repository.ts";
import { __setEmailSenderForTests } from "../lib/email/service.ts";
import { setupKvTest } from "./test_utils.ts";

Deno.test("retention preserves old pending and leased mail; deletes only expired terminal records", async () => {
  const { kv, cleanup } = await setupKvTest("outbox-retention");
  try {
    const old = "2020-01-01T00:00:00Z";
    await kv.set(["email_outbox", "pending"], { createdAt: old });
    await kv.set(["email_outbox", "leased"], {
      createdAt: old,
      leaseOwner: "worker",
      leaseExpiresAt: "2099-01-01T00:00:00Z",
    });
    await kv.set(["email_dead_letters", "old"], { failedAt: old });
    await kv.set(["email_dead_letters", "recent"], {
      failedAt: "2026-10-22T00:00:00Z",
    });
    assertEquals(
      await cleanupOldDeadLetters(30, new Date("2026-10-23T00:00:00Z")),
      1,
    );
    assertEquals((await kv.get(["email_outbox", "pending"])).value, {
      createdAt: old,
    });
    assertEquals(
      (await kv.get(["email_outbox", "leased"])).value !== null,
      true,
    );
    assertEquals((await kv.get(["email_dead_letters", "old"])).value, null);
    assertEquals(
      (await kv.get(["email_dead_letters", "recent"])).value !== null,
      true,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("background drain processes multiple batches but remains bounded", async () => {
  const { kv, cleanup } = await setupKvTest("outbox-drain");
  let sends = 0;
  __setEmailSenderForTests(() => {
    sends++;
    return Promise.resolve({ ok: true });
  });
  try {
    for (let index = 0; index < 5; index++) {
      await enqueueEmailOutboxOnce(`batch-${index}`, {
        registrationId: `r-${index}`,
        templateKey: "approved",
        recipientEmail: "participant@example.invalid",
        subject: "Course",
        text: "Confirmed",
        html: "<p>Confirmed</p>",
        attempt: 0,
        nextAttemptAt: new Date().toISOString(),
        lastError: null,
      });
    }
    assertEquals(await drainEmailOutbox(2, 2), 4);
    assertEquals(sends, 4);
    let remaining = 0;
    for await (const _entry of kv.list({ prefix: ["email_outbox"] })) {
      remaining++;
    }
    assertEquals(remaining, 1);
    assertEquals(await drainEmailOutbox(2, 2), 1);
    assertEquals(sends, 5);
  } finally {
    __setEmailSenderForTests(null);
    await cleanup();
  }
});
