import { app } from "@/src/app/create-app.ts";

export { app };

if (import.meta.main) {
  Deno.serve({ port: Number(Deno.env.get("PORT") ?? "8000") }, app.fetch);
}
