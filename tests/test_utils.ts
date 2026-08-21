import { __setKvFactoryForTests } from "../lib/kv/client.ts";

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
