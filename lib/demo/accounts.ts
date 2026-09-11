import type { UserRole } from "../types.ts";

/**
 * Demo accounts created by `deno task seed:demo`. Addresses use RFC 2606
 * reserved domains, so they can never receive mail even outside DEMO_MODE.
 */
export interface DemoAccount {
  email: string;
  role: UserRole;
  label: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: "demo-admin@example.org", role: "admin", label: "Administrator" },
  { email: "demo-approver@example.org", role: "approver", label: "Genehmiger" },
  { email: "demo-viewer@example.org", role: "viewer", label: "Betrachter" },
];

export const DEMO_ADMIN_ACCOUNT = DEMO_ACCOUNTS[0];
