/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { ClaimStatus } from "../types";

interface StatusBadgeProps {
  status: ClaimStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  let styles = "bg-gray-100 text-gray-800 border-gray-200";

  switch (status) {
    case ClaimStatus.Draft:
      styles = "bg-neutral-100 text-neutral-700 border-neutral-200";
      break;
    case ClaimStatus.Submitted:
      styles = "bg-blue-50 text-blue-700 border-blue-200";
      break;
    case ClaimStatus.Pending:
      styles = "bg-amber-50 text-amber-700 border-amber-200";
      break;
    case ClaimStatus.Paid:
      styles = "bg-emerald-50 text-emerald-700 border-emerald-200";
      break;
    case ClaimStatus.PartiallyPaid:
      styles = "bg-cyan-50 text-cyan-700 border-cyan-200";
      break;
    case ClaimStatus.Denied:
      styles = "bg-rose-50 text-rose-700 border-rose-200";
      break;
    case ClaimStatus.Rejected:
      styles = "bg-red-50 text-red-700 border-red-200 font-semibold";
      break;
    case ClaimStatus.Appealed:
      styles = "bg-indigo-50 text-indigo-700 border-indigo-200";
      break;
    case ClaimStatus.Corrected:
      styles = "bg-violet-50 text-violet-700 border-violet-200";
      break;
    case ClaimStatus.ReadyToRebill:
      styles = "bg-orange-50 text-orange-700 border-orange-200";
      break;
    case ClaimStatus.Resubmitted:
      styles = "bg-sky-50 text-sky-700 border-sky-200";
      break;
    case ClaimStatus.BlockedByError:
      styles = "bg-red-100 text-red-800 border-red-300 animate-pulse";
      break;
    case ClaimStatus.WrittenOff:
      styles = "bg-slate-100 text-slate-700 border-slate-300";
      break;
    case ClaimStatus.Uncollectible:
      styles = "bg-zinc-200 text-zinc-700 border-zinc-300";
      break;
    case ClaimStatus.Closed:
      styles = "bg-teal-50 text-teal-700 border-teal-200";
      break;
  }

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider leading-none shrink-0 ${styles}`}>
      {status}
    </span>
  );
}
