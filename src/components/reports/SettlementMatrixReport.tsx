import React from "react";
import { SettlementMatrixRow } from "../../reportsEngine";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const currency = (value: number) => value === 0
  ? "-"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

function rowClass(row: SettlementMatrixRow) {
  if (row.tone === "section") return "bg-[#005a91] text-white font-bold";
  if (row.tone === "total") return "bg-emerald-100 text-emerald-950 font-bold";
  if (row.tone === "subtotal") return "bg-slate-100 text-slate-950 font-semibold";
  if (row.tone === "formula") return "bg-blue-50 text-slate-900";
  if (row.tone === "input") return "bg-amber-50 text-slate-900";
  return "bg-white text-slate-800";
}

export function SettlementMatrixReport({
  year,
  monthKeys,
  rows
}: {
  year: number;
  monthKeys: string[];
  rows: SettlementMatrixRow[];
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">Digital Care Revenue Settlement Matrix</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Monthly view of ITERA billing, physician billing, operational totals and settlement balance for {year}.
        </p>
      </div>
      <div className="overflow-auto">
        <table className="min-w-[1780px] w-full border-collapse text-[10px]">
          <thead>
            <tr className="bg-[#1f6d9f] text-white">
              <th className="sticky left-0 z-20 w-[360px] bg-[#1f6d9f] border border-[#2c7aa9] px-3 py-2 text-left">
                Program / Line Item
              </th>
              <th className="w-16 border border-[#2c7aa9] px-2 py-2 text-center">{year}</th>
              {MONTH_LABELS.map(month => (
                <th key={month} className="w-24 border border-[#2c7aa9] px-2 py-2 text-right">{month}</th>
              ))}
              <th className="w-28 border border-[#2c7aa9] px-2 py-2 text-right">Total</th>
              <th className="w-[420px] border border-[#2c7aa9] px-3 py-2 text-left">Formula / Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isSection = row.tone === "section";
              return (
                <tr key={row.id} className={rowClass(row)}>
                  <td className={`sticky left-0 z-10 border border-slate-200 px-3 py-1.5 ${rowClass(row)}`}>
                    {row.label}
                  </td>
                  <td className="border border-slate-200 px-2 py-1.5 text-center font-mono">
                    {isSection ? "" : year}
                  </td>
                  {monthKeys.map(month => (
                    <td key={month} className="border border-slate-200 px-2 py-1.5 text-right font-mono">
                      {isSection ? "" : currency(row.values[month] || 0)}
                    </td>
                  ))}
                  <td className="border border-slate-200 px-2 py-1.5 text-right font-mono font-bold">
                    {isSection ? "" : currency(row.total)}
                  </td>
                  <td className="border border-slate-200 px-3 py-1.5 text-left text-[9px]">
                    {row.formula}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
