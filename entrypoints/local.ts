import { app } from "@/src/app/create-app.ts";

if (import.meta.main) {
  Deno.serve({ port: Number(Deno.env.get("PORT") ?? "8000") }, app.fetch);
}
