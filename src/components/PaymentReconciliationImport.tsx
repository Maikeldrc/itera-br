import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, RefreshCw, Upload, XCircle } from "lucide-react";
import { apiFetch } from "../apiClient";
import { useFeedback } from "./FeedbackProvider";
import { useLanguage } from "./LanguageProvider";

type ImportPayload = { rows?: Record<string, string>[]; fileName?: string; fileBase64?: string };

type PaymentImportSummary = {
  totalRowsRead: number;
  readyToImport: number;
  importedRows: number;
  needsReviewRows: number;
  rejectedRows: number;
  matchedClaims: number;
  matchedCptCodes: number;
  totalPaymentInFile: number;
  totalPaymentImported: number;
};

type PaymentImportRow = {
  rowNumber: number;
  status: "ready" | "imported" | "needs_review" | "rejected";
  claimId: string;
  patientId: string;
  patientName: string;
  cptCode: string;
  serviceDate: string;
  paymentDate: string;
  payerName: string;
  claimPayerName?: string;
  reportPayerName?: string;
  payerMismatch?: boolean;
  suggestedPayerId?: string;
  suggestedPayerName?: string;
  payment: number;
  errors: string[];
  warnings: string[];
};

type PaymentImportResult = {
  applied: boolean;
  importedCount: number;
  updatedClaims: number;
  summary: PaymentImportSummary;
  rows: PaymentImportRow[];
};

interface PaymentReconciliationImportProps {
  onImported: () => Promise<void>;
}

const REQUIRED_COLUMNS = [
  "CPT Code",
  "Facility Name",
  "Facility POS",
  "Rendering Provider Name",
  "Patient Name",
  "Patient Acct No",
  "Payer Name",
  "Service Date",
  "Claim Date",
  "Payment Date",
  "Payment Check Date",
  "Payment Deposit Date",
  "Payment EOB Date",
  "Payment Posted Date",
  "Payment Check No",
  "Payment Type",
  "Payer Type",
  "Claim No",
  "CPT Group Name",
  "Payment ID",
  "Payment",
  "Payer Payment",
  "Patient Payment",
  "Contractual Adjustment",
  "Payer Withheld"
];

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      i += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current.trim());
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  row.push(current.trim());
  if (row.some(value => value !== "")) rows.push(row);

  const headers = rows[0] || [];
  return rows.slice(1).map(values => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header.trim()] = values[index] || "";
    });
    return record;
  });
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(value) ? value : 0);
}

function statusBadge(status: PaymentImportRow["status"], isEnglish: boolean) {
  const labels = {
    ready: isEnglish ? "Ready" : "Lista",
    imported: isEnglish ? "Imported" : "Importada",
    needs_review: isEnglish ? "Needs Review" : "Requiere revisión",
    rejected: isEnglish ? "Rejected" : "Rechazada"
  };
  const classes = {
    ready: "border-blue-100 bg-blue-50 text-blue-700",
    imported: "border-emerald-100 bg-emerald-50 text-emerald-700",
    needs_review: "border-amber-100 bg-amber-50 text-amber-700",
    rejected: "border-rose-100 bg-rose-50 text-rose-700"
  };
  return <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${classes[status]}`}>{labels[status]}</span>;
}

export function PaymentReconciliationImport({ onImported }: PaymentReconciliationImportProps) {
  const { notify } = useFeedback();
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [payload, setPayload] = useState<ImportPayload | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [payerChangeState, setPayerChangeState] = useState<Record<string, "applying" | "applied">>({});
  const [result, setResult] = useState<PaymentImportResult | null>(null);

  const reset = () => {
    setFileName("");
    setPayload(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const rowKey = (row: PaymentImportRow) => `${row.rowNumber}-${row.claimId}-${row.cptCode}-${row.reportPayerName || row.payerName}`;

  const processFile = (file: File) => {
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
    reader.onload = event => {
      const value = String(event.target?.result || "");
      if (isXlsx) {
        setPayload({ fileName: file.name, fileBase64: value });
      } else {
        setPayload({ rows: parseCsv(value) });
      }
    };
    if (isXlsx) reader.readAsDataURL(file);
    else reader.readAsText(file);
  };

  const submit = async (apply: boolean) => {
    if (!payload) {
      notify(isEnglish ? "Select a payment report first." : "Seleccione primero un reporte de pagos.", "warning");
      return;
    }
    setIsProcessing(true);
    try {
      const response = await apiFetch("/api/payment-reconciliation-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, apply })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment reconciliation import failed.");
      setResult(data);
      if (apply) {
        notify(
          isEnglish
            ? `Imported ${data.importedCount} payment row(s). ${data.summary.needsReviewRows} require review.`
            : `Importadas ${data.importedCount} fila(s) de pago. ${data.summary.needsReviewRows} requieren revisión.`,
          data.importedCount > 0 ? "success" : "warning"
        );
        await onImported();
      }
    } catch (err: any) {
      notify(`${isEnglish ? "Import error" : "Error de importación"}: ${err.message}`, "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const applyPayerChange = async (row: PaymentImportRow) => {
    if (!row.claimId || !(row.reportPayerName || row.suggestedPayerName)) return;
    const key = rowKey(row);
    setPayerChangeState(current => ({ ...current, [key]: "applying" }));
    try {
      const response = await apiFetch("/api/payment-reconciliation-import/apply-payer-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimId: row.claimId,
          reportPayerName: row.suggestedPayerName || row.reportPayerName
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to apply payer change.");

      setResult(current => {
        if (!current) return current;
        const rows = current.rows.map(item => {
          if (rowKey(item) !== key) return item;
          const newPayerName = data.newPayerName || item.suggestedPayerName || item.reportPayerName || item.payerName;
          const warnings = item.warnings.filter(warning => !warning.toLowerCase().startsWith("payer mismatch:"));
          const stillNeedsReview = warnings.some(warning => warning.toLowerCase().includes("already has payment activity"));
          return {
            ...item,
            payerName: newPayerName,
            claimPayerName: newPayerName,
            payerMismatch: false,
            status: item.status === "needs_review" && !stillNeedsReview && item.errors.length === 0 ? "ready" : item.status,
            warnings
          };
        });
        return {
          ...current,
          summary: {
            ...current.summary,
            readyToImport: rows.filter(item => item.status === "ready").length,
            needsReviewRows: rows.filter(item => item.status === "needs_review").length,
            rejectedRows: rows.filter(item => item.status === "rejected").length
          },
          rows
        };
      });
      setPayerChangeState(current => ({ ...current, [key]: "applied" }));
      notify(
        data.changed
          ? (isEnglish ? "Claim payer updated and audit trail recorded." : "Seguro del claim actualizado con trazabilidad registrada.")
          : (isEnglish ? "Claim payer already matches the report payer." : "El seguro del claim ya coincide con el payer del reporte."),
        "success"
      );
      await onImported();
    } catch (err: any) {
      setPayerChangeState(current => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      notify(`${isEnglish ? "Payer update error" : "Error actualizando seguro"}: ${err.message}`, "error");
    }
  };

  const summary = result?.summary;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 md:text-2xl">
            {isEnglish ? "Payment Reconciliation Import" : "Importación de Conciliación de Pagos"}
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            {isEnglish
              ? "Import payer payment reports, match them against pending claim/CPT lines, and automatically apply only safe matches. Existing payment activity is routed to human review."
              : "Importa reportes de pagos de payers, los cruza contra claims/CPT pendientes y aplica automáticamente solo coincidencias seguras. Los claims con pagos existentes pasan a revisión humana."}
          </p>
        </div>
        <button
          onClick={reset}
          disabled={isProcessing || (!fileName && !result)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" /> {isEnglish ? "New import" : "Nueva importación"}
        </button>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700">
        <div className="flex gap-3">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-primary-blue" />
          <div>
            <h3 className="font-bold text-dark-blue">{isEnglish ? "Expected report columns" : "Columnas esperadas del reporte"}</h3>
            <p className="mt-1 text-xs leading-relaxed">{REQUIRED_COLUMNS.join(", ")}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) processFile(file);
          }}
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center"
        >
          <Upload className="h-8 w-8 text-slate-400" />
          <p className="mt-3 text-sm font-bold text-slate-700">{fileName || (isEnglish ? "Drop CSV/XLSX payment report here" : "Arrastre aquí el reporte CSV/XLSX de pagos")}</p>
          <p className="mt-1 text-xs text-slate-500">{isEnglish ? "or select a local file" : "o seleccione un archivo local"}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) processFile(file);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="mt-4 rounded-lg bg-dark-blue px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-secondary-blue disabled:opacity-50"
          >
            {isEnglish ? "Choose file" : "Seleccionar archivo"}
          </button>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => void submit(false)}
            disabled={!payload || isProcessing}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {isProcessing ? (isEnglish ? "Processing..." : "Procesando...") : (isEnglish ? "Analyze file" : "Analizar archivo")}
          </button>
          <button
            onClick={() => void submit(true)}
            disabled={!payload || isProcessing || !result || result.summary.readyToImport === 0}
            className="rounded-lg bg-primary-blue px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-dark-blue disabled:opacity-50"
          >
            {isEnglish ? "Import safe matches" : "Importar coincidencias seguras"}
          </button>
        </div>
      </div>

      {summary && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            {[
              [isEnglish ? "Rows" : "Filas", summary.totalRowsRead],
              [isEnglish ? "Ready" : "Listas", summary.readyToImport],
              [isEnglish ? "Imported" : "Importadas", summary.importedRows],
              [isEnglish ? "Review" : "Revisión", summary.needsReviewRows],
              [isEnglish ? "Rejected" : "Rechazadas", summary.rejectedRows],
              [isEnglish ? "Claims" : "Claims", summary.matchedClaims],
              [isEnglish ? "CPT" : "CPT", summary.matchedCptCodes],
              [isEnglish ? "Imported $" : "$ importado", money(summary.totalPaymentImported)]
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="mt-1 font-mono text-base font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-bold text-slate-800">{isEnglish ? "Reconciliation Result" : "Resultado de conciliación"}</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {isEnglish
                  ? "Rows marked Ready can be imported. Needs Review rows were intentionally not overwritten."
                  : "Las filas Ready pueden importarse. Las filas en revisión no se sobreescriben."}
              </p>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-3 py-3">Row</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Claim</th>
                    <th className="px-3 py-3">Patient</th>
                    <th className="px-3 py-3">CPT</th>
                    <th className="px-3 py-3">DOS</th>
                    <th className="px-3 py-3">Payer</th>
                    <th className="px-3 py-3 text-right">Payment</th>
                    <th className="px-3 py-3">Issue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.rows.map(row => (
                    <tr key={`${row.rowNumber}-${row.claimId}-${row.cptCode}`} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-mono text-slate-500">{row.rowNumber}</td>
                      <td className="px-3 py-3">{statusBadge(row.status, isEnglish)}</td>
                      <td className="px-3 py-3 font-mono font-bold text-dark-blue">{row.claimId || "-"}</td>
                      <td className="px-3 py-3">
                        <p className="font-semibold text-slate-800">{row.patientName || "-"}</p>
                        <p className="font-mono text-[10px] text-slate-400">{row.patientId || "-"}</p>
                      </td>
                      <td className="px-3 py-3 font-mono font-bold">{row.cptCode || "-"}</td>
                      <td className="px-3 py-3 font-mono text-slate-500">{row.serviceDate || "-"}</td>
                      <td className="px-3 py-3">
                        {row.payerMismatch ? (
                          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">{isEnglish ? "Payer mismatch" : "Payer diferente"}</p>
                              <p className="text-[11px] text-slate-700">
                                <span className="font-bold">{isEnglish ? "Claim" : "Claim"}:</span> {row.claimPayerName || "-"}
                              </p>
                              <p className="text-[11px] text-slate-700">
                                <span className="font-bold">{isEnglish ? "Report" : "Reporte"}:</span> {row.reportPayerName || row.suggestedPayerName || "-"}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void applyPayerChange(row)}
                              disabled={payerChangeState[rowKey(row)] === "applying"}
                              className="inline-flex items-center gap-1 rounded-md bg-dark-blue px-2 py-1 text-[10px] font-bold text-white shadow-sm hover:bg-secondary-blue disabled:opacity-50"
                            >
                              {payerChangeState[rowKey(row)] === "applying"
                                ? (isEnglish ? "Applying..." : "Aplicando...")
                                : (isEnglish ? "Apply report payer" : "Aplicar payer del reporte")}
                            </button>
                          </div>
                        ) : (
                          <div>
                            <p>{row.payerName || "-"}</p>
                            {payerChangeState[rowKey(row)] === "applied" && (
                              <p className="mt-1 text-[10px] font-bold text-emerald-700">{isEnglish ? "Payer updated" : "Seguro actualizado"}</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-emerald-700">{money(Number(row.payment || 0))}</td>
                      <td className="max-w-sm px-3 py-3">
                        {row.errors.length > 0 ? (
                          <p className="flex items-start gap-1 text-rose-700"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {row.errors.join("; ")}</p>
                        ) : row.warnings.length > 0 ? (
                          <p className="flex items-start gap-1 text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {row.warnings.join("; ")}</p>
                        ) : (
                          <p className="flex items-start gap-1 text-emerald-700"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {isEnglish ? "Safe match" : "Coincidencia segura"}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
