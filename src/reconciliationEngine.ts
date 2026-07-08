/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Claim } from "./types";
import { validateServiceLinesJson } from "./serviceLineValidation";

/**
 * Reconciliation Engine for ITERA HEALTH
 * Computes all financial fields of a claim based on billing, collections, adjustments and payer denials.
 */
export interface ReconciliationConfig {
  providerSharePercent: number; // e.g. 70 for 70%
  iteraSharePercent: number;    // e.g. 30 for 30%
}

export const DEFAULT_CONFIG: ReconciliationConfig = {
  providerSharePercent: 70,
  iteraSharePercent: 30,
};

/**
 * Calculates all reconciliation fields for a single claim.
 * Mutates or returns a new calculated claim.
 */
export function calculateClaimFinancials(
  claim: Partial<Claim>,
  config: ReconciliationConfig = DEFAULT_CONFIG
): Claim {
  // Ensure we have numbers
  const billed_charge = Number(claim.billed_charge || 0);
  const insurance_adjustment = Number(claim.insurance_adjustment || 0);
  const denied_amount = Number(claim.denied_amount || 0);
  const write_off_amount = Number(claim.write_off_amount || 0);
  const uncollectible_amount = Number(claim.uncollectible_amount || 0);
  
  const itera_direct_collection = Number(claim.itera_direct_collection || 0);
  const provider_direct_collection = Number(claim.provider_direct_collection || 0);
  const payment_to_physician = Number(claim.payment_to_physician || 0);

  // 1. Net Collectible Revenue = Billed Charges - Insurance Adjustments - Denials/Write-offs/Uncollectible
  const net_collectible_revenue = Math.max(
    0,
    billed_charge - insurance_adjustment - denied_amount - write_off_amount - uncollectible_amount
  );

  // 2. Total Collections = ITERA + Provider collections
  const total_collections = itera_direct_collection + provider_direct_collection;

  // 3. A/R Balance = Net Collectible Revenue - Total Collections
  const ar_balance = Math.max(0, net_collectible_revenue - total_collections);

  // 4. A/R Allocation based on who billed the claim
  // If ITERA billed, the expected remaining balance is ITERA A/R.
  // If Provider billed, the expected remaining balance is Provider A/R.
  let itera_ar = 0;
  let provider_ar = 0;
  if (claim.billed_by === "ITERA") {
    itera_ar = ar_balance;
  } else {
    provider_ar = ar_balance;
  }

  // 5. Provider and ITERA revenue allocations (Shares)
  const provider_ratio = config.providerSharePercent / 100;
  const itera_ratio = config.iteraSharePercent / 100;

  // Net revenues are based on actual collections
  const net_provider_revenue = total_collections * provider_ratio;
  const net_itera_revenue = total_collections * itera_ratio;

  // 6. Account Payable (A/P) to Physician (Provider)
  // Unified formula: we owe the provider their 70% share of total collections,
  // minus whatever they have already collected directly.
  // If positive, ITERA needs to pay this to the provider.
  // If negative, the provider has over-collected directly and owes ITERA their share.
  const account_payable_to_physician = net_provider_revenue - provider_direct_collection;

  // 7. Ending A/P Balance to Physician
  // Ending A/P = Account Payable - Actual Payments made by ITERA to the provider
  const ending_ap_to_physician = account_payable_to_physician - payment_to_physician;

  return {
    ...(claim as Claim),
    billed_charge,
    allowed_amount: Number(claim.allowed_amount || 0),
    paid_amount: Number(claim.paid_amount || 0),
    insurance_adjustment,
    denied_amount,
    write_off_amount,
    uncollectible_amount,
    net_collectible_revenue: Number(net_collectible_revenue.toFixed(2)),
    
    itera_direct_collection: Number(itera_direct_collection.toFixed(2)),
    provider_direct_collection: Number(provider_direct_collection.toFixed(2)),
    total_collections: Number(total_collections.toFixed(2)),
    ar_balance: Number(ar_balance.toFixed(2)),
    itera_ar: Number(itera_ar.toFixed(2)),
    provider_ar: Number(provider_ar.toFixed(2)),
    
    account_payable_to_physician: Number(account_payable_to_physician.toFixed(2)),
    payment_to_physician: Number(payment_to_physician.toFixed(2)),
    ending_ap_to_physician: Number(ending_ap_to_physician.toFixed(2)),
    
    net_itera_revenue: Number(net_itera_revenue.toFixed(2)),
    net_provider_revenue: Number(net_provider_revenue.toFixed(2)),
    
    // Status locks & flags
    error_flag: !!claim.error_flag,
    locked: !!claim.locked,
    units: Number(claim.units || 1),
  } as Claim;
}

/**
 * Validates a claim object before saving it.
 * Returns a list of error messages or null if valid.
 */
export function validateClaim(claim: Partial<Claim>): string[] {
  const errors: string[] = [];

  if (!claim.claim_id || claim.claim_id.trim() === "") {
    errors.push("Claim ID is required.");
  }
  
  if (!claim.billed_by || (claim.billed_by !== "ITERA" && claim.billed_by !== "Provider")) {
    errors.push("Billed by must be either 'ITERA' or 'Provider'.");
  }

  if (
    !claim.payment_received_by ||
    !["ITERA", "Provider", "Split", "Unknown"].includes(claim.payment_received_by)
  ) {
    errors.push("Payment received by must be 'ITERA', 'Provider', 'Split' or 'Unknown'.");
  }

  // Financial values must not be negative
  const financialFields: Array<keyof Claim> = [
    "billed_charge",
    "allowed_amount",
    "paid_amount",
    "insurance_adjustment",
    "denied_amount",
    "write_off_amount",
    "uncollectible_amount",
    "itera_direct_collection",
    "provider_direct_collection",
    "payment_to_physician"
  ];

  financialFields.forEach(field => {
    const val = claim[field];
    if (val !== undefined && typeof val === "number" && val < 0) {
      errors.push(`${field.replace(/_/g, " ")} cannot be negative.`);
    }
  });

  // Paid amount cannot exceed billed charge unless marked as overpaid
  if (
    claim.paid_amount !== undefined &&
    claim.billed_charge !== undefined &&
    claim.paid_amount > claim.billed_charge &&
    claim.claim_classification !== "Overpaid"
  ) {
    errors.push("Paid amount cannot exceed billed charge unless claim classification is 'Overpaid'.");
  }

  errors.push(...validateServiceLinesJson(claim.service_lines_json, claim));

  return errors;
}
