import { Claim, Provider, User, UserRole } from "./types";

export type MenuAccessId =
  | "dashboard"
  | "claims"
  | "payments"
  | "denials"
  | "errors"
  | "providers"
  | "reports"
  | "settings"
  | "audit-log";

export const MENU_ACCESS_IDS: MenuAccessId[] = [
  "dashboard",
  "claims",
  "payments",
  "denials",
  "errors",
  "providers",
  "reports",
  "settings",
  "audit-log"
];

export const ROLE_DEFAULT_MENU_ACCESS: Record<UserRole, MenuAccessId[]> = {
  [UserRole.Admin]: MENU_ACCESS_IDS,
  [UserRole.BillingManager]: MENU_ACCESS_IDS,
  [UserRole.ReconciliationSpecialist]: ["dashboard", "claims", "payments", "denials", "errors", "reports"],
  [UserRole.ProviderViewer]: ["dashboard", "claims", "payments", "providers", "reports"],
  [UserRole.Auditor]: ["dashboard", "claims", "denials", "errors", "providers", "reports", "audit-log"]
};

const ALL_PROVIDERS = "ALL";

function splitAccess(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  return String(value ?? "")
    .split(/[,;\n]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export function parseMenuAccess(value: unknown): MenuAccessId[] {
  const allowed = new Set(MENU_ACCESS_IDS);
  return splitAccess(value).filter((item): item is MenuAccessId => allowed.has(item as MenuAccessId));
}

export function serializeMenuAccess(items: MenuAccessId[]) {
  return Array.from(new Set(items.filter(item => MENU_ACCESS_IDS.includes(item)))).join(",");
}

export function getUserMenuAccess(user: Partial<User>) {
  const explicit = parseMenuAccess(user.menu_access);
  if (explicit.length > 0) return explicit;
  return ROLE_DEFAULT_MENU_ACCESS[user.role as UserRole] || [];
}

export function canUserAccessMenu(user: Partial<User>, menuId: MenuAccessId) {
  return getUserMenuAccess(user).includes(menuId);
}

export function parseProviderAccess(value: unknown): string[] {
  const items = splitAccess(value).map(item => item.toUpperCase());
  if (items.includes(ALL_PROVIDERS)) return [ALL_PROVIDERS];
  return Array.from(new Set(items));
}

export function serializeProviderAccess(providerIds: string[], allProviders: boolean) {
  return allProviders ? ALL_PROVIDERS : Array.from(new Set(providerIds.map(item => item.trim().toUpperCase()).filter(Boolean))).join(",");
}

export function userHasAllProviderAccess(user: Partial<User>) {
  const providerAccess = parseProviderAccess(user.provider_access);
  return providerAccess.length === 0 || providerAccess.includes(ALL_PROVIDERS);
}

export function canUserAccessProvider(user: Partial<User>, providerId: unknown, providerNpi?: unknown) {
  if (userHasAllProviderAccess(user)) return true;
  const providerAccess = parseProviderAccess(user.provider_access);
  const ids = [providerId, providerNpi].map(value => String(value ?? "").trim().toUpperCase()).filter(Boolean);
  return ids.some(id => providerAccess.includes(id));
}

export function filterClaimsForUser(claims: Claim[], user?: Partial<User>) {
  if (!user || userHasAllProviderAccess(user)) return claims;
  return claims.filter(claim => canUserAccessProvider(user, claim.provider_id, claim.provider_npi));
}

export function filterProvidersForUser(providers: Provider[], user?: Partial<User>) {
  if (!user || userHasAllProviderAccess(user)) return providers;
  return providers.filter(provider => canUserAccessProvider(user, provider.provider_id, provider.npi));
}

export function normalizeUserAccess(user: Partial<User>): Partial<User> {
  return {
    ...user,
    menu_access: serializeMenuAccess(parseMenuAccess(user.menu_access)),
    provider_access: userHasAllProviderAccess(user) ? ALL_PROVIDERS : serializeProviderAccess(parseProviderAccess(user.provider_access), false)
  };
}
