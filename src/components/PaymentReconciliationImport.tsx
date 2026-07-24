import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FileDown, FileSpreadsheet, RefreshCw, Save, SlidersHorizontal, Upload, XCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { apiFetch } from "../apiClient";
import { Payer } from "../types";
import { useFeedback } from "./FeedbackProvider";
import { useLanguage } from "./LanguageProvider";
import { MultiSelectFilter } from "./MultiSelectFilter";
import { PayerCombobox } from "./PayerCombobox";
import { decodeMultiFilter, multiFilterIntersects, multiFilterMatches } from "../multiSelectFilters";
import { formatDosDate } from "../dateFormatting";

type PaymentImportBillingOwner = "Unknown" | "ITERA" | "Provider";
type ImportPayload = { rows?: Record<string, string>[]; fileName?: string; fileBase64?: string; retryRows?: number[] };

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
  paymentActivityRows?: number;
  rejectedRows: number;
  matchedClaims: number;
  matchedCptCodes: number;
  totalPaymentInFile: number;
  totalPaymentImported: number;
};

type PaymentImportRow = {
  rowNumber: number;
  status: "ready" | "imported" | "needs_review" | "payment_activity" | "rejected";
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
  payerAssociationAccepted?: boolean;
  suggestedPayerId?: string;
  suggestedPayerName?: string;
  payment: number;
  errors: string[];
  warnings: string[];
};

type AcceptedPayerAssociation = {
  rowNumber: number;
  claimId: string;
  cptCode: string;
  serviceDate: string;
  reportPayerName: string;
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
  canApply?: boolean;
  payers: Payer[];
}

type PersistedPaymentImportAnalysis = {
  savedAt: string;
  fileName: string;
  payload: ImportPayload | null;
  schema: PaymentImportSchema | null;
  mapping: PaymentImportMapping;
  mappingExpanded: boolean;
  templateName: string;
  systemName: string;
  selectedTemplateId: string;
  acceptedPayerAssociations: Record<string, AcceptedPayerAssociation>;
  selectedMismatchPayers: Record<string, string>;
  importBilledBy: PaymentImportBillingOwner;
  result: PaymentImportResult;
  resultSearch: string;
  resultStatusFilter: string;
  resultIssueFilter: string;
  resultSort: { field: string; direction: "asc" | "desc" };
};

export const PAYMENT_IMPORT_ANALYSIS_SESSION_KEY = "itera.paymentImport.lastAnalysis.v1";

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

function summarizePaymentImportRows(rows: PaymentImportRow[], applied: boolean): PaymentImportSummary {
  return {
    totalRowsRead: rows.length,
    readyToImport: rows.filter(row => row.status === "ready").length,
    importedRows: applied ? rows.filter(row => row.status === "imported").length : 0,
    needsReviewRows: rows.filter(row => row.status === "needs_review").length,
    paymentActivityRows: rows.filter(row => row.status === "payment_activity").length,
    rejectedRows: rows.filter(row => row.status === "rejected").length,
    matchedClaims: new Set(rows.map(row => row.claimId).filter(Boolean)).size,
    matchedCptCodes: new Set(rows.map(row => row.cptCode).filter(Boolean)).size,
    totalPaymentInFile: Number(rows.reduce((sum, row) => sum + Number(row.payment || 0), 0).toFixed(2)),
    totalPaymentImported: Number(rows.filter(row => row.status === "imported").reduce((sum, row) => sum + Number(row.payment || 0), 0).toFixed(2))
  };
}

const SCHEMA_ANALYSIS_TIMEOUT_MS = 45_000;
const TEMPLATE_SAVE_TIMEOUT_MS = 45_000;
const PAYMENT_ANALYSIS_TIMEOUT_MS = 180_000;
const PAYMENT_IMPORT_TIMEOUT_MS = 180_000;
const REQUEST_ABORTED_MESSAGE = "__itera_request_aborted__";

function requestTimeoutError(message: string) {
  return new Error(message);
}

function statusBadge(status: PaymentImportRow["status"], isEnglish: boolean) {
  const labels = {
    ready: isEnglish ? "Ready" : "Lista",
    imported: isEnglish ? "Imported" : "Importada",
    needs_review: isEnglish ? "Needs Review" : "Requiere revisión",
    payment_activity: isEnglish ? "Payment Activity" : "Actividad de pago",
    rejected: isEnglish ? "Rejected" : "Rechazada"
  };
  const classes = {
    ready: "border-blue-100 bg-blue-50 text-blue-700",
    imported: "border-emerald-100 bg-emerald-50 text-emerald-700",
    needs_review: "border-amber-100 bg-amber-50 text-amber-700",
    payment_activity: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rejected: "border-rose-100 bg-rose-50 text-rose-700"
  };
  return <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${classes[status]}`}>{labels[status]}</span>;
}

function hasLegacyGenericMatchWarning(row: PaymentImportRow) {
  const text = [...(row.errors || []), ...(row.warnings || [])].join(" ");
  return (
    text.includes("Payment date is missing; today's date will be used if imported.") ||
    text.includes("External Claim No did not match the internal claim ID; matched by Patient Acct No, CPT and DOS instead.") ||
    text.includes("Multiple matching claims found; requires human review.")
  );
}

export function PaymentReconciliationImport({ onImported, canApply = true, payers }: PaymentReconciliationImportProps) {
  const { notify } = useFeedback();
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const schemaRequestRef = useRef<AbortController | null>(null);
  const templateRequestRef = useRef<AbortController | null>(null);
  const processRequestRef = useRef<AbortController | null>(null);
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
  const [acceptedPayerAssociations, setAcceptedPayerAssociations] = useState<Record<string, AcceptedPayerAssociation>>({});
  const [selectedMismatchPayers, setSelectedMismatchPayers] = useState<Record<string, string>>({});
  const [importBilledBy, setImportBilledBy] = useState<PaymentImportBillingOwner>("Unknown");
  const [recheckingRow, setRecheckingRow] = useState<number | null>(null);
  const [isRefreshingSavedAnalysis, setIsRefreshingSavedAnalysis] = useState(false);
  const [result, setResult] = useState<PaymentImportResult | null>(null);
  const [resultSearch, setResultSearch] = useState("");
  const [resultStatusFilter, setResultStatusFilter] = useState("all");
  const [resultIssueFilter, setResultIssueFilter] = useState("all");
  const [resultSort, setResultSort] = useState<{ field: string; direction: "asc" | "desc" }>({ field: "row", direction: "asc" });
  const [restoredFromSavedAnalysis, setRestoredFromSavedAnalysis] = useState(false);
  const persistWarningShownRef = useRef(false);
  const legacyRefreshAttemptedRef = useRef(false);

  const abortRequests = () => {
    schemaRequestRef.current?.abort();
    templateRequestRef.current?.abort();
    processRequestRef.current?.abort();
    schemaRequestRef.current = null;
    templateRequestRef.current = null;
    processRequestRef.current = null;
  };

  useEffect(() => () => abortRequests(), []);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(PAYMENT_IMPORT_ANALYSIS_SESSION_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as PersistedPaymentImportAnalysis;
      if (!saved?.result?.rows) return;
      setFileName(saved.fileName || "");
      setPayload(saved.payload || null);
      setSchema(saved.schema || null);
      setMapping(saved.mapping || {});
      setMappingExpanded(saved.mappingExpanded ?? false);
      setTemplateName(saved.templateName || "");
      setSystemName(saved.systemName || "");
      setSelectedTemplateId(saved.selectedTemplateId || "");
      setAcceptedPayerAssociations(saved.acceptedPayerAssociations || {});
      setSelectedMismatchPayers(saved.selectedMismatchPayers || {});
      setImportBilledBy(saved.importBilledBy || "Unknown");
      setResult(saved.result);
      setResultSearch(saved.resultSearch || "");
      setResultStatusFilter(saved.resultStatusFilter || "all");
      setResultIssueFilter(saved.resultIssueFilter || "all");
      setResultSort(saved.resultSort || { field: "row", direction: "asc" });
      setRestoredFromSavedAnalysis(true);
      notify(
        isEnglish
          ? "Last payment analysis restored. You can continue importing safe matches or start a new import."
          : "Se restauró el último análisis de pagos. Puede continuar importando matches seguros o iniciar una nueva importación.",
        "info"
      );
    } catch {
      window.sessionStorage.removeItem(PAYMENT_IMPORT_ANALYSIS_SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    if (!result) return;
    try {
      const snapshot: PersistedPaymentImportAnalysis = {
        savedAt: new Date().toISOString(),
        fileName,
        payload,
        schema,
        mapping,
        mappingExpanded,
        templateName,
        systemName,
        selectedTemplateId,
        acceptedPayerAssociations,
        selectedMismatchPayers,
        importBilledBy,
        result,
        resultSearch,
        resultStatusFilter,
        resultIssueFilter,
        resultSort
      };
      window.sessionStorage.setItem(PAYMENT_IMPORT_ANALYSIS_SESSION_KEY, JSON.stringify(snapshot));
    } catch {
      if (!persistWarningShownRef.current) {
        persistWarningShownRef.current = true;
        notify(
          isEnglish
            ? "This analysis is too large to keep after leaving the page. Export or import before navigating away."
            : "Este análisis es demasiado grande para conservarlo al salir de la página. Exporte o importe antes de navegar.",
          "warning"
        );
      }
    }
  }, [
    result,
    fileName,
    payload,
    schema,
    mapping,
    mappingExpanded,
    templateName,
    systemName,
    selectedTemplateId,
    acceptedPayerAssociations,
    selectedMismatchPayers,
    importBilledBy,
    resultSearch,
    resultStatusFilter,
    resultIssueFilter,
    resultSort,
    isEnglish,
    notify
  ]);

  const fetchWithTimeout = async (
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs: number,
    timeoutMessage: string,
    requestRef: React.MutableRefObject<AbortController | null>
  ) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      return await apiFetch(input, { ...init, signal: controller.signal });
    } catch (err: any) {
      if (controller.signal.aborted) {
        if (timedOut) throw requestTimeoutError(timeoutMessage);
        throw requestTimeoutError(REQUEST_ABORTED_MESSAGE);
      }
      throw err;
    } finally {
      window.clearTimeout(timeoutId);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const reset = () => {
    abortRequests();
    window.sessionStorage.removeItem(PAYMENT_IMPORT_ANALYSIS_SESSION_KEY);
    setFileName("");
    setPayload(null);
    setSchema(null);
    setMapping({});
    setMappingExpanded(true);
    setTemplateName("");
    setSystemName("");
    setSelectedTemplateId("");
    setResult(null);
    setAcceptedPayerAssociations({});
    setSelectedMismatchPayers({});
    setImportBilledBy("Unknown");
    setResultSearch("");
    setResultStatusFilter("all");
    setResultIssueFilter("all");
    setProgress(null);
    setRecheckingRow(null);
    setRestoredFromSavedAnalysis(false);
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
      const response = await fetchWithTimeout(
        "/api/payment-reconciliation-import/analyze-schema",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextPayload)
        },
        SCHEMA_ANALYSIS_TIMEOUT_MS,
        isEnglish
          ? "Column analysis is taking too long. Try again, or reduce the workbook to the payment sheet before importing."
          : "El análisis de columnas está tardando demasiado. Intente nuevamente o deje solo la hoja de pagos antes de importar.",
        schemaRequestRef
      );
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
      if (err.message === REQUEST_ABORTED_MESSAGE) return;
      notify(`${isEnglish ? "Column analysis error" : "Error analizando columnas"}: ${err.message}`, "error");
    } finally {
      setIsSchemaLoading(false);
    }
  };

  const processFile = (file: File) => {
    window.sessionStorage.removeItem(PAYMENT_IMPORT_ANALYSIS_SESSION_KEY);
    setRestoredFromSavedAnalysis(false);
    setFileName(file.name);
    setResult(null);
    setAcceptedPayerAssociations({});
    setSelectedMismatchPayers({});
    setImportBilledBy("Unknown");
    setResultSearch("");
    setResultStatusFilter("all");
    setResultIssueFilter("all");
    setRecheckingRow(null);
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
      const response = await fetchWithTimeout(
        "/api/payment-reconciliation-import/templates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateName: templateName || `${fileName || "Payment report"} mapping`,
            systemName,
            headersSignature: schema.headersSignature,
            mapping
          })
        },
        TEMPLATE_SAVE_TIMEOUT_MS,
        isEnglish
          ? "Template save is taking too long. Please try again."
          : "Guardar la plantilla está tardando demasiado. Intente nuevamente.",
        templateRequestRef
      );
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
      if (err.message === REQUEST_ABORTED_MESSAGE) return;
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
      const response = await fetchWithTimeout(
        "/api/payment-reconciliation-import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            apply,
            mapping: schema ? mapping : undefined,
            importBilledBy,
            acceptedPayerAssociations: Object.values(acceptedPayerAssociations)
          })
        },
        apply ? PAYMENT_IMPORT_TIMEOUT_MS : PAYMENT_ANALYSIS_TIMEOUT_MS,
        apply
          ? (isEnglish
            ? "Payment import is taking too long. No confirmation was received; refresh before retrying to avoid duplicate work."
            : "La importación de pagos está tardando demasiado. No se recibió confirmación; refresque antes de reintentar para evitar duplicados.")
          : (isEnglish
            ? "Payment analysis is taking too long. Try again with a smaller file or saved mapping template."
            : "El análisis de pagos está tardando demasiado. Intente nuevamente con un archivo más pequeño o una plantilla guardada."),
        processRequestRef
      );
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
            ? `Imported ${data.importedCount} payment row(s). ${(data.summary.needsReviewRows || 0) + (data.summary.paymentActivityRows || 0)} require review.`
            : `Importadas ${data.importedCount} fila(s) de pago. ${(data.summary.needsReviewRows || 0) + (data.summary.paymentActivityRows || 0)} requieren revisión.`,
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
      if (err.message === REQUEST_ABORTED_MESSAGE) return;
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

  const recheckRows = async (rowNumbers: number[]) => {
    const targetRows = Array.from(new Set(rowNumbers.map(row => Number(row)).filter(row => Number.isFinite(row) && row > 0)));
    if (!payload || targetRows.length === 0) return [] as PaymentImportRow[];
    if (schema && !mappingIssues.valid) {
      notify(
        isEnglish
          ? "Complete the required column mapping before rechecking this row."
          : "Complete el mapeo de columnas requerido antes de rechequear esta fila.",
        "warning"
      );
      setMappingExpanded(true);
      return [] as PaymentImportRow[];
    }

    const response = await fetchWithTimeout(
      "/api/payment-reconciliation-import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          apply: false,
          retryRows: targetRows,
          mapping: schema ? mapping : undefined,
          importBilledBy,
          acceptedPayerAssociations: Object.values(acceptedPayerAssociations)
        })
      },
      PAYMENT_ANALYSIS_TIMEOUT_MS,
      isEnglish
        ? "The row recheck is taking too long. Try again after refreshing the payment analysis."
        : "El rechequeo de la fila está tardando demasiado. Intente nuevamente después de refrescar el análisis.",
      processRequestRef
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Row recheck failed.");
    const checkedRows = (data.rows || []) as PaymentImportRow[];
    if (checkedRows.length === 0) throw new Error("The selected row was not returned by the recheck.");
    const checkedByRow = new Map(checkedRows.map(item => [Number(item.rowNumber), item] as const));
    setResult(current => {
      if (!current) return current;
      const rows = current.rows.map(item => checkedByRow.get(Number(item.rowNumber)) || item);
      return {
        ...current,
        applied: false,
        summary: summarizePaymentImportRows(rows, false),
        rows
      };
    });
    return checkedRows;
  };

  const recheckRow = async (row: PaymentImportRow) => {
    if (!payload || isProcessing || recheckingRow !== null || isRefreshingSavedAnalysis) return;
    setRecheckingRow(row.rowNumber);
    try {
      const checkedRows = await recheckRows([row.rowNumber]);
      const checkedRow = checkedRows.find(item => Number(item.rowNumber) === Number(row.rowNumber));
      if (!checkedRow) return;
      setResult(current => {
        if (!current) return current;
        const rows = current.rows.map(item => Number(item.rowNumber) === Number(row.rowNumber) ? checkedRow : item);
        return {
          ...current,
          applied: false,
          summary: summarizePaymentImportRows(rows, false),
          rows
        };
      });
      notify(
        checkedRow.status === "ready"
          ? (isEnglish ? `Row ${row.rowNumber} is now ready to import.` : `La fila ${row.rowNumber} ya está lista para importar.`)
          : (isEnglish ? `Row ${row.rowNumber} was rechecked and remains ${checkedRow.status.replace("_", " ")}.` : `La fila ${row.rowNumber} fue rechequeada y permanece en ${checkedRow.status.replace("_", " ")}.`),
        checkedRow.status === "ready" ? "success" : "warning"
      );
    } catch (err: any) {
      if (err.message !== REQUEST_ABORTED_MESSAGE) {
        notify(`${isEnglish ? "Row recheck error" : "Error rechequeando fila"}: ${err.message}`, "error");
      }
    } finally {
      setRecheckingRow(null);
    }
  };

  useEffect(() => {
    if (!restoredFromSavedAnalysis || legacyRefreshAttemptedRef.current || !result || !payload || isProcessing) return;
    const legacyRows = result.rows
      .filter(row => !result.applied && hasLegacyGenericMatchWarning(row))
      .map(row => row.rowNumber);
    if (legacyRows.length === 0) return;

    legacyRefreshAttemptedRef.current = true;
    setIsRefreshingSavedAnalysis(true);
    void recheckRows(legacyRows)
      .then(() => {
        notify(
          isEnglish
            ? `Refreshed ${legacyRows.length} saved analysis row(s) with detailed match information.`
            : `Se refrescaron ${legacyRows.length} fila(s) del análisis guardado con detalles del match.`,
          "info"
        );
      })
      .catch((err: any) => {
        if (err.message !== REQUEST_ABORTED_MESSAGE) {
          notify(
            isEnglish
              ? "Could not refresh the saved analysis details. Click Recheck row on any generic warning."
              : "No se pudieron refrescar los detalles del análisis guardado. Use Rechequear fila en cualquier warning genérico.",
            "warning"
          );
        }
      })
      .finally(() => setIsRefreshingSavedAnalysis(false));
  }, [restoredFromSavedAnalysis, result, payload, isProcessing]);

  const applyPayerChange = async (row: PaymentImportRow, payerId?: string) => {
    const selectedPayerId = payerId || row.suggestedPayerId || "";
    const selectedPayerName = payers.find(payer => payer.payer_id === selectedPayerId)?.payer_name || row.suggestedPayerName || "";
    if (!row.claimId || !selectedPayerId) {
      notify(
        isEnglish
          ? "Select a registered platform payer before changing claim insurance."
          : "Seleccione un payer registrado en la plataforma antes de cambiar el seguro del claim.",
        "warning"
      );
      return;
    }
    const key = rowKey(row);
    setPayerChangeState(current => ({ ...current, [key]: "applying" }));
    try {
      const response = await apiFetch("/api/payment-reconciliation-import/apply-payer-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimId: row.claimId,
          payerId: selectedPayerId,
          payerName: selectedPayerName,
          reportPayerName: row.reportPayerName || row.suggestedPayerName || ""
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to apply payer change.");

      setResult(current => {
        if (!current) return current;
        const rows = current.rows.map(item => {
          if (rowKey(item) !== key) return item;
          const newPayerId = data.newPayerId || selectedPayerId;
          const newPayerName = data.newPayerName || selectedPayerName || item.suggestedPayerName || item.payerName;
          const warnings = item.warnings.filter(warning => !warning.toLowerCase().startsWith("payer mismatch:"));
          const stillNeedsReview = warnings.some(warning => warning.toLowerCase().includes("already has payment activity"));
          return {
            ...item,
            suggestedPayerId: newPayerId,
            suggestedPayerName: newPayerName,
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
            paymentActivityRows: rows.filter(item => item.status === "payment_activity").length,
            rejectedRows: rows.filter(item => item.status === "rejected").length
          },
          rows
        };
      });
      setSelectedMismatchPayers(current => {
        const next = { ...current };
        delete next[key];
        return next;
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

  const associateReportPayer = (row: PaymentImportRow) => {
    if (!row.claimId || !row.reportPayerName) return;
    const key = rowKey(row);
    setAcceptedPayerAssociations(current => ({
      ...current,
      [key]: {
        rowNumber: row.rowNumber,
        claimId: row.claimId,
        cptCode: row.cptCode,
        serviceDate: row.serviceDate,
        reportPayerName: row.reportPayerName || ""
      }
    }));
    setResult(current => {
      if (!current) return current;
      const rows = current.rows.map(item => {
        if (rowKey(item) !== key) return item;
        const warnings = item.warnings.filter(warning => !warning.toLowerCase().startsWith("payer mismatch:"));
        const stillNeedsReview = warnings.some(warning => warning.toLowerCase().includes("already has payment activity"));
        return {
          ...item,
          payerMismatch: false,
          payerAssociationAccepted: true,
          status: item.status === "needs_review" && !stillNeedsReview && item.errors.length === 0 ? "ready" : item.status,
          warnings: [
            ...warnings,
            `Report payer "${item.reportPayerName}" associated to current claim payer "${item.claimPayerName || item.payerName}". Claim insurance will not be changed.`
          ]
        };
      });
      return {
        ...current,
        summary: {
          ...current.summary,
          readyToImport: rows.filter(item => item.status === "ready").length,
          needsReviewRows: rows.filter(item => item.status === "needs_review").length,
          paymentActivityRows: rows.filter(item => item.status === "payment_activity").length,
          rejectedRows: rows.filter(item => item.status === "rejected").length
        },
        rows
      };
    });
    notify(
      isEnglish
        ? "Report payer associated to the current claim insurance for this import."
        : "Payer del reporte asociado al seguro actual del claim para esta importación.",
      "success"
    );
  };

  const summary = result?.summary;
  const resultRows = result?.rows || [];
  const normalizedResultSearch = resultSearch.trim().toLowerCase();
  const filteredResultRows = resultRows.filter(row => {
    if (!multiFilterMatches(row.status, resultStatusFilter === "all" ? "" : resultStatusFilter)) return false;
    const selectedIssues = decodeMultiFilter(resultIssueFilter === "all" ? "" : resultIssueFilter);
    if (selectedIssues.length > 0) {
      const rowIssues = [
        row.errors.length > 0 ? "errors" : "",
        row.warnings.length > 0 ? "warnings" : "",
        row.payerMismatch ? "payer_mismatch" : "",
        row.status === "payment_activity" ? "payment_activity" : "",
        row.errors.length === 0 && row.warnings.length === 0 ? "safe_match" : ""
      ].filter(Boolean);
      if (!multiFilterIntersects(rowIssues, selectedIssues)) return false;
    }
    if (!normalizedResultSearch) return true;
    return [
      row.rowNumber,
      row.claimId,
      row.patientId,
      row.patientName,
      row.cptCode,
      row.serviceDate,
      row.payerName,
      row.claimPayerName,
      row.reportPayerName,
      row.payment,
      ...row.errors,
      ...row.warnings
    ]
      .map(value => String(value || "").toLowerCase())
      .some(value => value.includes(normalizedResultSearch));
  });
  const sortedResultRows = [...filteredResultRows].sort((a, b) => {
    const valueFor = (row: PaymentImportRow) => {
      if (resultSort.field === "row") return row.rowNumber;
      if (resultSort.field === "status") return row.status;
      if (resultSort.field === "claim") return row.claimId;
      if (resultSort.field === "patient") return `${row.patientName} ${row.patientId}`;
      if (resultSort.field === "cpt") return row.cptCode;
      if (resultSort.field === "dos") return row.serviceDate;
      if (resultSort.field === "payer") return row.reportPayerName || row.payerName;
      if (resultSort.field === "payment") return row.payment;
      if (resultSort.field === "issue") return [...row.errors, ...row.warnings].join(" ");
      return row.rowNumber;
    };
    const aValue = valueFor(a);
    const bValue = valueFor(b);
    const result = typeof aValue === "number" && typeof bValue === "number"
      ? aValue - bValue
      : String(aValue || "").localeCompare(String(bValue || ""), undefined, { numeric: true, sensitivity: "base" });
    return resultSort.direction === "asc" ? result : -result;
  });
  const exportPaymentImportRowsToExcel = () => {
    if (sortedResultRows.length === 0) {
      notify(
        isEnglish ? "There are no payment import rows to export." : "No hay filas de importación de pagos para exportar.",
        "warning"
      );
      return;
    }
    const statusLabel = (status: PaymentImportRow["status"]) => STATUS_TEXT[status]?.(isEnglish) || status;
    const worksheetRows = sortedResultRows.map(row => ({
      Row: row.rowNumber,
      Status: statusLabel(row.status),
      Claim: row.claimId || "",
      "Patient ID": row.patientId || "",
      Patient: row.patientName || "",
      CPT: row.cptCode || "",
      DOS: formatDosDate(row.serviceDate),
      "Payment Date": formatDosDate(row.paymentDate),
      "Claim Payer": row.claimPayerName || "",
      "Report Payer": row.reportPayerName || row.payerName || "",
      "Displayed Payer": row.payerName || "",
      "Payer Mismatch": row.payerMismatch ? "Yes" : "No",
      "Payer Association Accepted": row.payerAssociationAccepted ? "Yes" : "No",
      "Suggested Payer ID": row.suggestedPayerId || "",
      "Suggested Payer": row.suggestedPayerName || "",
      Payment: Number(row.payment || 0),
      Errors: row.errors.join("; "),
      Warnings: row.warnings.join("; ")
    }));
    const worksheet = XLSX.utils.json_to_sheet(worksheetRows);
    worksheet["!cols"] = [
      { wch: 8 }, { wch: 18 }, { wch: 28 }, { wch: 16 }, { wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
      { wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 16 }, { wch: 24 }, { wch: 18 }, { wch: 28 }, { wch: 12 },
      { wch: 60 }, { wch: 60 }
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Payment Import");
    const statusSuffix = resultStatusFilter === "all" ? "all" : decodeMultiFilter(resultStatusFilter).join("-");
    const safeFileName = (fileName || "payment-import").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 80);
    XLSX.writeFile(workbook, `ITERA_Payment_Import_${safeFileName}_${statusSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const sortableResultHeader = (label: React.ReactNode, field: string, className = "px-3 py-3") => (
    <th
      className={`${className} cursor-pointer select-none hover:bg-slate-100`}
      onClick={() => setResultSort(current => ({ field, direction: current.field === field && current.direction === "asc" ? "desc" : "asc" }))}
      title={isEnglish ? "Sort column" : "Ordenar columna"}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {resultSort.field === field && (resultSort.direction === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );
  const hasResultFilters = Boolean(normalizedResultSearch || resultStatusFilter !== "all" || resultIssueFilter !== "all");
  const clearResultFilters = () => {
    setResultSearch("");
    setResultStatusFilter("all");
    setResultIssueFilter("all");
  };
  const applyResultStatusFilter = (status: string) => {
    setResultSearch("");
    setResultIssueFilter("all");
    setResultStatusFilter(status);
  };
  const summaryCards = summary ? [
    { key: "rows", label: isEnglish ? "Rows" : "Filas", value: summary.totalRowsRead, status: "all" },
    { key: "ready", label: isEnglish ? "Ready" : "Listas", value: summary.readyToImport, status: "ready" },
    { key: "imported", label: isEnglish ? "Imported" : "Importadas", value: summary.importedRows, status: "imported" },
    { key: "review", label: isEnglish ? "Review" : "Revisión", value: summary.needsReviewRows, status: "needs_review" },
    { key: "paymentActivity", label: isEnglish ? "Payment Activity" : "Actividad de pago", value: summary.paymentActivityRows || 0, status: "payment_activity" },
    { key: "rejected", label: isEnglish ? "Rejected" : "Rechazadas", value: summary.rejectedRows, status: "rejected" },
    { key: "claims", label: isEnglish ? "Claims" : "Claims", value: summary.matchedClaims },
    { key: "cpt", label: isEnglish ? "CPT" : "CPT", value: summary.matchedCptCodes },
    { key: "importedAmount", label: isEnglish ? "Imported $" : "$ importado", value: money(summary.totalPaymentImported) }
  ] : [];

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

      {restoredFromSavedAnalysis && result && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-blue" />
              <div>
                <h3 className="text-sm font-bold text-dark-blue">
                  {isEnglish ? "Saved analysis loaded" : "Análisis guardado cargado"}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {isEnglish
                    ? `Showing the last analysis for ${fileName || "the selected payment report"}. It remains available until you discard it or start a new import.`
                    : `Mostrando el último análisis de ${fileName || "el reporte de pagos seleccionado"}. Se conserva hasta que lo descarte o inicie una nueva importación.`}
                </p>
                {isRefreshingSavedAnalysis && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] font-bold text-primary-blue">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    {isEnglish ? "Refreshing saved warning details..." : "Actualizando detalles del análisis guardado..."}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              disabled={isProcessing}
              className="shrink-0 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-dark-blue hover:bg-blue-50 disabled:opacity-50"
            >
              {isEnglish ? "Discard saved analysis" : "Descartar análisis guardado"}
            </button>
          </div>
        </div>
      )}

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

        {payload && !result?.applied && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {isEnglish ? "Billing ownership for this payment import" : "Responsable del billing para esta importación de pagos"}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {isEnglish
                    ? "Choose whether imported payment rows should classify matched claims as ITERA billing, Provider billing, or leave the existing claim billing owner unchanged."
                    : "Seleccione si las filas de pago importadas deben clasificar los claims como billing de ITERA, billing del Provider, o dejar sin cambios el responsable actual del claim."}
                </p>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-3 lg:max-w-3xl">
                {(["Unknown", "ITERA", "Provider"] as const).map(owner => (
                  <button
                    key={owner}
                    type="button"
                    onClick={() => setImportBilledBy(owner)}
                    disabled={isProcessing}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      importBilledBy === owner
                        ? "border-primary-blue bg-blue-50 text-dark-blue shadow-sm ring-2 ring-blue-100"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-200 hover:bg-blue-50/60"
                    }`}
                  >
                    <span className="block text-xs font-bold">
                      {owner === "Unknown"
                        ? (isEnglish ? "Not specified" : "No especificar")
                        : owner === "ITERA"
                          ? (isEnglish ? "ITERA Billing" : "Billing de ITERA")
                          : (isEnglish ? "Provider Billing" : "Billing del Provider")}
                    </span>
                    <span className="mt-1 block text-[10px] font-semibold text-slate-500">
                      {owner === "Unknown"
                        ? (isEnglish ? "Keep each matched claim's current billing owner." : "Mantiene el responsable actual del billing en cada claim.")
                        : owner === "ITERA"
                          ? (isEnglish ? "Classify matched claims as billed by ITERA." : "Clasifica los claims matcheados como facturados por ITERA.")
                          : (isEnglish ? "Classify matched claims as billed by the practice/provider." : "Clasifica los claims matcheados como facturados por la práctica/provider.")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
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
            disabled={!payload || isProcessing || isSchemaLoading || (schema ? !mappingIssues.valid : false) || !result || result.summary.readyToImport === 0 || !canApply}
            className="rounded-lg bg-primary-blue px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-dark-blue disabled:opacity-50"
            title={!canApply ? (isEnglish ? "You do not have permission to apply payment imports." : "No tiene permiso para aplicar imports de pago.") : undefined}
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
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-9">
            {summaryCards.map(card => {
              const isFilterCard = Boolean(card.status);
              const isActive = isFilterCard && resultStatusFilter === card.status && resultIssueFilter === "all" && !normalizedResultSearch;
              const className = `rounded-lg border px-3 py-2 text-left shadow-sm transition ${
                isActive
                  ? "border-primary-blue bg-blue-50 ring-2 ring-blue-100"
                  : "border-slate-200 bg-white"
              } ${isFilterCard ? "cursor-pointer hover:border-primary-blue hover:bg-blue-50" : ""}`;
              const content = (
                <>
                  <p className={`text-[10px] font-bold uppercase tracking-wide ${isActive ? "text-primary-blue" : "text-slate-400"}`}>{card.label}</p>
                  <p className="mt-1 font-mono text-base font-bold text-slate-900">{card.value}</p>
                </>
              );
              return isFilterCard ? (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => applyResultStatusFilter(card.status || "all")}
                  className={className}
                  title={isEnglish ? `Filter table by ${card.label}` : `Filtrar tabla por ${card.label}`}
                >
                  {content}
                </button>
              ) : (
                <div key={card.key} className={className}>
                  {content}
                </div>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {result?.applied
                      ? (isEnglish ? "Payment Import Result" : "Resultado de importación de pagos")
                      : (isEnglish ? "Preflight Analysis" : "Análisis previo")}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {result?.applied
                      ? (isEnglish
                        ? "Rows marked Ready were imported. Needs Review rows were intentionally not overwritten."
                        : "Las filas Ready se importaron. Las filas en revisión no se sobreescriben.")
                      : (isEnglish
                        ? "This is a dry-run validation. No claim or payment data has been written yet."
                        : "Esta es una validación previa. Todavía no se ha escrito información de claims ni pagos.")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-full bg-slate-50 px-3 py-1 text-[11px] font-bold text-slate-600">
                    {isEnglish ? "Showing" : "Mostrando"} {filteredResultRows.length} {isEnglish ? "of" : "de"} {resultRows.length}
                  </div>
                  <button
                    type="button"
                    onClick={exportPaymentImportRowsToExcel}
                    disabled={sortedResultRows.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-[11px] font-bold text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:opacity-50"
                    title={isEnglish ? "Export the current filtered and sorted table to Excel." : "Exportar la tabla filtrada y ordenada actual a Excel."}
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    {isEnglish ? "Export Excel" : "Exportar Excel"}
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(260px,1.3fr)_180px_220px_auto]">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{isEnglish ? "Search result" : "Buscar resultado"}</span>
                  <input
                    value={resultSearch}
                    onChange={event => setResultSearch(event.target.value)}
                    placeholder={isEnglish ? "Row, claim, patient, CPT, payer, issue..." : "Fila, claim, paciente, CPT, payer, problema..."}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{isEnglish ? "Status" : "Estado"}</span>
                  <MultiSelectFilter
                    value={resultStatusFilter === "all" ? "" : resultStatusFilter}
                    onChange={value => setResultStatusFilter(value || "all")}
                    allLabel={isEnglish ? "All statuses" : "Todos"}
                    options={[
                      { value: "ready", label: isEnglish ? "Ready" : "Lista" },
                      { value: "imported", label: isEnglish ? "Imported" : "Importada" },
                      { value: "needs_review", label: isEnglish ? "Needs Review" : "Requiere revisión" },
                      { value: "payment_activity", label: isEnglish ? "Payment Activity" : "Actividad de pago" },
                      { value: "rejected", label: isEnglish ? "Rejected" : "Rechazada" }
                    ]}
                    className="mt-1"
                    buttonClassName="bg-white px-3 py-2 font-semibold"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{isEnglish ? "Issue type" : "Tipo de issue"}</span>
                  <MultiSelectFilter
                    value={resultIssueFilter === "all" ? "" : resultIssueFilter}
                    onChange={value => setResultIssueFilter(value || "all")}
                    allLabel={isEnglish ? "All rows" : "Todas las filas"}
                    options={[
                      { value: "errors", label: isEnglish ? "Errors only" : "Solo errores" },
                      { value: "warnings", label: isEnglish ? "Warnings only" : "Solo advertencias" },
                      { value: "payer_mismatch", label: isEnglish ? "Payer mismatch" : "Payer diferente" },
                      { value: "payment_activity", label: isEnglish ? "Payment activity" : "Actividad de pago" },
                      { value: "safe_match", label: isEnglish ? "Safe matches" : "Coincidencias seguras" }
                    ]}
                    className="mt-1"
                    buttonClassName="bg-white px-3 py-2 font-semibold"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={clearResultFilters}
                    disabled={!hasResultFilters}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {isEnglish ? "Clear filters" : "Limpiar filtros"}
                  </button>
                </div>
              </div>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <tr>
                    {sortableResultHeader("Row", "row")}
                    {sortableResultHeader("Status", "status")}
                    {sortableResultHeader("Claim", "claim")}
                    {sortableResultHeader("Patient", "patient")}
                    {sortableResultHeader("CPT", "cpt")}
                    {sortableResultHeader("DOS", "dos")}
                    {sortableResultHeader("Payer", "payer")}
                    {sortableResultHeader("Payment", "payment", "px-3 py-3 text-right")}
                    {sortableResultHeader("Issue", "issue")}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedResultRows.map(row => (
                    <tr key={`${row.rowNumber}-${row.claimId}-${row.cptCode}`} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-mono text-slate-500">{row.rowNumber}</td>
                      <td className="px-3 py-3">{statusBadge(row.status, isEnglish)}</td>
                      <td className="px-3 py-3 font-mono font-bold text-dark-blue">{row.claimId || "-"}</td>
                      <td className="px-3 py-3">
                        <p className="font-semibold text-slate-800">{row.patientName || "-"}</p>
                        <p className="font-mono text-[10px] text-slate-400">{row.patientId || "-"}</p>
                      </td>
                      <td className="px-3 py-3 font-mono font-bold">{row.cptCode || "-"}</td>
                      <td className="px-3 py-3 font-mono text-slate-500">{formatDosDate(row.serviceDate)}</td>
                      <td className="px-3 py-3">
                        {row.payerMismatch ? (
                          <div className="min-w-[320px] space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">{isEnglish ? "Payer mismatch" : "Payer diferente"}</p>
                              <p className="text-[11px] text-slate-700">
                                <span className="font-bold">{isEnglish ? "Claim" : "Claim"}:</span> {row.claimPayerName || "-"}
                              </p>
                              <p className="text-[11px] text-slate-700">
                                <span className="font-bold">{isEnglish ? "Report" : "Reporte"}:</span> {row.reportPayerName || row.suggestedPayerName || "-"}
                              </p>
                              {row.suggestedPayerId ? (
                                <p className="rounded-md border border-emerald-100 bg-white px-2 py-1 text-[11px] text-slate-700">
                                  <span className="font-bold text-emerald-700">{isEnglish ? "Matched platform payer" : "Payer identificado"}:</span>{" "}
                                  {row.suggestedPayerName} <span className="font-mono text-[10px] text-slate-400">({row.suggestedPayerId})</span>
                                </p>
                              ) : (
                                <p className="rounded-md border border-amber-100 bg-white px-2 py-1 text-[11px] font-semibold text-amber-800">
                                  {isEnglish
                                    ? "Report payer was not identified in Settings. Select the real platform payer below."
                                    : "El payer del reporte no fue identificado en Settings. Seleccione debajo el payer real de la plataforma."}
                                </p>
                              )}
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                {isEnglish ? "Registered payer to apply" : "Payer registrado a aplicar"}
                              </p>
                              <PayerCombobox
                                payers={payers}
                                value={selectedMismatchPayers[rowKey(row)] || row.suggestedPayerId || ""}
                                onChange={payerId => setSelectedMismatchPayers(current => ({ ...current, [rowKey(row)]: payerId }))}
                                allowEmpty
                                emptyLabel={isEnglish ? "Select platform payer" : "Seleccione payer de plataforma"}
                                placeholder={isEnglish ? "Type payer name or code..." : "Escriba nombre o código del payer..."}
                                inputClassName="bg-white py-1.5 text-[11px]"
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void applyPayerChange(row, selectedMismatchPayers[rowKey(row)] || row.suggestedPayerId)}
                                disabled={payerChangeState[rowKey(row)] === "applying" || !(selectedMismatchPayers[rowKey(row)] || row.suggestedPayerId)}
                                className="inline-flex items-center gap-1 rounded-md bg-dark-blue px-2 py-1 text-[10px] font-bold text-white shadow-sm hover:bg-secondary-blue disabled:opacity-50"
                                title={isEnglish ? "Change the claim insurance to the selected registered payer." : "Cambia el seguro del claim al payer registrado seleccionado."}
                              >
                                {payerChangeState[rowKey(row)] === "applying"
                                  ? (isEnglish ? "Applying..." : "Aplicando...")
                                  : row.suggestedPayerId && !(selectedMismatchPayers[rowKey(row)] && selectedMismatchPayers[rowKey(row)] !== row.suggestedPayerId)
                                    ? (isEnglish ? "Apply platform payer" : "Aplicar payer identificado")
                                    : (isEnglish ? "Associate selected payer" : "Asociar payer seleccionado")}
                              </button>
                              <button
                                type="button"
                                onClick={() => associateReportPayer(row)}
                                className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2 py-1 text-[10px] font-bold text-amber-800 shadow-sm hover:bg-amber-100"
                                title={isEnglish ? "Keep the current claim insurance and accept this report payer name as the same payer for this import." : "Mantiene el seguro actual del claim y acepta este nombre del reporte como el mismo payer para esta importación."}
                              >
                                {isEnglish ? "Treat as current payer" : "Tratar como payer actual"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p>{row.payerName || "-"}</p>
                            {row.payerAssociationAccepted && (
                              <p className="mt-1 text-[10px] font-bold text-amber-700">{isEnglish ? "Report payer associated" : "Payer del reporte asociado"}</p>
                            )}
                            {payerChangeState[rowKey(row)] === "applied" && (
                              <p className="mt-1 text-[10px] font-bold text-emerald-700">{isEnglish ? "Payer updated" : "Seguro actualizado"}</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-emerald-700">{money(Number(row.payment || 0))}</td>
                      <td className="max-w-sm px-3 py-3">
                        <div className="space-y-2">
                          {row.errors.length > 0 ? (
                            <p className="flex items-start gap-1 text-rose-700"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {row.errors.join("; ")}</p>
                          ) : row.warnings.length > 0 ? (
                            <p className="flex items-start gap-1 text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {row.warnings.join("; ")}</p>
                          ) : (
                            <p className="flex items-start gap-1 text-emerald-700"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {isEnglish ? "Safe match" : "Coincidencia segura"}</p>
                          )}
                          {!result?.applied && ["needs_review", "rejected", "payment_activity"].includes(row.status) && (
                            <button
                              type="button"
                              onClick={() => void recheckRow(row)}
                              disabled={isProcessing || recheckingRow !== null}
                              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-700 shadow-sm hover:border-primary-blue hover:bg-blue-50 hover:text-primary-blue disabled:cursor-wait disabled:opacity-50"
                              title={isEnglish ? "Recheck this row only using the current file and mapping." : "Rechequear solo esta fila usando el archivo y mapeo actual."}
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${recheckingRow === row.rowNumber ? "animate-spin" : ""}`} />
                              {recheckingRow === row.rowNumber
                                ? (isEnglish ? "Rechecking..." : "Rechequeando...")
                                : (isEnglish ? "Recheck row" : "Rechequear fila")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredResultRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">
                        {isEnglish ? "No rows match the selected filters." : "No hay filas que coincidan con los filtros seleccionados."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
