let kvPromise: Promise<Deno.Kv> | null = null;

function dirname(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

async function createDefaultKv(): Promise<Deno.Kv> {
  const deploymentId = Deno.env.get("DENO_DEPLOYMENT_ID");
  const configuredPath = (Deno.env.get("KV_PATH") ?? "").trim();

  // Always use managed KV on Deno Deploy.
  if (deploymentId) {
    try {
      const kv = await Deno.openKv();
      // Force a metadata request during startup to fail fast with a clear message
      // when no managed KV database is attached to the Deploy app/project.
      await kv.get(["kv_bootstrap_probe"]);
      return kv;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Managed Deno KV is unavailable on Deploy. Attach a KV database to this Deploy app/project. Original error: ${message}`,
      );
    }
  }

  const kvPath = configuredPath || ".data/aid-org-courses.kv";
  const dir = dirname(kvPath);
  if (dir) {
    await Deno.mkdir(dir, { recursive: true });
  }
  return await Deno.openKv(kvPath);
}

let kvFactory: () => Promise<Deno.Kv> = createDefaultKv;

export function getKv(): Promise<Deno.Kv> {
  if (!kvPromise) {
    kvPromise = kvFactory();
  }
  return kvPromise!;
}

export function __setKvFactoryForTests(
  factory: (() => Promise<Deno.Kv>) | null,
): void {
  kvFactory = factory ?? createDefaultKv;
  kvPromise = null;
}
