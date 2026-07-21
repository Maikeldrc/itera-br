import React, { useEffect, useState } from "react";
import { BarChart3, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { Claim, EligibilityCoverage, FeeSchedule, Payer, Provider, ReportFeeSchedule } from "../../types";
import {
  aggregateReports,
  buildSettlementMatrix,
  calculateReportKpis,
  DEFAULT_REPORT_FILTERS,
  filterRowsForView,
  ReportFiltersState,
  ReportRow,
  ReportView
} from "../../reportsEngine";
import {
  ExportButton,
  ReportFilters,
  ReportKpiCard,
  ReportTabs
} from "./ReportComponents";
import { ReportsTable } from "./ReportsTable";
import { SettlementMatrixReport } from "./SettlementMatrixReport";
import { useFeedback } from "../FeedbackProvider";
import { useLanguage } from "../LanguageProvider";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const percentage = (value: number | null) => value === null ? "N/A" : `${value.toFixed(1)}%`;

function csvValue(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function excelValue(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textValue(value: unknown) {
  return String(value ?? "").trim();
}

const EXPORT_COLUMNS: Array<[string, keyof ReportRow]> = [
  ["Date", "date"], ["Payer", "payer"], ["Practice", "practice"], ["Provider", "provider"], ["Service Type", "serviceType"],
  ["CPT Code", "cptCode"], ["CPT Description", "cptDescription"], ["Unique Billable Patients", "uniqueBillablePatients"],
  ["Coverage %", "coveragePercent"], ["Units Billed", "unitsBilled"], ["Provider Units", "providerUnitsBilled"],
  ["ITERA Units", "iteraUnitsBilled"], ["Claims", "claims"], ["Unit Price", "unitPrice"],
  ["Total Billed", "totalBilledCharges"], ["Provider Billed", "providerBilledCharges"], ["ITERA Billed", "iteraBilledCharges"],
  ["ITERA Fee", "iteraBilledFee"], ["Total Paid", "totalPaid"], ["Difference", "difference"],
  ["Collection Rate", "collectionRate"], ["Provider Denied Claims", "providerDeniedClaims"],
  ["Provider Denied", "providerDeniedAmount"], ["ITERA Denied Claims", "iteraDeniedClaims"],
  ["ITERA Denied", "iteraDeniedAmount"], ["Denial Rate", "denialRate"], ["Pending Claims", "pendingClaims"],
  ["Pending Amount", "pendingAmount"], ["Provider Pending Claims", "providerPendingClaims"],
  ["Provider Pending", "providerPendingAmount"], ["ITERA Pending Claims", "iteraPendingClaims"],
  ["ITERA Pending", "iteraPendingAmount"], ["Submission Date", "submissionDate"], ["Payment Date", "paymentDate"],
  ["Aging", "agingBucket"], ["Billed By", "billedBy"], ["Payment Received By", "paymentReceivedBy"]
];

function exportRows(rows: ReportRow[], view: ReportView) {
  const csv = [
    EXPORT_COLUMNS.map(([label]) => csvValue(label)).join(","),
    ...rows.map(row => EXPORT_COLUMNS.map(([, key]) => csvValue(row[key])).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `itera-${view}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportExcelRows(rows: ReportRow[], view: ReportView) {
  const worksheet = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Reports</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      </head>
      <body>
        <table>
          <thead><tr>${EXPORT_COLUMNS.map(([label]) => `<th>${excelValue(label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map(row => `<tr>${EXPORT_COLUMNS.map(([, key]) => `<td>${excelValue(row[key])}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </body>
    </html>`;
  const blob = new Blob([worksheet], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `itera-${view}-${new Date().toISOString().slice(0, 10)}.xls`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportSettlementMatrixExcel(matrix: ReturnType<typeof buildSettlementMatrix>) {
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const moneyCell = (value: number) => value === 0 ? "" : value.toFixed(2);
  const worksheet = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Settlement Matrix</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 10px; }
          th { background: #1f6d9f; color: white; font-weight: bold; border: 1px solid #2c7aa9; padding: 4px; }
          td { border: 1px solid #d9e2ec; padding: 3px; }
          .section { background: #005a91; color: white; font-weight: bold; }
          .subtotal { background: #eef2f7; font-weight: bold; }
          .total { background: #d9ead3; font-weight: bold; }
          .input { background: #fff2cc; }
          .num { text-align: right; mso-number-format: "$"#,##0.00; }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr><th>Program / Line Item</th><th>${matrix.year}</th>${monthLabels.map(label => `<th>${label}</th>`).join("")}<th>Total</th><th>Formula / Notes</th></tr>
          </thead>
          <tbody>
            ${matrix.rows.map(row => {
              const cls = row.tone === "section" ? "section" : row.tone === "total" ? "total" : row.tone === "subtotal" ? "subtotal" : row.tone === "input" ? "input" : "";
              return `<tr class="${cls}">
                <td>${excelValue(row.label)}</td>
                <td>${row.tone === "section" ? "" : matrix.year}</td>
                ${matrix.monthKeys.map(month => `<td class="num">${moneyCell(row.values[month] || 0)}</td>`).join("")}
                <td class="num">${row.tone === "section" ? "" : moneyCell(row.total)}</td>
                <td>${excelValue(row.formula)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </body>
    </html>`;
  const blob = new Blob([worksheet], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `itera-settlement-matrix-${matrix.year}-${new Date().toISOString().slice(0, 10)}.xls`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function serviceTypesForClaim(claim: Claim) {
  const values = new Set(textValue(claim.service_type).split(",").map(item => item.trim()).filter(Boolean));
  try {
    const lines = claim.service_lines_json ? JSON.parse(claim.service_lines_json) : [];
    if (Array.isArray(lines)) {
      lines.forEach(line => {
        if (line?.serviceType) values.add(String(line.serviceType).trim());
      });
    }
  } catch {
    // Ignore malformed service line JSON for filter option generation.
  }
  return Array.from(values);
}

function InsuranceAnalysisSummary({ rows }: { rows: ReportRow[] }) {
  const sorted = [...rows].sort((a, b) => b.totalBilledCharges - a.totalBilledCharges);
  const highestBalance = [...rows].sort((a, b) => b.difference - a.difference)[0];
  const bestCollection = [...rows]
    .filter(row => row.totalBilledCharges > 0)
    .sort((a, b) => b.collectionRate - a.collectionRate)[0];
  const highestDenial = [...rows]
    .filter(row => row.claims > 0)
    .sort((a, b) => b.denialRate - a.denialRate)[0];
  const currency = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  const rate = (value: number) => `${value.toFixed(1)}%`;
  const insightCards = [
    {
      label: "Highest Open Balance",
      payer: highestBalance?.payer || "-",
      value: highestBalance ? currency(highestBalance.difference) : "$0",
      icon: TrendingDown,
      tone: "border-rose-200 bg-rose-50 text-rose-700"
    },
    {
      label: "Best Collection Rate",
      payer: bestCollection?.payer || "-",
      value: bestCollection ? rate(bestCollection.collectionRate) : "N/A",
      icon: TrendingUp,
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700"
    },
    {
      label: "Highest Denial Rate",
      payer: highestDenial?.payer || "-",
      value: highestDenial ? rate(highestDenial.denialRate) : "N/A",
      icon: ShieldCheck,
      tone: "border-amber-200 bg-amber-50 text-amber-700"
    }
  ];

  return (
    <section className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {insightCards.map(item => {
          const Icon = item.icon;
          return (
            <div key={item.label} className={`rounded-xl border p-4 shadow-sm ${item.tone}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">{item.label}</p>
                  <p className="mt-1 truncate text-sm font-bold text-slate-900">{item.payer}</p>
                </div>
                <Icon className="h-4 w-4 shrink-0" />
              </div>
              <p className="mt-3 font-display text-2xl font-bold">{item.value}</p>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Insurance Performance Ranking</h3>
            <p className="text-[10px] text-slate-500">Aggregated by payer across claims, CPT lines, paid amount, denials and pending balance.</p>
          </div>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[9px] font-bold text-primary-blue">{rows.length} payers</span>
        </div>
        <div className="overflow-auto">
          <table className="min-w-[980px] w-full text-left text-[10px]">
            <thead className="bg-slate-50 text-[9px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Insurance / Payer</th>
                <th className="px-4 py-3 text-right">Claims</th>
                <th className="px-4 py-3 text-right">CPT Units</th>
                <th className="px-4 py-3 text-right">Billed</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Open Balance</th>
                <th className="px-4 py-3 text-right">Collection</th>
                <th className="px-4 py-3 text-right">Denial</th>
                <th className="px-4 py-3 text-right">Pending</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map(row => (
                <tr key={row.key} className="hover:bg-blue-50/30">
                  <td className="px-4 py-3 font-bold text-slate-900">{row.payer}</td>
                  <td className="px-4 py-3 text-right font-mono">{row.claims}</td>
                  <td className="px-4 py-3 text-right font-mono">{row.unitsBilled}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold">{currency(row.totalBilledCharges)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700">{currency(row.totalPaid)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${row.difference > 0 ? "text-rose-600" : "text-emerald-700"}`}>{currency(row.difference)}</td>
                  <td className="px-4 py-3 text-right font-mono">{rate(row.collectionRate)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${row.denialRate >= 10 ? "text-rose-600" : "text-slate-700"}`}>{rate(row.denialRate)}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-700">{currency(row.pendingAmount)}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">No insurance analysis data matches the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function ReportsPage({
  claims,
  providers,
  payers,
  feeSchedules,
  eligibilityCoverage,
  reportFeeSchedules
}: {
  claims: Claim[];
  providers: Provider[];
  payers: Payer[];
  feeSchedules: FeeSchedule[];
  eligibilityCoverage: EligibilityCoverage[];
  reportFeeSchedules: ReportFeeSchedule[];
}) {
  const { notify } = useFeedback();
  const { language } = useLanguage();
  const isEnglish = language !== "es";
  const [view, setView] = useState<ReportView>(() => {
    const path = window.location.pathname.split("/").filter(Boolean)[1];
    return (["billing-summary", "insurance-analysis", "provider-vs-itera", "collections", "denials", "pending", "coverage", "settlement-matrix"].includes(path) ? path : "billing-summary") as ReportView;
  });
  const [filters, setFilters] = useState<ReportFiltersState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("itera-report-view") || "{}");
      if ("search" in saved) {
        delete saved.search;
        localStorage.setItem("itera-report-view", JSON.stringify(saved));
      }
      return { ...DEFAULT_REPORT_FILTERS, ...saved, search: "" };
    } catch {
      return DEFAULT_REPORT_FILTERS;
    }
  });

  useEffect(() => {
    window.history.replaceState({}, "", `/reports/${view}`);
  }, [view]);

  const effectiveFilters = view === "insurance-analysis" ? { ...filters, groupBy: ["payer"] as ReportFiltersState["groupBy"] } : filters;
  const allRows = aggregateReports(claims, effectiveFilters, eligibilityCoverage, feeSchedules, reportFeeSchedules);
  const rows = filterRowsForView(allRows, view);
  const kpis = calculateReportKpis(rows);
  const settlementMatrix = buildSettlementMatrix(claims, filters);
  const practices = Array.from(new Map(claims.map(claim => [claim.practice_id, { id: claim.practice_id, name: claim.practice_name }])).values());
  const serviceTypes = Array.from(new Set(claims.flatMap(serviceTypesForClaim))).sort();
  const cptCodes = Array.from(new Set(claims.flatMap(claim => textValue(claim.cpt_hcpcs).split(/[\s,]+/).filter(Boolean)))).sort();

  const saveView = () => {
    const { search, ...safeFilters } = filters;
    localStorage.setItem("itera-report-view", JSON.stringify(safeFilters));
    notify(isEnglish ? "Report view saved locally." : "Vista de reporte guardada localmente.", "success");
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-blue-50 p-2 text-primary-blue"><BarChart3 className="h-5 w-5" /></div>
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900">Billing & Reconciliation Reports</h2>
              <p className="text-[11px] text-slate-500">Operational analytics for ITERA and Provider billing, collections, denials, pending claims and coverage.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {view === "settlement-matrix" ? (
              <ExportButton onClick={() => exportSettlementMatrixExcel(settlementMatrix)} label="Export Excel" />
            ) : (
              <>
                <ExportButton onClick={() => exportRows(rows, view)} />
                <ExportButton onClick={() => exportExcelRows(rows, view)} label="Export Excel" />
              </>
            )}
          </div>
        </div>
        <ReportTabs value={view} onChange={setView} />
      </div>

      <ReportFilters
        filters={filters}
        providers={providers}
        payers={payers}
        practices={practices}
        serviceTypes={serviceTypes}
        cptCodes={cptCodes}
        onChange={setFilters}
        onReset={() => setFilters(DEFAULT_REPORT_FILTERS)}
        onSave={saveView}
      />

      {view !== "settlement-matrix" && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <ReportKpiCard title="Total Billed" value={money(kpis.totalBilledCharges)} />
        <ReportKpiCard title="Total Paid" value={money(kpis.totalPaid)} tone="green" />
        <ReportKpiCard title="Difference" value={money(kpis.difference)} tone={kpis.difference > 0 ? "red" : "green"} />
        <ReportKpiCard title="Collection Rate" value={percentage(kpis.collectionRate)} tone="blue" />
        <ReportKpiCard title="Total Denied" value={money(kpis.totalDenied)} indicator={percentage(kpis.denialRate)} tone="red" />
        <ReportKpiCard title="Total Pending" value={money(kpis.totalPending)} tone="orange" />
        <ReportKpiCard title="Billable Patients" value={String(kpis.uniqueBillablePatients)} indicator={percentage(kpis.coveragePercent)} tone="slate" />
        <ReportKpiCard title="ITERA Billed" value={money(kpis.iteraBilledCharges)} />
        <ReportKpiCard title="Provider Billed" value={money(kpis.providerBilledCharges)} tone="orange" />
        <ReportKpiCard title="ITERA Pending" value={money(kpis.iteraPending)} tone="orange" />
        <ReportKpiCard title="Provider Pending" value={money(kpis.providerPending)} tone="orange" />
      </div>}

      {view !== "settlement-matrix" && <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500"><strong className="text-slate-700">{rows.length}</strong> aggregated report rows</p>
        {kpis.coveragePercent === null && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[9px] text-amber-700" title="Eligible patient denominator is missing for this period.">
            Coverage is N/A where Eligibility_Coverage denominators are missing.
          </p>
        )}
      </div>}
      {view === "settlement-matrix" ? (
        <SettlementMatrixReport year={settlementMatrix.year} monthKeys={settlementMatrix.monthKeys} rows={settlementMatrix.rows} />
      ) : view === "insurance-analysis" ? (
        <>
          <InsuranceAnalysisSummary rows={rows} />
          <ReportsTable rows={rows} view={view} />
        </>
      ) : (
        <ReportsTable rows={rows} view={view} />
      )}
    </div>
  );
}
