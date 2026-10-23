import { assert, assertEquals } from "@std/assert";

Deno.test("root Compose forwards all documented configuration without copying secrets into images", async () => {
  const root = new URL("../", import.meta.url);
  const template = await Deno.readTextFile(new URL(".env.example", root));
  const keys = [...template.matchAll(/^([A-Z][A-Z_0-9]*)=/gm)].map((match) =>
    match[1]
  );
  keys.push("NODE_ENV");
  const fixture = Object.fromEntries(
    keys.map((key) => [key, `fixture_${key}`]),
  );
  const directory = await Deno.makeTempDir();
  try {
    const envPath = `${directory}/fixture.env`;
    await Deno.writeTextFile(
      envPath,
      Object.entries(fixture).map(([key, value]) => `${key}=${value}`).join(
        "\n",
      ),
    );
    const runtimeEnv: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "SYSTEMROOT"]) {
      const value = Deno.env.get(key);
      if (value) runtimeEnv[key] = value;
    }
    const result = await new Deno.Command("docker", {
      args: [
        "compose",
        "--env-file",
        envPath,
        "-f",
        new URL("docker-compose.yml", root).pathname,
        "config",
        "--format",
        "json",
      ],
      cwd: directory,
      clearEnv: true,
      env: runtimeEnv,
    }).output();
    assert(result.success, new TextDecoder().decode(result.stderr));
    const config = JSON.parse(new TextDecoder().decode(result.stdout));
    assertEquals(config.services.web.environment, fixture);
    const exclusions = (await Deno.readTextFile(new URL(".dockerignore", root)))
      .split(/\r?\n/);
    assert(exclusions.includes(".env"));
    assert(exclusions.includes(".env.*"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
