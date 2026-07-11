import { getClaimDifferences, GoogleSheetsService } from "./googleSheetsService";
import { ClaimClassification, ClaimStatus, type Claim } from "./types";

function baseClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    claim_id: "CLM-QA",
    patient_id: "QA_AUTO_MRN_001",
    patient_display_name_masked: "QA_AUTO_PATIENT_001",
    practice_id: "PRAC_01",
    practice_name: "Metropolitan Care Group",
    provider_id: "PROV_01",
    provider_name: "Dr. Robert Chen",
    provider_npi: "1982736450",
    payer_id: "00283",
    payer_name: "AARP (A United HealthCare Insurance Company)",
    service_type: "RPM",
    cpt_hcpcs: "99453",
    modifiers: "",
    units: 1,
    date_of_service_from: "2026-07-11",
    date_of_service_to: "2026-07-11",
    month_of_service: "2026-07",
    billed_by: "ITERA",
    payment_received_by: "ITERA",
    claim_status: ClaimStatus.Draft,
    claim_classification: ClaimClassification.CleanClaim,
    billed_charge: 23.59,
    allowed_amount: 23.59,
    paid_amount: 0,
    insurance_adjustment: 0,
    denied_amount: 0,
    write_off_amount: 0,
    uncollectible_amount: 0,
    net_collectible_revenue: 23.59,
    itera_direct_collection: 0,
    provider_direct_collection: 0,
    total_collections: 0,
    ar_balance: 23.59,
    itera_ar: 23.59,
    provider_ar: 0,
    account_payable_to_physician: 0,
    payment_to_physician: 0,
    ending_ap_to_physician: 0,
    net_itera_revenue: 0,
    net_provider_revenue: 0,
    era_received: "No",
    eob_received: "No",
    payment_date: "",
    check_or_eft_number: "",
    carc_code: "",
    rarc_code: "",
    denial_reason: "",
    error_flag: false,
    error_category: "",
    locked: false,
    lock_reason: "",
    correction_status: "",
    resubmission_date: "",
    corrected_claim_reference: "",
    last_note: "",
    service_lines_json: JSON.stringify([{
      cpt: "99453",
      charged: 23.59,
      allowed: 23.59,
      adj: 0,
      patResp: 0,
      paid: 0,
      secondaryPaid: 0,
      secondaryPayerId: "",
      hasSecondaryPayment: false,
      balance: 23.59,
      codes: [],
      status: "Not Billed",
      notes: [],
      nextAction: "No action",
      eftNumber: "",
      paymentDate: ""
    }]),
    created_at: "2026-07-11T14:00:00.000Z",
    updated_at: "2026-07-11T14:00:00.000Z",
    updated_by: "qa",
    ...overrides
  };
}

export async function runGoogleSheetsServiceTests() {
  const failures: string[] = [];

  const previous = baseClaim({
    error_category: undefined as unknown as "",
    service_lines_json: JSON.stringify([{
      cpt: "99453",
      serviceType: "RPM",
      charged: 23.59,
      allowed: 23.59,
      adj: 0,
      patResp: 0,
      paid: 0,
      secondaryPaid: 0,
      secondaryPayerId: "",
      hasSecondaryPayment: false,
      balance: 23.59,
      codes: [],
      status: "Not Billed",
      notes: [],
      nextAction: "No action",
      eftNumber: "",
      paymentDate: ""
    }])
  });
  const current = baseClaim({ error_category: "" });

  const diffs = getClaimDifferences(previous, current);
  if (diffs.some(diff => diff.field === "error_category")) {
    failures.push("Empty error_category equivalence generated a false audit diff.");
  }
  if (diffs.some(diff => diff.field === "service_lines_json")) {
    failures.push("Equivalent service lines generated a false audit diff.");
  }

  const service = new GoogleSheetsService();
  service.auditLogs = [
    {
      audit_id: "",
      claim_id: "",
      action_type: "" as any,
      field_name: "",
      previous_value: "",
      new_value: "",
      reason: "",
      changed_by: "",
      changed_at: ""
    },
    {
      audit_id: "AUD-QA",
      claim_id: "CLM-QA",
      action_type: "Create",
      field_name: "all",
      previous_value: "",
      new_value: "Claim Created",
      reason: "QA",
      changed_by: "qa",
      changed_at: "2026-07-11T14:00:00.000Z"
    }
  ];
  try {
    const logs = await service.getAuditLogs();
    if (logs.length !== 1 || logs[0].audit_id !== "AUD-QA") {
      failures.push("Blank audit log rows were not filtered.");
    }
  } catch (err: any) {
    failures.push(`Audit log filtering threw: ${err.message || String(err)}`);
  }

  return failures;
}
