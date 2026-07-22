import React, { useMemo, useState } from "react";
import { ArrowUpRight, CalendarClock, ChevronDown, ChevronUp, Filter, Search, UserRound } from "lucide-react";
import { Claim, User } from "../types";
import { MultiSelectFilter } from "./MultiSelectFilter";
import { multiFilterMatches } from "../multiSelectFilters";

type QueueLine = {
  id: string;
  lineIndex: number;
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
  onUpdateClaim: (updates: Partial<Claim>, targetClaimId?: string) => Promise<void>;
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
        id: `${claim.claim_id}-${index}-${line?.cpt || "line"}`,
        lineIndex: index,
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

export function RcmWorkQueue({ claims, users, onOpenClaim, onUpdateClaim, isEnglish }: RcmWorkQueueProps) {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [payerFilter, setPayerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<{ field: string; direction: "asc" | "desc" }>({ field: "dueDate", direction: "asc" });
  const [savingAssignmentId, setSavingAssignmentId] = useState<string | null>(null);

  const rows = useMemo(() => claims.flatMap(parseLines), [claims]);
  const assignableUsers = users.filter(user => user.active);
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
    if (!multiFilterMatches(row.nextAction, actionFilter)) return false;
    if (!multiFilterMatches(row.providerName, providerFilter)) return false;
    if (!multiFilterMatches(row.payerName, payerFilter)) return false;
    if (!multiFilterMatches(row.status, statusFilter)) return false;
    return true;
  });
  const sortedRows = useMemo(() => {
    const valueFor = (row: QueueLine) => {
      if (sort.field === "patient") return row.claim.patient_display_name_masked || row.claim.patient_id;
      if (sort.field === "claim") return row.claim.claim_id;
      if (sort.field === "cpt") return row.cpt;
      if (sort.field === "nextAction") return row.nextAction;
      if (sort.field === "provider") return row.providerName;
      if (sort.field === "payer") return row.payerName;
      if (sort.field === "dos") return row.dos;
      if (sort.field === "status") return row.status;
      if (sort.field === "balance") return row.balance;
      if (sort.field === "assignedTo") return users.find(user => user.user_id === row.assignedTo || user.email === row.assignedTo)?.name || row.assignedTo;
      if (sort.field === "notes") return row.notes.length;
      return row.dueDate || row.followUpDate;
    };
    return [...filteredRows].sort((a, b) => {
      const aValue = valueFor(a);
      const bValue = valueFor(b);
      const result = typeof aValue === "number" && typeof bValue === "number"
        ? aValue - bValue
        : textValue(aValue).localeCompare(textValue(bValue), undefined, { numeric: true, sensitivity: "base" });
      return sort.direction === "asc" ? result : -result;
    });
  }, [filteredRows, sort, users]);
  const sortableHeader = (label: React.ReactNode, field: string, className = "px-3 py-3") => (
    <th
      className={`${className} cursor-pointer select-none hover:bg-slate-100`}
      onClick={() => setSort(current => ({ field, direction: current.field === field && current.direction === "asc" ? "desc" : "asc" }))}
      title={isEnglish ? "Sort column" : "Ordenar columna"}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sort.field === field && (sort.direction === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  const pendingEra = rows.filter(row => row.nextAction === "Pending ERA").length;
  const overdue = rows.filter(row => row.dueDate && row.dueDate < new Date().toISOString().slice(0, 10)).length;

  const updateLineAssignment = async (row: QueueLine, assignedTo: string) => {
    let parsed: any[] = [];
    try {
      parsed = row.claim.service_lines_json ? JSON.parse(row.claim.service_lines_json) : [];
    } catch {
      parsed = [];
    }
    if (!Array.isArray(parsed)) return;

    const nextLines = parsed.map((line, index) => (
      index === row.lineIndex ? { ...line, assignedTo, assigned_to: assignedTo } : line
    ));

    setSavingAssignmentId(row.id);
    try {
      await onUpdateClaim({ service_lines_json: JSON.stringify(nextLines) }, row.claim.claim_id);
    } finally {
      setSavingAssignmentId(null);
    }
  };

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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[2fr_repeat(4,minmax(0,1fr))]">
          <label>
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
              <MultiSelectFilter
                value={String(value)}
                onChange={(nextValue) => (setter as React.Dispatch<React.SetStateAction<string>>)(nextValue)}
                options={(options as string[]).map(option => ({ value: option, label: option }))}
                allLabel={isEnglish ? "All" : "Todos"}
                placeholder={isEnglish ? "Search..." : "Buscar..."}
                buttonClassName="px-3 py-2 font-semibold"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <tr>
                {sortableHeader(isEnglish ? "Patient / Claim" : "Paciente / Claim", "patient")}
                {sortableHeader("CPT", "cpt")}
                {sortableHeader(isEnglish ? "Next Action" : "Próxima acción", "nextAction")}
                {sortableHeader(isEnglish ? "Provider" : "Provider", "provider")}
                {sortableHeader(isEnglish ? "Payer" : "Payer", "payer")}
                {sortableHeader("DOS", "dos")}
                {sortableHeader(isEnglish ? "Status" : "Estado", "status")}
                {sortableHeader(isEnglish ? "Balance" : "Balance", "balance", "px-3 py-3 text-right")}
                {sortableHeader(isEnglish ? "Assignment" : "Asignación", "assignedTo")}
                {sortableHeader(isEnglish ? "Notes" : "Notas", "notes")}
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
                sortedRows.map(row => {
                  const assignedUser = users.find(user => user.user_id === row.assignedTo || user.email === row.assignedTo);
                  const assignmentMeta = [
                    row.dueDate ? `${isEnglish ? "Due" : "Vence"}: ${shortDate(row.dueDate)}` : "",
                    !row.dueDate && row.followUpDate ? `${isEnglish ? "Follow-up" : "Seguimiento"}: ${shortDate(row.followUpDate)}` : "",
                    row.priority ? `${isEnglish ? "Priority" : "Prioridad"}: ${row.priority}` : "",
                    savingAssignmentId === row.id ? (isEnglish ? "Saving..." : "Guardando...") : ""
                  ].filter(Boolean);
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
                          <div className="min-w-44">
                            <select
                              value={assignedUser?.user_id || row.assignedTo}
                              disabled={savingAssignmentId === row.id}
                              onChange={(event) => void updateLineAssignment(row, event.target.value)}
                              aria-label={isEnglish ? `Assign task for claim ${row.claim.claim_id}` : `Asignar tarea para claim ${row.claim.claim_id}`}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none transition focus:border-primary-blue focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:bg-slate-50"
                            >
                              <option value="">{isEnglish ? "Unassigned" : "Sin asignar"}</option>
                              {assignableUsers.map(user => (
                                <option key={user.user_id} value={user.user_id}>
                                  {user.name || user.email}
                                </option>
                              ))}
                            </select>
                            {assignmentMeta.length > 0 && (
                              <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                                {(row.dueDate || row.followUpDate) && <CalendarClock className="h-3 w-3" />}
                                <span>{assignmentMeta.join(" · ")}</span>
                              </p>
                            )}
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
