import { Claim, ClaimStatus } from "./types";

export interface ServiceLineLike {
  cpt?: string;
  dos?: string;
  charged?: number;
  allowed?: number;
  adj?: number;
  patResp?: number;
  paid?: number;
  secondaryPaid?: number;
  secondaryPayerId?: string;
  hasSecondaryPayment?: boolean;
  balance?: number;
  codes?: string[];
  status?: string;
  nextAction?: string;
}

export interface ServiceLineValidationResult {
  lineErrors: Record<number, string[]>;
  claimErrors: string[];
  allErrors: string[];
}

const MONEY_TOLERANCE = 0.01;
const PAID_LINE_STATUSES = new Set(["Paid", "Partially Paid"]);
const DENIAL_LINE_STATUSES = new Set(["Denied", "Rejected"]);
const OPEN_LINE_STATUSES = new Set(["Not Billed", "Submitted", "Pending"]);
export const PENDING_ERA_ACTION = "Pending ERA";

function money(value: unknown) {
  return Number(value || 0);
}

function isMoney(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  return Number.isFinite(Number(value));
}

function isIsoDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return !Number.isNaN(new Date(`${text}T00:00:00`).getTime());
}

function closeEnough(left: number, right: number) {
  return Math.abs(left - right) <= MONEY_TOLERANCE;
}

export function parseServiceLinesJson(serviceLinesJson?: string): { lines: ServiceLineLike[]; errors: string[] } {
  if (!serviceLinesJson || serviceLinesJson.trim() === "") return { lines: [], errors: [] };

  try {
    const parsed = JSON.parse(serviceLinesJson);
    if (!Array.isArray(parsed)) {
      return { lines: [], errors: ["Service lines must be saved as an array."] };
    }
    return { lines: parsed as ServiceLineLike[], errors: [] };
  } catch {
    return { lines: [], errors: ["Service lines JSON is invalid."] };
  }
}

export function validateServiceLineDetails(lines: ServiceLineLike[], claim?: Partial<Claim>): ServiceLineValidationResult {
  const lineErrors: Record<number, string[]> = {};
  const claimErrors: string[] = [];
  const addLineError = (index: number, message: string) => {
    lineErrors[index] = [...(lineErrors[index] || []), message];
  };

  lines.forEach((line, index) => {
    const charged = money(line.charged);
    const allowed = money(line.allowed);
    const primaryPaid = money(line.paid);
    const secondaryPaid = money(line.secondaryPaid);
    const totalPaid = primaryPaid + secondaryPaid;
    const expectedAdj = Number((charged - allowed).toFixed(2));
    const expectedBalance = Number(Math.max(0, charged - totalPaid - money(line.adj)).toFixed(2));
    const status = line.status || "Pending";
    const codes = Array.isArray(line.codes) ? line.codes.filter(Boolean) : [];
    const isPendingEra = line.nextAction === PENDING_ERA_ACTION;

    if (!line.cpt || line.cpt.trim() === "") {
      addLineError(index, "CPT code is required.");
    }
    if (!isIsoDate(line.dos)) {
      addLineError(index, "DOS must be a valid YYYY-MM-DD date.");
    }

    ([
      ["charged", line.charged],
      ["allowed", line.allowed],
      ["paid", line.paid],
      ["secondary paid", line.secondaryPaid],
      ["patient responsibility", line.patResp],
      ["adjustment", line.adj],
      ["balance", line.balance]
    ] as const).forEach(([field, value]) => {
      if (!isMoney(value)) {
        addLineError(index, `${field} must be numeric.`);
      } else if (money(value) < 0 && field !== "balance") {
        addLineError(index, `${field} cannot be negative.`);
      }
    });

    if (charged <= 0) {
      addLineError(index, "charged amount must be greater than zero.");
    }

    if (!closeEnough(money(line.adj), expectedAdj)) {
      addLineError(index, "adjustment must equal charged minus allowed.");
    }

    if (!closeEnough(money(line.balance), expectedBalance)) {
      addLineError(index, "balance must equal charged amount minus total paid minus CAS adjustments.");
    }

    if (line.hasSecondaryPayment || secondaryPaid > 0) {
      if (secondaryPaid <= 0) {
        addLineError(index, "secondary payer payment must be greater than zero when secondary payment is enabled.");
      }
      if (!line.secondaryPayerId) {
        addLineError(index, "select the secondary payer before saving a secondary payment.");
      }
    }

    if (totalPaid > charged + MONEY_TOLERANCE) {
      addLineError(index, "total paid (primary + secondary) cannot exceed the charged amount.");
    }

    if (charged - totalPaid - money(line.adj) < -MONEY_TOLERANCE) {
      addLineError(index, "balance cannot be negative.");
    }

    if (status === "Paid") {
      if (totalPaid <= 0) {
        addLineError(index, "status Paid requires a primary or secondary payment greater than zero.");
      }
    }

    if (status === "Partially Paid") {
      if (totalPaid <= 0) {
        addLineError(index, "status Partially Paid requires a primary or secondary payment greater than zero.");
      }
    }

    if (DENIAL_LINE_STATUSES.has(status)) {
      if (totalPaid > MONEY_TOLERANCE) {
        addLineError(index, "denied/rejected lines cannot include payments. Use Partially Paid if the payer paid part of the CPT.");
      }
      if (codes.length === 0 && !isPendingEra) {
        addLineError(index, "denied/rejected lines require at least one CARC/RARC/MA code unless Next Action is Pending ERA.");
      }
    }

    if (OPEN_LINE_STATUSES.has(status) && totalPaid > MONEY_TOLERANCE) {
      addLineError(index, `${status} lines cannot include payments. Change the status to Paid or Partially Paid.`);
    }
  });

  if (claim && lines.length > 0) {
    const totalLinePaid = Number(lines.reduce((sum, line) => sum + money(line.paid) + money(line.secondaryPaid), 0).toFixed(2));
    const totalLineCharged = Number(lines.reduce((sum, line) => sum + money(line.charged), 0).toFixed(2));
    const totalLineAllowed = Number(lines.reduce((sum, line) => sum + money(line.allowed), 0).toFixed(2));
    const claimPaid = money(claim.paid_amount);
    const claimBilled = money(claim.billed_charge);
    const claimAllowed = money(claim.allowed_amount);

    if (!closeEnough(claimPaid, totalLinePaid)) {
      claimErrors.push(`Claim paid amount must match service line payments (${totalLinePaid.toFixed(2)}).`);
    }
    if (!closeEnough(claimBilled, totalLineCharged)) {
      claimErrors.push(`Claim billed charge must match service line charged total (${totalLineCharged.toFixed(2)}).`);
    }
    if (!closeEnough(claimAllowed, totalLineAllowed)) {
      claimErrors.push(`Claim allowed amount must match service line allowed total (${totalLineAllowed.toFixed(2)}).`);
    }

    const statuses = lines.map(line => line.status || "Pending");
    const hasPaidLine = statuses.some(status => PAID_LINE_STATUSES.has(status));
    const hasDeniedLine = statuses.some(status => DENIAL_LINE_STATUSES.has(status));
    const allPaid = statuses.every(status => status === "Paid");
    const allDenied = statuses.every(status => DENIAL_LINE_STATUSES.has(status));
    const hasMixedOutcome = new Set(statuses).size > 1 || statuses.some(status => status === "Partially Paid");

    if (claim.claim_status === ClaimStatus.Paid && !allPaid) {
      claimErrors.push("Claim status Paid requires every CPT service line to be Paid.");
    }
    if ((claim.claim_status === ClaimStatus.Denied || claim.claim_status === ClaimStatus.Rejected) && !allDenied) {
      claimErrors.push("Claim status Denied/Rejected requires every CPT service line to be denied or rejected.");
    }
    if (claim.claim_status === ClaimStatus.PartiallyPaid && !hasMixedOutcome && !(hasPaidLine && hasDeniedLine)) {
      claimErrors.push("Claim status Partially Paid requires mixed CPT outcomes or at least one partially paid line.");
    }
    if (hasPaidLine && hasDeniedLine && claim.claim_status !== ClaimStatus.PartiallyPaid) {
      claimErrors.push("Claims with both paid and denied CPT lines must use claim status Partially Paid.");
    }
  }

  const allErrors = [
    ...Object.entries(lineErrors).flatMap(([index, errors]) => {
      const line = lines[Number(index)];
      const label = `CPT ${line?.cpt || `line ${Number(index) + 1}`}`;
      return errors.map(error => `${label}: ${error}`);
    }),
    ...claimErrors
  ];

  return { lineErrors, claimErrors, allErrors };
}

export function validateServiceLines(lines: ServiceLineLike[], claim?: Partial<Claim>): string[] {
  return validateServiceLineDetails(lines, claim).allErrors;
}

export function validateServiceLinesJson(serviceLinesJson?: string, claim?: Partial<Claim>): string[] {
  const parsed = parseServiceLinesJson(serviceLinesJson);
  if (parsed.errors.length > 0) return parsed.errors;
  return validateServiceLines(parsed.lines, claim);
}
