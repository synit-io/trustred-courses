import nodemailer from "nodemailer";
import { ensureSmtpConfig, env } from "../lib/env.ts";

interface CliOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  dryRun: boolean;
}

function parseArgs(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const keyValue = arg.slice(2);
    if (keyValue.includes("=")) {
      const [key, ...rest] = keyValue.split("=");
      out[key] = rest.join("=");
      continue;
    }

    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      out[keyValue] = true;
      continue;
    }
    out[keyValue] = next;
    i += 1;
  }
  return out;
}

function maskSecret(value: string): string {
  if (!value) return "(empty)";
  if (value.length <= 4) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function readOptions(args: string[]): CliOptions {
  const parsed = parseArgs(args);
  const to = typeof parsed.to === "string"
    ? parsed.to
    : env.mailAdminNotificationTo || env.legalEmail || env.mailFromAddress;

  if (!to) {
    throw new Error(
      "Empfanger fehlt. Setze --to=mail@example.org oder MAIL_ADMIN_NOTIFICATION_TO/LEGAL_EMAIL.",
    );
  }

  const nowIso = new Date().toISOString();
  return {
    to,
    subject: typeof parsed.subject === "string"
      ? parsed.subject
      : `[${env.appName}] SMTP Test ${nowIso}`,
    text: typeof parsed.text === "string" ? parsed.text : [
      `SMTP Test erfolgreich gestartet`,
      `Zeitpunkt: ${nowIso}`,
      `App: ${env.appName}`,
      `Host: ${env.smtpHost}:${env.smtpPort}`,
    ].join("\n"),
    html: typeof parsed.html === "string" ? parsed.html : undefined,
    dryRun: parsed["dry-run"] === true,
  };
}

function printUsage(): void {
  console.log(
    "Usage: deno task smtp:test --to=mail@example.org [--subject='...'] [--text='...'] [--html='...'] [--dry-run]",
  );
}

async function main(): Promise<void> {
  if (Deno.args.includes("--help")) {
    printUsage();
    return;
  }

  ensureSmtpConfig();
  const options = readOptions(Deno.args);

  console.log("SMTP Debug Information");
  console.log("----------------------");
  console.log(`App: ${env.appName}`);
  console.log(`SMTP host: ${env.smtpHost}`);
  console.log(`SMTP port: ${env.smtpPort}`);
  console.log(`SMTP secure: ${String(env.smtpSecure)}`);
  console.log(`SMTP user: ${maskSecret(env.smtpUser)}`);
  console.log(`SMTP pass: ${maskSecret(env.smtpPass)}`);
  console.log(`From: ${env.mailFromName} <${env.mailFromAddress}>`);
  console.log(`To: ${options.to}`);
  console.log(`Dry run: ${String(options.dryRun)}`);

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });

  console.log("\n1) Verifying SMTP connection...");
  await transporter.verify();
  console.log("   Connection verified.");

  if (options.dryRun) {
    console.log("\nDry run enabled. No email sent.");
    return;
  }

  console.log("\n2) Sending test email...");
  const info = await transporter.sendMail({
    from: `${env.mailFromName} <${env.mailFromAddress}>`,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html ??
      `<pre style=\"font-family:monospace\">${options.text}</pre>`,
  });

  console.log("   Email sent.");
  console.log(`   messageId: ${info.messageId}`);

  const responseRaw = info.response;
  if (typeof responseRaw === "string" && responseRaw.trim() !== "") {
    console.log(`   response: ${responseRaw}`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error("SMTP test failed:", (error as Error).message);
    Deno.exit(1);
  }
}
