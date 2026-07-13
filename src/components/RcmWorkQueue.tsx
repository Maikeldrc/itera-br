import React, { useMemo, useState } from "react";
import { ArrowUpRight, CalendarClock, Filter, Search, UserRound } from "lucide-react";
import { Claim, User } from "../types";

type QueueLine = {
  id: string;
  claim: Claim;
  cpt: string;
  status: string;
  nextAction: string;
  assignedTo: string;
  priority: string;
  dueDate: string;
  followUpDate: string;
  notes: string[];
  balance: number;
  payerName: string;
  providerName: string;
  dos: string;
};

interface RcmWorkQueueProps {
  claims: Claim[];
  users: User[];
  onOpenClaim: (claim: Claim) => void;
  isEnglish: boolean;
}

const CLOSED_ACTIONS = new Set(["", "No action", "Close line"]);

const textValue = (value: unknown) => String(value ?? "").trim();

const noteText = (value: unknown) => {
  if (value && typeof value === "object" && "text" in value) {
    return textValue((value as { text?: unknown }).text);
  }
  return textValue(value);
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(value) ? value : 0);

const shortDate = (value: string) => {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${month}/${day}/${year.slice(2)}` : value;
};

function parseLines(claim: Claim): QueueLine[] {
  let parsed: any[] = [];
  try {
    parsed = claim.service_lines_json ? JSON.parse(claim.service_lines_json) : [];
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  return parsed
    .map((line, index) => {
      const nextAction = textValue(line?.nextAction || line?.next_action || "No action");
      return {
        id: `${claim.claim_id}-${line?.cpt || index}`,
        claim,
        cpt: textValue(line?.cpt || claim.cpt_hcpcs),
        status: textValue(line?.status || claim.claim_status),
        nextAction,
        assignedTo: textValue(line?.assignedTo || line?.assigned_to || ""),
        priority: textValue(line?.priority || ""),
        dueDate: textValue(line?.dueDate || line?.due_date || ""),
        followUpDate: textValue(line?.followUpDate || line?.follow_up_date || ""),
        notes: Array.isArray(line?.notes) ? line.notes.map(noteText).filter(Boolean) : [],
        balance: Number(line?.balance ?? claim.ar_balance ?? 0),
        payerName: textValue(claim.payer_name),
        providerName: textValue(claim.provider_name),
        dos: textValue(claim.date_of_service_from)
      };
    })
    .filter(line => !CLOSED_ACTIONS.has(line.nextAction));
}

export function RcmWorkQueue({ claims, users, onOpenClaim, isEnglish }: RcmWorkQueueProps) {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [payerFilter, setPayerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const rows = useMemo(() => claims.flatMap(parseLines), [claims]);
  const actions = Array.from(new Set(rows.map(row => row.nextAction))).sort();
  const providers = Array.from(new Set(rows.map(row => row.providerName).filter(Boolean))).sort();
  const payers = Array.from(new Set(rows.map(row => row.payerName).filter(Boolean))).sort();
  const statuses = Array.from(new Set(rows.map(row => row.status).filter(Boolean))).sort();

  const filteredRows = rows.filter(row => {
    const haystack = [
      row.claim.claim_id,
      row.claim.patient_display_name_masked,
      row.claim.patient_id,
      row.providerName,
      row.payerName,
      row.cpt,
      row.nextAction,
      row.status,
      row.notes.join(" ")
    ].join(" ").toLowerCase();
    const term = search.trim().toLowerCase();
    if (term && !haystack.includes(term)) return false;
    if (actionFilter && row.nextAction !== actionFilter) return false;
    if (providerFilter && row.providerName !== providerFilter) return false;
    if (payerFilter && row.payerName !== payerFilter) return false;
    if (statusFilter && row.status !== statusFilter) return false;
    return true;
  });

  const pendingEra = rows.filter(row => row.nextAction === "Pending ERA").length;
  const overdue = rows.filter(row => row.dueDate && row.dueDate < new Date().toISOString().slice(0, 10)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 md:text-2xl">
            {isEnglish ? "RCM Work Queue" : "Cola de Trabajo RCM"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {isEnglish
              ? "Operational queue for CPT lines with open Next Action follow-up."
              : "Cola operativa de líneas CPT con Next Action pendiente."}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{isEnglish ? "Open actions" : "Acciones abiertas"}</p>
            <p className="font-mono text-lg font-bold text-slate-900">{rows.length}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Pending ERA</p>
            <p className="font-mono text-lg font-bold text-amber-800">{pendingEra}</p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">{isEnglish ? "Overdue" : "Vencidas"}</p>
            <p className="font-mono text-lg font-bold text-rose-800">{overdue}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="md:col-span-2">
            <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <Search className="h-3.5 w-3.5" /> {isEnglish ? "Search" : "Buscar"}
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isEnglish ? "Patient, MRN, claim, CPT, payer..." : "Paciente, MRN, claim, CPT, payer..."}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-primary-blue focus:bg-white"
            />
          </label>
          {[
            [isEnglish ? "Next Action" : "Próxima acción", actionFilter, setActionFilter, actions],
            [isEnglish ? "Provider" : "Provider", providerFilter, setProviderFilter, providers],
            [isEnglish ? "Payer" : "Payer", payerFilter, setPayerFilter, payers],
            [isEnglish ? "Line Status" : "Estado línea", statusFilter, setStatusFilter, statuses]
          ].map(([label, value, setter, options]) => (
            <label key={String(label)}>
              <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <Filter className="h-3.5 w-3.5" /> {String(label)}
              </span>
              <select
                value={String(value)}
                onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-primary-blue focus:bg-white"
              >
                <option value="">{isEnglish ? "All" : "Todos"}</option>
                {(options as string[]).map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-3">{isEnglish ? "Patient / Claim" : "Paciente / Claim"}</th>
                <th className="px-3 py-3">CPT</th>
                <th className="px-3 py-3">{isEnglish ? "Next Action" : "Próxima acción"}</th>
                <th className="px-3 py-3">{isEnglish ? "Provider" : "Provider"}</th>
                <th className="px-3 py-3">{isEnglish ? "Payer" : "Payer"}</th>
                <th className="px-3 py-3">DOS</th>
                <th className="px-3 py-3">{isEnglish ? "Status" : "Estado"}</th>
                <th className="px-3 py-3 text-right">{isEnglish ? "Balance" : "Balance"}</th>
                <th className="px-3 py-3">{isEnglish ? "Assignment" : "Asignación"}</th>
                <th className="px-3 py-3">{isEnglish ? "Notes" : "Notas"}</th>
                <th className="px-3 py-3 text-center">{isEnglish ? "Action" : "Acción"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-500">
                    {isEnglish ? "No open RCM actions match the selected filters." : "No hay acciones RCM abiertas para los filtros seleccionados."}
                  </td>
                </tr>
              ) : (
                filteredRows.map(row => {
                  const assignedUser = users.find(user => user.user_id === row.assignedTo || user.email === row.assignedTo);
                  return (
                    <tr key={row.id} className="hover:bg-blue-50/30">
                      <td className="px-3 py-3">
                        <button onClick={() => onOpenClaim(row.claim)} className="text-left">
                          <span className="block font-semibold text-slate-800 hover:text-primary-blue">{row.claim.patient_display_name_masked}</span>
                          <span className="block font-mono text-[10px] text-slate-400">{row.claim.claim_id}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3 font-mono font-bold text-dark-blue">{row.cpt || "-"}</td>
                      <td className="px-3 py-3">
                        <span className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-bold text-dark-blue">
                          {row.nextAction}
                        </span>
                      </td>
                      <td className="px-3 py-3">{row.providerName || "-"}</td>
                      <td className="px-3 py-3">{row.payerName || "-"}</td>
                      <td className="px-3 py-3 font-mono text-slate-500">{shortDate(row.dos)}</td>
                      <td className="px-3 py-3">
                        <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{row.status || "-"}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-slate-700">{money(row.balance)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-1.5">
                          <UserRound className="mt-0.5 h-3.5 w-3.5 text-slate-400" />
                          <div>
                            <p className="font-semibold text-slate-700">{assignedUser?.name || row.assignedTo || (isEnglish ? "Unassigned" : "Sin asignar")}</p>
                            <p className="flex items-center gap-1 text-[10px] text-slate-400">
                              <CalendarClock className="h-3 w-3" />
                              {row.dueDate ? shortDate(row.dueDate) : (row.followUpDate ? shortDate(row.followUpDate) : "-")}
                              {row.priority ? ` · ${row.priority}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-xs px-3 py-3">
                        <p className="truncate text-[11px] text-slate-500" title={row.notes.join(" | ") || row.claim.last_note}>
                          {row.notes[0] || row.claim.last_note || "-"}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => onOpenClaim(row.claim)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-700 hover:border-primary-blue hover:bg-blue-50 hover:text-primary-blue"
                        >
                          {isEnglish ? "Open" : "Abrir"} <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
