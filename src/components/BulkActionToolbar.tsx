/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Check, Clipboard, AlertTriangle, HelpCircle, FileSpreadsheet, Tag, Send, Loader2 } from "lucide-react";
import { ClaimStatus, ClaimClassification } from "../types";
import { useLanguage } from "./LanguageProvider";

interface BulkActionToolbarProps {
  selectedCount: number;
  onApplyAction: (actionType: string, value: any) => void | Promise<void>;
  onExportSelected: () => void;
  onClearSelection: () => void;
}

export function BulkActionToolbar({
  selectedCount,
  onApplyAction,
  onExportSelected,
  onClearSelection
}: BulkActionToolbarProps) {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const [noteText, setNoteText] = useState("");
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<"status" | "classification" | "billed_by" | "payment_received_by" | null>(null);
  const [pendingActionLabel, setPendingActionLabel] = useState<string | null>(null);
  const isApplying = !!pendingActionLabel;

  if (selectedCount === 0) return null;

  const handleApplyNote = async () => {
    if (!noteText.trim() || isApplying) return;
    setPendingActionLabel(isEnglish ? "Applying bulk note..." : "Aplicando nota masiva...");
    try {
      await onApplyAction("note", noteText);
      setNoteText("");
      setIsNoteOpen(false);
    } finally {
      setPendingActionLabel(null);
    }
  };

  const applyMenuAction = async (actionType: string, value: any) => {
    if (isApplying) return;
    setOpenMenu(null);
    setPendingActionLabel(isEnglish ? "Applying bulk update..." : "Aplicando actualización masiva...");
    try {
      await onApplyAction(actionType, value);
    } finally {
      setPendingActionLabel(null);
    }
  };

  return (
    <div className="fixed bottom-6 left-6 right-6 md:left-64 bg-dark-blue text-white p-4 rounded border border-secondary-blue shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 z-50 animate-bounce-subtle">
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-orange text-xs font-bold font-mono text-white">
          {selectedCount}
        </span>
        <div>
          <p className="text-sm font-bold uppercase tracking-wider">{isEnglish ? "Bulk Claim Actions" : "Acciones Masivas para Claims"}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-blue-200 font-medium">
            {isApplying && <Loader2 className="h-3 w-3 animate-spin" />}
            {pendingActionLabel || (isEnglish ? "Apply changes to all selected items" : "Aplica cambios a todos los elementos seleccionados")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Change Status Dropdown */}
        <div className="relative group">
          <button
            type="button"
            disabled={isApplying}
            onClick={() => setOpenMenu(openMenu === "status" ? null : "status")}
            aria-expanded={openMenu === "status"}
            className="bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-colors border border-slate-700 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          >
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            {isEnglish ? "Change Status" : "Cambiar Estado"}
          </button>
          <div className={`absolute bottom-full mb-1 right-0 bg-white text-slate-800 text-xs rounded shadow-xl border border-slate-200 p-1 w-44 ${openMenu === "status" ? "block" : "hidden"} group-hover:block z-50`}>
            <button onClick={() => applyMenuAction("status", ClaimStatus.Paid)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Paid</button>
            <button onClick={() => applyMenuAction("status", ClaimStatus.PartiallyPaid)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Partially Paid</button>
            <button onClick={() => applyMenuAction("status", ClaimStatus.Denied)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded text-rose-600 font-medium">Denied</button>
            <button onClick={() => applyMenuAction("status", ClaimStatus.Rejected)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded text-red-600 font-medium">Rejected</button>
            <button onClick={() => applyMenuAction("status", ClaimStatus.Pending)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Pending</button>
            <button onClick={() => applyMenuAction("status", ClaimStatus.BlockedByError)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded text-amber-600">Blocked by Error</button>
            <button onClick={() => applyMenuAction("status", ClaimStatus.ReadyToRebill)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Ready to Rebill</button>
            <button onClick={() => applyMenuAction("status", ClaimStatus.Closed)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Closed</button>
          </div>
        </div>

        {/* Change Classification */}
        <div className="relative group">
          <button
            type="button"
            disabled={isApplying}
            onClick={() => setOpenMenu(openMenu === "classification" ? null : "classification")}
            aria-expanded={openMenu === "classification"}
            className="bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-colors border border-slate-700 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          >
            <Tag className="w-3.5 h-3.5 text-sky-400" />
            {isEnglish ? "Classification" : "Clasificación"}
          </button>
          <div className={`absolute bottom-full mb-1 right-0 bg-white text-slate-800 text-xs rounded shadow-xl border border-slate-200 p-1 w-48 ${openMenu === "classification" ? "block" : "hidden"} group-hover:block max-h-60 overflow-y-auto z-50`}>
            <button onClick={() => applyMenuAction("classification", ClaimClassification.CleanClaim)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Clean Claim</button>
            <button onClick={() => applyMenuAction("classification", ClaimClassification.MissingPayment)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Missing Payment</button>
            <button onClick={() => applyMenuAction("classification", ClaimClassification.MissingERA)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Missing ERA</button>
            <button onClick={() => applyMenuAction("classification", ClaimClassification.PaymentMismatch)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Payment Mismatch</button>
            <button onClick={() => applyMenuAction("classification", ClaimClassification.SplitCollection)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Split Collection</button>
            <button onClick={() => applyMenuAction("classification", ClaimClassification.Underpaid)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Underpaid</button>
            <button onClick={() => applyMenuAction("classification", ClaimClassification.BillingError)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Billing Error</button>
            <button onClick={() => applyMenuAction("classification", ClaimClassification.CodingError)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Coding Error</button>
            <button onClick={() => applyMenuAction("classification", ClaimClassification.ReadyForResubmission)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Ready for Resubmission</button>
            <button onClick={() => applyMenuAction("classification", ClaimClassification.WriteOffCandidate)} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Write-off Candidate</button>
          </div>
        </div>

        {/* Change Billed By */}
        <div className="relative group">
          <button
            type="button"
            disabled={isApplying}
            onClick={() => setOpenMenu(openMenu === "billed_by" ? null : "billed_by")}
            aria-expanded={openMenu === "billed_by"}
            className="bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-colors border border-slate-700 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          >
            <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
            Billed By
          </button>
          <div className={`absolute bottom-full mb-1 right-0 bg-white text-slate-800 text-xs rounded shadow-xl border border-slate-200 p-1 w-32 ${openMenu === "billed_by" ? "block" : "hidden"} group-hover:block z-50`}>
            <button onClick={() => applyMenuAction("billed_by", "ITERA")} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">ITERA</button>
            <button onClick={() => applyMenuAction("billed_by", "Provider")} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Provider</button>
          </div>
        </div>

        {/* Change Payment Received By */}
        <div className="relative group">
          <button
            type="button"
            disabled={isApplying}
            onClick={() => setOpenMenu(openMenu === "payment_received_by" ? null : "payment_received_by")}
            aria-expanded={openMenu === "payment_received_by"}
            className="bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-colors border border-slate-700 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
            Received By
          </button>
          <div className={`absolute bottom-full mb-1 right-0 bg-white text-slate-800 text-xs rounded shadow-xl border border-slate-200 p-1 w-36 ${openMenu === "payment_received_by" ? "block" : "hidden"} group-hover:block z-50`}>
            <button onClick={() => applyMenuAction("payment_received_by", "ITERA")} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">ITERA</button>
            <button onClick={() => applyMenuAction("payment_received_by", "Provider")} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Provider</button>
            <button onClick={() => applyMenuAction("payment_received_by", "Split")} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Split</button>
            <button onClick={() => applyMenuAction("payment_received_by", "Unknown")} className="w-full text-left p-1.5 hover:bg-slate-100 rounded">Unknown</button>
          </div>
        </div>

        {/* Add Note Button */}
        <div className="relative">
          <button
            disabled={isApplying}
            onClick={() => setIsNoteOpen(!isNoteOpen)}
            className="bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-colors border border-slate-700 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          >
            <Clipboard className="w-3.5 h-3.5 text-purple-400" />
            {isEnglish ? "Add Note" : "Añadir Nota"}
          </button>
          {isNoteOpen && (
            <div className="absolute bottom-full mb-1 right-0 bg-slate-900 text-slate-100 p-3 rounded shadow-2xl border border-slate-700 w-72 z-50">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">{isEnglish ? "Bulk note:" : "Nota masiva:"}</label>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
                placeholder={isEnglish ? "Write the audit note..." : "Escribe la nota de auditoría..."}
                className="w-full p-2 bg-slate-800 border border-slate-700 rounded text-xs focus:outline-hidden focus:ring-1 focus:ring-primary-blue text-white"
              />
              <div className="flex justify-end gap-1.5 mt-2">
                <button disabled={isApplying} onClick={() => setIsNoteOpen(false)} className="px-2 py-1 text-[10px] hover:bg-slate-800 rounded cursor-pointer disabled:opacity-50 disabled:cursor-wait">{isEnglish ? "Cancel" : "Cancelar"}</button>
                <button disabled={isApplying} onClick={handleApplyNote} className="px-2.5 py-1 bg-primary-blue hover:bg-secondary-blue rounded text-[10px] flex items-center gap-1 font-bold text-white uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-wait">
                  {isApplying ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Send className="w-2.5 h-2.5" />}
                  {isApplying ? (isEnglish ? "Applying" : "Aplicando") : (isEnglish ? "Apply" : "Aplicar")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Export Button */}
        <button
          disabled={isApplying}
          onClick={onExportSelected}
          className="bg-primary-blue hover:bg-secondary-blue px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1 transition-all text-white border border-transparent shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-wait"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          {isEnglish ? "Export CSV" : "Exportar CSV"}
        </button>

        {/* Clear Selection */}
        <button
          disabled={isApplying}
          onClick={onClearSelection}
          className="text-slate-300 hover:text-white px-2 py-1.5 text-xs font-semibold font-mono cursor-pointer disabled:opacity-50 disabled:cursor-wait"
        >
          {isEnglish ? "Clear" : "Limpiar"} ({selectedCount})
        </button>
      </div>
    </div>
  );
}
