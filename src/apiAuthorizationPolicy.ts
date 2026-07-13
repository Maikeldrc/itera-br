import { UserRole } from "./types";

export const API_ROLE_GROUPS = {
  adminOnly: [UserRole.Admin],
  billingAdmin: [UserRole.Admin, UserRole.BillingManager],
  claimWrite: [UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist],
  auditRead: [UserRole.Admin, UserRole.BillingManager, UserRole.Auditor]
} as const;

export function canRoleAccessGroup(role: UserRole, group: readonly UserRole[]) {
  return group.includes(role);
}
