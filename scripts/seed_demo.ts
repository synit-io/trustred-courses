import { isDemoMode } from "../lib/env.ts";
import { DemoModeDisabledError, seedDemoData } from "../lib/demo/seed.ts";

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
  fallback: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value === true) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Ungültiger Wert für --${name}: ${String(value)}`);
  }
  return parsed;
}

function printUsage(): void {
  console.log(
    [
      "Usage: DEMO_MODE=true deno task seed:demo [--courses=8] [--min-registrations=4] [--max-registrations=28] [--seed=42]",
      "",
      "Fügt bei jedem Aufruf neue Demo-Kurse, Anmeldungen und Verlauf hinzu.",
      "Nur mit DEMO_MODE=true erlaubt. DEMO_MODE deaktiviert jeden E-Mail-Versand.",
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

  const summary = await seedDemoData({
    courses: readInt(args.courses, 8, "courses"),
    minRegistrations: readInt(
      args["min-registrations"],
      undefined,
      "min-registrations",
    ),
    maxRegistrations: readInt(
      args["max-registrations"],
      undefined,
      "max-registrations",
    ),
    seed: readInt(args.seed, undefined, "seed"),
  });

  console.log("Demo-Seed erfolgreich ausgeführt.");
  console.log(`Kurse hinzugefügt: ${summary.courses}`);
  console.log(`Anmeldungen hinzugefügt: ${summary.registrations}`);
  console.log(`Verlaufseinträge: ${summary.auditLogs}`);
  console.log(`E-Mail-Protokolle (unterdrückt): ${summary.emailLogs}`);
  console.log(`Demo-Zugänge: ${summary.accounts.join(", ")}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      `Demo-Seed fehlgeschlagen: ${(error as Error).message}`,
    );
    Deno.exit(1);
  }
}
