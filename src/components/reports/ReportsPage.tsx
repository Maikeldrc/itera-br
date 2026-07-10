import React, { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Claim, EligibilityCoverage, FeeSchedule, Payer, Provider, ReportFeeSchedule } from "../../types";
import {
  aggregateReports,
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
  ["Date", "date"], ["Practice", "practice"], ["Provider", "provider"], ["Service Type", "serviceType"],
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
    return (["billing-summary", "provider-vs-itera", "collections", "denials", "pending", "coverage"].includes(path) ? path : "billing-summary") as ReportView;
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

  const allRows = aggregateReports(claims, filters, eligibilityCoverage, feeSchedules, reportFeeSchedules);
  const rows = filterRowsForView(allRows, view);
  const kpis = calculateReportKpis(rows);
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
            <ExportButton onClick={() => exportRows(rows, view)} />
            <ExportButton onClick={() => exportExcelRows(rows, view)} label="Export Excel" />
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
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
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500"><strong className="text-slate-700">{rows.length}</strong> aggregated report rows</p>
        {kpis.coveragePercent === null && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[9px] text-amber-700" title="Eligible patient denominator is missing for this period.">
            Coverage is N/A where Eligibility_Coverage denominators are missing.
          </p>
        )}
      </div>
      <ReportsTable rows={rows} view={view} />
    </div>
  );
}
