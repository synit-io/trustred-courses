import { isDemoMode } from "../env.ts";

/**
 * Message shown when a destructive admin action is blocked in DEMO_MODE.
 * Kept in one place so routes and pages say the same thing.
 */
export const DEMO_DELETE_BLOCKED_MESSAGE =
  "Löschen ist im Demo-Modus deaktiviert. Alle Daten werden regelmäßig automatisch zurückgesetzt.";

/**
 * In an open demo anyone can hold an admin session, so irreversible actions
 * (deleting courses or users) are refused server-side. Edits stay possible;
 * the scheduled reset restores the seeded state.
 */
export function demoModeBlocksDeletion(): boolean {
  return isDemoMode();
}
