import type { UserRole } from "../types.ts";

const roleRank: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  approver: 3,
  admin: 4,
  super_admin: 5,
};

export function hasRole(actual: UserRole, required: UserRole): boolean {
  return roleRank[actual] >= roleRank[required];
}
