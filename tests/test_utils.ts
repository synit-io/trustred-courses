import { __setKvFactoryForTests } from "../lib/kv/client.ts";

export function futureIso(daysFromNow: number, hourUtc: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

export interface KvTestContext {
  kv: Deno.Kv;
  cleanup: () => Promise<void>;
}

export async function setupKvTest(prefix: string): Promise<KvTestContext> {
  const kvPath = await Deno.makeTempFile({
    prefix,
    suffix: ".sqlite",
  });
  const kv = await Deno.openKv(kvPath);
  __setKvFactoryForTests(() => Promise.resolve(kv));

  return {
    kv,
    cleanup: async () => {
      __setKvFactoryForTests(null);
      kv.close();
      await Deno.remove(kvPath).catch(() => {});
    },
  };
}
