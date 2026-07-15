/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Core types for ITERA Claim Reconciliation

export enum ClaimStatus {
  Draft = "Draft",
  Submitted = "Submitted",
  Pending = "Pending",
  Paid = "Paid",
  PartiallyPaid = "Partially Paid",
  Denied = "Denied",
  Rejected = "Rejected",
  Appealed = "Appealed",
  Corrected = "Corrected",
  ReadyToRebill = "Ready to Rebill",
  Resubmitted = "Resubmitted",
  BlockedByError = "Blocked by Error",
  WrittenOff = "Written Off",
  Uncollectible = "Uncollectible",
  Closed = "Closed"
}

export enum ClaimClassification {
  CleanClaim = "Clean Claim",
  MissingPayment = "Missing Payment",
  MissingERA = "Missing ERA",
  PaymentMismatch = "Payment Mismatch",
  ProviderCollected = "Provider Collected",
  IteraCollected = "ITERA Collected",
  SplitCollection = "Split Collection",
  Underpaid = "Underpaid",
  Overpaid = "Overpaid",
  DeniedNeedsReview = "Denied - Needs Review",
  RejectedNeedsCorrection = "Rejected - Needs Correction",
  BillingError = "Billing Error",
  CodingError = "Coding Error",
  EligibilityIssue = "Eligibility Issue",
  AuthorizationIssue = "Authorization Issue",
  DuplicateClaim = "Duplicate Claim",
  TimelyFilingIssue = "Timely Filing Issue",
  ReadyForResubmission = "Ready for Resubmission",
  WriteOffCandidate = "Write-off Candidate",
  Closed = "Closed"
}

export enum ErrorCategory {
  MissingPatientInfo = "Missing patient information",
  MissingProviderInfo = "Missing provider information",
  MissingPayerInfo = "Missing payer information",
  IncorrectCPT = "Incorrect CPT/HCPCS code",
  IncorrectModifier = "Incorrect modifier",
  IncorrectDOS = "Incorrect date of service",
  DuplicateBilling = "Duplicate billing",
  EligibilityIssue = "Eligibility issue",
  AuthorizationIssue = "Authorization issue",
  MissingDocumentation = "Missing documentation",
  IncorrectBillingOwner = "Incorrect billing owner",
  IncorrectPaymentReceiver = "Incorrect payment receiver",
  PaymentMismatch = "Payment mismatch",
  ERAMissing = "ERA/EOB missing",
  DenialCodeMissing = "Denial code missing",
  Other = "Other"
}

export enum UserRole {
  Admin = "Admin",
  BillingManager = "Billing Manager",
  ReconciliationSpecialist = "Reconciliation Specialist",
  ProviderViewer = "Provider Viewer",
  Auditor = "Auditor"
}

export interface Claim {
  claim_id: string;
  patient_id: string;
  patient_display_name_masked: string;
  practice_id: string;
  practice_name: string;
  provider_id: string;
  provider_name: string;
  provider_npi: string;
  payer_id: string;
  payer_name: string;
  service_type: string; // CCM, RPM, APCM, TCM, BHI, etc.
  cpt_hcpcs: string;
  cpt_description?: string;
  modifiers: string;
  units: number;
  date_of_service_from: string; // YYYY-MM-DD
  date_of_service_to: string; // YYYY-MM-DD
  month_of_service: string; // YYYY-MM
  billed_by: "ITERA" | "Provider";
  payment_received_by: "ITERA" | "Provider" | "Split" | "Unknown";
  claim_status: ClaimStatus;
  claim_classification: ClaimClassification;
  
  // Financial fields
  billed_charge: number;
  allowed_amount: number;
  paid_amount: number;
  insurance_adjustment: number;
  denied_amount: number;
  write_off_amount: number;
  uncollectible_amount: number;
  net_collectible_revenue: number;
  
  // Collection breakdowns
  itera_direct_collection: number;
  provider_direct_collection: number;
  total_collections: number;
  ar_balance: number;
  itera_ar: number;
  provider_ar: number;
  
  // Provider payouts
  account_payable_to_physician: number;
  payment_to_physician: number;
  ending_ap_to_physician: number;
  
  // Net revenues
  net_itera_revenue: number;
  net_provider_revenue: number;
  
  // ERA/EOB Status
  era_received: "Yes" | "No";
  eob_received: "Yes" | "No";
  payment_date: string; // YYYY-MM-DD
  submission_date?: string;
  check_or_eft_number: string;
  carc_code: string;
  rarc_code: string;
  denial_reason: string;
  
  // Error Workflow
  error_flag: boolean;
  error_category: ErrorCategory | "";
  locked: boolean;
  lock_reason: string;
  correction_status: "Pending" | "Corrected" | "Ready to Rebill" | "Resubmitted" | "";
  resubmission_date: string; // YYYY-MM-DD
  corrected_claim_reference: string;
  
  last_note: string;
  itera_billed_fee?: number;
  billable_flag?: boolean;
  voided_flag?: boolean;
  corrected_claim_flag?: boolean;
  deleted_flag?: boolean;
  deleted_at?: string;
  deleted_by?: string;
  delete_reason?: string;
  service_lines_json?: string;
  // Transient metadata used during insurance change events (not persisted)
  insurance_change_reason?: string;
  insurance_change_member_id?: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

export interface Payment {
  payment_id: string;
  claim_id: string;
  payment_date: string; // YYYY-MM-DD
  payment_received_by: "ITERA" | "Provider";
  payer_name: string;
  amount: number;
  check_or_eft_number: string;
  era_id: string;
  eob_id: string;
  payment_source: string; // ERA, Manual, Patient check
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  note_id: string;
  claim_id: string;
  note_type: "General" | "Billing" | "Reconciliation" | "Provider" | "Internal ITERA" | "Denial Follow-up" | "Correction";
  note_text: string;
  created_by: string;
  created_at: string;
}

export interface AuditLog {
  audit_id: string;
  claim_id: string;
  action_type: "Create" | "Update" | "Bulk Update" | "Import" | "Lock" | "Unlock" | "Status Change" | "Delete";
  field_name: string;
  previous_value: string;
  new_value: string;
  reason: string;
  changed_by: string;
  changed_at: string;
}

export interface Provider {
  provider_id: string;
  provider_name: string;
  npi: string;
  practice_id: string;
  practice_name: string;
  active: boolean;
}

export interface Payer {
  payer_id: string;
  payer_name: string;
  payer_type: string; // Medicare, Medicaid, Commercial, etc.
  pverify_payer_code?: string;
  eligibility_supported?: boolean | string;
  claim_status_supported?: boolean | string;
  dental_eligibility_supported?: boolean | string;
  active: boolean;
}

export interface User {
  user_id: string;
  name: string;
  email: string;
  role: UserRole;
  menu_access?: string;
  provider_access?: string;
  active: boolean;
}

export interface Setting {
  setting_key: string;
  setting_value: string;
  description: string;
}

export interface BackupRecord {
  backup_id: string;
  backup_file_id: string;
  backup_file_name: string;
  backup_drive_url: string;
  created_by: string;
  created_at: string;
  source_spreadsheet_id: string;
  status: string;
  notes: string;
  last_restored_at?: string;
  last_restored_by?: string;
}

export interface JobRecord {
  job_id: string;
  job_type: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  requested_by: string;
  requested_at: string;
  started_at: string;
  completed_at: string;
  summary_json: string;
  error_message: string;
}

export interface ImportHistoryRecord {
  import_id: string;
  import_type: string;
  file_name: string;
  file_drive_url: string;
  requested_by: string;
  imported_at: string;
  total_rows: number;
  imported_rows: number;
  rejected_rows: number;
  review_rows: number;
  total_amount: number;
  summary_json: string;
  status: string;
}

export interface UserActivityLog {
  activity_id: string;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata_json: string;
  created_at: string;
}

export interface ReviewTask {
  task_id: string;
  source: string;
  claim_id: string;
  cpt_code: string;
  reason: string;
  assigned_to: string;
  priority: "Low" | "Medium" | "High";
  status: "Open" | "In Progress" | "Resolved" | "Dismissed";
  due_date: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationRecord {
  notification_id: string;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  target_role: string;
  read_by_json: string;
  created_at: string;
}

export interface BankDeposit {
  deposit_id: string;
  deposit_date: string;
  check_or_eft_number: string;
  payer_name: string;
  deposit_amount: number;
  matched_payment_total: number;
  difference: number;
  status: "Matched" | "Mismatch" | "Unmatched";
  notes: string;
  created_at: string;
}

export interface MonthlyCloseRecord {
  close_id: string;
  period: string;
  status: "Open" | "Closed" | "Reopened";
  closed_by: string;
  closed_at: string;
  backup_file_id: string;
  validation_summary_json: string;
  notes: string;
}

export interface FeeSchedule {
  id: string;
  cpt_code: string;
  year: number;
  semester1_rate: number;
  semester2_rate: number;
  max_per_dos?: number;
  description: string;
}

export interface EligibilityCoverage {
  coverage_id: string;
  practice_id: string;
  practice_name: string;
  service_type: string;
  period: string;
  total_eligible_patients: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ReportFeeSchedule {
  fee_schedule_id: string;
  cpt_hcpcs: string;
  cpt_description: string;
  service_type: string;
  unit_price: number;
  itera_fee: number;
  effective_date: string;
  active: boolean;
}

// FHIR Conceptual Mapping Notes:
// - Claim -> FHIR Claim (Billing & Professional services)
// - ClaimResponse / Payment -> FHIR ClaimResponse & ExplanationOfBenefit (EOB)
// - PaymentReconciliation -> FHIR PaymentReconciliation (payouts to practitioner)
// - Provider -> FHIR Practitioner / Organization
// - Payer -> FHIR Coverage / Organization (Payer)
