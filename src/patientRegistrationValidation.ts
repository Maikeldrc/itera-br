import { Claim } from "./types";
import { normalizeClaimIdSegment } from "./claimId";

function normalizeProviderValue(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizePatientIdForDuplicateCheck(value: unknown) {
  return normalizeClaimIdSegment(value, "");
}

export function isSamePatientProvider(candidate: Partial<Claim>, existing: Partial<Claim>) {
  const candidatePatientId = normalizePatientIdForDuplicateCheck(candidate.patient_id);
  const existingPatientId = normalizePatientIdForDuplicateCheck(existing.patient_id);
  if (!candidatePatientId || candidatePatientId !== existingPatientId) return false;

  const candidateProviderId = normalizeProviderValue(candidate.provider_id);
  const existingProviderId = normalizeProviderValue(existing.provider_id);
  if (candidateProviderId && existingProviderId && candidateProviderId === existingProviderId) return true;

  const candidateProviderNpi = normalizeProviderValue(candidate.provider_npi);
  const existingProviderNpi = normalizeProviderValue(existing.provider_npi);
  return !!candidateProviderNpi && !!existingProviderNpi && candidateProviderNpi === existingProviderNpi;
}

export function validateUniquePatientProvider(
  claim: Partial<Claim>,
  existingClaims: Partial<Claim>[],
  currentClaimId?: string
) {
  const patientId = normalizePatientIdForDuplicateCheck(claim.patient_id);
  const providerId = normalizeProviderValue(claim.provider_id || claim.provider_npi);
  if (!patientId || !providerId) return [];

  const currentId = normalizeProviderValue(currentClaimId);
  const duplicate = existingClaims
    .filter(existing => !existing.deleted_flag)
    .filter(existing => !currentId || normalizeProviderValue(existing.claim_id) !== currentId)
    .find(existing => isSamePatientProvider(claim, existing));

  if (!duplicate) return [];

  return [
    `Patient ID/MRN ${claim.patient_id} is already registered for this provider on claim ${duplicate.claim_id}.`
  ];
}
