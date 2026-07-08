import React from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Coins,
  Database,
  FileSpreadsheet,
  FileText,
  FileX,
  Hospital,
  Lock,
  Plus,
  Upload
} from "lucide-react";
import { Claim, ClaimStatus } from "../types";

interface PremiumDashboardProps {
  claims: Claim[];
  isEnglish: boolean;
  formatUSD: (value: number) => string;
  onImport: () => void;
  onCreate: () => void;
  onFilterStatus: (status: ClaimStatus) => void;
  onFilterErrors: () => void;
}

interface SeriesPoint {
  label: string;
  billed: number;
  collected: number;
  ar: number;
}

interface StatusDatum {
  label: string;
  value: number;
  color: string;
  status?: ClaimStatus;
}

function sum(claims: Claim[], selector: (claim: Claim) => number) {
  return claims.reduce((total, claim) => total + (Number(selector(claim)) || 0), 0);
}

function pct(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function compactMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
    style: "currency",
    currency: "USD"
  }).format(Number(value) || 0);
}

function daysSince(dateValue: string) {
  const time = new Date(dateValue).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function groupByMonth(claims: Claim[]): SeriesPoint[] {
  const grouped = new Map<string, SeriesPoint>();
  claims.forEach(claim => {
    const label = claim.month_of_service || (claim.date_of_service_from || "").slice(0, 7) || "Unknown";
    const current = grouped.get(label) || { label, billed: 0, collected: 0, ar: 0 };
    current.billed += Number(claim.billed_charge) || 0;
    current.collected += Number(claim.total_collections) || 0;
    current.ar += Number(claim.ar_balance) || 0;
    grouped.set(label, current);
  });
  return Array.from(grouped.values()).sort((a, b) => a.label.localeCompare(b.label)).slice(-6);
}

function groupTop<T extends string>(
  claims: Claim[],
  keySelector: (claim: Claim) => T,
  valueSelector: (claim: Claim) => number,
  limit = 5
) {
  const grouped = new Map<T, { label: T; value: number; claims: number }>();
  claims.forEach(claim => {
    const label = keySelector(claim);
    const current = grouped.get(label) || { label, value: 0, claims: 0 };
    current.value += Number(valueSelector(claim)) || 0;
    current.claims += 1;
    grouped.set(label, current);
  });
  return Array.from(grouped.values()).sort((a, b) => b.value - a.value).slice(0, limit);
}

function DashboardPanel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ExecutiveMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone = "blue"
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ElementType;
  tone?: "blue" | "green" | "amber" | "rose";
}) {
  const toneMap = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700"
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-bold uppercase text-slate-500">{label}</span>
        <span className={`rounded-md border p-1.5 ${toneMap[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-2xl font-bold text-slate-950">{value}</div>
      <p className="mt-1 text-[11px] font-medium text-slate-500">{detail}</p>
    </div>
  );
}

function MiniTrend({ data }: { data: SeriesPoint[] }) {
  const width = 520;
  const height = 178;
  const pad = 28;
  const maxValue = Math.max(...data.flatMap(point => [point.billed, point.collected, point.ar]), 1);
  const xFor = (index: number) => pad + (index * (width - pad * 2)) / Math.max(data.length - 1, 1);
  const yFor = (value: number) => height - pad - (value / maxValue) * (height - pad * 2);
  const pathFor = (field: keyof Omit<SeriesPoint, "label">) =>
    data.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point[field])}`).join(" ");

  if (data.length === 0) {
    return <div className="py-12 text-center text-xs text-slate-400">No trend data available.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-52 min-w-[520px]">
        <defs>
          <linearGradient id="paidArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(step => (
          <line
            key={step}
            x1={pad}
            x2={width - pad}
            y1={pad + step * (height - pad * 2)}
            y2={pad + step * (height - pad * 2)}
            stroke="#e2e8f0"
            strokeWidth="1"
          />
        ))}
        <path d={`${pathFor("collected")} L ${xFor(data.length - 1)} ${height - pad} L ${xFor(0)} ${height - pad} Z`} fill="url(#paidArea)" />
        <path d={pathFor("billed")} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
        <path d={pathFor("collected")} fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" />
        <path d={pathFor("ar")} fill="none" stroke="#f59e0b" strokeWidth="3" strokeDasharray="5 5" strokeLinecap="round" />
        {data.map((point, index) => (
          <g key={point.label}>
            <circle cx={xFor(index)} cy={yFor(point.collected)} r="4" fill="#10b981" />
            <text x={xFor(index)} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[10px] font-bold">
              {point.label.slice(5)}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-4 text-[11px] font-semibold text-slate-500">
        <span className="flex items-center gap-1"><i className="h-2 w-5 rounded bg-blue-600" /> Billed</span>
        <span className="flex items-center gap-1"><i className="h-2 w-5 rounded bg-emerald-500" /> Collected</span>
        <span className="flex items-center gap-1"><i className="h-2 w-5 rounded bg-amber-500" /> A/R</span>
      </div>
    </div>
  );
}

function StatusDonut({ data, onStatusClick }: { data: StatusDatum[]; onStatusClick: (status: ClaimStatus) => void }) {
  const total = data.reduce((acc, item) => acc + item.value, 0);
  let offset = 25;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="grid gap-4 md:grid-cols-[180px_1fr] md:items-center">
      <div className="relative mx-auto h-44 w-44">
        <svg viewBox="0 0 120 120" className="-rotate-90">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="14" />
          {data.map(item => {
            const length = total ? (item.value / total) * circumference : 0;
            const strokeDasharray = `${length} ${circumference - length}`;
            const currentOffset = offset;
            offset -= length;
            return (
              <circle
                key={item.label}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth="14"
                strokeDasharray={strokeDasharray}
                strokeDashoffset={currentOffset}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-slate-950">{total}</span>
          <span className="text-[10px] font-bold uppercase text-slate-400">Claims</span>
        </div>
      </div>
      <div className="space-y-2">
        {data.map(item => (
          <button
            key={item.label}
            type="button"
            onClick={() => item.status && onStatusClick(item.status)}
            className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-xs hover:border-slate-300 hover:bg-slate-50"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-700">
              <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
            <span className="font-mono font-bold text-slate-900">{item.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HorizontalBarList({
  rows,
  formatValue
}: {
  rows: Array<{ label: string; value: number; color?: string; meta?: string }>;
  formatValue: (value: number) => string;
}) {
  const maxValue = Math.max(...rows.map(row => row.value), 1);
  return (
    <div className="space-y-3">
      {rows.map(row => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-semibold text-slate-700">{row.label}</span>
            <span className="shrink-0 font-mono font-bold text-slate-900">{formatValue(row.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full"
              style={{ width: `${Math.max(3, (row.value / maxValue) * 100)}%`, backgroundColor: row.color || "#2563eb" }}
            />
          </div>
          {row.meta && <div className="mt-1 text-[10px] font-medium text-slate-400">{row.meta}</div>}
        </div>
      ))}
    </div>
  );
}

function AgingBars({ claims, formatUSD }: { claims: Claim[]; formatUSD: (value: number) => string }) {
  const buckets = [
    { label: "0-30", min: 0, max: 30, color: "#10b981" },
    { label: "31-60", min: 31, max: 60, color: "#2563eb" },
    { label: "61-90", min: 61, max: 90, color: "#f59e0b" },
    { label: "90+", min: 91, max: Infinity, color: "#e11d48" }
  ].map(bucket => {
    const matches = claims.filter(claim => {
      const age = daysSince(claim.date_of_service_from);
      return age >= bucket.min && age <= bucket.max;
    });
    return {
      ...bucket,
      value: matches.reduce((acc, claim) => acc + claim.ar_balance, 0),
      claims: matches.length
    };
  });
  const maxValue = Math.max(...buckets.map(bucket => bucket.value), 1);

  return (
    <div className="grid grid-cols-4 gap-3">
      {buckets.map(bucket => (
        <div key={bucket.label} className="flex min-h-40 flex-col justify-end rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex flex-1 items-end">
            <div
              className="w-full rounded-t-md"
              style={{ height: `${Math.max(8, (bucket.value / maxValue) * 112)}px`, backgroundColor: bucket.color }}
            />
          </div>
          <div className="mt-2 text-center">
            <div className="text-xs font-bold text-slate-800">{bucket.label}</div>
            <div className="font-mono text-[11px] font-bold text-slate-600">{formatUSD(bucket.value)}</div>
            <div className="text-[10px] text-slate-400">{bucket.claims} claims</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PremiumDashboard({
  claims,
  isEnglish,
  formatUSD,
  onImport,
  onCreate,
  onFilterStatus,
  onFilterErrors
}: PremiumDashboardProps) {
  const totalBilled = sum(claims, claim => claim.billed_charge);
  const totalAdjustments = sum(claims, claim => claim.insurance_adjustment);
  const totalDenials = sum(claims, claim => claim.denied_amount + claim.write_off_amount + claim.uncollectible_amount);
  const totalNetCollectible = sum(claims, claim => claim.net_collectible_revenue);
  const totalCollections = sum(claims, claim => claim.total_collections);
  const totalAR = sum(claims, claim => claim.ar_balance);
  const iteraCollections = sum(claims, claim => claim.itera_direct_collection);
  const providerCollections = sum(claims, claim => claim.provider_direct_collection);
  const iteraAR = sum(claims, claim => claim.itera_ar);
  const providerAR = sum(claims, claim => claim.provider_ar);
  const payableToPhysician = sum(claims, claim => claim.account_payable_to_physician);
  const paidToPhysician = sum(claims, claim => claim.payment_to_physician);
  const endingAP = sum(claims, claim => claim.ending_ap_to_physician);
  const netItera = sum(claims, claim => claim.net_itera_revenue);
  const netProvider = sum(claims, claim => claim.net_provider_revenue);
  const cleanClaimCount = claims.filter(claim => claim.claim_classification === "Clean Claim").length;
  const errorCount = claims.filter(claim => claim.error_flag || claim.claim_status === ClaimStatus.BlockedByError).length;
  const collectionRate = pct(totalCollections, totalNetCollectible || totalBilled);
  const arRate = pct(totalAR, totalNetCollectible || totalBilled);
  const netMargin = pct(netItera, Math.max(totalCollections, 1));
  const monthTrend = groupByMonth(claims);

  const statusData: StatusDatum[] = [
    { label: "Paid", value: claims.filter(claim => claim.claim_status === ClaimStatus.Paid).length, color: "#10b981", status: ClaimStatus.Paid },
    { label: "Partial", value: claims.filter(claim => claim.claim_status === ClaimStatus.PartiallyPaid).length, color: "#06b6d4", status: ClaimStatus.PartiallyPaid },
    { label: "Pending", value: claims.filter(claim => claim.claim_status === ClaimStatus.Pending).length, color: "#f59e0b", status: ClaimStatus.Pending },
    { label: "Denied", value: claims.filter(claim => claim.claim_status === ClaimStatus.Denied).length, color: "#e11d48", status: ClaimStatus.Denied },
    { label: "Rejected", value: claims.filter(claim => claim.claim_status === ClaimStatus.Rejected).length, color: "#991b1b", status: ClaimStatus.Rejected },
    { label: "Rebill", value: claims.filter(claim => claim.claim_status === ClaimStatus.ReadyToRebill).length, color: "#ea580c", status: ClaimStatus.ReadyToRebill }
  ].filter(item => item.value > 0);

  const financialWaterfall = [
    { label: "Billed", value: totalBilled, color: "#2563eb" },
    { label: "Adjustments", value: totalAdjustments, color: "#64748b" },
    { label: "Denials / write-offs", value: totalDenials, color: "#e11d48" },
    { label: "Net collectible", value: totalNetCollectible, color: "#10b981" }
  ];

  const providerRows = groupTop(claims, claim => claim.provider_name || "Unknown", claim => claim.total_collections).map(row => ({
    label: row.label,
    value: row.value,
    meta: `${row.claims} claims`,
    color: "#2563eb"
  }));

  const payerRiskRows = groupTop(
    claims.filter(claim => claim.ar_balance > 0 || claim.claim_status === ClaimStatus.Denied || claim.claim_status === ClaimStatus.Rejected),
    claim => claim.payer_name || "Unknown",
    claim => claim.ar_balance + claim.denied_amount + claim.write_off_amount
  ).map(row => ({
    label: row.label,
    value: row.value,
    meta: `${row.claims} claims with open exposure`,
    color: "#e11d48"
  }));

  const queueItems = [
    { label: "Pending", value: claims.filter(claim => claim.claim_status === ClaimStatus.Pending).length, status: ClaimStatus.Pending, color: "border-amber-200 bg-amber-50 text-amber-700" },
    { label: "Partial paid", value: claims.filter(claim => claim.claim_status === ClaimStatus.PartiallyPaid).length, status: ClaimStatus.PartiallyPaid, color: "border-cyan-200 bg-cyan-50 text-cyan-700" },
    { label: "Denied", value: claims.filter(claim => claim.claim_status === ClaimStatus.Denied).length, status: ClaimStatus.Denied, color: "border-rose-200 bg-rose-50 text-rose-700" },
    { label: "Rejected", value: claims.filter(claim => claim.claim_status === ClaimStatus.Rejected).length, status: ClaimStatus.Rejected, color: "border-red-200 bg-red-50 text-red-700" },
    { label: "Ready to rebill", value: claims.filter(claim => claim.claim_status === ClaimStatus.ReadyToRebill).length, status: ClaimStatus.ReadyToRebill, color: "border-orange-200 bg-orange-50 text-orange-700" }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-slate-500">
            <BarChart3 className="h-4 w-4 text-primary-blue" />
            {isEnglish ? "Financial command center" : "Centro financiero"}
          </div>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">
            {isEnglish ? "Reconciliation Dashboard" : "Dashboard de Conciliacion"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {claims.length} claims tracked across billing, collections, A/R exposure and provider payouts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onImport} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <Upload className="h-3.5 w-3.5 text-primary-blue" />
            {isEnglish ? "Import CSV" : "Importar CSV"}
          </button>
          <button onClick={onCreate} className="flex items-center gap-1.5 rounded-lg bg-primary-blue px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-secondary-blue">
            <Plus className="h-3.5 w-3.5" />
            {isEnglish ? "New Claim" : "Nuevo Claim"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ExecutiveMetric label="Collection rate" value={`${collectionRate}%`} detail={`${formatUSD(totalCollections)} collected`} icon={Coins} tone="green" />
        <ExecutiveMetric label="Open A/R exposure" value={formatUSD(totalAR)} detail={`${arRate}% of collectible revenue`} icon={AlertTriangle} tone={totalAR > 0 ? "amber" : "green"} />
        <ExecutiveMetric label="Clean claim ratio" value={`${pct(cleanClaimCount, claims.length)}%`} detail={`${cleanClaimCount} clean claims`} icon={CheckCircle2} tone="blue" />
        <ExecutiveMetric label="ITERA net revenue" value={formatUSD(netItera)} detail={`${netMargin}% of collections`} icon={Database} tone="blue" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.35fr_0.9fr]">
        <DashboardPanel title="Financial Flow" subtitle="Waterfall view: billed charges, contractual loss, denial/write-off leakage and collectible revenue.">
          <HorizontalBarList rows={financialWaterfall} formatValue={formatUSD} />
        </DashboardPanel>

        <DashboardPanel title="Claim Status Mix" subtitle="Donut chart for operational workload by status.">
          <StatusDonut data={statusData} onStatusClick={onFilterStatus} />
        </DashboardPanel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_1fr]">
        <DashboardPanel title="Monthly Performance Trend" subtitle="Line chart comparing billed, collected and remaining A/R by month.">
          <MiniTrend data={monthTrend} />
        </DashboardPanel>

        <DashboardPanel title="A/R Aging" subtitle="Column chart for open balance by days since DOS.">
          <AgingBars claims={claims} formatUSD={formatUSD} />
        </DashboardPanel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <DashboardPanel title="Collection Ownership" subtitle="Stacked bar for direct collections and A/R responsibility.">
          <div className="space-y-5">
            <HorizontalBarList
              rows={[
                { label: "ITERA collections", value: iteraCollections, color: "#2563eb", meta: `${pct(iteraCollections, totalCollections)}% of collected` },
                { label: "Provider collections", value: providerCollections, color: "#0ea5e9", meta: `${pct(providerCollections, totalCollections)}% of collected` },
                { label: "ITERA A/R", value: iteraAR, color: "#f59e0b", meta: `${pct(iteraAR, totalAR)}% of open A/R` },
                { label: "Provider A/R", value: providerAR, color: "#e11d48", meta: `${pct(providerAR, totalAR)}% of open A/R` }
              ]}
              formatValue={formatUSD}
            />
          </div>
        </DashboardPanel>

        <DashboardPanel title="Provider Yield" subtitle="Ranking by collections received.">
          <HorizontalBarList rows={providerRows} formatValue={compactMoney} />
        </DashboardPanel>

        <DashboardPanel title="Payer Exposure" subtitle="Ranking by A/R, denials and write-offs.">
          {payerRiskRows.length > 0 ? (
            <HorizontalBarList rows={payerRiskRows} formatValue={compactMoney} />
          ) : (
            <div className="py-12 text-center text-xs text-slate-400">No payer exposure in the current filter set.</div>
          )}
        </DashboardPanel>
      </div>

      <DashboardPanel
        title="Work Queue"
        subtitle="Clickable counters route directly to the claims worklist."
        action={
          <button onClick={onFilterErrors} className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100">
            <FileX className="h-3.5 w-3.5" />
            {errorCount} errors
          </button>
        }
      >
        <div className="grid gap-3 md:grid-cols-5">
          {queueItems.map(item => (
            <button
              key={item.label}
              type="button"
              onClick={() => onFilterStatus(item.status)}
              className={`flex items-center justify-between rounded-lg border px-3 py-3 text-left transition hover:shadow-sm ${item.color}`}
            >
              <span>
                <span className="block text-[10px] font-bold uppercase">{item.label}</span>
                <span className="mt-1 block text-2xl font-bold">{item.value}</span>
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          ))}
        </div>
      </DashboardPanel>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <ExecutiveMetric label="Physician payable" value={formatUSD(payableToPhysician)} detail={`${formatUSD(paidToPhysician)} already distributed`} icon={Hospital} tone="blue" />
        <ExecutiveMetric label="Ending A/P" value={formatUSD(endingAP)} detail="Remaining physician balance" icon={Lock} tone={endingAP > 0 ? "amber" : "green"} />
        <ExecutiveMetric label="Provider net revenue" value={formatUSD(netProvider)} detail="Provider share on collections" icon={FileText} tone="green" />
        <ExecutiveMetric label="Billed charges" value={formatUSD(totalBilled)} detail={`${formatUSD(totalAdjustments + totalDenials)} total leakage`} icon={FileSpreadsheet} tone="blue" />
      </div>
    </div>
  );
}
