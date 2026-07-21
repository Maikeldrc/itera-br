import { validateClaimCptRepeatLimitsAgainstExisting, validateCptRepeatLimits } from "./cptRepeatLimits";
import { Claim, FeeSchedule } from "./types";

const feeSchedules: FeeSchedule[] = [
  {
    id: "TEST-99454",
    cpt_code: "99454",
    year: 2026,
    semester1_rate: 50,
    semester2_rate: 50,
    max_per_dos: 1,
    description: "RPM - Device supply and daily recordings"
  }
];

export function runCptRepeatLimitTests(): string[] {
  const failures: string[] = [];

  const twentyNineDayErrors = validateCptRepeatLimits([
    { cpt: "99454", dos: "2026-05-01" },
    { cpt: "99454", dos: "2026-05-30" }
  ], feeSchedules, "2026-05-01");
  if (!twentyNineDayErrors.some(error => error.includes("at least 30 days"))) {
    failures.push("99454 should reject DOS dates that are 29 days apart.");
  }

  const thirtyDayErrors = validateCptRepeatLimits([
    { cpt: "99454", dos: "2026-05-01" },
    { cpt: "99454", dos: "2026-05-31" }
  ], feeSchedules, "2026-05-01");
  if (thirtyDayErrors.length > 0) {
    failures.push(`99454 should allow DOS dates that are 30 days apart: ${thirtyDayErrors.join("; ")}`);
  }

  const existingClaim = {
    claim_id: "CLM-EXISTING",
    patient_id: "PAT-001",
    date_of_service_from: "2026-05-01",
    service_lines_json: JSON.stringify([{ cpt: "99454", dos: "2026-05-01", units: 1 }])
  } as Partial<Claim>;
  const candidateClaim = {
    claim_id: "CLM-CANDIDATE",
    patient_id: "PAT-001",
    date_of_service_from: "2026-05-30",
    service_lines_json: JSON.stringify([{ cpt: "99454", dos: "2026-05-30", units: 1 }])
  } as Partial<Claim>;
  const existingErrors = validateClaimCptRepeatLimitsAgainstExisting(candidateClaim, feeSchedules, [existingClaim]);
  if (!existingErrors.some(error => error.includes("at least 30 days"))) {
    failures.push("99454 should reject another patient claim when previous DOS is less than 30 days apart.");
  }

  return failures;
}
