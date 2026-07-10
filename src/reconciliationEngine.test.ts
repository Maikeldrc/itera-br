/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { calculateClaimFinancials, validateClaim } from "./reconciliationEngine";
import { ClaimStatus, ClaimClassification } from "./types";

/**
 * Basic Unit Tests for ITERA HEALTH Reconciliation Engine
 */
export function runReconciliationEngineTests() {
  const results: { name: string; success: boolean; error?: string }[] = [];

  function test(name: string, fn: () => void) {
    try {
      fn();
      results.push({ name, success: true });
    } catch (e: any) {
      results.push({ name, success: false, error: e.message || String(e) });
    }
  }

  // Test Case 1: ITERA billed and ITERA collected
  test("Scenario 1: ITERA billed and ITERA collected (70/30 split)", () => {
    const claim = calculateClaimFinancials({
      billed_by: "ITERA",
      payment_received_by: "ITERA",
      billed_charge: 150,
      insurance_adjustment: 30,
      denied_amount: 0,
      itera_direct_collection: 120,
      provider_direct_collection: 0,
      payment_to_physician: 0,
    });

    if (claim.net_collectible_revenue !== 120) {
      throw new Error(`Net collectible revenue expected 120, got ${claim.net_collectible_revenue}`);
    }
    if (claim.total_collections !== 120) {
      throw new Error(`Total collections expected 120, got ${claim.total_collections}`);
    }
    if (claim.ar_balance !== 0) {
      throw new Error(`A/R balance expected 0, got ${claim.ar_balance}`);
    }
    if (claim.itera_ar !== 0) {
      throw new Error(`ITERA A/R expected 0, got ${claim.itera_ar}`);
    }
    // 70% of 120 is 84
    if (claim.account_payable_to_physician !== 84) {
      throw new Error(`Payable to physician expected 84, got ${claim.account_payable_to_physician}`);
    }
    if (claim.ending_ap_to_physician !== 84) {
      throw new Error(`Ending A/P expected 84, got ${claim.ending_ap_to_physician}`);
    }
    if (claim.net_itera_revenue !== 36) {
      throw new Error(`Net ITERA revenue expected 36 (30% of 120), got ${claim.net_itera_revenue}`);
    }
    if (claim.net_provider_revenue !== 84) {
      throw new Error(`Net Provider revenue expected 84, got ${claim.net_provider_revenue}`);
    }
  });

  // Test Case 2: ITERA billed but Provider collected
  test("Scenario 2: ITERA billed but Provider collected", () => {
    const claim = calculateClaimFinancials({
      billed_by: "ITERA",
      payment_received_by: "Provider",
      billed_charge: 100,
      insurance_adjustment: 0,
      denied_amount: 0,
      itera_direct_collection: 0,
      provider_direct_collection: 100,
      payment_to_physician: 0,
    });

    // Net provider share = 70% of 100 = 70.
    // Provider collected 100 directly.
    // So payable to physician = 70 - 100 = -30 (Provider owes ITERA 30).
    if (claim.account_payable_to_physician !== -30) {
      throw new Error(`Payable expected -30, got ${claim.account_payable_to_physician}`);
    }
    if (claim.net_itera_revenue !== 30) {
      throw new Error(`Net ITERA revenue expected 30, got ${claim.net_itera_revenue}`);
    }
  });

  // Test Case 3: Split collection
  test("Scenario 5: Split Collection", () => {
    const claim = calculateClaimFinancials({
      billed_by: "ITERA",
      payment_received_by: "Split",
      billed_charge: 100,
      insurance_adjustment: 0,
      denied_amount: 0,
      itera_direct_collection: 40,
      provider_direct_collection: 60,
      payment_to_physician: 0,
    });

    // Total collection = 100. Provider entitled to 70.
    // Provider collected 60.
    // Payable to physician = 70 - 60 = 10.
    if (claim.account_payable_to_physician !== 10) {
      throw new Error(`Payable expected 10, got ${claim.account_payable_to_physician}`);
    }
    if (claim.net_itera_revenue !== 30) {
      throw new Error(`Net ITERA expected 30, got ${claim.net_itera_revenue}`);
    }
  });

  // Test Case 4: Validation Rule
  test("Validation: Claim ID required", () => {
    const errors = validateClaim({
      claim_id: "  ",
      billed_by: "ITERA",
      payment_received_by: "ITERA",
    });

    if (!errors.includes("Claim ID is required.")) {
      throw new Error("Validation did not catch empty Claim ID.");
    }
  });

  test("Validation: Service line Paid requires payment", () => {
    const errors = validateClaim({
      claim_id: "CLM-TEST-001",
      billed_by: "ITERA",
      payment_received_by: "ITERA",
      claim_status: ClaimStatus.Paid,
      claim_classification: ClaimClassification.CleanClaim,
      billed_charge: 100,
      allowed_amount: 100,
      paid_amount: 0,
      service_lines_json: JSON.stringify([{
        cpt: "99453",
        charged: 100,
        allowed: 100,
        adj: 0,
        patResp: 0,
        paid: 0,
        secondaryPaid: 0,
        balance: 100,
        codes: [],
        status: "Paid",
        nextAction: "No action"
      }])
    });

    if (!errors.some(error => error.includes("status Paid requires a primary or secondary payment greater than zero"))) {
      throw new Error("Validation did not catch Paid service line without payment.");
    }
  });

  test("Validation: Paid service line can keep a positive balance", () => {
    const errors = validateClaim({
      claim_id: "CLM-TEST-001A",
      billed_by: "ITERA",
      payment_received_by: "ITERA",
      claim_status: ClaimStatus.Paid,
      claim_classification: ClaimClassification.CleanClaim,
      billed_charge: 100,
      allowed_amount: 100,
      paid_amount: 40,
      service_lines_json: JSON.stringify([{
        cpt: "99453",
        charged: 100,
        allowed: 100,
        adj: 0,
        patResp: 0,
        paid: 40,
        secondaryPaid: 0,
        balance: 60,
        codes: [],
        status: "Paid",
        nextAction: "No action"
      }])
    });

    if (errors.some(error => error.includes("line balance to be zero"))) {
      throw new Error("Validation incorrectly requires Paid service line balance to be zero.");
    }
  });

  test("Validation: Quick payment can mark CPT Paid with remaining positive balance", () => {
    const errors = validateClaim({
      claim_id: "CLM-TEST-001D",
      billed_by: "ITERA",
      payment_received_by: "ITERA",
      claim_status: ClaimStatus.PartiallyPaid,
      claim_classification: ClaimClassification.CleanClaim,
      billed_charge: 120,
      allowed_amount: 120,
      paid_amount: 12,
      service_lines_json: JSON.stringify([
        {
          cpt: "99453",
          charged: 40,
          allowed: 40,
          adj: 0,
          patResp: 0,
          paid: 12,
          secondaryPaid: 0,
          balance: 28,
          codes: [],
          status: "Paid",
          nextAction: "No action"
        },
        {
          cpt: "99454",
          charged: 40,
          allowed: 40,
          adj: 0,
          patResp: 0,
          paid: 0,
          secondaryPaid: 0,
          balance: 40,
          codes: [],
          status: "Pending",
          nextAction: "No action"
        },
        {
          cpt: "99457",
          charged: 40,
          allowed: 40,
          adj: 0,
          patResp: 0,
          paid: 0,
          secondaryPaid: 0,
          balance: 40,
          codes: [],
          status: "Pending",
          nextAction: "No action"
        }
      ])
    });

    if (errors.some(error => error.includes("line balance to be zero") || error.includes("balance must be zero"))) {
      throw new Error("Validation incorrectly rejected Paid CPT with remaining balance after quick payment.");
    }
  });

  test("Validation: Empty optional payment fields are treated as zero", () => {
    const errors = validateClaim({
      claim_id: "CLM-TEST-001C",
      billed_by: "ITERA",
      payment_received_by: "ITERA",
      claim_status: ClaimStatus.PartiallyPaid,
      claim_classification: ClaimClassification.CleanClaim,
      billed_charge: 120,
      allowed_amount: 120,
      paid_amount: 12,
      service_lines_json: JSON.stringify([
        {
          cpt: "99453",
          charged: 40,
          allowed: 40,
          adj: 0,
          patResp: 0,
          paid: 12,
          secondaryPaid: 0,
          balance: 28,
          codes: [],
          status: "Partially Paid",
          nextAction: "No action"
        },
        {
          cpt: "99454",
          charged: 40,
          allowed: 40,
          adj: 0,
          paid: 0,
          balance: 40,
          codes: [],
          status: "Pending",
          nextAction: "No action"
        },
        {
          cpt: "99457",
          charged: 40,
          allowed: 40,
          adj: 0,
          paid: 0,
          secondaryPaid: "",
          patResp: "",
          balance: 40,
          codes: [],
          status: "Pending",
          nextAction: "No action"
        }
      ])
    });

    const optionalFieldErrors = errors.filter(error =>
      error.includes("secondary paid must be numeric") || error.includes("patient responsibility must be numeric")
    );

    if (optionalFieldErrors.length > 0) {
      throw new Error(`Validation incorrectly rejected empty optional payment fields: ${optionalFieldErrors.join("; ")}`);
    }
  });

  test("Validation: Service line balance cannot be negative", () => {
    const errors = validateClaim({
      claim_id: "CLM-TEST-001B",
      billed_by: "ITERA",
      payment_received_by: "ITERA",
      claim_status: ClaimStatus.Paid,
      claim_classification: ClaimClassification.CleanClaim,
      billed_charge: 100,
      allowed_amount: 100,
      paid_amount: 120,
      service_lines_json: JSON.stringify([{
        cpt: "99453",
        charged: 100,
        allowed: 100,
        adj: 0,
        patResp: 0,
        paid: 120,
        secondaryPaid: 0,
        balance: -20,
        codes: [],
        status: "Paid",
        nextAction: "No action"
      }])
    });

    if (!errors.some(error => error.includes("balance cannot be negative"))) {
      throw new Error("Validation did not catch negative service line balance.");
    }
  });

  test("Validation: PR CAS adjustment does not double-count patient responsibility", () => {
    const errors = validateClaim({
      claim_id: "CLM-TEST-PR-001",
      billed_by: "ITERA",
      payment_received_by: "Unknown",
      claim_status: ClaimStatus.Denied,
      claim_classification: ClaimClassification.DeniedNeedsReview,
      billed_charge: 23.59,
      allowed_amount: 0,
      paid_amount: 0,
      service_lines_json: JSON.stringify([{
        cpt: "99453",
        charged: 23.59,
        allowed: 0,
        adj: 23.59,
        patResp: 23.59,
        paid: 0,
        secondaryPaid: 0,
        balance: 0,
        codes: ["PR-204"],
        status: "Denied",
        nextAction: "Correct and Resubmit"
      }])
    });

    const doubleCountErrors = errors.filter(error =>
      error.includes("balance must equal") || error.includes("balance cannot be negative")
    );

    if (doubleCountErrors.length > 0) {
      throw new Error(`Validation double-counted PR patient responsibility: ${doubleCountErrors.join("; ")}`);
    }
  });

  test("Validation: Denied service line requires ERA code unless Pending ERA", () => {
    const errors = validateClaim({
      claim_id: "CLM-TEST-002",
      billed_by: "ITERA",
      payment_received_by: "Unknown",
      claim_status: ClaimStatus.Denied,
      claim_classification: ClaimClassification.DeniedNeedsReview,
      billed_charge: 100,
      allowed_amount: 0,
      paid_amount: 0,
      service_lines_json: JSON.stringify([{
        cpt: "99453",
        charged: 100,
        allowed: 0,
        adj: 100,
        patResp: 0,
        paid: 0,
        secondaryPaid: 0,
        balance: 0,
        codes: [],
        status: "Denied",
        nextAction: "File appeal"
      }])
    });

    if (!errors.some(error => error.includes("denied/rejected lines require at least one CARC/RARC/MA code"))) {
      throw new Error("Validation did not catch denied service line without ERA code.");
    }

    const pendingEraErrors = validateClaim({
      claim_id: "CLM-TEST-002-PENDING-ERA",
      billed_by: "ITERA",
      payment_received_by: "Unknown",
      claim_status: ClaimStatus.Denied,
      claim_classification: ClaimClassification.DeniedNeedsReview,
      billed_charge: 100,
      allowed_amount: 0,
      paid_amount: 0,
      service_lines_json: JSON.stringify([{
        cpt: "99453",
        charged: 100,
        allowed: 0,
        adj: 100,
        patResp: 0,
        paid: 0,
        secondaryPaid: 0,
        balance: 0,
        codes: [],
        status: "Denied",
        nextAction: "Pending ERA"
      }])
    });

    if (pendingEraErrors.some(error => error.includes("denied/rejected lines require at least one CARC/RARC/MA code"))) {
      throw new Error("Validation should allow denied service lines without ERA codes when Next Action is Pending ERA.");
    }
  });

  test("Validation: Secondary payment requires payer", () => {
    const errors = validateClaim({
      claim_id: "CLM-TEST-003",
      billed_by: "ITERA",
      payment_received_by: "ITERA",
      claim_status: ClaimStatus.Paid,
      claim_classification: ClaimClassification.CleanClaim,
      billed_charge: 100,
      allowed_amount: 100,
      paid_amount: 100,
      service_lines_json: JSON.stringify([{
        cpt: "99453",
        charged: 100,
        allowed: 100,
        adj: 0,
        patResp: 0,
        paid: 80,
        secondaryPaid: 20,
        secondaryPayerId: "",
        hasSecondaryPayment: true,
        balance: 0,
        codes: [],
        status: "Paid",
        nextAction: "No action"
      }])
    });

    if (!errors.some(error => error.includes("select the secondary payer"))) {
      throw new Error("Validation did not catch secondary payment without payer.");
    }
  });

  test("Validation: Mixed CPT outcomes require Partially Paid claim status", () => {
    const errors = validateClaim({
      claim_id: "CLM-TEST-004",
      billed_by: "ITERA",
      payment_received_by: "ITERA",
      claim_status: ClaimStatus.Paid,
      claim_classification: ClaimClassification.CleanClaim,
      billed_charge: 200,
      allowed_amount: 100,
      paid_amount: 100,
      service_lines_json: JSON.stringify([
        {
          cpt: "99453",
          charged: 100,
          allowed: 100,
          adj: 0,
          patResp: 0,
          paid: 100,
          secondaryPaid: 0,
          balance: 0,
          codes: [],
          status: "Paid",
          nextAction: "No action"
        },
        {
          cpt: "99454",
          charged: 100,
          allowed: 0,
          adj: 100,
          patResp: 0,
          paid: 0,
          secondaryPaid: 0,
          balance: 0,
          codes: ["CO-45"],
          status: "Denied",
          nextAction: "File appeal"
        }
      ])
    });

    if (!errors.some(error => error.includes("Claims with both paid and denied CPT lines must use claim status Partially Paid"))) {
      throw new Error("Validation did not catch mixed CPT outcomes with non-partial claim status.");
    }
  });

  return results;
}
