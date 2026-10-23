import deployHandler from "@/entrypoints/deploy.ts";

export default deployHandler;

if (import.meta.main) {
  Deno.serve(
    { port: Number(Deno.env.get("PORT") ?? "8000") },
    deployHandler.fetch,
  );
}
