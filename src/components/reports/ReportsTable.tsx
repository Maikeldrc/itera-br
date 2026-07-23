import React, { useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { ReportRow, ReportView } from "../../reportsEngine";
import { BillingOwnerBadge, PaymentReceiverBadge } from "./ReportComponents";
import { formatDosDate } from "../../dateFormatting";

const currency = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const percent = (value: number | null) => value === null ? "N/A" : `${value.toFixed(1)}%`;

export function ReportsTable({ rows, view }: { rows: ReportRow[]; view: ReportView }) {
  const [sort, setSort] = useState<keyof ReportRow>("date");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const sorted = [...rows].sort((a, b) => {
    const left = a[sort] ?? "";
    const right = b[sort] ?? "";
    const result = typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right));
    return direction === "asc" ? result : -result;
  });
  const sortBy = (key: keyof ReportRow) => {
    if (sort === key) setDirection(value => value === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setDirection("desc");
    }
  };
  const header = (label: string, key: keyof ReportRow) => (
    <button onClick={() => sortBy(key)} className="flex items-center gap-1 whitespace-nowrap text-left">
      {label}<ArrowUpDown className="h-3 w-3 opacity-40" />
    </button>
  );

  return (
    <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-[2450px] w-full text-left text-[10px]">
        <thead className="sticky top-0 z-10 bg-slate-50 text-[9px] font-bold uppercase tracking-wider text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="p-3">{header("DOS", "date")}</th>
            <th className="p-3">{header("Payer", "payer")}</th>
            <th className="p-3">{header("Practice", "practice")}</th>
            <th className="p-3">{header("Service", "serviceType")}</th>
            <th className="p-3">{header("CPT", "cptCode")}</th>
            <th className="p-3">{header("Units", "unitsBilled")}</th>
            <th className="p-3">Prov. Units</th>
            <th className="p-3">ITERA Units</th>
            <th className="p-3">Unit Price</th>
            <th className="p-3">{header("Billed", "totalBilledCharges")}</th>
            <th className="p-3">Prov. Billed</th>
            <th className="p-3">ITERA Billed</th>
            <th className="p-3">ITERA Fee</th>
            <th className="p-3">{header("Paid", "totalPaid")}</th>
            <th className="p-3">{header("Difference", "difference")}</th>
            <th className="p-3">{header("Collection Rate", "collectionRate")}</th>
            <th className="p-3">Prov. Denied</th>
            <th className="p-3">Prov. Denied $</th>
            <th className="p-3">ITERA Denied</th>
            <th className="p-3">ITERA Denied $</th>
            <th className="p-3">{header("Denial Rate", "denialRate")}</th>
            <th className="p-3">{header("Pending", "pendingClaims")}</th>
            <th className="p-3">Pending $</th>
            <th className="p-3">Prov. Pending</th>
            <th className="p-3">Prov. Pending $</th>
            <th className="p-3">ITERA Pending</th>
            <th className="p-3">ITERA Pending $</th>
            <th className="p-3">Billed By</th>
            <th className="p-3">Receiver</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">
          {sorted.map(row => (
            <tr key={row.key} className={`hover:bg-blue-50/30 ${view === "pending" && row.agingBucket === "91+ days" ? "bg-rose-50/30" : ""}`}>
              <td className="p-3 font-mono">{formatDosDate(row.date)}</td>
              <td className="p-3 font-semibold text-slate-900">{row.payer}</td>
              <td className="p-3 font-semibold">{row.practice}</td>
              <td className="p-3">{row.serviceType}</td>
              <td className="p-3 font-mono font-bold text-primary-blue">{row.cptCode}</td>
              <td className="p-3 text-right font-mono">{row.unitsBilled}</td>
              <td className="p-3 text-right font-mono">{row.providerUnitsBilled}</td>
              <td className="p-3 text-right font-mono">{row.iteraUnitsBilled}</td>
              <td className="p-3 text-right font-mono">{currency(row.unitPrice)}</td>
              <td className="p-3 text-right font-mono font-bold">{currency(row.totalBilledCharges)}</td>
              <td className="p-3 text-right font-mono">{currency(row.providerBilledCharges)}</td>
              <td className="p-3 text-right font-mono">{currency(row.iteraBilledCharges)}</td>
              <td className="p-3 text-right font-mono">{currency(row.iteraBilledFee)}</td>
              <td className="p-3 text-right font-mono font-bold text-emerald-700">{currency(row.totalPaid)}</td>
              <td className={`p-3 text-right font-mono font-bold ${row.difference > 0 ? "text-rose-600" : "text-emerald-700"}`}>{currency(row.difference)}</td>
              <td className="p-3 text-right font-mono">{percent(row.collectionRate)}</td>
              <td className="p-3 text-right font-mono">{row.providerDeniedClaims}</td>
              <td className="p-3 text-right font-mono text-rose-600">{currency(row.providerDeniedAmount)}</td>
              <td className="p-3 text-right font-mono">{row.iteraDeniedClaims}</td>
              <td className="p-3 text-right font-mono text-rose-600">{currency(row.iteraDeniedAmount)}</td>
              <td className={`p-3 text-right font-mono font-bold ${row.denialRate >= 10 ? "text-rose-600" : ""}`}>{percent(row.denialRate)}</td>
              <td className="p-3 text-right font-mono">{row.pendingClaims}</td>
              <td className="p-3 text-right font-mono text-amber-700">{currency(row.pendingAmount)}</td>
              <td className="p-3 text-right font-mono">{row.providerPendingClaims}</td>
              <td className="p-3 text-right font-mono">{currency(row.providerPendingAmount)}</td>
              <td className="p-3 text-right font-mono">{row.iteraPendingClaims}</td>
              <td className="p-3 text-right font-mono">{currency(row.iteraPendingAmount)}</td>
              <td className="p-3"><BillingOwnerBadge value={row.billedBy} /></td>
              <td className="p-3"><PaymentReceiverBadge value={row.paymentReceivedBy} /></td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={29} className="p-12 text-center text-sm text-slate-400">No report data matches the selected filters.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
