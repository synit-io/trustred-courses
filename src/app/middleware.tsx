import { getCookie } from "@/lib/auth/cookies.ts";
import { hasRole } from "@/lib/auth/roles.ts";
import { getSession } from "@/lib/auth/service.ts";
import { env, frameAncestorsDirectiveValue } from "@/lib/env.ts";
import {
  extractRequestTraceContext,
  logger,
} from "@/lib/observability/logger.ts";
import { getUserById } from "@/lib/users/repository.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { RootDocument } from "@/src/app/renderer.tsx";
import { redactQueryForLogs } from "@/src/routes/shared/helpers.ts";
import { serveStatic } from "hono/deno";
import type { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";

export function registerGlobalMiddleware(app: Hono<AppEnv>) {
  app.use("/assets/*", serveStatic({ root: "./" }));
  app.use("/static/*", serveStatic({ root: "./" }));
  app.use("/favicon.ico", serveStatic({ path: "./static/favicon.ico" }));

  app.use("*", async (c, next) => {
    const startedAt = performance.now();
    const trace = extractRequestTraceContext(c.req.raw.headers);
    const url = new URL(c.req.url);

    logger.info("http.request.start", {
      ...trace,
      method: c.req.method,
      path: c.req.path,
      query: redactQueryForLogs(url),
    });

    try {
      await next();
    } catch (error) {
      logger.error("http.request.error", {
        ...trace,
        method: c.req.method,
        path: c.req.path,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        error,
      });
      throw error;
    }

    logger.info("http.request.finish", {
      ...trace,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    });
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    const frameAncestors = frameAncestorsDirectiveValue();
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "img-src 'self' data:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "script-src 'self'",
        `frame-ancestors ${frameAncestors}`,
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    );
  });

  app.use(
    "*",
    jsxRenderer(({ children }, c) => {
      const user = c.get("sessionUser");
      return <RootDocument user={user}>{children}</RootDocument>;
    }),
  );

  app.use("*", async (c, next) => {
    const sessionId = getCookie(c.req.raw.headers, env.authCookieName);
    if (sessionId) {
      const session = await getSession(sessionId);
      if (session) {
        const user = await getUserById(session.userId);
        if (user && user.active && user.authVersion === session.authVersion) {
          c.set("sessionUser", {
            id: user.id,
            email: user.email,
            role: user.role,
          });
        }
      }
    }
    await next();
  });

  app.use("*", async (c, next) => {
    const path = c.req.path;
    const isAdminPath = path.startsWith("/admin") ||
      path.startsWith("/api/admin");
    const isAuthPath = path === "/admin/login" || path.startsWith("/api/auth/");
    if (!isAdminPath || isAuthPath) return await next();

    const user = c.get("sessionUser");
    if (!user) {
      if (path.startsWith("/api/")) return c.text("Unauthorized", 401);
      return c.redirect("/admin/login", 303);
    }

    const requiredRole = path.startsWith("/admin/users") ||
        path.startsWith("/admin/courses") ||
        path.startsWith("/api/admin/users") ||
        path.startsWith("/api/admin/courses")
      ? "admin"
      : path.startsWith("/api/admin/registrations")
      ? "approver"
      : path.startsWith("/api/admin/exports")
      ? "approver"
      : "viewer";

    if (!hasRole(user.role, requiredRole)) return c.text("Forbidden", 403);
    await next();
  });
}
