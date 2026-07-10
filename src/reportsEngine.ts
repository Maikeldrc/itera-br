import {
  Claim,
  ClaimStatus,
  EligibilityCoverage,
  FeeSchedule,
  ReportFeeSchedule
} from "./types";

export type ReportView =
  | "billing-summary"
  | "provider-vs-itera"
  | "collections"
  | "denials"
  | "pending"
  | "coverage";

export type ReportGroupBy =
  | "month"
  | "date"
  | "practice"
  | "provider"
  | "serviceType"
  | "cpt"
  | "payer"
  | "billedBy"
  | "paymentReceivedBy";

export interface ReportFiltersState {
  search: string;
  startDate: string;
  endDate: string;
  month: string;
  practiceId: string;
  providerId: string;
  serviceType: string;
  cptCode: string;
  billedBy: string;
  paymentReceivedBy: string;
  claimStatus: string;
  payerId: string;
  submissionStartDate: string;
  submissionEndDate: string;
  paymentStartDate: string;
  paymentEndDate: string;
  groupBy: ReportGroupBy[];
  collectionBasis: "billed" | "netCollectible";
}

export interface ReportRow {
  key: string;
  claimIds: string[];
  deniedClaimIds: string[];
  billablePatientIds: string[];
  coverageEntries: Array<{ id: string; eligible: number }>;
  date: string;
  practice: string;
  provider: string;
  serviceType: string;
  cptCode: string;
  cptDescription: string;
  payer: string;
  billedBy: string;
  paymentReceivedBy: string;
  uniqueBillablePatients: number;
  eligiblePatients: number | null;
  coveragePercent: number | null;
  unitsBilled: number;
  providerUnitsBilled: number;
  iteraUnitsBilled: number;
  claims: number;
  unitPrice: number;
  totalBilledCharges: number;
  providerBilledCharges: number;
  iteraBilledCharges: number;
  iteraBilledFee: number;
  totalPaid: number;
  netCollectibleRevenue: number;
  difference: number;
  collectionRate: number;
  providerDeniedClaims: number;
  providerDeniedAmount: number;
  iteraDeniedClaims: number;
  iteraDeniedAmount: number;
  denialRate: number;
  pendingClaims: number;
  pendingAmount: number;
  providerPendingClaims: number;
  providerPendingAmount: number;
  iteraPendingClaims: number;
  iteraPendingAmount: number;
  submissionDate: string;
  paymentDate: string;
  agingBucket: AgingBucket | "";
}

export interface ReportKpis {
  totalBilledCharges: number;
  totalPaid: number;
  difference: number;
  collectionRate: number;
  totalDenied: number;
  denialRate: number;
  totalPending: number;
  uniqueBillablePatients: number;
  eligiblePatients: number | null;
  coveragePercent: number | null;
  iteraBilledCharges: number;
  providerBilledCharges: number;
  iteraPending: number;
  providerPending: number;
}

export type AgingBucket = "0-30 days" | "31-60 days" | "61-90 days" | "91+ days";

interface ReportLine {
  claim: Claim;
  cptCode: string;
  cptDescription: string;
  serviceType: string;
  units: number;
  billed: number;
  allowed: number;
  paid: number;
  denied: number;
  pending: number;
  netCollectible: number;
  iteraFee: number;
}

const PENDING_STATUSES = new Set<ClaimStatus>([ClaimStatus.Pending, ClaimStatus.Submitted]);
const INVALID_STATUSES = new Set<ClaimStatus>([ClaimStatus.Rejected, ClaimStatus.BlockedByError]);

export const DEFAULT_REPORT_FILTERS: ReportFiltersState = {
  search: "",
  startDate: "",
  endDate: "",
  month: "",
  practiceId: "",
  providerId: "",
  serviceType: "",
  cptCode: "",
  billedBy: "",
  paymentReceivedBy: "",
  claimStatus: "",
  payerId: "",
  submissionStartDate: "",
  submissionEndDate: "",
  paymentStartDate: "",
  paymentEndDate: "",
  groupBy: ["date", "practice", "serviceType", "cpt"],
  collectionBasis: "billed"
};

function number(value: unknown) {
  return Number(value) || 0;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function textValue(value: unknown) {
  return String(value ?? "").trim();
}

function splitCpts(claim: Claim) {
  return textValue(claim.cpt_hcpcs).split(/[\s,]+/).map(value => value.trim()).filter(Boolean);
}

function dateText(value: unknown) {
  return textValue(value).slice(0, 10);
}

function feeScheduleFor(
  claim: Claim,
  cptCode: string,
  feeSchedules: FeeSchedule[],
  reportFeeSchedules: ReportFeeSchedule[]
) {
  const reportSchedule = reportFeeSchedules
    .filter(item => item.active && textValue(item.cpt_hcpcs) === cptCode)
    .sort((a, b) => textValue(b.effective_date).localeCompare(textValue(a.effective_date)))
    .find(item => !item.effective_date || textValue(item.effective_date) <= dateText(claim.date_of_service_from));
  if (reportSchedule) {
    return {
      description: reportSchedule.cpt_description,
      unitPrice: number(reportSchedule.unit_price),
      iteraFee: number(reportSchedule.itera_fee)
    };
  }

  const serviceDate = dateText(claim.date_of_service_from);
  const year = Number(serviceDate.slice(0, 4)) || new Date().getFullYear();
  const month = Number(serviceDate.slice(5, 7)) || 1;
  const schedule = feeSchedules.find(item => textValue(item.cpt_code) === cptCode && Number(item.year) === year);
  return {
    description: schedule?.description || claim.cpt_description || "",
    unitPrice: schedule ? (month <= 6 ? schedule.semester1_rate : schedule.semester2_rate) : 0,
    iteraFee: 0
  };
}

export function expandClaimsToReportLines(
  claims: Claim[],
  feeSchedules: FeeSchedule[] = [],
  reportFeeSchedules: ReportFeeSchedule[] = []
): ReportLine[] {
  return claims.flatMap(claim => {
    const cpts = splitCpts(claim);
    let parsedLines: any[] = [];
    try {
      parsedLines = claim.service_lines_json ? JSON.parse(claim.service_lines_json) : [];
    } catch {
      parsedLines = [];
    }
    const count = Math.max(cpts.length, 1);

    return cpts.map(cptCode => {
      const serviceLine = parsedLines.find(line => line.cpt === cptCode);
      const fee = feeScheduleFor(claim, cptCode, feeSchedules, reportFeeSchedules);
      const units = number(serviceLine?.units) || (count === 1 ? number(claim.units) || 1 : 1);
      const billed = serviceLine?.charged !== undefined
        ? number(serviceLine.charged)
        : fee.unitPrice > 0
          ? fee.unitPrice * units
          : number(claim.billed_charge) / count;
      const allowed = serviceLine?.allowed !== undefined ? number(serviceLine.allowed) : number(claim.allowed_amount) / count;
      const paid = serviceLine
        ? number(serviceLine.paid) + number(serviceLine.secondaryPaid)
        : (number(claim.total_collections) || number(claim.paid_amount)) / count;
      const denied = serviceLine?.status === "Denied"
        ? Math.max(billed - paid - number(serviceLine.adj), 0)
        : number(claim.denied_amount) / count;
      const pending = PENDING_STATUSES.has(claim.claim_status)
        ? (number(claim.ar_balance) || billed) / count
        : 0;

      return {
        claim,
        cptCode,
        cptDescription: fee.description || `CPT ${cptCode}`,
        serviceType: serviceLine?.serviceType || claim.service_type,
        units,
        billed,
        allowed,
        paid,
        denied,
        pending,
        netCollectible: number(claim.net_collectible_revenue) / count,
        iteraFee: claim.itera_billed_fee !== undefined
          ? number(claim.itera_billed_fee) / count
          : fee.iteraFee * units
      };
    });
  });
}

function matchesFilters(line: ReportLine, filters: ReportFiltersState) {
  const claim = line.claim;
  const serviceDate = dateText(claim.date_of_service_from);
  const submissionDate = dateText(claim.submission_date) || dateText(claim.created_at);
  const paymentDate = dateText(claim.payment_date);
  const search = filters.search.trim().toLowerCase();

  if (search && ![
    claim.claim_id,
    claim.patient_id,
    claim.practice_name,
    claim.provider_name,
    line.cptCode,
    line.cptDescription,
    claim.payer_name
  ].some(value => String(value || "").toLowerCase().includes(search))) return false;
  if (filters.startDate && serviceDate < filters.startDate) return false;
  if (filters.endDate && serviceDate > filters.endDate) return false;
  if (filters.month && textValue(claim.month_of_service) !== filters.month) return false;
  if (filters.practiceId && textValue(claim.practice_id) !== filters.practiceId) return false;
  if (filters.providerId && textValue(claim.provider_id) !== filters.providerId) return false;
  if (filters.serviceType && textValue(line.serviceType) !== filters.serviceType) return false;
  if (filters.cptCode && textValue(line.cptCode) !== filters.cptCode) return false;
  if (filters.billedBy && textValue(claim.billed_by) !== filters.billedBy) return false;
  if (filters.paymentReceivedBy && textValue(claim.payment_received_by) !== filters.paymentReceivedBy) return false;
  if (filters.claimStatus && textValue(claim.claim_status) !== filters.claimStatus) return false;
  if (filters.payerId && textValue(claim.payer_id) !== filters.payerId) return false;
  if (filters.submissionStartDate && submissionDate < filters.submissionStartDate) return false;
  if (filters.submissionEndDate && submissionDate > filters.submissionEndDate) return false;
  if (filters.paymentStartDate && (!paymentDate || paymentDate < filters.paymentStartDate)) return false;
  if (filters.paymentEndDate && (!paymentDate || paymentDate > filters.paymentEndDate)) return false;
  return true;
}

function groupValue(line: ReportLine, groupBy: ReportGroupBy) {
  const claim = line.claim;
  const values: Record<ReportGroupBy, string> = {
    month: textValue(claim.month_of_service),
    date: dateText(claim.date_of_service_from),
    practice: textValue(claim.practice_name),
    provider: textValue(claim.provider_name),
    serviceType: textValue(line.serviceType),
    cpt: textValue(line.cptCode),
    payer: textValue(claim.payer_name),
    billedBy: textValue(claim.billed_by),
    paymentReceivedBy: textValue(claim.payment_received_by)
  };
  return values[groupBy] || "N/A";
}

function dateRange(values: string[], pendingLabel = false) {
  const dates = values.filter(Boolean).sort();
  if (dates.length === 0) return pendingLabel ? "Pending" : "";
  return dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} - ${dates[dates.length - 1]}`;
}

function coverageForGroup(
  lines: ReportLine[],
  coverage: EligibilityCoverage[]
) {
  const billablePatients = new Set(
    lines
      .filter(line => line.claim.billable_flag !== false && !line.claim.voided_flag && !INVALID_STATUSES.has(line.claim.claim_status))
      .map(line => line.claim.patient_id)
  );
  const keys = new Set(lines.map(line => `${textValue(line.claim.practice_id)}|${textValue(line.serviceType)}|${textValue(line.claim.month_of_service)}`));
  const matchingCoverage = coverage.filter(item => keys.has(`${item.practice_id}|${item.service_type}|${item.period}`));
  const eligible = matchingCoverage.length > 0
    ? matchingCoverage.reduce((sum, item) => sum + number(item.total_eligible_patients), 0)
    : null;
  return {
    billablePatients: billablePatients.size,
    billablePatientIds: Array.from(billablePatients),
    eligible,
    coverageEntries: matchingCoverage.map(item => ({ id: item.coverage_id, eligible: number(item.total_eligible_patients) })),
    percent: eligible && eligible > 0 ? (billablePatients.size / eligible) * 100 : null
  };
}

export function getAgingBucket(submissionDate: string, asOf = new Date()): AgingBucket | "" {
  if (!submissionDate) return "";
  const submitted = new Date(`${submissionDate}T00:00:00`);
  if (Number.isNaN(submitted.getTime())) return "";
  const days = Math.max(0, Math.floor((asOf.getTime() - submitted.getTime()) / 86400000));
  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "91+ days";
}

export function aggregateReports(
  claims: Claim[],
  filters: ReportFiltersState,
  coverage: EligibilityCoverage[] = [],
  feeSchedules: FeeSchedule[] = [],
  reportFeeSchedules: ReportFeeSchedule[] = []
): ReportRow[] {
  const lines = expandClaimsToReportLines(claims, feeSchedules, reportFeeSchedules)
    .filter(line => matchesFilters(line, filters));
  const groups = new Map<string, ReportLine[]>();

  lines.forEach(line => {
    const key = filters.groupBy.map(group => `${group}:${groupValue(line, group)}`).join("|") || "all";
    groups.set(key, [...(groups.get(key) || []), line]);
  });

  return Array.from(groups.entries()).map(([key, groupLines]) => {
    const first = groupLines[0];
    const uniqueClaims = new Map(groupLines.map(line => [line.claim.claim_id, line.claim]));
    const claimList = Array.from(uniqueClaims.values());
    const deniedClaims = claimList.filter(claim => claim.claim_status === ClaimStatus.Denied);
    const pendingClaims = claimList.filter(claim => PENDING_STATUSES.has(claim.claim_status));
    const totalBilled = groupLines.reduce((sum, line) => sum + line.billed, 0);
    const totalPaid = groupLines.reduce((sum, line) => sum + line.paid, 0);
    const netCollectible = groupLines.reduce((sum, line) => sum + line.netCollectible, 0);
    const collectionBase = filters.collectionBasis === "netCollectible" ? netCollectible : totalBilled;
    const coverageStats = coverageForGroup(groupLines, coverage);
    const providerDenied = deniedClaims.filter(claim => claim.billed_by === "Provider");
    const iteraDenied = deniedClaims.filter(claim => claim.billed_by === "ITERA");
    const providerPending = pendingClaims.filter(claim => claim.billed_by === "Provider");
    const iteraPending = pendingClaims.filter(claim => claim.billed_by === "ITERA");
    const submissionDates = claimList.map(claim => dateText(claim.submission_date) || dateText(claim.created_at));
    const paymentDates = claimList.map(claim => dateText(claim.payment_date));
    const latestSubmission = submissionDates.filter(Boolean).sort().at(-1) || "";

    return {
      key,
      claimIds: Array.from(uniqueClaims.keys()),
      deniedClaimIds: deniedClaims.map(claim => claim.claim_id),
      billablePatientIds: coverageStats.billablePatientIds,
      coverageEntries: coverageStats.coverageEntries,
      date: filters.groupBy.includes("month") ? textValue(first.claim.month_of_service) : dateText(first.claim.date_of_service_from),
      practice: filters.groupBy.includes("practice") ? textValue(first.claim.practice_name) : "All practices",
      provider: filters.groupBy.includes("provider") ? textValue(first.claim.provider_name) : "All providers",
      serviceType: filters.groupBy.includes("serviceType") ? textValue(first.serviceType) : "All services",
      cptCode: filters.groupBy.includes("cpt") ? textValue(first.cptCode) : "All CPTs",
      cptDescription: filters.groupBy.includes("cpt") ? textValue(first.cptDescription) : "Multiple CPT services",
      payer: filters.groupBy.includes("payer") ? textValue(first.claim.payer_name) : "All payers",
      billedBy: filters.groupBy.includes("billedBy") ? textValue(first.claim.billed_by) : "Mixed",
      paymentReceivedBy: filters.groupBy.includes("paymentReceivedBy") ? textValue(first.claim.payment_received_by) : "Mixed",
      uniqueBillablePatients: coverageStats.billablePatients,
      eligiblePatients: coverageStats.eligible,
      coveragePercent: coverageStats.percent === null ? null : round(coverageStats.percent),
      unitsBilled: groupLines.reduce((sum, line) => sum + line.units, 0),
      providerUnitsBilled: groupLines.filter(line => line.claim.billed_by === "Provider").reduce((sum, line) => sum + line.units, 0),
      iteraUnitsBilled: groupLines.filter(line => line.claim.billed_by === "ITERA").reduce((sum, line) => sum + line.units, 0),
      claims: uniqueClaims.size,
      unitPrice: round(totalBilled / Math.max(groupLines.reduce((sum, line) => sum + line.units, 0), 1)),
      totalBilledCharges: round(totalBilled),
      providerBilledCharges: round(groupLines.filter(line => line.claim.billed_by === "Provider").reduce((sum, line) => sum + line.billed, 0)),
      iteraBilledCharges: round(groupLines.filter(line => line.claim.billed_by === "ITERA").reduce((sum, line) => sum + line.billed, 0)),
      iteraBilledFee: round(groupLines.reduce((sum, line) => sum + line.iteraFee, 0)),
      totalPaid: round(totalPaid),
      netCollectibleRevenue: round(netCollectible),
      difference: round(collectionBase - totalPaid),
      collectionRate: collectionBase > 0 ? round((totalPaid / collectionBase) * 100) : 0,
      providerDeniedClaims: providerDenied.length,
      providerDeniedAmount: round(groupLines.filter(line => line.claim.billed_by === "Provider" && line.claim.claim_status === ClaimStatus.Denied).reduce((sum, line) => sum + line.denied, 0)),
      iteraDeniedClaims: iteraDenied.length,
      iteraDeniedAmount: round(groupLines.filter(line => line.claim.billed_by === "ITERA" && line.claim.claim_status === ClaimStatus.Denied).reduce((sum, line) => sum + line.denied, 0)),
      denialRate: uniqueClaims.size > 0 ? round((deniedClaims.length / uniqueClaims.size) * 100) : 0,
      pendingClaims: pendingClaims.length,
      pendingAmount: round(groupLines.reduce((sum, line) => sum + line.pending, 0)),
      providerPendingClaims: providerPending.length,
      providerPendingAmount: round(groupLines.filter(line => line.claim.billed_by === "Provider").reduce((sum, line) => sum + line.pending, 0)),
      iteraPendingClaims: iteraPending.length,
      iteraPendingAmount: round(groupLines.filter(line => line.claim.billed_by === "ITERA").reduce((sum, line) => sum + line.pending, 0)),
      submissionDate: dateRange(submissionDates),
      paymentDate: dateRange(paymentDates, pendingClaims.length > 0),
      agingBucket: pendingClaims.length > 0 ? getAgingBucket(latestSubmission) : ""
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.practice.localeCompare(b.practice) || a.cptCode.localeCompare(b.cptCode));
}

export function calculateReportKpis(rows: ReportRow[]): ReportKpis {
  const totalBilled = rows.reduce((sum, row) => sum + row.totalBilledCharges, 0);
  const totalPaid = rows.reduce((sum, row) => sum + row.totalPaid, 0);
  const deniedClaims = new Set(rows.flatMap(row => row.deniedClaimIds)).size;
  const totalClaims = new Set(rows.flatMap(row => row.claimIds)).size;
  const coverageEntries = new Map<string, number>();
  rows.flatMap(row => row.coverageEntries).forEach(entry => coverageEntries.set(entry.id, entry.eligible));
  const eligible = coverageEntries.size > 0 ? Array.from(coverageEntries.values()).reduce((sum, value) => sum + value, 0) : null;
  const patients = new Set(rows.flatMap(row => row.billablePatientIds)).size;

  return {
    totalBilledCharges: round(totalBilled),
    totalPaid: round(totalPaid),
    difference: round(rows.reduce((sum, row) => sum + row.difference, 0)),
    collectionRate: totalBilled > 0 ? round((totalPaid / totalBilled) * 100) : 0,
    totalDenied: round(rows.reduce((sum, row) => sum + row.providerDeniedAmount + row.iteraDeniedAmount, 0)),
    denialRate: totalClaims > 0 ? round((deniedClaims / totalClaims) * 100) : 0,
    totalPending: round(rows.reduce((sum, row) => sum + row.pendingAmount, 0)),
    uniqueBillablePatients: patients,
    eligiblePatients: eligible,
    coveragePercent: eligible && eligible > 0 ? round((patients / eligible) * 100) : null,
    iteraBilledCharges: round(rows.reduce((sum, row) => sum + row.iteraBilledCharges, 0)),
    providerBilledCharges: round(rows.reduce((sum, row) => sum + row.providerBilledCharges, 0)),
    iteraPending: round(rows.reduce((sum, row) => sum + row.iteraPendingAmount, 0)),
    providerPending: round(rows.reduce((sum, row) => sum + row.providerPendingAmount, 0))
  };
}

export function filterRowsForView(rows: ReportRow[], view: ReportView) {
  if (view === "denials") return rows.filter(row => row.providerDeniedClaims + row.iteraDeniedClaims > 0);
  if (view === "pending") return rows.filter(row => row.pendingClaims > 0);
  if (view === "coverage") return rows.filter(row => row.uniqueBillablePatients > 0);
  return rows;
}
