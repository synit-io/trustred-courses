import { registerCronJobs } from "@/lib/background/cron.ts";
import { env } from "@/lib/env.ts";
import { ensureInitialAdminUserBootstrappedOnce } from "@/lib/users/repository.ts";
import { logger } from "@/lib/observability/logger.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { registerErrorPages } from "@/src/app/error-pages.tsx";
import { registerGlobalMiddleware } from "@/src/app/middleware.tsx";
import { registerRoutes } from "@/src/app/register-routes.ts";
import { Hono } from "hono";

try {
  const initialAdminBootstrap = await ensureInitialAdminUserBootstrappedOnce(
    env.initialAdminEmail,
  );
  if (initialAdminBootstrap !== "already_bootstrapped") {
    logger.info("bootstrap.initial_admin", {
      email: env.initialAdminEmail.trim().toLowerCase(),
      result: initialAdminBootstrap,
    });
  }
} catch (error) {
  logger.error("bootstrap.initial_admin_failed", {
    email: env.initialAdminEmail.trim().toLowerCase(),
    error,
  });
}

registerCronJobs();

export function createApp() {
  const app = new Hono<AppEnv>();
  registerGlobalMiddleware(app);
  registerRoutes(app);
  registerErrorPages(app);
  return app;
}

export const app = createApp();
