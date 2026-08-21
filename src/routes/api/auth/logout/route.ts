import { buildSessionClearCookie, getCookie } from "@/lib/auth/cookies.ts";
import { revokeSession } from "@/lib/auth/service.ts";
import { env } from "@/lib/env.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const logoutRoute = new Hono<AppEnv>().post("/", async (c) => {
  const trace = extractRequestTraceContext(c.req.raw.headers);
  const sessionId = getCookie(c.req.raw.headers, env.authCookieName);
  if (sessionId) await revokeSession(sessionId);
  logger.info("auth.session.logout", {
    ...trace,
    hadSessionCookie: Boolean(sessionId),
  });
  c.header("Set-Cookie", buildSessionClearCookie());
  return c.redirect("/admin/login", 303);
});
