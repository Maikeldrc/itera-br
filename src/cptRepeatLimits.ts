import { Claim, FeeSchedule } from "./types";

export type CptRepeatLine = {
  cpt?: string;
  units?: number;
  dos?: string;
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
  const lineDos = (line: CptRepeatLine) => normalizeDos(line.dos || dos);
  lines.forEach(line => {
    const cpt = normalizedCpt(line.cpt);
    if (!cpt) return;
    const key = `${cpt}|${lineDos(line)}`;
    counts.set(key, (counts.get(key) || 0) + lineUnitCount(line));
  });

  const errors: Record<number, string[]> = {};
  lines.forEach((line, index) => {
    const cpt = normalizedCpt(line.cpt);
    if (!cpt) return;
    const dosForLine = lineDos(line);
    const count = counts.get(`${cpt}|${dosForLine}`) || 0;
    const max = getCptMaxPerDos(cpt, feeSchedules, dosForLine || dos);
    if (count > max) {
      errors[index] = [
        ...(errors[index] || []),
        `CPT ${cpt} can be used ${max} ${max === 1 ? "time" : "times"} per DOS. DOS ${dosForLine || dos || "blank"} has ${count}.`
      ];
    }
  });

  return errors;
}

function lineUnitCount(line: CptRepeatLine) {
  const units = Number(line.units);
  return Number.isFinite(units) && units > 0 ? Math.floor(units) : 1;
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
        return parsed
          .map(line => ({
            cpt: normalizedCpt(line?.cpt),
            dos: normalizeDos(line?.dos || claim.date_of_service_from),
            units: lineUnitCount({ units: line?.units })
          }))
          .filter(line => line.cpt);
      }
    } catch {
      return [];
    }
  }

  return String(claim.cpt_hcpcs || "")
    .split(/[\s,]+/)
    .map(cpt => ({ cpt: normalizedCpt(cpt), dos: normalizeDos(claim.date_of_service_from) }))
    .filter(line => line.cpt);
}

export function validateClaimCptRepeatLimits(claim: Partial<Claim>, feeSchedules: FeeSchedule[]) {
  return validateCptRepeatLimits(
    extractClaimCptRepeatLines(claim),
    feeSchedules,
    claim.date_of_service_from
  );
}

function normalizeDos(value: unknown) {
  return normalizedCpt(value).slice(0, 10);
}

export function validateClaimCptRepeatLimitsAgainstExisting(
  claim: Partial<Claim>,
  feeSchedules: FeeSchedule[],
  existingClaims: Partial<Claim>[],
  currentClaimId?: string
) {
  const patientId = normalizedCpt(claim.patient_id);
  const claimDos = normalizeDos(claim.date_of_service_from);
  if (!patientId || !claimDos) return [];

  const candidateLines = extractClaimCptRepeatLines(claim);
  if (candidateLines.length === 0) return [];

  const counts = new Map<string, number>();
  const addLine = (line: CptRepeatLine) => {
    const cpt = normalizedCpt(line.cpt);
    if (!cpt) return;
    const dos = normalizeDos(line.dos || claimDos);
    if (!dos) return;
    const key = `${cpt}|${dos}`;
    counts.set(key, (counts.get(key) || 0) + lineUnitCount(line));
  };

  existingClaims
    .filter(existing => !existing.deleted_flag)
    .filter(existing => !currentClaimId || normalizedCpt(existing.claim_id) !== normalizedCpt(currentClaimId))
    .filter(existing => normalizedCpt(existing.patient_id) === patientId)
    .flatMap(existing => extractClaimCptRepeatLines(existing))
    .forEach(addLine);

  candidateLines.forEach(addLine);

  const uniqueCandidateKeys = Array.from(new Set(candidateLines.map(line => {
    const cpt = normalizedCpt(line.cpt);
    const dos = normalizeDos(line.dos || claimDos);
    return cpt && dos ? `${cpt}|${dos}` : "";
  }).filter(Boolean)));
  return uniqueCandidateKeys.flatMap(key => {
    const [cpt, dos] = key.split("|");
    const totalCount = counts.get(key) || 0;
    const max = getCptMaxPerDos(cpt, feeSchedules, dos);
    if (totalCount <= max) return [];
    return [
      `CPT ${cpt} exceeds Max/DOS for patient ${patientId} on ${dos}. Max allowed: ${max}; existing plus current total: ${totalCount}.`
    ];
  });
}
