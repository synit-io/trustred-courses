import { app } from "@/src/app/create-app.ts";

if (import.meta.main) {
  Deno.serve(app.fetch);
}
