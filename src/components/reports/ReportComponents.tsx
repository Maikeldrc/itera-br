import React from "react";
import { Download, RotateCcw, Save, Search } from "lucide-react";
import { ClaimStatus, Payer, Provider } from "../../types";
import { MultiSelectFilter } from "../MultiSelectFilter";
import {
  AgingBucket,
  ReportFiltersState,
  ReportGroupBy,
  ReportView
} from "../../reportsEngine";

export function ReportKpiCard({
  title,
  value,
  tone = "blue",
  indicator
}: {
  title: string;
  value: string;
  tone?: "blue" | "green" | "orange" | "slate" | "red";
  indicator?: string;
}) {
  const tones = {
    blue: "border-blue-200 bg-blue-50/70 text-dark-blue",
    green: "border-emerald-200 bg-emerald-50/70 text-emerald-800",
    orange: "border-amber-200 bg-amber-50/70 text-amber-800",
    slate: "border-slate-200 bg-white text-slate-800",
    red: "border-rose-200 bg-rose-50/70 text-rose-800"
  };
  return (
    <div className={`rounded-xl border p-3 shadow-sm ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-wider opacity-70">{title}</span>
        {indicator && <span className="text-[9px] font-bold">{indicator}</span>}
      </div>
      <div className="mt-2 font-display text-xl font-bold">{value}</div>
    </div>
  );
}

export function BillingOwnerBadge({ value }: { value: string }) {
  const isItera = value === "ITERA";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${isItera ? "border-blue-200 bg-blue-50 text-primary-blue" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
      {value}
    </span>
  );
}

export function PaymentReceiverBadge({ value }: { value: string }) {
  const styles: Record<string, string> = {
    ITERA: "border-blue-200 bg-blue-50 text-primary-blue",
    Provider: "border-amber-200 bg-amber-50 text-amber-700",
    Split: "border-cyan-200 bg-cyan-50 text-cyan-700",
    Unknown: "border-slate-200 bg-slate-50 text-slate-500"
  };
  return <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${styles[value] || styles.Unknown}`}>{value}</span>;
}

export function AgingBadge({ bucket }: { bucket: AgingBucket | "" }) {
  if (!bucket) return <span className="text-slate-300">-</span>;
  const style = bucket === "91+ days"
    ? "bg-rose-100 text-rose-700 border-rose-200"
    : bucket === "61-90 days"
      ? "bg-orange-100 text-orange-700 border-orange-200"
      : bucket === "31-60 days"
        ? "bg-amber-100 text-amber-700 border-amber-200"
        : "bg-emerald-50 text-emerald-700 border-emerald-200";
  return <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${style}`}>{bucket}</span>;
}

const TAB_LABELS: Record<ReportView, string> = {
  "billing-summary": "Billing Summary",
  "insurance-analysis": "Insurance Analysis",
  "provider-vs-itera": "ITERA vs Provider",
  collections: "Collections",
  denials: "Denials",
  pending: "Pending Claims",
  coverage: "Coverage",
  "settlement-matrix": "Settlement Matrix"
};

export function ReportTabs({ value, onChange }: { value: ReportView; onChange: (view: ReportView) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
      {(Object.keys(TAB_LABELS) as ReportView[]).map(tab => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-bold ${value === tab ? "bg-primary-blue text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </div>
  );
}

const GROUP_LABELS: Record<ReportGroupBy, string> = {
  month: "Month",
  date: "Date",
  practice: "Practice",
  provider: "Provider",
  serviceType: "Service Type",
  cpt: "CPT Code",
  payer: "Payer",
  billedBy: "Billed By",
  paymentReceivedBy: "Payment Receiver"
};

export function GroupBySelector({
  value,
  onChange
}: {
  value: ReportGroupBy[];
  onChange: (groups: ReportGroupBy[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">Group by</span>
      {(Object.keys(GROUP_LABELS) as ReportGroupBy[]).map(group => {
        const active = value.includes(group);
        return (
          <button
            key={group}
            onClick={() => onChange(active ? value.filter(item => item !== group) : [...value, group])}
            className={`rounded-full border px-2 py-1 text-[9px] font-bold ${active ? "border-primary-blue bg-blue-50 text-primary-blue" : "border-slate-200 bg-white text-slate-400"}`}
          >
            {GROUP_LABELS[group]}
          </button>
        );
      })}
    </div>
  );
}

export function ExportButton({ onClick, label = "Export CSV" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-lg bg-dark-blue px-3 py-2 text-[10px] font-bold text-white hover:bg-secondary-blue">
      <Download className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export function ReportFilters({
  filters,
  providers,
  payers,
  practices,
  serviceTypes,
  cptCodes,
  onChange,
  onReset,
  onSave
}: {
  filters: ReportFiltersState;
  providers: Provider[];
  payers: Payer[];
  practices: Array<{ id: string; name: string }>;
  serviceTypes: string[];
  cptCodes: string[];
  onChange: (filters: ReportFiltersState) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const field = "rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-700";
  const labeledField = `${field} w-full`;
  const labelClass = "mb-1 block text-[8px] font-bold uppercase tracking-wider text-slate-400";
  const update = (key: keyof ReportFiltersState, value: any) => onChange({ ...filters, [key]: value });
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <div className="relative col-span-2">
          <span className={labelClass}>Search</span>
          <Search className="absolute left-2.5 top-7 h-3.5 w-3.5 text-slate-400" />
          <input value={filters.search} onChange={e => update("search", e.target.value)} placeholder="Search claim, patient, CPT, payer..." className={`${field} w-full pl-8`} />
        </div>
        <label>
          <span className={labelClass}>DOS From</span>
          <input type="date" value={filters.startDate} onChange={e => update("startDate", e.target.value)} className={labeledField} title="Date of service from" aria-label="Date of service from" />
        </label>
        <label>
          <span className={labelClass}>DOS To</span>
          <input type="date" value={filters.endDate} onChange={e => update("endDate", e.target.value)} className={labeledField} title="Date of service to" aria-label="Date of service to" />
        </label>
        <label>
          <span className={labelClass}>Month of Service</span>
          <input type="month" value={filters.month} onChange={e => update("month", e.target.value)} className={labeledField} aria-label="Month of service" />
        </label>
        <MultiSelectFilter value={filters.practiceId} onChange={value => update("practiceId", value)} allLabel="All practices" placeholder="Search practice..." options={practices.map(item => ({ value: item.id, label: item.name }))} buttonClassName="bg-white py-1.5 text-[10px]" />
        <MultiSelectFilter value={filters.providerId} onChange={value => update("providerId", value)} allLabel="All providers" placeholder="Search provider..." options={providers.map(item => ({ value: item.provider_id, label: item.provider_name, meta: item.npi }))} buttonClassName="bg-white py-1.5 text-[10px]" />
        <MultiSelectFilter value={filters.serviceType} onChange={value => update("serviceType", value)} allLabel="All services" placeholder="Search service..." options={serviceTypes.map(item => ({ value: item, label: item }))} buttonClassName="bg-white py-1.5 text-[10px]" />
        <MultiSelectFilter value={filters.cptCode} onChange={value => update("cptCode", value)} allLabel="All CPT codes" placeholder="Search CPT..." options={cptCodes.map(item => ({ value: item, label: item }))} buttonClassName="bg-white py-1.5 text-[10px]" />
        <MultiSelectFilter value={filters.billedBy} onChange={value => update("billedBy", value)} allLabel="Billed By: All" options={[{ value: "ITERA", label: "ITERA" }, { value: "Provider", label: "Provider" }]} buttonClassName="bg-white py-1.5 text-[10px]" />
        <MultiSelectFilter value={filters.paymentReceivedBy} onChange={value => update("paymentReceivedBy", value)} allLabel="Payment Receiver: All" options={["ITERA", "Provider", "Split", "Unknown"].map(item => ({ value: item, label: item }))} buttonClassName="bg-white py-1.5 text-[10px]" />
        <MultiSelectFilter value={filters.claimStatus} onChange={value => update("claimStatus", value)} allLabel="All statuses" placeholder="Search status..." options={Object.values(ClaimStatus).map(item => ({ value: item, label: item }))} buttonClassName="bg-white py-1.5 text-[10px]" />
        <MultiSelectFilter value={filters.payerId} onChange={value => update("payerId", value)} allLabel="All payers" placeholder="Search payer..." options={payers.map(item => ({ value: item.payer_id, label: item.payer_name, meta: item.payer_id }))} buttonClassName="bg-white py-1.5 text-[10px]" />
        <label>
          <span className={labelClass}>Submission From</span>
          <input type="date" value={filters.submissionStartDate} onChange={e => update("submissionStartDate", e.target.value)} className={labeledField} title="Submission date from" aria-label="Submission date from" />
        </label>
        <label>
          <span className={labelClass}>Submission To</span>
          <input type="date" value={filters.submissionEndDate} onChange={e => update("submissionEndDate", e.target.value)} className={labeledField} title="Submission date to" aria-label="Submission date to" />
        </label>
        <label>
          <span className={labelClass}>Payment From</span>
          <input type="date" value={filters.paymentStartDate} onChange={e => update("paymentStartDate", e.target.value)} className={labeledField} title="Payment date from" aria-label="Payment date from" />
        </label>
        <label>
          <span className={labelClass}>Payment To</span>
          <input type="date" value={filters.paymentEndDate} onChange={e => update("paymentEndDate", e.target.value)} className={labeledField} title="Payment date to" aria-label="Payment date to" />
        </label>
        <select value={filters.collectionBasis} onChange={e => update("collectionBasis", e.target.value)} className={field}>
          <option value="billed">Rate vs Billed</option>
          <option value="netCollectible">Rate vs Net Collectible</option>
        </select>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <GroupBySelector value={filters.groupBy} onChange={groups => update("groupBy", groups)} />
        <div className="flex gap-2">
          <button onClick={onSave} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[9px] font-bold text-slate-500 hover:bg-slate-50">
            <Save className="h-3 w-3" /> Save View
          </button>
          <button onClick={onReset} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[9px] font-bold text-slate-500 hover:bg-slate-50">
            <RotateCcw className="h-3 w-3" /> Reset Filters
          </button>
        </div>
      </div>
    </section>
  );
}
