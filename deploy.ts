import deployHandler, { startStandaloneServer } from "@/entrypoints/deploy.ts";

export default deployHandler;

if (import.meta.main) {
  startStandaloneServer();
}
