export function normalizeClaimIdSegment(value: unknown, fallback: string) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^MRN[-_\s]*/i, "")
    .replace(/[^A-Z0-9]+/g, "");
  return normalized || fallback;
}

export function formatClaimDateSegment(value: unknown) {
  const parsed = typeof value === "string" ? new Date(`${value}T00:00:00`) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("");
}

export function generateClaimId(existingClaimIds: string[], patientId: unknown, serviceDate: unknown) {
  const mrnSegment = normalizeClaimIdSegment(patientId, "SINMRN");
  const dateSegment = formatClaimDateSegment(serviceDate);
  const prefix = `CLM-${mrnSegment}-${dateSegment}-`;
  const usedSequences = existingClaimIds
    .filter(claimId => claimId.startsWith(prefix))
    .map(claimId => Number(claimId.slice(prefix.length)))
    .filter(Number.isFinite);
  let nextSequence = usedSequences.length > 0 ? Math.max(...usedSequences) + 1 : 1;
  let candidate = `${prefix}${String(nextSequence).padStart(3, "0")}`;

  while (existingClaimIds.includes(candidate)) {
    nextSequence++;
    candidate = `${prefix}${String(nextSequence).padStart(3, "0")}`;
  }

  return candidate;
}
