import { isDemoMode } from "../lib/env.ts";
import { resetDemoData } from "../lib/demo/reset.ts";
import { DemoModeDisabledError } from "../lib/demo/seed.ts";

function parseArgs(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    out[key] = rest.length > 0 ? rest.join("=") : true;
  }
  return out;
}

function readInt(
  value: string | boolean | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value === true) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Ungültiger Wert für --${name}: ${String(value)}`);
  }
  return parsed;
}

function printUsage(): void {
  console.log(
    [
      "Usage: DEMO_MODE=true deno task demo:reset [--courses=10] [--seed=4711]",
      "",
      "Löscht ALLE Daten (Kurse, Anmeldungen, Benutzer, Sitzungen) und erzeugt",
      "den Demo-Datensatz neu. Nur mit DEMO_MODE=true erlaubt.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  if (args.help === true) {
    printUsage();
    return;
  }
  if (!isDemoMode()) {
    throw new DemoModeDisabledError();
  }

  const summary = await resetDemoData({
    courses: readInt(args.courses, "courses"),
    seed: readInt(args.seed, "seed"),
  }, "manual");

  console.log("Demo-Reset erfolgreich ausgeführt.");
  console.log(`Gelöschte Einträge: ${summary.deletedKeys}`);
  console.log(`Kurse: ${summary.courses}`);
  console.log(`Anmeldungen: ${summary.registrations}`);
  console.log(`Demo-Zugänge: ${summary.accounts.join(", ")}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`Demo-Reset fehlgeschlagen: ${(error as Error).message}`);
    Deno.exit(1);
  }
}
