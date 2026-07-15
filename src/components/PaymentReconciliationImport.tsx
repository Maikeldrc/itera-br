import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, RefreshCw, Save, SlidersHorizontal, Upload, XCircle } from "lucide-react";
import { apiFetch } from "../apiClient";
import { useFeedback } from "./FeedbackProvider";
import { useLanguage } from "./LanguageProvider";

type ImportPayload = { rows?: Record<string, string>[]; fileName?: string; fileBase64?: string };

type PaymentImportMapping = Record<string, string>;

type PaymentImportSchema = {
  headers: string[];
  headersSignature: string;
  fieldLabels: Record<string, string>;
  requiredFields: string[];
  paymentFields: string[];
  autoMapping: PaymentImportMapping;
  mapping: PaymentImportMapping;
  requirements: {
    missingRequired: string[];
    missingPayment: boolean;
    valid: boolean;
  };
  templates: Array<{
    templateId: string;
    templateName: string;
    providerName: string;
    systemName: string;
    headersSignature: string;
    mapping: PaymentImportMapping;
    exactHeaderMatch: boolean;
  }>;
  selectedTemplateId: string;
  previewRows: Array<Record<string, unknown>>;
};

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

type ImportProgressState = {
  mode: "analyze" | "import";
  percent: number;
  label: string;
  steps: Array<{ label: string; status: "pending" | "running" | "done" }>;
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

const CORE_MAPPING_FIELDS = ["patientAcctNo", "patientName", "claimNo", "cptCode", "serviceDate", "payerName"];
const PAYMENT_MAPPING_FIELDS = ["payment", "payerPayment", "patientPayment", "paymentDate", "checkNo", "externalPaymentId"];
const FINANCIAL_MAPPING_FIELDS = ["allowedAmount", "contractualAdjustment", "coinsurance", "deductible", "copay", "balance", "responsibleParty"];

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

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

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
  const [schema, setSchema] = useState<PaymentImportSchema | null>(null);
  const [mapping, setMapping] = useState<PaymentImportMapping>({});
  const [mappingExpanded, setMappingExpanded] = useState(true);
  const [templateName, setTemplateName] = useState("");
  const [systemName, setSystemName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [isSchemaLoading, setIsSchemaLoading] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ImportProgressState | null>(null);
  const [payerChangeState, setPayerChangeState] = useState<Record<string, "applying" | "applied">>({});
  const [result, setResult] = useState<PaymentImportResult | null>(null);

  const reset = () => {
    setFileName("");
    setPayload(null);
    setSchema(null);
    setMapping({});
    setMappingExpanded(true);
    setTemplateName("");
    setSystemName("");
    setSelectedTemplateId("");
    setResult(null);
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const rowKey = (row: PaymentImportRow) => `${row.rowNumber}-${row.claimId}-${row.cptCode}-${row.reportPayerName || row.payerName}`;

  const mappingIssues = schema ? {
    missingRequired: (schema.requiredFields || []).filter(field => !mapping[field]),
    missingPayment: !(schema.paymentFields || []).some(field => mapping[field]),
    valid: (schema.requiredFields || []).every(field => Boolean(mapping[field])) && (schema.paymentFields || []).some(field => Boolean(mapping[field]))
  } : { missingRequired: [], missingPayment: true, valid: false };
  const selectedTemplate = schema?.templates?.find(template => template.templateId === selectedTemplateId) || null;

  const analyzeSchema = async (nextPayload: ImportPayload) => {
    setIsSchemaLoading(true);
    setSchema(null);
    setMapping({});
    setSelectedTemplateId("");
    try {
      const response = await apiFetch("/api/payment-reconciliation-import/analyze-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPayload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not analyze payment file columns.");
      setSchema(data);
      setMapping(data.mapping || {});
      const exactTemplate = data.templates?.find((template: PaymentImportSchema["templates"][number]) => template.templateId === data.selectedTemplateId);
      setTemplateName(exactTemplate?.templateName || "");
      setSystemName(exactTemplate?.systemName || "");
      setSelectedTemplateId(exactTemplate?.templateId || "");
      setMappingExpanded(!data.requirements?.valid);
      if (!data.requirements?.valid) {
        notify(
          isEnglish
            ? "Review the column mapping before analyzing this payment file."
            : "Revise el mapeo de columnas antes de analizar este archivo de pagos.",
          "warning"
        );
      }
    } catch (err: any) {
      notify(`${isEnglish ? "Column analysis error" : "Error analizando columnas"}: ${err.message}`, "error");
    } finally {
      setIsSchemaLoading(false);
    }
  };

  const processFile = (file: File) => {
    setFileName(file.name);
    setResult(null);
    setSchema(null);
    setMapping({});
    setSelectedTemplateId("");
    const reader = new FileReader();
    const lowerName = file.name.toLowerCase();
    const isExcel = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
    reader.onload = event => {
      const value = String(event.target?.result || "");
      const nextPayload = isExcel ? { fileName: file.name, fileBase64: value } : { rows: parseCsv(value), fileName: file.name };
      if (isExcel) {
        setPayload(nextPayload);
      } else {
        setPayload(nextPayload);
      }
      void analyzeSchema(nextPayload);
    };
    if (isExcel) reader.readAsDataURL(file);
    else reader.readAsText(file);
  };

  const saveMappingTemplate = async () => {
    if (!schema || !mappingIssues.valid) return;
    setIsSavingTemplate(true);
    try {
      const response = await apiFetch("/api/payment-reconciliation-import/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: templateName || `${fileName || "Payment report"} mapping`,
          systemName,
          headersSignature: schema.headersSignature,
          mapping
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save mapping template.");
      const savedTemplate = data.template ? {
        templateId: data.template.template_id,
        templateName: data.template.template_name,
        providerName: data.template.provider_name,
        systemName: data.template.system_name,
        headersSignature: data.template.headers_signature,
        mapping,
        exactHeaderMatch: data.template.headers_signature === schema.headersSignature
      } : null;
      if (savedTemplate) {
        setSchema(current => current ? {
          ...current,
          templates: [savedTemplate, ...(current.templates || []).filter(item => item.templateId !== savedTemplate.templateId)],
          selectedTemplateId: savedTemplate.templateId
        } : current);
        setSelectedTemplateId(savedTemplate.templateId);
        setTemplateName(savedTemplate.templateName);
        setSystemName(savedTemplate.systemName);
      }
      notify(isEnglish ? "Payment import mapping template saved." : "Plantilla de mapeo guardada.", "success");
    } catch (err: any) {
      notify(`${isEnglish ? "Template save error" : "Error guardando plantilla"}: ${err.message}`, "error");
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const submit = async (apply: boolean) => {
    if (!payload) {
      notify(isEnglish ? "Select a payment report first." : "Seleccione primero un reporte de pagos.", "warning");
      return;
    }
    if (schema && !mappingIssues.valid) {
      notify(
        isEnglish
          ? "Complete the required column mapping before continuing."
          : "Complete el mapeo de columnas requerido antes de continuar.",
        "warning"
      );
      setMappingExpanded(true);
      return;
    }
    const steps = apply
      ? [
          isEnglish ? "Preparing safe-match import" : "Preparando importación de matches seguros",
          isEnglish ? "Validating ready rows" : "Validando filas listas",
          isEnglish ? "Applying payments to CPT lines" : "Aplicando pagos a líneas CPT",
          isEnglish ? "Writing claims and payment records" : "Guardando claims y registros de pago",
          isEnglish ? "Refreshing reconciliation data" : "Actualizando datos de conciliación"
        ]
      : [
          isEnglish ? "Uploading file for analysis" : "Subiendo archivo para análisis",
          isEnglish ? "Matching claims and CPT lines" : "Buscando matches de claims y CPT",
          isEnglish ? "Classifying ready/review/rejected rows" : "Clasificando filas listas/revisión/rechazadas",
          isEnglish ? "Preparing result table" : "Preparando tabla de resultados"
        ];
    const setStep = (index: number, percent: number, label?: string) => {
      setProgress({
        mode: apply ? "import" : "analyze",
        percent,
        label: label || steps[index] || "",
        steps: steps.map((step, stepIndex) => ({
          label: step,
          status: stepIndex < index ? "done" : stepIndex === index ? "running" : "pending"
        }))
      });
    };
    setIsProcessing(true);
    setStep(0, apply ? 8 : 12);
    try {
      await wait(150);
      setStep(1, apply ? 24 : 36);
      const response = await apiFetch("/api/payment-reconciliation-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, apply, mapping: schema ? mapping : undefined })
      });
      setStep(apply ? 2 : 2, apply ? 52 : 70);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment import failed.");
      setStep(apply ? 3 : 3, apply ? 76 : 92);
      setResult(data);
      if (apply) {
        setStep(4, 90);
        await onImported();
        setProgress({
          mode: "import",
          percent: 100,
          label: isEnglish ? "Payment import completed." : "Importación de pagos completada.",
          steps: steps.map(step => ({ label: step, status: "done" }))
        });
        notify(
          isEnglish
            ? `Imported ${data.importedCount} payment row(s). ${data.summary.needsReviewRows} require review.`
            : `Importadas ${data.importedCount} fila(s) de pago. ${data.summary.needsReviewRows} requieren revisión.`,
          data.importedCount > 0 ? "success" : "warning"
        );
      } else {
        setProgress({
          mode: "analyze",
          percent: 100,
          label: isEnglish ? "Analysis completed." : "Análisis completado.",
          steps: steps.map(step => ({ label: step, status: "done" }))
        });
      }
      await wait(500);
    } catch (err: any) {
      setProgress(current => current ? {
        ...current,
        percent: 100,
        label: isEnglish ? "Process failed." : "El proceso falló."
      } : null);
      notify(`${isEnglish ? "Import error" : "Error de importación"}: ${err.message}`, "error");
      await wait(700);
    } finally {
      setIsProcessing(false);
      setProgress(null);
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
            {isEnglish ? "Payment Import" : "Importación de Pagos"}
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
            <h3 className="font-bold text-dark-blue">{isEnglish ? "Default payment report columns" : "Columnas estándar del reporte de pagos"}</h3>
            <p className="mt-1 text-xs leading-relaxed">
              {isEnglish
                ? "This format is recognized automatically, and other provider formats can be mapped below after selecting a file: "
                : "Este formato se reconoce automáticamente, y otros formatos de providers se pueden mapear debajo luego de seleccionar un archivo: "}
              {REQUIRED_COLUMNS.join(", ")}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800">{isEnglish ? "Matching Criteria" : "Criterios de Matching"}</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {[
            [
              isEnglish ? "Primary match" : "Match primario",
              isEnglish
                ? "Internal Claim No + CPT. If the external claim number does not match, the importer falls back to Patient Acct No + CPT + DOS/month."
                : "Claim No interno + CPT. Si el claim externo no coincide, usa Patient Acct No + CPT + DOS/mes."
            ],
            [
              isEnglish ? "Tie breakers" : "Desempate",
              isEnglish
                ? "When more than one claim matches, payer and rendering provider are used to narrow the candidate list."
                : "Si hay más de un claim, se usa payer y rendering provider para reducir candidatos."
            ],
            [
              isEnglish ? "Human review" : "Revisión humana",
              isEnglish
                ? "Rows with existing payment activity, payer mismatches, closed periods or ambiguous matches are not overwritten."
                : "Filas con pagos existentes, payer diferente, período cerrado o matches ambiguos no se sobreescriben."
            ]
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{body}</p>
            </div>
          ))}
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
          <p className="mt-3 text-sm font-bold text-slate-700">{fileName || (isEnglish ? "Drop CSV/XLS/XLSX payment report here" : "Arrastre aquí el reporte CSV/XLS/XLSX de pagos")}</p>
          <p className="mt-1 text-xs text-slate-500">{isEnglish ? "or select a local file" : "o seleccione un archivo local"}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
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

        {(isSchemaLoading || schema) && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <SlidersHorizontal className="mt-0.5 h-5 w-5 text-primary-blue" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{isEnglish ? "Column Mapping" : "Mapeo de columnas"}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {isEnglish
                      ? "Map the provider report headers to the fields required for claim/CPT matching and payment import."
                      : "Mapee las columnas del reporte del provider contra los campos requeridos para matching e importación de pagos."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isSchemaLoading && <RefreshCw className="h-4 w-4 animate-spin text-primary-blue" />}
                {schema && (
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${mappingIssues.valid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {mappingIssues.valid ? (isEnglish ? "Ready to analyze" : "Listo para analizar") : (isEnglish ? "Mapping required" : "Mapeo requerido")}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setMappingExpanded(current => !current)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  {mappingExpanded ? (isEnglish ? "Collapse" : "Contraer") : (isEnglish ? "Edit mapping" : "Editar mapeo")}
                </button>
              </div>
            </div>

            {schema && !mappingIssues.valid && (
              <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <AlertTriangle className="mr-2 inline h-4 w-4 align-text-bottom" />
                {isEnglish ? "Missing required mapping: " : "Falta mapeo requerido: "}
                {[...mappingIssues.missingRequired.map(field => schema.fieldLabels[field] || field), ...(mappingIssues.missingPayment ? [isEnglish ? "one payment amount source" : "una fuente de monto pagado"] : [])].join(", ")}
              </div>
            )}

            {schema && (
              <div className={`border-b px-4 py-3 text-xs ${selectedTemplate ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-slate-100 bg-slate-50 text-slate-600"}`}>
                {selectedTemplate ? (
                  <span>
                    <CheckCircle2 className="mr-2 inline h-4 w-4 align-text-bottom" />
                    {isEnglish ? "Using saved template: " : "Usando plantilla guardada: "}
                    <strong>{selectedTemplate.templateName}</strong>
                    {selectedTemplate.systemName ? ` (${selectedTemplate.systemName})` : ""}
                    {selectedTemplate.exactHeaderMatch ? (isEnglish ? " - exact column match." : " - match exacto de columnas.") : ""}
                  </span>
                ) : (
                  <span>
                    <FileSpreadsheet className="mr-2 inline h-4 w-4 align-text-bottom" />
                    {isEnglish
                      ? "No saved template matched these headers. The auto-detected mapping is being used until you save or select a template."
                      : "Ninguna plantilla guardada coincide con estos encabezados. Se usará el mapeo auto-detectado hasta que guarde o seleccione una plantilla."}
                  </span>
                )}
                <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {isEnglish ? "Stored in Google Sheets: Import_Mapping_Templates" : "Guardado en Google Sheets: Import_Mapping_Templates"}
                </span>
              </div>
            )}

            {schema && mappingExpanded && (
              <div className="space-y-4 p-4">
                {schema.templates?.length > 0 && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-dark-blue">{isEnglish ? "Saved templates" : "Plantillas guardadas"}</label>
                    <select
                      className="mt-2 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                      value={selectedTemplateId}
                      onChange={event => {
                        const template = schema.templates.find(item => item.templateId === event.target.value);
                        if (!template) {
                          setSelectedTemplateId("");
                          return;
                        }
                        setMapping(template.mapping || {});
                        setTemplateName(template.templateName || "");
                        setSystemName(template.systemName || "");
                        setSelectedTemplateId(template.templateId);
                      }}
                    >
                      <option value="">{isEnglish ? "Select a template..." : "Seleccione una plantilla..."}</option>
                      {schema.templates.map(template => (
                        <option key={template.templateId} value={template.templateId}>
                          {template.templateName}{template.systemName ? ` - ${template.systemName}` : ""}{template.exactHeaderMatch ? (isEnglish ? " (same headers)" : " (mismos headers)") : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {[
                  [isEnglish ? "Matching fields" : "Campos de matching", CORE_MAPPING_FIELDS],
                  [isEnglish ? "Payment fields" : "Campos de pago", PAYMENT_MAPPING_FIELDS],
                  [isEnglish ? "Optional financial details" : "Detalles financieros opcionales", FINANCIAL_MAPPING_FIELDS]
                ].map(([title, fields]) => (
                  <div key={String(title)}>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{String(title)}</h4>
                    <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {(fields as string[]).map(field => {
                        const required = schema.requiredFields.includes(field) || (field === "payment" && mappingIssues.missingPayment);
                        return (
                          <label key={field} className="block">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                              {schema.fieldLabels[field] || field}{required ? " *" : ""}
                            </span>
                            <select
                              className={`mt-1 w-full rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 ${required && !mapping[field] ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
                              value={mapping[field] || ""}
                              onChange={event => {
                                setSelectedTemplateId("");
                                setMapping(current => ({ ...current, [field]: event.target.value }));
                              }}
                            >
                              <option value="">{isEnglish ? "Not mapped" : "Sin mapear"}</option>
                              {schema.headers.map(header => (
                                <option key={header} value={header}>{header}</option>
                              ))}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{isEnglish ? "Save this mapping" : "Guardar este mapeo"}</h4>
                  <div className="mt-2 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <input
                      value={templateName}
                      onChange={event => setTemplateName(event.target.value)}
                      placeholder={isEnglish ? "Template name" : "Nombre de plantilla"}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                    />
                    <input
                      value={systemName}
                      onChange={event => setSystemName(event.target.value)}
                      placeholder={isEnglish ? "Provider system (optional)" : "Sistema del provider (opcional)"}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                    />
                    <button
                      type="button"
                      onClick={() => void saveMappingTemplate()}
                      disabled={!mappingIssues.valid || isSavingTemplate}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-dark-blue px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-secondary-blue disabled:opacity-50"
                    >
                      {isSavingTemplate ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {isEnglish ? "Save template" : "Guardar plantilla"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => void submit(false)}
            disabled={!payload || isProcessing || isSchemaLoading || (schema ? !mappingIssues.valid : false)}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {isProcessing && progress?.mode === "analyze" ? (isEnglish ? "Analyzing..." : "Analizando...") : (isEnglish ? "Analyze file" : "Analizar archivo")}
          </button>
          <button
            onClick={() => void submit(true)}
            disabled={!payload || isProcessing || isSchemaLoading || (schema ? !mappingIssues.valid : false) || !result || result.summary.readyToImport === 0}
            className="rounded-lg bg-primary-blue px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-dark-blue disabled:opacity-50"
          >
            {isProcessing && progress?.mode === "import" ? (isEnglish ? "Importing..." : "Importando...") : (isEnglish ? "Import safe matches" : "Importar coincidencias seguras")}
          </button>
        </div>

        {progress && (
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="mb-2 flex items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-bold text-dark-blue">
                  {progress.mode === "import"
                    ? (isEnglish ? "Import progress" : "Progreso de importación")
                    : (isEnglish ? "Analysis progress" : "Progreso de análisis")}
                </h4>
                <p className="mt-0.5 text-xs text-slate-600">{progress.label}</p>
              </div>
              <span className="font-mono text-xs font-bold text-primary-blue">{Math.round(progress.percent)}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-primary-blue transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
              />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              {progress.steps.map(step => (
                <div
                  key={step.label}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-bold ${
                    step.status === "done"
                      ? "border-emerald-100 bg-white text-emerald-700"
                      : step.status === "running"
                        ? "border-blue-200 bg-white text-dark-blue"
                        : "border-slate-100 bg-white/60 text-slate-400"
                  }`}
                >
                  {step.status === "done" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : step.status === "running" ? (
                    <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-200" />
                  )}
                  <span className="leading-tight">{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
              <h3 className="text-sm font-bold text-slate-800">{isEnglish ? "Payment Import Result" : "Resultado de importación de pagos"}</h3>
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
