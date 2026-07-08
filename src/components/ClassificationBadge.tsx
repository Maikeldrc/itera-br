/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { ClaimClassification } from "../types";

interface ClassificationBadgeProps {
  classification: ClaimClassification;
}

export function ClassificationBadge({ classification }: ClassificationBadgeProps) {
  let styles = "bg-gray-100 text-gray-800 border-gray-200";

  switch (classification) {
    case ClaimClassification.CleanClaim:
      styles = "bg-emerald-50 text-emerald-700 border-emerald-200";
      break;
    case ClaimClassification.MissingPayment:
      styles = "bg-rose-50 text-rose-700 border-rose-200";
      break;
    case ClaimClassification.MissingERA:
      styles = "bg-orange-50 text-orange-700 border-orange-200";
      break;
    case ClaimClassification.PaymentMismatch:
      styles = "bg-amber-50 text-amber-700 border-amber-200";
      break;
    case ClaimClassification.ProviderCollected:
      styles = "bg-sky-50 text-sky-700 border-sky-200";
      break;
    case ClaimClassification.IteraCollected:
      styles = "bg-blue-50 text-blue-700 border-blue-200";
      break;
    case ClaimClassification.SplitCollection:
      styles = "bg-teal-50 text-teal-700 border-teal-200";
      break;
    case ClaimClassification.Underpaid:
      styles = "bg-yellow-50 text-yellow-700 border-yellow-200";
      break;
    case ClaimClassification.Overpaid:
      styles = "bg-purple-50 text-purple-700 border-purple-200";
      break;
    case ClaimClassification.DeniedNeedsReview:
      styles = "bg-red-50 text-red-700 border-red-200";
      break;
    case ClaimClassification.RejectedNeedsCorrection:
      styles = "bg-red-50 text-red-700 border-red-300";
      break;
    case ClaimClassification.BillingError:
    case ClaimClassification.CodingError:
      styles = "bg-rose-100 text-rose-800 border-rose-300";
      break;
    case ClaimClassification.EligibilityIssue:
    case ClaimClassification.AuthorizationIssue:
      styles = "bg-orange-100 text-orange-800 border-orange-300";
      break;
    case ClaimClassification.DuplicateClaim:
      styles = "bg-stone-100 text-stone-700 border-stone-200";
      break;
    case ClaimClassification.TimelyFilingIssue:
      styles = "bg-neutral-200 text-neutral-800 border-neutral-300";
      break;
    case ClaimClassification.ReadyForResubmission:
      styles = "bg-indigo-50 text-indigo-700 border-indigo-200";
      break;
    case ClaimClassification.WriteOffCandidate:
      styles = "bg-slate-100 text-slate-700 border-slate-300";
      break;
    case ClaimClassification.Closed:
      styles = "bg-zinc-100 text-zinc-600 border-zinc-200";
      break;
  }

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider leading-none shrink-0 ${styles}`}>
      {classification}
    </span>
  );
}
