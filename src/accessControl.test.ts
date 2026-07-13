import {
  canRoleAccessGroup,
  API_ROLE_GROUPS
} from "./apiAuthorizationPolicy";
import {
  canUserAccessMenu,
  canUserAccessProvider,
  filterClaimsForUser,
  filterProvidersForUser,
  ROLE_DEFAULT_MENU_ACCESS
} from "./accessControl";
import { Claim, Provider, UserRole } from "./types";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const allRoles = Object.values(UserRole);

function assertAllowedRoles(groupName: keyof typeof API_ROLE_GROUPS, expected: UserRole[]) {
  const actual = allRoles.filter(role => canRoleAccessGroup(role, API_ROLE_GROUPS[groupName]));
  assert(
    actual.join("|") === expected.join("|"),
    `${groupName} allowed roles changed. Expected ${expected.join(", ")}, got ${actual.join(", ")}.`
  );
}

export function runAccessControlTests() {
  const failures: string[] = [];

  const tests: { name: string; run: () => void }[] = [
    {
      name: "API role groups preserve least-privilege route contracts",
      run: () => {
        assertAllowedRoles("adminOnly", [UserRole.Admin]);
        assertAllowedRoles("billingAdmin", [UserRole.Admin, UserRole.BillingManager]);
        assertAllowedRoles("claimWrite", [UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist]);
        assertAllowedRoles("auditRead", [UserRole.Admin, UserRole.BillingManager, UserRole.Auditor]);
      }
    },
    {
      name: "default menu access restricts settings and audit navigation by role",
      run: () => {
        assert(canUserAccessMenu({ role: UserRole.Admin }, "settings"), "Admin should access Settings.");
        assert(canUserAccessMenu({ role: UserRole.BillingManager }, "settings"), "Billing Manager should access Settings.");
        assert(!canUserAccessMenu({ role: UserRole.ReconciliationSpecialist }, "settings"), "Reconciliation Specialist must not access Settings.");
        assert(!canUserAccessMenu({ role: UserRole.ProviderViewer }, "settings"), "Provider Viewer must not access Settings.");
        assert(canUserAccessMenu({ role: UserRole.Auditor }, "audit-log"), "Auditor should access Audit Log.");
        assert(!canUserAccessMenu({ role: UserRole.ProviderViewer }, "audit-log"), "Provider Viewer must not access Audit Log.");
        assert(!ROLE_DEFAULT_MENU_ACCESS[UserRole.Auditor].includes("payments"), "Auditor should not access Payment Control by default.");
      }
    },
    {
      name: "explicit provider access filters claims and provider catalog",
      run: () => {
        const user = { role: UserRole.ProviderViewer, provider_access: "PROV_01" };
        const claims = [
          { claim_id: "QA_AUTO_ALLOWED", provider_id: "PROV_01", provider_npi: "111" },
          { claim_id: "QA_AUTO_BLOCKED", provider_id: "PROV_02", provider_npi: "222" }
        ] as Claim[];
        const providers = [
          { provider_id: "PROV_01", npi: "111" },
          { provider_id: "PROV_02", npi: "222" }
        ] as Provider[];

        assert(canUserAccessProvider(user, "PROV_01", "111"), "User should access explicitly assigned provider.");
        assert(!canUserAccessProvider(user, "PROV_02", "222"), "User must not access unassigned provider.");
        assert(filterClaimsForUser(claims, user).map(claim => claim.claim_id).join(",") === "QA_AUTO_ALLOWED", "Claims should be filtered by provider access.");
        assert(filterProvidersForUser(providers, user).map(provider => provider.provider_id).join(",") === "PROV_01", "Providers should be filtered by provider access.");
      }
    }
  ];

  for (const test of tests) {
    try {
      test.run();
    } catch (err) {
      failures.push(`${test.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return failures;
}
