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

export const ISSUE_GROUP_CODES: IssueGroupCode[] = ["CO", "PR", "OA", "PI"];

export const CARC_CATALOG: IssueCarcCode[] = [
  { code: "CO-16", description: "Claim lacks information or has submission errors." },
  { code: "CO-18", description: "Duplicate claim or service." },
  { code: "CO-22", description: "Coordination of Benefits (COB) issue." },
  { code: "CO-27", description: "Expenses incurred after coverage terminated." },
  { code: "CO-50", description: "Non-covered service; not medically necessary." },
  { code: "CO-97", description: "Procedure/revenue code bundled/inclusive." },
  { code: "CO-109", description: "Claim/service not covered by this payer." },
  { code: "CO-119", description: "Benefit maximum has been reached." },
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
  { code: "N30", description: "Patient ineligible for this service." },
  { code: "N29", description: "Missing documentation/notes/orders." },
  { code: "N130", description: "Consult plan benefit documents for details." },
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
