import { app } from "@/src/app/create-app.ts";

export { app };

if (import.meta.main) {
  Deno.serve(app.fetch);
}
