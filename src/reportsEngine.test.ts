import { aggregateReports, calculateReportKpis, DEFAULT_REPORT_FILTERS, getAgingBucket } from "./reportsEngine";
import { Claim, ClaimClassification, ClaimStatus } from "./types";

function claim(overrides: Partial<Claim>): Claim {
  return {
    claim_id: "CLM-1",
    patient_id: "P-1",
    patient_display_name_masked: "Patient",
    practice_id: "PR-1",
    practice_name: "Practice",
    provider_id: "PROV-1",
    provider_name: "Provider",
    provider_npi: "123",
    payer_id: "PAY-1",
    payer_name: "Payer",
    service_type: "RPM",
    cpt_hcpcs: "99454",
    modifiers: "",
    units: 1,
    date_of_service_from: "2026-05-01",
    date_of_service_to: "2026-05-31",
    month_of_service: "2026-05",
    billed_by: "ITERA",
    payment_received_by: "ITERA",
    claim_status: ClaimStatus.Paid,
    claim_classification: ClaimClassification.CleanClaim,
    billed_charge: 100,
    allowed_amount: 80,
    paid_amount: 80,
    insurance_adjustment: 20,
    denied_amount: 0,
    write_off_amount: 0,
    uncollectible_amount: 0,
    net_collectible_revenue: 80,
    itera_direct_collection: 80,
    provider_direct_collection: 0,
    total_collections: 80,
    ar_balance: 0,
    itera_ar: 0,
    provider_ar: 0,
    account_payable_to_physician: 0,
    payment_to_physician: 0,
    ending_ap_to_physician: 0,
    net_itera_revenue: 0,
    net_provider_revenue: 0,
    era_received: "Yes",
    eob_received: "Yes",
    payment_date: "2026-06-01",
    check_or_eft_number: "EFT",
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
    created_at: "2026-05-02T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    updated_by: "test",
    ...overrides
  };
}

export function runReportsEngineTests() {
  const rows = aggregateReports(
    [
      claim({ claim_id: "A", patient_id: "P1" }),
      claim({
        claim_id: "B",
        patient_id: "P2",
        billed_by: "Provider",
        claim_status: ClaimStatus.Denied,
        billed_charge: 50,
        paid_amount: 0,
        total_collections: 0,
        denied_amount: 50,
        net_collectible_revenue: 0
      })
    ],
    DEFAULT_REPORT_FILTERS,
    [{
      coverage_id: "C1",
      practice_id: "PR-1",
      practice_name: "Practice",
      service_type: "RPM",
      period: "2026-05",
      total_eligible_patients: 4,
      notes: "",
      created_at: "",
      updated_at: ""
    }]
  );
  const kpis = calculateReportKpis(rows);
  const failures: string[] = [];
  if (rows.length !== 1) failures.push(`Expected 1 row, got ${rows.length}`);
  if (rows[0]?.claims !== 2) failures.push(`Expected 2 claims, got ${rows[0]?.claims}`);
  if (rows[0]?.providerDeniedClaims !== 1) failures.push("Provider denial was not separated.");
  if (rows[0]?.iteraBilledCharges !== 100) failures.push("ITERA billed charges incorrect.");
  if (rows[0]?.providerBilledCharges !== 50) failures.push("Provider billed charges incorrect.");
  if (rows[0]?.coveragePercent !== 50) failures.push(`Coverage expected 50, got ${rows[0]?.coveragePercent}`);
  if (kpis.totalPaid !== 80) failures.push(`Paid expected 80, got ${kpis.totalPaid}`);
  if (getAgingBucket("2026-01-01", new Date("2026-04-15")) !== "91+ days") failures.push("Aging bucket incorrect.");
  return failures;
}
