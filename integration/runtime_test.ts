import { assert, assertEquals } from "@std/assert";

const root = new URL("../", import.meta.url).pathname;

function terminateChild(child: Deno.ChildProcess): void {
  try {
    // Cron resources can outlive graceful server shutdown in these test children.
    child.kill("SIGKILL");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

function isolatedEnvironment(): Record<string, string> {
  const result: Record<string, string> = {
    KV_PATH: ":memory:",
    INITIAL_ADMIN_EMAIL: "runtime-test@example.invalid",
    DEMO_MODE: "false",
    AUTH_DEV_EXPOSE_MAGIC_LINK: "false",
    NODE_ENV: "production",
    APP_TIME_ZONE: "Europe/Berlin",
    LOG_LEVEL: "error",
  };
  // Retain only runtime/cache discovery, never inherit service credentials.
  for (const key of ["HOME", "PATH", "DENO_DIR", "SYSTEMROOT"]) {
    const value = Deno.env.get(key);
    if (value) result[key] = value;
  }
  return result;
}

for (
  const [runner, entrypoint] of [
    ["run", "deploy.ts"],
    ["run", "entrypoints/deploy.ts"],
    ["run", "entrypoints/local.ts"],
    ["serve", "deploy.ts"],
  ] as const
) {
  Deno.test(`${runner} ${entrypoint} serves a real health request`, async () => {
    const reservation = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = reservation.addr.port;
    reservation.close();
    const directory = await Deno.makeTempDir();
    const server = new Deno.Command(Deno.execPath(), {
      args: [
        runner,
        ...(runner === "serve" ? ["--host=127.0.0.1", `--port=${port}`] : []),
        `--config=${root}deno.json`,
        "--cached-only",
        "--node-modules-dir=none",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-net=127.0.0.1,0.0.0.0",
        "--unstable-kv",
        "--unstable-cron",
        root + entrypoint,
      ],
      cwd: directory,
      clearEnv: true,
      env: { ...isolatedEnvironment(), PORT: String(port) },
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    let exited = false;
    const output = server.output().then((result) => {
      exited = true;
      return result;
    });
    let ready = false;
    try {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
            signal: AbortSignal.timeout(500),
          });
          const body = await response.json();
          assertEquals(response.status, 200);
          assertEquals(body.status, "ok");
          await new Promise((resolve) => setTimeout(resolve, 150));
          assert(!exited, "Entrypoint exited immediately after startup");
          ready = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    } finally {
      terminateChild(server);
      const result = await output;
      await Deno.remove(directory, { recursive: true });
      assert(ready, new TextDecoder().decode(result.stderr));
    }
  });
}

Deno.test("organization wall time is independent of the process timezone", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const code = `import { parseAppLocalDateTime, appDateKey } from ${
      JSON.stringify(root + "lib/time.ts")
    };
console.log(JSON.stringify([parseAppLocalDateTime("2098-05-01T09:00"),appDateKey("2026-05-01T22:30:00Z")]));`;
    const results: string[] = [];
    for (const zone of ["UTC", "Europe/Berlin", "America/New_York"]) {
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["eval", `--config=${root}deno.json`, "--cached-only", code],
        cwd: directory,
        clearEnv: true,
        env: { ...isolatedEnvironment(), TZ: zone },
      }).output();
      assert(result.success, new TextDecoder().decode(result.stderr));
      results.push(new TextDecoder().decode(result.stdout).trim());
    }
    assertEquals(
      results,
      Array(3).fill(
        '["2098-05-01T07:00:00.000Z","2026-05-02"]',
      ),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
