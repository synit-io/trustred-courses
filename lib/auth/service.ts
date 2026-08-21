import {
  DenoKvMagicLinkAuth,
  type MagicLinkAuthUser,
  type MagicLinkIssueResult,
  type SendMailPayload,
  type SendMailResult,
  type SessionRecord,
} from "@synitio/kv-magic-link-auth";
import { env, isLocalDebugBypassEnabled } from "../env.ts";
import { getKv } from "../kv/client.ts";
import { logger } from "../observability/logger.ts";
import type { User } from "../types.ts";
import { getUserByEmail, getUserById } from "../users/repository.ts";

export type { MagicLinkIssueResult, SessionRecord };

export interface MagicLinkRequestContext {
  requestIp?: string | null;
  userAgent?: string | null;
  bindingSecret?: string | null;
}

export interface MagicLinkVerifyContext {
  requestIp?: string | null;
  userAgent?: string | null;
  bindingSecret?: string | null;
}

export interface VerifyResult {
  sessionId: string;
  redirectTo: string;
  user: User;
}

let authPromise: Promise<DenoKvMagicLinkAuth> | null = null;

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  if (local.length <= 2) return `${local[0] ?? "*"}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

async function sendMagicLinkEmail(
  payload: SendMailPayload,
): Promise<SendMailResult> {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass || !env.mailFromAddress) {
    logger.error("auth.magic_link.smtp_not_configured", {
      recipient: maskEmail(payload.to),
    });
    return { ok: false, error: "smtp_not_configured" };
  }

  try {
    const { default: nodemailer } = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass,
      },
    });

    await transporter.sendMail({
      from: `${env.mailFromName} <${env.mailFromAddress}>`,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });

    return { ok: true };
  } catch (error) {
    logger.error("auth.magic_link.smtp_send_failed", {
      recipient: maskEmail(payload.to),
      error,
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function toMagicLinkAuthUser(user: User): MagicLinkAuthUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    authVersion: user.authVersion,
    active: user.active,
    isSuperAdmin: user.role === "super_admin",
  };
}

async function createAuth(): Promise<DenoKvMagicLinkAuth> {
  const kv = await getKv();
  return new DenoKvMagicLinkAuth(
    {
      appBaseUrl: env.appBaseUrl,
      appName: env.appName,
      magicLinkTtlMinutes: env.magicLinkTtlMinutes,
      sessionIdleTtlDays: env.sessionIdleTtlDays,
      sessionAbsoluteTtlDays: env.sessionAbsoluteTtlDays,
      authDevExposeMagicLink: isLocalDebugBypassEnabled(),
      sendEmailInDebugMode: false,
      initialSuperAdminEmail: env.initialAdminEmail,
      failedAuthRateLimitMaxAttempts: env.authRateLimitMaxAttempts,
      failedAuthRateLimitWindowMinutes: env.authRateLimitWindowMinutes,
      failedAuthRateLimitBlockMinutes: env.authRateLimitBlockMinutes,
    },
    {
      kv,
      findUserByEmail: async (email) => {
        const user = await getUserByEmail(email);
        return user ? toMagicLinkAuthUser(user) : null;
      },
      findUserById: async (id) => {
        const user = await getUserById(id);
        return user ? toMagicLinkAuthUser(user) : null;
      },
      sendMail: sendMagicLinkEmail,
    },
  );
}

function getAuth(): Promise<DenoKvMagicLinkAuth> {
  if (!authPromise) {
    authPromise = createAuth();
  }
  return authPromise;
}

export async function issueMagicLink(
  email: string,
  redirectTo?: string,
  context?: MagicLinkRequestContext,
): Promise<MagicLinkIssueResult> {
  if (env.authDevExposeMagicLink && !isLocalDebugBypassEnabled()) {
    logger.warn("auth.magic_link.dev_exposed_blocked_non_localhost", {
      email: maskEmail(email),
      appBaseUrl: env.appBaseUrl,
      hasDeployId: Boolean((Deno.env.get("DENO_DEPLOYMENT_ID") ?? "").trim()),
      nodeEnv: (Deno.env.get("NODE_ENV") ?? "").trim().toLowerCase(),
    });
  }

  const result = await (await getAuth()).issueMagicLink({
    email,
    redirectTo,
    requestIp: context?.requestIp,
    userAgent: context?.userAgent,
    bindingSecret: context?.bindingSecret,
  });

  if (result.debugUrl) {
    logger.info("auth.magic_link.dev_exposed_localhost", {
      email: maskEmail(email),
    });
  }

  return result;
}

export async function verifyMagicLinkToken(
  rawToken: string,
  context?: MagicLinkVerifyContext,
): Promise<VerifyResult | null> {
  const verified = await (await getAuth()).verifyMagicLink({
    token: rawToken,
    requestIp: context?.requestIp,
    userAgent: context?.userAgent,
    bindingSecret: context?.bindingSecret,
  });
  if (!verified) {
    return null;
  }

  const user = await getUserById(verified.user.id);
  if (!user) {
    return null;
  }

  return {
    sessionId: verified.sessionId,
    redirectTo: verified.redirectTo,
    user,
  };
}

export async function getSession(
  sessionId: string,
): Promise<SessionRecord | null> {
  return await (await getAuth()).getSession(sessionId);
}

export async function revokeSession(sessionId: string): Promise<void> {
  await (await getAuth()).revokeSession(sessionId);
}

export function __resetAuthForTests(): void {
  authPromise = null;
}
