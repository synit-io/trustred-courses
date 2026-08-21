import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export const healthRoute = new Hono<AppEnv>().get(
  "/",
  (c) => c.json({ status: "ok", ts: new Date().toISOString() }),
);
