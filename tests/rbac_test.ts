import { assertEquals } from "@std/assert";
import { hasRole } from "../lib/auth/roles.ts";

Deno.test("RBAC role hierarchy is enforced", () => {
  assertEquals(hasRole("super_admin", "admin"), true);
  assertEquals(hasRole("admin", "approver"), true);
  assertEquals(hasRole("approver", "viewer"), true);
  assertEquals(hasRole("viewer", "admin"), false);
  assertEquals(hasRole("editor", "approver"), false);
});
