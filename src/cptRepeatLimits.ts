import { Claim, FeeSchedule } from "./types";
import { formatDosDate } from "./dateFormatting";

export type CptRepeatLine = {
  cpt?: string;
  units?: number;
  dos?: string;
};

const DEFAULT_MAX_PER_DOS = 1;
const MIN_DAYS_BETWEEN_DOS = 30;
const MIN_DAYS_BETWEEN_DOS_CPTS = new Set(["99454", "99445"]);

function normalizedCpt(value: unknown) {
  return String(value ?? "").trim();
}

function yearFromDos(dos?: string) {
  const year = Number(String(dos || "").slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : undefined;
}

function normalizeDos(value: unknown) {
  return normalizedCpt(value).slice(0, 10);
}

function displayDos(value: unknown) {
  const dos = normalizeDos(value);
  return dos ? formatDosDate(dos) : "blank";
}

function isMinimumSpacingCpt(cpt: string) {
  return MIN_DAYS_BETWEEN_DOS_CPTS.has(normalizedCpt(cpt));
}

function parseDosTime(dos?: string) {
  const normalized = normalizeDos(dos);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return undefined;
  const time = new Date(`${normalized}T00:00:00Z`).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function daysBetween(leftDos?: string, rightDos?: string) {
  const left = parseDosTime(leftDos);
  const right = parseDosTime(rightDos);
  if (left === undefined || right === undefined) return undefined;
  return Math.abs(Math.round((right - left) / 86400000));
}

function lineUnitCount(line: CptRepeatLine) {
  const units = Number(line.units);
  return Number.isFinite(units) && units > 0 ? Math.floor(units) : 1;
}

function expandLineOccurrences(line: CptRepeatLine, fallbackDos?: string) {
  const cpt = normalizedCpt(line.cpt);
  const dos = normalizeDos(line.dos || fallbackDos);
  if (!cpt || !dos) return [];
  return Array.from({ length: lineUnitCount(line) }, () => ({ cpt, dos }));
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
    if (!cpt || isMinimumSpacingCpt(cpt)) return;
    const key = `${cpt}|${lineDos(line)}`;
    counts.set(key, (counts.get(key) || 0) + lineUnitCount(line));
  });

  const errors: Record<number, string[]> = {};
  lines.forEach((line, index) => {
    const cpt = normalizedCpt(line.cpt);
    if (!cpt || isMinimumSpacingCpt(cpt)) return;
    const dosForLine = lineDos(line);
    const count = counts.get(`${cpt}|${dosForLine}`) || 0;
    const max = getCptMaxPerDos(cpt, feeSchedules, dosForLine || dos);
    if (count > max) {
      errors[index] = [
        ...(errors[index] || []),
        `CPT ${cpt} can be used ${max} ${max === 1 ? "time" : "times"} per DOS. DOS ${displayDos(dosForLine || dos)} has ${count}.`
      ];
    }
  });

  const spacingOccurrences = lines.flatMap((line, index) =>
    expandLineOccurrences(line, dos)
      .filter(item => isMinimumSpacingCpt(item.cpt))
      .map(item => ({ ...item, index }))
  );
  spacingOccurrences.forEach((left, leftIndex) => {
    spacingOccurrences.slice(leftIndex + 1).forEach(right => {
      if (left.cpt !== right.cpt) return;
      const gap = daysBetween(left.dos, right.dos);
      if (gap === undefined || gap >= MIN_DAYS_BETWEEN_DOS) return;
      [left.index, right.index].forEach(index => {
        errors[index] = [
          ...(errors[index] || []),
          `CPT ${left.cpt} requires at least ${MIN_DAYS_BETWEEN_DOS} days between DOS dates. ${displayDos(left.dos)} and ${displayDos(right.dos)} are ${gap} day(s) apart.`
        ];
      });
    });
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
    if (!cpt || isMinimumSpacingCpt(cpt)) return;
    const dos = normalizeDos(line.dos || claimDos);
    if (!dos) return;
    const key = `${cpt}|${dos}`;
    counts.set(key, (counts.get(key) || 0) + lineUnitCount(line));
  };

  const otherPatientClaims = existingClaims
    .filter(existing => !existing.deleted_flag)
    .filter(existing => !currentClaimId || normalizedCpt(existing.claim_id) !== normalizedCpt(currentClaimId))
    .filter(existing => normalizedCpt(existing.patient_id) === patientId);

  otherPatientClaims
    .flatMap(existing => extractClaimCptRepeatLines(existing))
    .forEach(addLine);

  candidateLines.forEach(addLine);

  const existingSpacingOccurrences = otherPatientClaims
    .flatMap(existing => extractClaimCptRepeatLines(existing))
    .flatMap(line => expandLineOccurrences(line, claimDos))
    .filter(line => isMinimumSpacingCpt(line.cpt));
  const candidateSpacingOccurrences = candidateLines
    .flatMap(line => expandLineOccurrences(line, claimDos))
    .filter(line => isMinimumSpacingCpt(line.cpt));
  const spacingErrors = candidateSpacingOccurrences.flatMap((candidate, candidateIndex) => {
    const comparisons = [
      ...existingSpacingOccurrences,
      ...candidateSpacingOccurrences.filter((_, index) => index !== candidateIndex)
    ];
    const conflict = comparisons.find(other => {
      if (other.cpt !== candidate.cpt) return false;
      const gap = daysBetween(other.dos, candidate.dos);
      return gap !== undefined && gap < MIN_DAYS_BETWEEN_DOS;
    });
    if (!conflict) return [];
    const gap = daysBetween(conflict.dos, candidate.dos) ?? 0;
    return [
      `CPT ${candidate.cpt} requires at least ${MIN_DAYS_BETWEEN_DOS} days between DOS dates for patient ${patientId}. Existing/current DOS ${displayDos(conflict.dos)} and ${displayDos(candidate.dos)} are ${gap} day(s) apart.`
    ];
  });

  const uniqueCandidateKeys = Array.from(new Set(candidateLines.map(line => {
    const cpt = normalizedCpt(line.cpt);
    const dos = normalizeDos(line.dos || claimDos);
    return cpt && dos ? `${cpt}|${dos}` : "";
  }).filter(Boolean)));
  const maxPerDosErrors = uniqueCandidateKeys.flatMap(key => {
    const [cpt, dos] = key.split("|");
    if (isMinimumSpacingCpt(cpt)) return [];
    const totalCount = counts.get(key) || 0;
    const max = getCptMaxPerDos(cpt, feeSchedules, dos);
    if (totalCount <= max) return [];
    return [
      `CPT ${cpt} exceeds Max/DOS for patient ${patientId} on ${displayDos(dos)}. Max allowed: ${max}; existing plus current total: ${totalCount}.`
    ];
  });

  return [...spacingErrors, ...maxPerDosErrors];
}
