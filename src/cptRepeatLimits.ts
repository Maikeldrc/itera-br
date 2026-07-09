import { Claim, FeeSchedule } from "./types";

export type CptRepeatLine = {
  cpt?: string;
};

const DEFAULT_MAX_PER_DOS = 1;

function normalizedCpt(value: unknown) {
  return String(value ?? "").trim();
}

function yearFromDos(dos?: string) {
  const year = Number(String(dos || "").slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : undefined;
}

export function getCptMaxPerDos(cpt: string, feeSchedules: FeeSchedule[], dos?: string) {
  const targetCpt = normalizedCpt(cpt);
  if (!targetCpt) return DEFAULT_MAX_PER_DOS;

  const dosYear = yearFromDos(dos);
  const matches = feeSchedules.filter(fs => normalizedCpt(fs.cpt_code) === targetCpt);
  const preferred = matches.find(fs => dosYear !== undefined && Number(fs.year) === dosYear) || matches[0];
  const rawLimit = Number(preferred?.max_per_dos);
  return Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : DEFAULT_MAX_PER_DOS;
}

export function validateCptRepeatLimitsByLine(lines: CptRepeatLine[], feeSchedules: FeeSchedule[], dos?: string) {
  const counts = new Map<string, number>();
  lines.forEach(line => {
    const cpt = normalizedCpt(line.cpt);
    if (!cpt) return;
    counts.set(cpt, (counts.get(cpt) || 0) + 1);
  });

  const errors: Record<number, string[]> = {};
  lines.forEach((line, index) => {
    const cpt = normalizedCpt(line.cpt);
    if (!cpt) return;
    const count = counts.get(cpt) || 0;
    const max = getCptMaxPerDos(cpt, feeSchedules, dos);
    if (count > max) {
      errors[index] = [
        ...(errors[index] || []),
        `CPT ${cpt} can be used ${max} ${max === 1 ? "time" : "times"} per DOS. Current DOS has ${count}.`
      ];
    }
  });

  return errors;
}

export function validateCptRepeatLimits(lines: CptRepeatLine[], feeSchedules: FeeSchedule[], dos?: string) {
  const lineErrors = validateCptRepeatLimitsByLine(lines, feeSchedules, dos);
  return Object.values(lineErrors).flat();
}

export function extractClaimCptRepeatLines(claim: Partial<Claim>): CptRepeatLine[] {
  if (claim.service_lines_json) {
    try {
      const parsed = JSON.parse(claim.service_lines_json);
      if (Array.isArray(parsed)) {
        return parsed.map(line => ({ cpt: normalizedCpt(line?.cpt) })).filter(line => line.cpt);
      }
    } catch {
      return [];
    }
  }

  return String(claim.cpt_hcpcs || "")
    .split(/[\s,]+/)
    .map(cpt => ({ cpt: normalizedCpt(cpt) }))
    .filter(line => line.cpt);
}

export function validateClaimCptRepeatLimits(claim: Partial<Claim>, feeSchedules: FeeSchedule[]) {
  return validateCptRepeatLimits(
    extractClaimCptRepeatLines(claim),
    feeSchedules,
    claim.date_of_service_from
  );
}
