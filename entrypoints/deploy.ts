import { app } from "@/src/app/create-app.ts";

let listenerStarted = false;

const deployHandler = {
  fetch: app.fetch,
  onListen(address: Deno.Addr) {
    listenerStarted = true;
    console.log("Listening on", address);
  },
} satisfies Deno.ServeDefaultExport;

export default deployHandler;

export function startStandaloneServer(): void {
  // import.meta.main is also true under `deno serve`. Its default-export
  // listener starts before load; onListen prevents a second listener here.
  globalThis.addEventListener("load", () => {
    if (listenerStarted) return;
    Deno.serve({
      port: Number(Deno.env.get("PORT") ?? "8000"),
      onListen: deployHandler.onListen,
    }, deployHandler.fetch);
  }, { once: true });
}

if (import.meta.main) {
  startStandaloneServer();
}
