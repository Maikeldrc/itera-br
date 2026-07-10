export type IssueGroupCode = "CO" | "PR" | "OA" | "PI";

export interface IssueCarcCode {
  code: string;
  description: string;
}

export interface IssueRarcCode {
  code: string;
  description: string;
}

export interface IssueCodeCombination {
  groupCode: IssueGroupCode;
  carc: string;
  rarcs: string[];
}

export interface QuickIssuePreset {
  label: string;
  category: string;
  carc: string;
  rarcs: string[];
}

export const ISSUE_GROUP_CODES: IssueGroupCode[] = ["CO", "PR", "OA", "PI"];

export const CARC_CATALOG: IssueCarcCode[] = [
  { code: "CO-16", description: "Claim lacks information or has submission errors." },
  { code: "CO-18", description: "Duplicate claim or service." },
  { code: "CO-22", description: "Coordination of Benefits (COB) issue." },
  { code: "CO-27", description: "Expenses incurred after coverage terminated." },
  { code: "CO-29", description: "The time limit for filing has expired." },
  { code: "CO-50", description: "Non-covered service; not medically necessary." },
  { code: "CO-97", description: "Procedure/revenue code bundled/inclusive." },
  { code: "CO-109", description: "Claim/service not covered by this payer." },
  { code: "CO-119", description: "Benefit maximum has been reached." },
  { code: "CO-197", description: "Precertification, authorization, notification absent." },
  { code: "CO-204", description: "Service not covered under current benefit plan." },
  { code: "CO-206", description: "National Provider Identifier (NPI) missing or invalid." },
  { code: "PR-1", description: "Deductible." },
  { code: "PR-2", description: "Coinsurance." },
  { code: "PR-3", description: "Copayment." },
  { code: "PR-204", description: "Service not covered under current benefit plan." },
  { code: "OA-18", description: "Duplicate claim/service (Other Adjustment)." },
  { code: "OA-23", description: "Impact of prior payer adjudication." },
  { code: "PI-204", description: "Service not covered (Payer Initiated)." },
];

export const RARC_CATALOG: IssueRarcCode[] = [
  { code: "N105", description: "This is a Railroad Medicare claim." },
  { code: "N781", description: "Patient is a Qualified Medicare Beneficiary (QMB). Medicaid cost-sharing limitations apply." },
  { code: "N782", description: "Co-insurance/deductible not collectable from patient under Medicaid regulations." },
  { code: "N783", description: "Patient responsibility must be billed to Medicaid as QMB." },
  { code: "N115", description: "Decision based on Local Coverage Determination (LCD)." },
  { code: "N182", description: "Missing/incomplete/invalid treatment authorization number." },
  { code: "N290", description: "Missing/incomplete/invalid rendering provider primary identifier." },
  { code: "N30", description: "Patient ineligible for this service." },
  { code: "N29", description: "Missing documentation/notes/orders." },
  { code: "N130", description: "Consult plan benefit documents for details." },
];

export const QUICK_ISSUE_PRESETS: QuickIssuePreset[] = [
  { label: "Incorrect Payer / Contractor", category: "Incorrect Payer", carc: "CO-109", rarcs: [] },
  { label: "Eligibility / Coverage Issue", category: "Eligibility / Coverage", carc: "PR-204", rarcs: [] },
  { label: "Railroad Medicare", category: "Railroad Medicare", carc: "CO-109", rarcs: ["N105"] },
  { label: "COB Issue", category: "Coordination of Benefits", carc: "CO-22", rarcs: [] },
  { label: "Missing Information", category: "Documentation", carc: "CO-16", rarcs: ["N29"] },
  { label: "Authorization Missing", category: "Authorization / Referral", carc: "CO-197", rarcs: ["N182"] },
  { label: "Duplicate Claim", category: "Duplicate Claim", carc: "CO-18", rarcs: [] },
  { label: "Bundled / Inclusive", category: "Bundling", carc: "CO-97", rarcs: [] },
  { label: "Timely Filing", category: "Timely Filing", carc: "CO-29", rarcs: [] },
  { label: "Medical Necessity", category: "Medical Necessity", carc: "CO-50", rarcs: ["N115"] },
  { label: "Benefit Maximum Reached", category: "Benefit Limitation", carc: "CO-119", rarcs: [] },
  { label: "Non-Covered Service", category: "Contractual Adjustment", carc: "CO-204", rarcs: ["N130"] },
  { label: "Provider Enrollment / NPI Issue", category: "NPI / Provider Data", carc: "CO-206", rarcs: ["N290"] },
  { label: "Patient Responsibility", category: "Patient Responsibility", carc: "PR-1", rarcs: [] },
  { label: "QMB / Medicaid Cost-Sharing", category: "QMB / Medicaid", carc: "PR-1", rarcs: ["N781"] }
];

export function getCarcGroup(carcCode: string) {
  return String(carcCode || "").split("-")[0] as IssueGroupCode;
}

export function getCarcOptionsForGroup(groupCode: IssueGroupCode) {
  return CARC_CATALOG.filter(carc => getCarcGroup(carc.code) === groupCode);
}

export function getDefaultCarcForGroup(groupCode: IssueGroupCode) {
  return getCarcOptionsForGroup(groupCode)[0]?.code || "";
}

export function getQuickIssuePreset(label: string) {
  return QUICK_ISSUE_PRESETS.find(preset => preset.label === label);
}

export function getQuickIssuePresetLabels() {
  return QUICK_ISSUE_PRESETS.map(preset => preset.label);
}

export function quickCodesForCategory(category: string) {
  const preset = QUICK_ISSUE_PRESETS.find(item => item.category === category);
  return preset ? [preset.carc, ...preset.rarcs] : ["CO-16"];
}

export function validateIssueCombination(combination: IssueCodeCombination): string[] {
  const errors: string[] = [];
  if (!ISSUE_GROUP_CODES.includes(combination.groupCode)) {
    errors.push(`Unsupported group code: ${combination.groupCode}`);
  }

  const carcGroup = getCarcGroup(combination.carc);
  if (carcGroup !== combination.groupCode) {
    errors.push(`CARC ${combination.carc} does not belong to group ${combination.groupCode}.`);
  }

  if (!CARC_CATALOG.some(item => item.code === combination.carc)) {
    errors.push(`Unknown CARC code: ${combination.carc}`);
  }

  const validRarcs = new Set(RARC_CATALOG.map(item => item.code));
  combination.rarcs.forEach(code => {
    if (!validRarcs.has(code)) {
      errors.push(`Unknown RARC code: ${code}`);
    }
  });

  return errors;
}

export function normalizeIssueCombination(combination: IssueCodeCombination): IssueCodeCombination {
  const groupCode = combination.groupCode;
  const validCarcs = getCarcOptionsForGroup(groupCode);
  const carc = validCarcs.some(item => item.code === combination.carc)
    ? combination.carc
    : getDefaultCarcForGroup(groupCode);
  const validRarcs = new Set(RARC_CATALOG.map(item => item.code));
  const rarcs = Array.from(new Set(combination.rarcs.filter(code => validRarcs.has(code))));

  return { groupCode, carc, rarcs };
}

export function buildIssueCodes(combinations: IssueCodeCombination[]) {
  return Array.from(new Set(
    combinations.flatMap(combination => {
      const normalized = normalizeIssueCombination(combination);
      return [normalized.carc, ...normalized.rarcs];
    }).filter(Boolean)
  ));
}

export function enumerateRarcSubsets() {
  const codes = RARC_CATALOG.map(item => item.code);
  const subsets: string[][] = [];
  const total = 2 ** codes.length;
  for (let mask = 0; mask < total; mask += 1) {
    subsets.push(codes.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return subsets;
}

export function enumerateIssueCombinationTestCases() {
  const rarcSubsets = enumerateRarcSubsets();
  return ISSUE_GROUP_CODES.flatMap(groupCode =>
    getCarcOptionsForGroup(groupCode).flatMap(carc =>
      rarcSubsets.map(rarcs => ({ groupCode, carc: carc.code, rarcs }))
    )
  );
}
