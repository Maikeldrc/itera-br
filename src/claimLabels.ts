export const CLAIM_LABEL_OPTIONS = [
  "Not Reconciled",
  "Pending Reconciliation",
  "Reconciled",
  "Variance Detected",
  "Follow-up Required",
  "Correction Required",
  "Resubmission Pending",
  "Appeal in Progress",
  "Pending Payer Response",
  "Closed - Recovered",
  "Closed - Loss",
  "Excluded"
] as const;

export function normalizeClaimLabel(value: unknown) {
  return String(value ?? "").trim();
}

export function getClaimLabelTone(label: string) {
  const normalized = normalizeClaimLabel(label).toLowerCase();
  if (!normalized) return "slate";
  if (normalized.includes("reconciled") && !normalized.includes("not") && !normalized.includes("pending")) return "emerald";
  if (normalized.includes("variance") || normalized.includes("correction") || normalized.includes("appeal")) return "amber";
  if (normalized.includes("loss") || normalized.includes("excluded")) return "rose";
  if (normalized.includes("follow") || normalized.includes("pending") || normalized.includes("response") || normalized.includes("resubmission")) return "blue";
  return "slate";
}

export function getClaimLabelClasses(label: string) {
  switch (getClaimLabelTone(label)) {
    case "emerald":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "rose":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "blue":
      return "border-blue-200 bg-blue-50 text-blue-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}
