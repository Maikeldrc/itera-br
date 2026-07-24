/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle, Info, Download, RefreshCw } from "lucide-react";
import { ClaimStatus, ClaimClassification } from "../types";
import { useFeedback } from "./FeedbackProvider";
import { useLanguage } from "./LanguageProvider";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (payload: ImportPayload) => Promise<ImportResult>;
  onRollback: (claimIds: string[], fileName?: string) => Promise<{ revertedClaims?: number; requestedClaims?: number }>;
}

type ImportBillingOwner = "Unknown" | "ITERA" | "Provider";
type ClaimImportMode = "ready" | "force" | "all_eligible";
type ClaimImportDecision = "ready" | "all_eligible" | "problems";
type ImportPayload = any[] | { rows?: any[]; fileName?: string; fileBase64?: string; retryRows?: number[]; forceImportRows?: number[]; importBilledBy?: ImportBillingOwner; apply?: boolean; importMode?: ClaimImportMode };

type ImportSummary = {
  totalRowsRead: number;
  importedRows: number;
  rejectedRows: number;
  accountedRows: number;
  allRowsAccounted: boolean;
  uniquePatientsInFile: number;
  uniquePatientsImported: number;
  uniqueProvidersImported: number;
  uniquePayersImported: number;
  uniqueCptCodesImported: number;
  totalCptUnitsImported: number;
  cptCodeCounts: Record<string, number>;
  totalBilledChargeImported: number;
  topRejectionReasons: { reason: string; count: number }[];
  forcedImportedRows?: number;
  readyRows?: number;
  analysisOnly?: boolean;
};

type ImportResult = {
  success: boolean;
  importedCount: number;
  readyCount?: number;
  errorCount: number;
  analysisOnly?: boolean;
  errors: any[];
  importedClaimIds?: string[];
  rollbackAvailable?: boolean;
  rollbackCompleted?: boolean;
  rollbackSummary?: {
    revertedClaims: number;
    requestedClaims: number;
  };
  summary?: ImportSummary;
  forcedImportedCount?: number;
};

export function ImportModal({ isOpen, onClose, onImport, onRollback }: ImportModalProps) {
  const { notify } = useFeedback();
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const [file, setFile] = useState<File | null>(null);
  const [filePayload, setFilePayload] = useState<{ fileName: string; fileBase64: string } | null>(null);
  const [importBilledBy, setImportBilledBy] = useState<ImportBillingOwner>("Unknown");
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [validationResults, setValidationResults] = useState<{ row: number; claim_id: string; status: "valid" | "invalid"; errors: string[] }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importProgress, setImportProgress] = useState<{ percent: number; label: string } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isRollbackConfirmOpen, setIsRollbackConfirmOpen] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [isForceImporting, setIsForceImporting] = useState(false);
  const [forceImportingRow, setForceImportingRow] = useState<number | null>(null);
  const [importedReadyRows, setImportedReadyRows] = useState(0);
  const [importedProblemRows, setImportedProblemRows] = useState(0);
  const [importedForcedRows, setImportedForcedRows] = useState<number[]>([]);
  const [selectedImportDecision, setSelectedImportDecision] = useState<ClaimImportDecision>("ready");
  const [pendingImportConfirmation, setPendingImportConfirmation] = useState<ClaimImportDecision | "">("");
  const [rollbackProgress, setRollbackProgress] = useState<{ percent: number; label: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const correctedFileInputRef = useRef<HTMLInputElement>(null);
  const importResultRef = useRef<HTMLDivElement>(null);
  const progressTimerRef = useRef<number | null>(null);
  const wasOpenRef = useRef(false);

  function clearProgressTimer() {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function resetImportState() {
    clearProgressTimer();
    setFile(null);
    setFilePayload(null);
    setImportBilledBy("Unknown");
    setParsedRows([]);
    setValidationResults([]);
    setIsProcessing(false);
    setImportProgress(null);
    setImportResult(null);
    setIsRollbackConfirmOpen(false);
    setIsRollingBack(false);
    setIsForceImporting(false);
    setForceImportingRow(null);
    setImportedReadyRows(0);
    setImportedProblemRows(0);
    setImportedForcedRows([]);
    setSelectedImportDecision("ready");
    setPendingImportConfirmation("");
    setRollbackProgress(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (correctedFileInputRef.current) {
      correctedFileInputRef.current.value = "";
    }
  }

  function clearSelectedFile() {
    setFile(null);
    setFilePayload(null);
    setImportBilledBy("");
    setParsedRows([]);
    setValidationResults([]);
    setImportResult(null);
    setImportProgress(null);
    setIsRollbackConfirmOpen(false);
    setRollbackProgress(null);
    setImportedReadyRows(0);
    setImportedProblemRows(0);
    setImportedForcedRows([]);
    setSelectedImportDecision("ready");
    setPendingImportConfirmation("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (correctedFileInputRef.current) {
      correctedFileInputRef.current.value = "";
    }
  }

  function handleClose() {
    if (isProcessing) return;
    resetImportState();
    onClose();
  }

  useEffect(() => {
    return () => {
      clearProgressTimer();
    };
  }, []);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      resetImportState();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (importResult) {
      window.setTimeout(() => {
        importResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [importResult]);

  if (!isOpen) return null;

  // CSV template string
  const csvTemplate = `claim_id,patient_id,patient_display_name_masked,practice_id,practice_name,provider_id,provider_name,provider_npi,payer_id,payer_name,service_type,cpt_hcpcs,modifiers,units,date_of_service_from,date_of_service_to,month_of_service,billed_by,payment_received_by,claim_status,claim_classification,billed_charge,allowed_amount,paid_amount,insurance_adjustment,denied_amount,write_off_amount,uncollectible_amount,itera_direct_collection,provider_direct_collection,total_collections,ar_balance,itera_ar,provider_ar,account_payable_to_physician,payment_to_physician,ending_ap_to_physician,net_itera_revenue,net_provider_revenue,era_received,eob_received,payment_date,check_or_eft_number,carc_code,rarc_code,denial_reason,error_flag,error_category,locked,lock_reason,correction_status,resubmission_date,corrected_claim_reference,last_note
CLM-2026-999,PAT-0192,Maria Knight,PRAC_01,Metropolitan Care Group,PROV_01,Dr. Robert Chen,1982736450,PAY_01,Medicare Texas (Novitas),RPM,99454,,1,2026-05-01,2026-05-31,2026-05,ITERA,ITERA,Paid,ITERA Collected,150.00,110.00,110.00,40.00,0.00,0.00,0.00,110.00,0.00,110.00,0.00,0.00,0.00,77.00,0.00,77.00,33.00,77.00,Yes,Yes,2026-06-12,EFT-881273,,,Reconciled claim,,false,,,Pending,,,Initial batch upload`;

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(csvTemplate);
      notify(isEnglish ? "CSV template copied to clipboard." : "Plantilla de CSV copiada al portapapeles.", "success");
    } catch {
      notify(isEnglish ? "Unable to copy the template to clipboard." : "No se pudo copiar la plantilla al portapapeles.", "error");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const processFile = (selectedFile: File) => {
    setFile(selectedFile);
    setFilePayload(null);
    setImportResult(null);
    setImportProgress(null);
    const reader = new FileReader();
    const lowerName = selectedFile.name.toLowerCase();
    const isExcel = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
    reader.onload = (event) => {
      if (isExcel) {
        const fileBase64 = event.target?.result as string;
        setFilePayload({ fileName: selectedFile.name, fileBase64 });
        setParsedRows([{ file_name: selectedFile.name, import_type: "Billing Worklist Excel" }]);
        setValidationResults([{ row: 1, claim_id: selectedFile.name, status: "valid", errors: [] }]);
      } else {
        const text = event.target?.result as string;
        parseCSV(text);
      }
    };
    if (isExcel) {
      reader.readAsDataURL(selectedFile);
    } else {
      reader.readAsText(selectedFile);
    }
  };

  const extractCsvRows = (text: string) => {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
    const dataRows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const rowValues = line.split(",").map(val => val.trim().replace(/^"|"$/g, ""));
      const claimObj: any = {};
      headers.forEach((header, index) => {
        claimObj[header] = rowValues[index] || "";
      });
      dataRows.push(claimObj);
    }
    return dataRows;
  };

  const parseCSV = (text: string) => {
    const dataRows = extractCsvRows(text);
    const validations: typeof validationResults = [];

    dataRows.forEach((claimObj, index) => {
      // Simple frontend validation
      const errors: string[] = [];
      const rowNum = index + 1;
      const claim_id = claimObj.claim_id || "";
      const isBillingWorklist = !!(claimObj.MRN || claimObj["Provider NPI"] || claimObj.Code1);

      if (isBillingWorklist) {
        if (!claimObj.MRN) errors.push(isEnglish ? "MRN is required." : "MRN es requerido.");
        if (!claimObj["Provider NPI"]) errors.push(isEnglish ? "Provider NPI is required." : "Provider NPI es requerido.");
        if (!claimObj["Primary Insurance Code"]) errors.push(isEnglish ? "Primary Insurance Code is required." : "Primary Insurance Code es requerido.");
        if (!claimObj["Month Of"]) errors.push(isEnglish ? "Month Of is required." : "Month Of es requerido.");
        if (!["Code1", "Code2", "Code3", "Code4", "Code5", "Code6"].some(key => claimObj[key])) {
          errors.push(isEnglish ? "Include at least one CPT in Code1..Code6." : "Debe incluir al menos un CPT en Code1..Code6.");
        }
      } else if (!claim_id) {
        errors.push(isEnglish ? "Claim ID is required." : "Claim ID es requerido.");
      }
      if (!isBillingWorklist && (!claimObj.billed_by || !["ITERA", "Provider", "Unknown"].includes(claimObj.billed_by))) {
        errors.push(isEnglish ? "Billed by must be 'ITERA', 'Provider' or 'Unknown'." : "Billed by debe ser 'ITERA', 'Provider' o 'Unknown'.");
      }
      if (claimObj.billed_charge && isNaN(Number(claimObj.billed_charge))) {
        errors.push(isEnglish ? "Billed Charge must be a numeric value." : "Billed Charge debe ser un valor numérico.");
      }

      validations.push({
        row: rowNum,
        claim_id: claim_id || `[${isEnglish ? "Row" : "Fila"} ${rowNum}]`,
        status: errors.length === 0 ? "valid" : "invalid",
        errors
      });
    });

    setParsedRows(dataRows);
    setValidationResults(validations);
  };

  const startImportProgress = (mode: "analysis" | "import" = "import") => {
    clearProgressTimer();
    setImportProgress({
      percent: 8,
      label: mode === "analysis"
        ? (isEnglish ? "Preparing analysis..." : "Preparando análisis...")
        : (isEnglish ? "Preparing import..." : "Preparando importación...")
    });

    progressTimerRef.current = window.setInterval(() => {
      setImportProgress(current => {
        if (!current) return current;
        const nextPercent = Math.min(88, current.percent + (filePayload ? 4 : 7));
        let label = mode === "analysis"
          ? (isEnglish ? "Uploading file for validation..." : "Subiendo archivo para validación...")
          : (isEnglish ? "Uploading file for import..." : "Subiendo archivo para importación...");
        if (nextPercent >= 35) label = mode === "analysis"
          ? (isEnglish ? "Validating rows and business rules..." : "Validando filas y reglas de negocio...")
          : (isEnglish ? "Processing selected rows..." : "Procesando filas seleccionadas...");
        if (nextPercent >= 65) label = mode === "analysis"
          ? (isEnglish ? "Preparing preflight results..." : "Preparando resultados del análisis...")
          : (isEnglish ? "Writing claims to Google Sheets..." : "Guardando claims en Google Sheets...");
        if (nextPercent >= 82) label = mode === "analysis"
          ? (isEnglish ? "Building review table..." : "Construyendo tabla de revisión...")
          : (isEnglish ? "Refreshing imported data..." : "Actualizando datos importados...");
        return { percent: nextPercent, label };
      });
    }, 700);
  };

  const buildLocalImportSummary = (result?: Partial<ImportResult>, fallbackReason?: string): ImportSummary => {
    const sourceRows = filePayload ? [] : parsedRows;
    const cptCodeCounts: Record<string, number> = {};
    const patientIds = new Set<string>();
    const providerIds = new Set<string>();
    const payerIds = new Set<string>();

    sourceRows.forEach(row => {
      const patientId = String(row.MRN || row.patient_id || "").trim();
      const providerId = String(row["Provider NPI"] || row.provider_npi || row.provider_id || "").trim();
      const payerId = String(row["Primary Insurance Code"] || row.payer_id || row.payer_name || "").trim();
      if (patientId) patientIds.add(patientId);
      if (providerId) providerIds.add(providerId);
      if (payerId) payerIds.add(payerId);

      const codes = ["Code1", "Code2", "Code3", "Code4", "Code5", "Code6"]
        .map(key => String(row[key] || "").trim())
        .filter(Boolean);
      if (codes.length === 0 && row.cpt_hcpcs) {
        String(row.cpt_hcpcs)
          .split(/[\s,]+/)
          .map(code => code.trim())
          .filter(Boolean)
          .forEach(code => codes.push(code));
      }
      codes.forEach(code => {
        cptCodeCounts[code] = (cptCodeCounts[code] || 0) + 1;
      });
    });

    const importedRows = Number(result?.analysisOnly ? (result?.readyCount ?? result?.summary?.readyRows ?? result?.summary?.importedRows ?? 0) : (result?.importedCount || 0));
    const rejectedRows = Number(result?.errorCount || (fallbackReason ? 1 : 0));
    const totalRowsRead = sourceRows.length;
    return {
      totalRowsRead,
      importedRows,
      rejectedRows,
      accountedRows: importedRows + rejectedRows,
      allRowsAccounted: totalRowsRead > 0 ? importedRows + rejectedRows === totalRowsRead : importedRows + rejectedRows > 0,
      uniquePatientsInFile: patientIds.size,
      uniquePatientsImported: result?.summary?.uniquePatientsImported ?? 0,
      uniqueProvidersImported: result?.summary?.uniqueProvidersImported ?? providerIds.size,
      uniquePayersImported: result?.summary?.uniquePayersImported ?? payerIds.size,
      uniqueCptCodesImported: result?.summary?.uniqueCptCodesImported ?? Object.keys(cptCodeCounts).length,
      totalCptUnitsImported: result?.summary?.totalCptUnitsImported ?? Object.values(cptCodeCounts).reduce((sum, count) => sum + count, 0),
      cptCodeCounts,
      totalBilledChargeImported: result?.summary?.totalBilledChargeImported ?? 0,
      topRejectionReasons: fallbackReason ? [{ reason: fallbackReason, count: 1 }] : []
    };
  };

  const normalizeImportResult = (result: ImportResult): ImportResult => ({
    ...result,
    summary: result.summary || buildLocalImportSummary(result)
  });

  const addCptCounts = (current: Record<string, number> = {}, next: Record<string, number> = {}) => {
    const merged = { ...current };
    Object.entries(next).forEach(([code, count]) => {
      merged[code] = (merged[code] || 0) + Number(count || 0);
    });
    return merged;
  };

  const removeErrorsForRows = (errors: any[] = [], rows: number[]) => {
    const targetRows = new Set(rows.map(row => Number(row)).filter(row => Number.isFinite(row) && row > 0));
    return errors.filter(error => !targetRows.has(Number(error?.row)));
  };

  const mergeImportActionResult = (
    previous: ImportResult | null,
    next: ImportResult,
    options: { forcedRows?: number[]; readyRowsImported?: number } = {}
  ): ImportResult => {
    const forcedRows = options.forcedRows || [];
    if (!previous) return next;
    const remainingPreviousErrors = removeErrorsForRows(previous.errors || [], forcedRows);
    const forcedErrors = next.errors || [];
    const mergedErrors = [...remainingPreviousErrors, ...forcedErrors];
    const importedClaimIds = Array.from(new Set([...(previous.importedClaimIds || []), ...(next.importedClaimIds || [])]));
    const importedCount = Number(previous.importedCount || 0) + Number(next.importedCount || 0);
    const errorCount = mergedErrors.length;
    const previousSummary = previous.summary || buildLocalImportSummary(previous);
    const nextSummary = next.summary || buildLocalImportSummary(next);
    const previousWasAnalysis = Boolean(previous.analysisOnly || previousSummary.analysisOnly);
    const previousHasPhysicalImports = Number(previous.importedCount || 0) > 0;
    const previousImportedRows = previousHasPhysicalImports ? Number(previousSummary.importedRows || previous.importedCount || 0) : 0;
    const previousForcedRows = previousHasPhysicalImports ? Number(previousSummary.forcedImportedRows || previous.forcedImportedCount || 0) : 0;
    const previousCptCounts = previousHasPhysicalImports ? previousSummary.cptCodeCounts : {};
    const previousImportedCharge = previousHasPhysicalImports ? Number(previousSummary.totalBilledChargeImported || 0) : 0;
    const previousImportedUnits = previousHasPhysicalImports ? Number(previousSummary.totalCptUnitsImported || 0) : 0;
    const totalRowsRead = previousSummary.totalRowsRead || nextSummary.totalRowsRead;
    const importedRows = previousImportedRows + Number(nextSummary.importedRows || next.importedCount || 0);
    const rejectedRows = errorCount;
    const accountedRows = importedRows + rejectedRows;
    const allRowsAccounted = totalRowsRead > 0 ? accountedRows === totalRowsRead : nextSummary.allRowsAccounted;
    const forcedImportedRows = previousForcedRows + Number(nextSummary.forcedImportedRows || next.forcedImportedCount || 0);
    const mergedSummary: ImportSummary = {
      ...previousSummary,
      totalRowsRead,
      importedRows,
      rejectedRows,
      accountedRows,
      allRowsAccounted,
      uniquePatientsImported: allRowsAccounted && rejectedRows === 0
        ? Math.max(previousSummary.uniquePatientsInFile, previousSummary.uniquePatientsImported, nextSummary.uniquePatientsImported)
        : Math.max(previousSummary.uniquePatientsImported, nextSummary.uniquePatientsImported),
      uniqueProvidersImported: Math.max(previousSummary.uniqueProvidersImported, nextSummary.uniqueProvidersImported),
      uniquePayersImported: Math.max(previousSummary.uniquePayersImported, nextSummary.uniquePayersImported),
      uniqueCptCodesImported: Math.max(previousSummary.uniqueCptCodesImported, nextSummary.uniqueCptCodesImported),
      totalCptUnitsImported: previousImportedUnits + Number(nextSummary.totalCptUnitsImported || 0),
      cptCodeCounts: addCptCounts(previousCptCounts, nextSummary.cptCodeCounts),
      totalBilledChargeImported: Number((previousImportedCharge + Number(nextSummary.totalBilledChargeImported || 0)).toFixed(2)),
      topRejectionReasons: rejectedRows > 0 ? previousSummary.topRejectionReasons : [],
      forcedImportedRows,
      analysisOnly: previousWasAnalysis
    };

    return {
      ...previous,
      ...next,
      success: errorCount === 0,
      analysisOnly: previousWasAnalysis,
      importedCount,
      errorCount,
      errors: mergedErrors,
      importedClaimIds,
      rollbackAvailable: importedClaimIds.length > 0,
      forcedImportedCount: forcedImportedRows,
      summary: mergedSummary
    };
  };

  const handleImportClick = async () => {
    if (isAnalysisResult) {
      await executeSelectedImportDecision();
      return;
    }
    await runImport(filePayload || parsedRows, { apply: false });
  };

  const handleImportReadyRowsOnly = async () => {
    if (readyToImportCount <= 0 || importedReadyRows > 0) return;
    const result = await runImport(filePayload || parsedRows, {
      apply: true,
      importMode: "ready",
      readyRowsImported: readyToImportCount
    });
    setImportedReadyRows(current => current + Number(result?.importedCount || 0));
  };

  const handleImportAllEligibleRows = async () => {
    const remainingReadyRows = Math.max(0, readyToImportCount - importedReadyRows);
    const remainingForcedRows = forcedImportEligibleRows.filter(row => !importedForcedRowSet.has(row));
    if (remainingReadyRows <= 0 && remainingForcedRows.length <= 0) return;
    let readyImported = 0;
    let forcedImported = 0;
    if (remainingReadyRows > 0) {
      const readyResult = await runImport(filePayload || parsedRows, {
        apply: true,
        importMode: "ready",
        readyRowsImported: remainingReadyRows
      });
      readyImported = Number(readyResult?.importedCount || 0);
    }
    if (remainingForcedRows.length > 0) {
      const forcedResult = await runImport(filePayload
        ? { ...filePayload, retryRows: remainingForcedRows, forceImportRows: remainingForcedRows }
        : { rows: parsedRows, retryRows: remainingForcedRows, forceImportRows: remainingForcedRows }, {
        apply: true,
        importMode: "force",
        mergeForcedRows: remainingForcedRows
      });
      forcedImported = Number(forcedResult?.forcedImportedCount || forcedResult?.importedCount || 0);
    }
    setImportedReadyRows(current => current + readyImported);
    setImportedProblemRows(current => current + forcedImported);
    setImportedForcedRows(current => Array.from(new Set([...current, ...remainingForcedRows])));
  };

  const runImport = async (payload: ImportPayload, options?: { mergeForcedRows?: number[]; readyRowsImported?: number; apply?: boolean; importMode?: ClaimImportMode }) => {
    setIsProcessing(true);
    const shouldApply = options?.apply !== false;
    startImportProgress(shouldApply ? "import" : "analysis");
    try {
      const importPayload = Array.isArray(payload)
        ? { rows: payload, fileName: file?.name || "", importBilledBy, apply: shouldApply, importMode: options?.importMode || "ready" }
        : { ...payload, importBilledBy, apply: shouldApply, importMode: options?.importMode || "ready" };
      const res = await onImport(importPayload);
      clearProgressTimer();
      setImportProgress({
        percent: 100,
        label: shouldApply
          ? (isEnglish ? "Import completed." : "Importación completada.")
          : (isEnglish ? "Analysis completed. No data has been written." : "Análisis completado. No se ha escrito ningún dato.")
      });
      const normalizedResult = normalizeImportResult(res);
      if (shouldApply && (options?.mergeForcedRows?.length || options?.readyRowsImported)) {
        setImportResult(previous => mergeImportActionResult(previous, normalizedResult, {
          forcedRows: options.mergeForcedRows || [],
          readyRowsImported: options.readyRowsImported || 0
        }));
      } else {
      setImportResult(normalizedResult);
      }
      setIsRollbackConfirmOpen(false);
      setRollbackProgress(null);
      return normalizedResult;
    } catch (err) {
      console.error(err);
      clearProgressTimer();
      setImportProgress({
        percent: 100,
        label: isEnglish ? "Import failed." : "Importación fallida."
      });
      const message = err instanceof Error ? err.message : (isEnglish ? "Import process failed." : "El proceso de importación falló.");
      setImportResult({
        success: false,
        importedCount: 0,
        errorCount: 1,
        errors: [{ row: 0, claimId: file?.name || "", errors: [message] }],
        summary: buildLocalImportSummary({ importedCount: 0, errorCount: 1 }, message)
      });
      notify(isEnglish ? "File import failed." : "Error al importar el archivo.", "error");
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRollbackImport = async () => {
    const claimIds = importResult?.importedClaimIds || [];
    if (claimIds.length === 0 || isRollingBack) return;

    setIsRollingBack(true);
    setRollbackProgress({
      percent: 12,
      label: isEnglish ? "Preparing rollback for imported claims..." : "Preparando reversión de claims importados..."
    });
    try {
      await new Promise(resolve => window.setTimeout(resolve, 200));
      setRollbackProgress({
        percent: 38,
        label: isEnglish ? "Deleting this import batch from operational sheets..." : "Eliminando este lote de las hojas operativas..."
      });
      const result = await onRollback(claimIds, file?.name || filePayload?.fileName || "");
      setRollbackProgress({
        percent: 82,
        label: isEnglish ? "Refreshing worklist after rollback..." : "Actualizando worklist después de revertir..."
      });
      await new Promise(resolve => window.setTimeout(resolve, 300));
      setRollbackProgress({
        percent: 100,
        label: isEnglish ? "Rollback completed." : "Reversión completada."
      });
      setImportResult(previous => previous ? {
        ...previous,
        importedCount: 0,
        rollbackAvailable: false,
        rollbackCompleted: true,
        rollbackSummary: {
          revertedClaims: Number(result.revertedClaims || 0),
          requestedClaims: Number(result.requestedClaims || claimIds.length)
        },
        summary: previous.summary ? {
          ...previous.summary,
          importedRows: 0,
          accountedRows: previous.summary.rejectedRows,
          totalBilledChargeImported: 0
        } : previous.summary
      } : previous);
      notify(
        isEnglish
          ? `Import reverted: ${Number(result.revertedClaims || 0)} claim(s) were completely removed.`
          : `Importación revertida: ${Number(result.revertedClaims || 0)} claim(s) fueron eliminados completamente.`,
        "success"
      );
      setIsRollbackConfirmOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : (isEnglish ? "Rollback failed." : "Falló la reversión.");
      setRollbackProgress({
        percent: 100,
        label: isEnglish ? "Rollback failed." : "Falló la reversión."
      });
      notify(`${isEnglish ? "Rollback error" : "Error al revertir"}: ${message}`, "error");
    } finally {
      setIsRollingBack(false);
    }
  };

  const triggerSelectFile = () => {
    fileInputRef.current?.click();
  };

  const displayedSummary = importResult?.summary || null;
  const isAnalysisResult = Boolean(importResult?.analysisOnly || displayedSummary?.analysisOnly);
  const readyToImportCount = Number(importResult?.readyCount ?? displayedSummary?.readyRows ?? (isAnalysisResult ? displayedSummary?.importedRows : 0) ?? 0);
  const rollbackAvailable = Boolean(importResult?.rollbackAvailable && (importResult.importedClaimIds || []).length > 0 && !importResult.rollbackCompleted);
  const importCompletedSuccessfully = Boolean(!isAnalysisResult && importResult?.success && Number(importResult.importedCount || 0) > 0 && Number(importResult.errorCount || 0) === 0);
  const importAlreadyFinalized = !isAnalysisResult && (Number(importResult?.importedCount || 0) > 0 || Boolean(importResult?.rollbackCompleted));
  const rejectedSourceRows = new Set<number>(
    (importResult?.errors || [])
      .map(err => Number(err.row))
      .filter((row): row is number => Number.isFinite(row) && row > 0)
  );
  const importErrorRows = (importResult?.errors || []).flatMap((err, index) => {
    const messages = Array.isArray(err.errors) ? err.errors : [String(err.errors || "")].filter(Boolean);
    return messages.map((message: string, messageIndex: number) => ({
      key: `${index}-${messageIndex}`,
      row: err.row,
      claimId: err.claimId || "-",
      message,
      action: message.includes("Max/DOS") || message.includes("per DOS")
        ? (isEnglish ? "Review CPT duplicates or Max/DOS settings." : "Revise CPT duplicados o configuración Max/DOS.")
        : (isEnglish ? "Correct the source row and re-import it." : "Corrija la fila origen y vuelva a importarla.")
    }));
  });
  const forcedImportEligibleRows = Array.from(new Set(
    (importResult?.errors || [])
      .filter(err => {
        const messages = Array.isArray(err.errors) ? err.errors : [String(err.errors || "")].filter(Boolean);
        return messages.length > 0 && messages.every(message =>
          /requires at least 30 days between DOS dates|exceeds Max\/DOS|can be used .* per DOS/i.test(String(message))
        );
      })
      .map(err => Number(err.row))
      .filter((row): row is number => Number.isFinite(row) && row > 0)
  ));
  const forcedImportEligibleRowSet = new Set(forcedImportEligibleRows);
  const importedForcedRowSet = new Set(importedForcedRows);
  const remainingForcedImportEligibleRows = forcedImportEligibleRows.filter(row => !importedForcedRowSet.has(row));
  const remainingReadyToImportCount = Math.max(0, readyToImportCount - importedReadyRows);
  const selectedImportCount = selectedImportDecision === "ready"
    ? remainingReadyToImportCount
    : selectedImportDecision === "all_eligible"
      ? remainingReadyToImportCount + remainingForcedImportEligibleRows.length
      : remainingForcedImportEligibleRows.length;
  const selectedImportHasProblemRows = selectedImportDecision === "problems"
    || (selectedImportDecision === "all_eligible" && remainingForcedImportEligibleRows.length > 0);
  const selectedImportDecisionLabel = selectedImportDecision === "ready"
    ? (isEnglish ? `Import ${selectedImportCount} ready row(s)` : `Importar ${selectedImportCount} fila(s) lista(s)`)
    : selectedImportDecision === "all_eligible"
      ? (isEnglish ? `Import ${selectedImportCount} ready + review row(s)` : `Importar ${selectedImportCount} fila(s) listas + revisión`)
      : (isEnglish ? `Import ${selectedImportCount} problem row(s)` : `Importar ${selectedImportCount} fila(s) con problemas`);
  const selectedImportConfirmationLabel = selectedImportDecision === "all_eligible"
    ? (isEnglish ? `Confirm import ${selectedImportCount} ready + review row(s)` : `Confirmar importación de ${selectedImportCount} fila(s) listas + revisión`)
    : (isEnglish ? `Confirm import ${selectedImportCount} problem row(s)` : `Confirmar importación de ${selectedImportCount} fila(s) con problemas`);

  const escapeCsvValue = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const downloadRejectedRowsCsv = () => {
    if (!importResult || importResult.errors.length === 0) return;

    const rejectedByRow = new Map<number, string>();
    importResult.errors.forEach(err => {
      rejectedByRow.set(Number(err.row), (err.errors || []).join("; "));
    });
    const rejectedRowsFromResponse = importResult.errors
      .map(err => ({ rowNumber: Number(err.row), row: err.sourceRow || null }))
      .filter((item): item is { rowNumber: number; row: Record<string, unknown> } => Number.isFinite(item.rowNumber) && !!item.row);
    const rejectedRows = rejectedRowsFromResponse.length > 0
      ? rejectedRowsFromResponse
      : parsedRows
        .map((row, index) => ({ rowNumber: Number(row.__source_row) || index + 1, row }))
        .filter(item => rejectedByRow.has(item.rowNumber));
    if (rejectedRows.length === 0) {
      notify(isEnglish ? "No rejected source rows are available to export." : "No hay filas rechazadas disponibles para exportar.", "warning");
      return;
    }

    const headers = Array.from(new Set<string>(rejectedRows.flatMap(item => Object.keys(item.row).filter(header => header !== "__source_row"))));
    const csv = [
      ["source_row", "import_errors", ...headers].map(escapeCsvValue).join(","),
      ...rejectedRows.map(item => [
        item.rowNumber,
        rejectedByRow.get(item.rowNumber) || "",
        ...headers.map(header => item.row[header] || "")
      ].map(escapeCsvValue).join(","))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ITERA_Rejected_Import_Rows_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCorrectedFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    e.target.value = "";
    if (!selectedFile || !importResult) return;
    const lowerName = selectedFile.name.toLowerCase();
    const isExcel = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = async event => {
        const fileBase64 = event.target?.result as string;
        setFile(selectedFile);
        setFilePayload({ fileName: selectedFile.name, fileBase64 });
        setParsedRows([{ file_name: selectedFile.name, import_type: "Corrected Billing Worklist Excel" }]);
        setValidationResults([{ row: 1, claim_id: selectedFile.name, status: "valid", errors: [] }]);
        await runImport({ fileName: selectedFile.name, fileBase64, retryRows: Array.from(rejectedSourceRows) });
      };
      reader.readAsDataURL(selectedFile);
      return;
    }

    const reader = new FileReader();
    reader.onload = async event => {
      const text = String(event.target?.result || "");
      const rows = extractCsvRows(text);
      const rowsToImport = rows.filter((row, index) => {
        const sourceRow = Number(row.source_row || row.Source_Row || row.SOURCE_ROW || index + 1);
        return rejectedSourceRows.has(sourceRow) || rejectedSourceRows.has(index + 1);
      });
      if (rowsToImport.length === 0) {
        notify(
          isEnglish
            ? "No corrected rows matched the previous rejected row numbers."
            : "Ninguna fila corregida coincide con las filas rechazadas anteriores.",
          "warning"
        );
        return;
      }
      setFile(selectedFile);
      setFilePayload(null);
      setParsedRows(rowsToImport);
      setValidationResults(rowsToImport.map((row, index) => ({
        row: index + 1,
        claim_id: row.claim_id || `[${isEnglish ? "Row" : "Fila"} ${index + 1}]`,
        status: "valid",
        errors: []
      })));
      await runImport(rowsToImport);
    };
    reader.readAsText(selectedFile);
  };

  const handleForceImportRejectedRows = async (rowNumber?: number) => {
    const targetRows = rowNumber ? [rowNumber] : remainingForcedImportEligibleRows;
    if (targetRows.length === 0 || isProcessing || isForceImporting || forceImportingRow !== null) return;
    setIsForceImporting(true);
    setForceImportingRow(rowNumber || null);
    try {
      const result = await runImport(filePayload
        ? { ...filePayload, retryRows: targetRows, forceImportRows: targetRows }
        : { rows: parsedRows, retryRows: targetRows, forceImportRows: targetRows }, { mergeForcedRows: targetRows, importMode: "force" });
      const importedCount = Number(result?.forcedImportedCount || result?.importedCount || 0);
      if (importedCount > 0) {
        setImportedForcedRows(current => Array.from(new Set([...current, ...targetRows])));
        setImportedProblemRows(current => current + importedCount);
        notify(
          isEnglish
            ? `${importedCount} rejected row(s) were imported and marked for service-line review.`
            : `${importedCount} fila(s) rechazada(s) fueron importadas y marcadas para revisión de service line.`,
          "success"
        );
      }
    } catch {
      // runImport already surfaces the failure state.
    } finally {
      setIsForceImporting(false);
      setForceImportingRow(null);
    }
  };

  const chooseImportDecision = (decision: ClaimImportDecision) => {
    setSelectedImportDecision(decision);
    setPendingImportConfirmation("");
  };

  const executeSelectedImportDecision = async () => {
    if (!isAnalysisResult || selectedImportCount <= 0 || isProcessing || isRollingBack || isForceImporting) return;
    if (selectedImportHasProblemRows && pendingImportConfirmation !== selectedImportDecision) {
      setPendingImportConfirmation(selectedImportDecision);
      return;
    }
    setPendingImportConfirmation("");
    if (selectedImportDecision === "ready") {
      await handleImportReadyRowsOnly();
      return;
    }
    if (selectedImportDecision === "all_eligible") {
      await handleImportAllEligibleRows();
      return;
    }
    await handleForceImportRejectedRows();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/50 flex items-center justify-center z-50 p-3 overflow-y-auto">
      <div className="bg-white rounded-2xl w-[min(98vw,1800px)] shadow-2xl border border-slate-200 overflow-hidden my-4 max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="bg-dark-blue p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary-blue" />
            <h3 className="font-semibold text-lg font-display">{isEnglish ? "Import Claims from CSV / XLS / XLSX" : "Importar Claims desde CSV / XLS / XLSX"}</h3>
          </div>
          <button
            onClick={handleClose}
            disabled={isProcessing}
            className="p-1 hover:bg-white/10 rounded-full transition-colors text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            ref={correctedFileInputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
            className="hidden"
            onChange={handleCorrectedFileChange}
          />

          {/* Instructions and Template */}
          <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start gap-3">
            <Info className="w-5 h-5 text-secondary-blue shrink-0 mt-0.5" />
            <div className="text-sm text-slate-700">
              <h5 className="font-semibold text-dark-blue mb-1">{isEnglish ? "ITERA Import Guidelines" : "Directrices de Importación de ITERA"}</h5>
              <p className="mb-2">
                {isEnglish
                  ? "Import the full reconciliation CSV or a Billing Worklist Excel file with MRN, First Name, Last Name, Sex, Date of Birth, Provider NPI, Care Manager, Service, Month Of, Primary Insurance Code and Code1..Code6. Excel rows import as Draft and charges come from the Fee Schedule."
                  : "Puede importar el CSV completo de conciliación o el Excel de Billing Worklist con MRN, First Name, Last Name, Sex, Date of Birth, Provider NPI, Care Manager, Service, Month Of, Primary Insurance Code y Code1..Code6. El Excel se importa como Draft y los charges salen del Fee Schedule."}
              </p>
              <button
                onClick={copyTemplate}
                className="bg-secondary-blue text-white font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-dark-blue transition-colors"
              >
                {isEnglish ? "Copy Sample CSV Template" : "Copiar Plantilla CSV de Ejemplo"}
              </button>
            </div>
          </div>

          {/* Drag & Drop File Zone */}
          {!file && !importResult && (
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={triggerSelectFile}
              className="border-2 border-dashed border-slate-300 hover:border-primary-blue rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors bg-slate-50 hover:bg-blue-50/10 group"
            >
              <Upload className="w-10 h-10 text-slate-400 group-hover:text-primary-blue transition-colors" />
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700">{isEnglish ? "Drag and drop your CSV, XLS or XLSX file here" : "Arrastre y suelte su archivo CSV, XLS o XLSX aquí"}</p>
                <p className="text-xs text-slate-500 mt-1">{isEnglish ? "or click to select a local file" : "o haga clic para seleccionar un archivo local"}</p>
              </div>
            </div>
          )}

          {/* Selected File Details */}
          {file && (
            <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">{file.name}</p>
                  <p className="text-xs text-slate-500 font-mono">
                    {(file.size / 1024).toFixed(1)} KB - {filePayload ? (isEnglish ? "Excel ready to process" : "Excel listo para procesar") : `${parsedRows.length} ${isEnglish ? "records loaded" : "registros cargados"}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (isProcessing) return;
                  clearSelectedFile();
                }}
                disabled={isProcessing}
                className="text-xs text-rose-500 hover:text-rose-700 disabled:text-slate-300 disabled:cursor-not-allowed font-medium font-mono"
              >
                {isEnglish ? "Remove" : "Eliminar"}
              </button>
            </div>
          )}

          {file && !importResult && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {isEnglish ? "Billing ownership for this import" : "Responsable del billing para esta importación"}
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {isEnglish
                      ? "Choose whether the imported Claims/CPT lines belong to Provider billing, ITERA billing, or leave the billing owner unclassified. Billing Worklist Excel rows use this value for every imported claim."
                      : "Seleccione si los Claims/CPT importados corresponden al billing del Provider, al billing de ITERA, o déjelos sin clasificar. Las filas del Billing Worklist Excel usarán este valor para cada claim importado."}
                  </p>
                </div>
                <div className="grid w-full gap-2 sm:grid-cols-3 lg:min-w-[520px]">
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
                          ? (isEnglish ? "Leave billing owner unclassified." : "Deja el responsable del billing sin clasificar.")
                          : owner === "ITERA"
                          ? (isEnglish ? "Claims are billed by ITERA." : "Claims facturados por ITERA.")
                          : (isEnglish ? "Claims are billed by the practice/provider." : "Claims facturados por la práctica/provider.")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Import Progress */}
          {importProgress && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div>
                  <h4 className="font-semibold text-dark-blue text-sm">
                    {isEnglish ? "Import progress" : "Progreso de importación"}
                  </h4>
                  <p className="text-xs text-slate-600 mt-0.5">{importProgress.label}</p>
                </div>
                <span className="text-xs font-bold text-dark-blue tabular-nums">{Math.round(importProgress.percent)}%</span>
              </div>
              <div
                className="h-2.5 w-full overflow-hidden rounded-full bg-white border border-blue-100"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(importProgress.percent)}
              >
                <div
                  className="h-full rounded-full bg-primary-blue transition-all duration-500 ease-out"
                  style={{ width: `${importProgress.percent}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                {filePayload
                  ? (isAnalysisResult || !importResult
                    ? (isEnglish ? "Large Excel files can take a few moments while the server validates rows." : "Los Excel grandes pueden tardar mientras el servidor valida las filas.")
                    : (isEnglish ? "Large Excel files can take a few moments while the server writes claims." : "Los Excel grandes pueden tardar mientras el servidor guarda los claims."))
                  : (isAnalysisResult || !importResult
                    ? (isEnglish ? `${parsedRows.length} parsed records are being validated.` : `${parsedRows.length} registros parseados se están validando.`)
                    : (isEnglish ? `${parsedRows.length} parsed records are being imported.` : `${parsedRows.length} registros parseados se están importando.`))}
              </p>
            </div>
          )}

          {/* Import Results Summary */}
          {importResult && (
            <div ref={importResultRef} className={`p-4 rounded-xl border flex gap-3 ${isAnalysisResult ? "bg-amber-50 border-amber-100 text-amber-900" : importResult.success && importResult.errorCount === 0 ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-rose-50 border-rose-100 text-rose-800"}`}>
              {isAnalysisResult ? (
                <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              ) : importResult.success && importResult.errorCount === 0 ? (
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="text-sm">
                <h5 className="font-semibold mb-1">
                  {isAnalysisResult
                    ? (isEnglish ? "Preflight Analysis Result" : "Resultado del análisis previo")
                    : (isEnglish ? "Import Result" : "Resultado de Importación")}
                </h5>
                {isAnalysisResult ? (
                  <>
                    <p>{isEnglish ? "Ready to import" : "Listos para importar"}: <span className="font-bold">{readyToImportCount} claims</span></p>
                    <p className="mt-1 text-xs font-semibold text-amber-800">
                      {isEnglish
                        ? "No data has been written to Google Sheets yet. Review the rows below, then import the ready rows or correct the rejected ones."
                        : "Todavía no se ha escrito ningún dato en Google Sheets. Revise las filas debajo y luego importe las filas listas o corrija las rechazadas."}
                    </p>
                  </>
                ) : (
                  <p>{isEnglish ? "Successfully imported" : "Importados correctamente"}: <span className="font-bold">{importResult.importedCount} claims</span></p>
                )}
                {!isAnalysisResult && Number(importResult.forcedImportedCount || displayedSummary?.forcedImportedRows || 0) > 0 && (
                  <p className="mt-1 text-xs text-emerald-700">
                    {isEnglish
                      ? `${Math.max(0, Number(importResult.importedCount || 0) - Number(importResult.forcedImportedCount || displayedSummary?.forcedImportedRows || 0))} imported without errors + ${Number(importResult.forcedImportedCount || displayedSummary?.forcedImportedRows || 0)} imported anyway and marked for review.`
                      : `${Math.max(0, Number(importResult.importedCount || 0) - Number(importResult.forcedImportedCount || displayedSummary?.forcedImportedRows || 0))} importados sin errores + ${Number(importResult.forcedImportedCount || displayedSummary?.forcedImportedRows || 0)} importados de todos modos y marcados para revisión.`}
                  </p>
                )}
                {importResult.errorCount > 0 && (
                  <p className={`mt-1 font-semibold ${isAnalysisResult ? "text-amber-800" : "text-rose-700"}`}>{isEnglish ? "Rejected due to errors" : "Rechazados por errores"}: {importResult.errorCount} {isEnglish ? "records" : "registros"}.</p>
                )}
                {displayedSummary && !displayedSummary.allRowsAccounted && (
                  <p className="mt-1 font-semibold text-rose-700">
                    {isEnglish
                      ? "Warning: not all source rows were accounted for. Review the import file and retry."
                      : "Advertencia: no todas las filas del archivo fueron contabilizadas. Revise el archivo e intente nuevamente."}
                  </p>
                )}
              </div>
            </div>
          )}

          {importResult?.rollbackCompleted && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {isEnglish ? "Import rolled back" : "Importación revertida"}
                  </h4>
                  <p className="mt-1 text-xs text-slate-600">
                    {isEnglish
                      ? `${importResult.rollbackSummary?.revertedClaims || 0} of ${importResult.rollbackSummary?.requestedClaims || 0} imported claim(s) were completely removed from Claims and related operational rows.`
                      : `${importResult.rollbackSummary?.revertedClaims || 0} de ${importResult.rollbackSummary?.requestedClaims || 0} claim(s) importados fueron eliminados completamente de Claims y filas operativas relacionadas.`}
                  </p>
                </div>
              </div>
            </div>
          )}

          {isAnalysisResult && displayedSummary && (
            <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {isEnglish ? "Import decision" : "Decisión de importación"}
                  </h4>
                  <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
                    {isEnglish
                      ? "Choose exactly which group to write to Google Sheets. The preflight analysis remains visible so the full file context is not lost after a partial import."
                      : "Seleccione exactamente qué grupo escribir en Google Sheets. El análisis previo se mantiene visible para no perder el contexto completo del archivo después de una importación parcial."}
                  </p>
                </div>
                <div className="grid w-full gap-2 md:grid-cols-3 lg:max-w-4xl">
                  <button
                    type="button"
                    onClick={() => chooseImportDecision("ready")}
                    disabled={isProcessing || isRollingBack || remainingReadyToImportCount <= 0}
                    className={`rounded-xl border px-3 py-3 text-left text-xs font-bold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                      selectedImportDecision === "ready"
                        ? "border-emerald-400 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-100"
                        : "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
                    }`}
                  >
                    <span className="block text-[10px] uppercase tracking-wide text-emerald-600">{isEnglish ? "Clean rows" : "Filas limpias"}</span>
                    {remainingReadyToImportCount > 0
                      ? (isEnglish ? `${remainingReadyToImportCount} ready row(s)` : `${remainingReadyToImportCount} fila(s) lista(s)`)
                      : (isEnglish ? `${importedReadyRows} ready row(s) imported` : `${importedReadyRows} fila(s) lista(s) importadas`)}
                    <span className="mt-1 block text-[10px] font-semibold leading-snug text-slate-500">
                      {isEnglish
                        ? "Only rows with no validation issues. These can be written directly."
                        : "Solo filas sin problemas de validación. Se pueden guardar directamente."}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseImportDecision("all_eligible")}
                    disabled={isProcessing || isRollingBack || (remainingReadyToImportCount <= 0 && remainingForcedImportEligibleRows.length <= 0)}
                    className={`rounded-xl border px-3 py-3 text-left text-xs font-bold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                      selectedImportDecision === "all_eligible"
                        ? "border-primary-blue bg-blue-50 text-dark-blue ring-2 ring-blue-100"
                        : "border-blue-200 bg-white text-dark-blue hover:bg-blue-50"
                    }`}
                  >
                    <span className="block text-[10px] uppercase tracking-wide text-primary-blue">{isEnglish ? "Ready + review rows" : "Listas + revisión"}</span>
                    {remainingReadyToImportCount > 0 || remainingForcedImportEligibleRows.length > 0
                      ? (isEnglish
                        ? `${remainingReadyToImportCount + remainingForcedImportEligibleRows.length} row(s) total`
                        : `${remainingReadyToImportCount + remainingForcedImportEligibleRows.length} fila(s) en total`)
                      : (isEnglish ? "All selected rows imported" : "Todas las filas seleccionadas importadas")}
                    <span className="mt-1 block text-[10px] font-semibold leading-snug text-slate-500">
                      {isEnglish
                        ? "Clean rows plus recoverable problem rows that will be marked for review."
                        : "Filas limpias más problemas recuperables que quedarán marcados para revisión."}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseImportDecision("problems")}
                    disabled={isProcessing || isRollingBack || isForceImporting || forceImportingRow !== null || remainingForcedImportEligibleRows.length <= 0}
                    className={`rounded-xl border px-3 py-3 text-left text-xs font-bold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                      selectedImportDecision === "problems"
                        ? "border-amber-400 bg-amber-50 text-amber-900 ring-2 ring-amber-100"
                        : "border-amber-300 bg-white text-amber-800 hover:bg-amber-50"
                    }`}
                  >
                    <span className="block text-[10px] uppercase tracking-wide text-amber-700">{isEnglish ? "Problem rows" : "Filas con problemas"}</span>
                    {remainingForcedImportEligibleRows.length > 0
                      ? (isEnglish ? `${remainingForcedImportEligibleRows.length} problem row(s) only` : `Solo ${remainingForcedImportEligibleRows.length} fila(s) con problemas`)
                      : (isEnglish ? `${importedProblemRows} problem row(s) imported` : `${importedProblemRows} fila(s) con problemas importadas`)}
                    <span className="mt-1 block text-[10px] font-semibold leading-snug text-slate-500">
                      {isEnglish
                        ? "Only recoverable rule conflicts. Paid duplicate CPT/DOS rows remain blocked."
                        : "Solo conflictos recuperables. Duplicados pagados por CPT/DOS siguen bloqueados."}
                    </span>
                  </button>
                </div>
              </div>
              {pendingImportConfirmation === selectedImportDecision && selectedImportHasProblemRows && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                  {isEnglish
                    ? "This selection includes problem rows. Click the bottom import button again to confirm that those service lines should be imported and marked for review."
                    : "Esta selección incluye filas con problemas. Haga clic nuevamente en el botón inferior para confirmar que esos service lines deben importarse y marcarse para revisión."}
                </div>
              )}
            </div>
          )}

          {rollbackAvailable && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <h4 className="text-sm font-bold text-amber-950">
                      {isEnglish ? "All-or-nothing recovery" : "Recuperación todo o nada"}
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-amber-800">
                      {isEnglish
                        ? `${importResult.importedClaimIds?.length || 0} claim(s) were imported in this batch. If you want the file to be imported only when every row is valid, revert this import to completely remove the batch, correct the rejected rows, and import again.`
                        : `${importResult.importedClaimIds?.length || 0} claim(s) fueron importados en este lote. Si desea que el archivo se importe solo cuando todas las filas sean válidas, revierta esta importación para eliminar completamente el lote, corrija las filas rechazadas y vuelva a importar.`}
                    </p>
                  </div>
                </div>
                {!isRollbackConfirmOpen ? (
                  <button
                    type="button"
                    onClick={() => setIsRollbackConfirmOpen(true)}
                    disabled={isRollingBack}
                    className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-2 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isEnglish ? "Revert imported claims" : "Revertir claims importados"}
                  </button>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsRollbackConfirmOpen(false)}
                      disabled={isRollingBack}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      {isEnglish ? "Cancel" : "Cancelar"}
                    </button>
                    <button
                      type="button"
                      onClick={handleRollbackImport}
                      disabled={isRollingBack}
                      className="rounded-lg bg-amber-700 px-3 py-2 text-[11px] font-bold text-white hover:bg-amber-800 disabled:cursor-wait disabled:opacity-60"
                    >
                      {isRollingBack ? (isEnglish ? "Reverting..." : "Revirtiendo...") : (isEnglish ? "Confirm rollback" : "Confirmar reversión")}
                    </button>
                  </div>
                )}
              </div>
              {rollbackProgress && (
                <div className="mt-4 rounded-lg border border-amber-100 bg-white/70 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold text-amber-900">{rollbackProgress.label}</p>
                    <span className="font-mono text-[11px] font-bold text-amber-800">{Math.round(rollbackProgress.percent)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-amber-100">
                    <div
                      className="h-full rounded-full bg-amber-600 transition-all duration-300"
                      style={{ width: `${rollbackProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {importErrorRows.length > 0 && (
            <div className="rounded-xl border border-rose-100 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-rose-100 bg-rose-50/70 flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-rose-900 text-sm">
                    {isEnglish ? "Rows Requiring Correction" : "Filas que requieren corrección"}
                  </h4>
                  <p className="text-xs text-rose-700 mt-0.5">
                    {isEnglish
                      ? "Review each rejected row, correct the source data, then re-import only the corrected records."
                      : "Revise cada fila rechazada, corrija el origen y luego importe solo los registros corregidos."}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={downloadRejectedRowsCsv}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isEnglish ? "Download rejected rows" : "Descargar rechazadas"}
                  </button>
                  <button
                    onClick={() => correctedFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-dark-blue px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-secondary-blue"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {isEnglish ? "Upload corrected file" : "Cargar archivo corregido"}
                  </button>
                  {remainingForcedImportEligibleRows.length > 0 && (
                    <button
                      onClick={() => {
                        chooseImportDecision("problems");
                        importResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      disabled={isProcessing || isForceImporting || forceImportingRow !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
                      title={isEnglish
                        ? "Import only rows with recoverable CPT/DOS rule conflicts and mark them for user review."
                        : "Importa solo filas con conflictos recuperables de reglas CPT/DOS y las marca para revisión."}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {isEnglish ? "Select problem rows" : "Seleccionar filas con problemas"}
                    </button>
                  )}
                </div>
              </div>
              {forcedImportEligibleRows.length > 0 && (
                <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[11px] font-semibold text-amber-800">
                  {isEnglish
                    ? `${remainingForcedImportEligibleRows.length} of ${forcedImportEligibleRows.length} rejected row(s) remain eligible to import anyway. Imported problem rows are marked as errors so users must resolve them in Claims Worklist.`
                    : `${remainingForcedImportEligibleRows.length} de ${forcedImportEligibleRows.length} fila(s) rechazada(s) siguen elegibles para importar de todos modos. Las filas problemáticas importadas quedan marcadas como error para resolverlas en Claims Worklist.`}
                </div>
              )}
              <div className="max-h-72 overflow-auto">
                <table className="w-full min-w-[1320px] table-fixed text-left text-xs border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="p-3 w-24">{isEnglish ? "Row" : "Fila"}</th>
                      <th className="p-3 w-72">Claim ID</th>
                      <th className="p-3 w-[520px]">{isEnglish ? "Issue" : "Problema"}</th>
                      <th className="p-3 w-[360px]">{isEnglish ? "Suggested correction" : "Corrección sugerida"}</th>
                      <th className="p-3 w-44 text-right">{isEnglish ? "Action" : "Acción"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importErrorRows.map(item => {
                      const rowNumber = Number(item.row);
                      const canForceRow = forcedImportEligibleRowSet.has(rowNumber);
                      const rowAlreadyForced = importedForcedRowSet.has(rowNumber);
                      const isThisRowImporting = forceImportingRow === rowNumber;
                      return (
                        <tr key={item.key} className="hover:bg-slate-50/80">
                          <td className="p-3 font-mono font-bold text-slate-800">{item.row || "-"}</td>
                          <td className="p-3 font-mono text-slate-700">{item.claimId}</td>
                          <td className="whitespace-normal p-3 text-slate-800 leading-relaxed">{item.message}</td>
                          <td className="whitespace-normal p-3 text-slate-600">{item.action}</td>
                          <td className="p-3 text-right">
                            {canForceRow ? (
                              <button
                                type="button"
                                onClick={() => handleForceImportRejectedRows(rowNumber)}
                                disabled={rowAlreadyForced || isProcessing || isForceImporting || forceImportingRow !== null}
                                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
                              >
                                {isThisRowImporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                                {rowAlreadyForced
                                  ? (isEnglish ? "Imported" : "Importada")
                                  : (isEnglish ? "Import anyway" : "Importar de todos modos")}
                              </button>
                            ) : (
                              <span className="text-[10px] font-semibold text-slate-300">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {displayedSummary && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h4 className="font-semibold text-slate-800 text-sm">
                  {isAnalysisResult ? (isEnglish ? "Preflight Summary" : "Resumen del análisis previo") : (isEnglish ? "Import Summary" : "Resumen de importación")}
                </h4>
                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${displayedSummary.allRowsAccounted ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {displayedSummary.allRowsAccounted ? (isEnglish ? "All rows accounted" : "Filas contabilizadas") : (isEnglish ? "Review required" : "Revisión requerida")}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {[
                  [isEnglish ? "Rows read" : "Filas leídas", displayedSummary.totalRowsRead],
                  [isAnalysisResult ? (isEnglish ? "Ready" : "Listas") : (isEnglish ? "Imported" : "Importadas"), isAnalysisResult ? readyToImportCount : displayedSummary.importedRows],
                  [isAnalysisResult ? (isEnglish ? "Import-anyway eligible" : "Elegibles para importar de todos modos") : (isEnglish ? "Imported anyway" : "Importadas de todos modos"), isAnalysisResult ? forcedImportEligibleRows.length : (displayedSummary.forcedImportedRows || 0)],
                  ...(isAnalysisResult && (importedReadyRows > 0 || importedProblemRows > 0) ? [
                    [isEnglish ? "Ready imported" : "Listas importadas", importedReadyRows],
                    [isEnglish ? "Problem imported" : "Con problemas importadas", importedProblemRows]
                  ] : []),
                  [isEnglish ? "Rejected" : "Rechazadas", displayedSummary.rejectedRows],
                  [isEnglish ? "Unique patients" : "Pacientes únicos", displayedSummary.uniquePatientsImported || displayedSummary.uniquePatientsInFile],
                  [isEnglish ? "Providers" : "Proveedores", displayedSummary.uniqueProvidersImported],
                  [isEnglish ? "Payers" : "Payers", displayedSummary.uniquePayersImported],
                  [isEnglish ? "CPT codes" : "Códigos CPT", displayedSummary.uniqueCptCodesImported],
                  [isEnglish ? "CPT units" : "Unidades CPT", displayedSummary.totalCptUnitsImported]
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
                    <p className="font-mono font-bold text-slate-900 mt-1">{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid md:grid-cols-2 gap-3 mt-3">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                    {isAnalysisResult ? (isEnglish ? "CPT ready" : "CPT listos") : (isEnglish ? "CPT imported" : "CPT importados")}
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {Object.entries(displayedSummary.cptCodeCounts).length === 0 ? (
                      <span className="text-xs text-slate-500">-</span>
                    ) : (
                      Object.entries(displayedSummary.cptCodeCounts).map(([code, count]) => (
                        <span key={code} className="rounded-md bg-white border border-slate-200 px-2 py-1 text-[11px] font-mono text-slate-700">
                          {code}: {count}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                    {isEnglish ? "Top rejection reasons" : "Principales razones de rechazo"}
                  </p>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {displayedSummary.topRejectionReasons.length === 0 ? (
                      <span className="text-xs text-slate-500">-</span>
                    ) : (
                      displayedSummary.topRejectionReasons.map(item => (
                        <div key={item.reason} className="flex justify-between gap-3 text-[11px] text-slate-700">
                          <span className="truncate" title={item.reason}>{item.reason}</span>
                          <span className="font-mono font-bold">{item.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-3">
                {isAnalysisResult ? (isEnglish ? "Total billed charge ready" : "Cargo total listo") : (isEnglish ? "Total billed charge imported" : "Cargo total importado")}: <span className="font-mono font-bold">${displayedSummary.totalBilledChargeImported.toFixed(2)}</span>
              </p>
            </div>
          )}

          {/* Parsing Preview Table */}
          {parsedRows.length > 0 && !filePayload && (
            <div>
              <h4 className="font-semibold text-slate-800 mb-2 text-sm">{isEnglish ? "Data Validation Preview" : "Vista Previa de Validación de Datos"} ({parsedRows.length})</h4>
              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase tracking-wider">
                      <th className="p-2 text-center w-12">{isEnglish ? "Row" : "Fila"}</th>
                      <th className="p-2">Claim ID</th>
                      <th className="p-2">{isEnglish ? "Patient" : "Paciente"}</th>
                      <th className="p-2">Billed By</th>
                      <th className="p-2 text-right">Billed Charge</th>
                      <th className="p-2 text-center w-24">{isEnglish ? "Status" : "Estado"}</th>
                      <th className="p-2">{isEnglish ? "Detected errors" : "Errores detectados"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                    {parsedRows.map((row, index) => {
                      const validation = validationResults[index] || { status: "valid", errors: [] };
                      return (
                        <tr key={index} className={validation.status === "invalid" ? "bg-rose-50/40" : "hover:bg-slate-50/50"}>
                          <td className="p-2 text-center text-slate-400">{index + 1}</td>
                          <td className="p-2 font-bold text-slate-900">{row.claim_id || (isEnglish ? "[EMPTY]" : "[VACÍO]")}</td>
                          <td className="p-2">{row.patient_id} ({row.patient_display_name_masked})</td>
                          <td className="p-2">{row.billed_by}</td>
                          <td className="p-2 text-right">${row.billed_charge}</td>
                          <td className="p-2 text-center">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${validation.status === "valid" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                              {validation.status === "valid" ? (isEnglish ? "Clean" : "Limpio") : "Error"}
                            </span>
                          </td>
                          <td className="p-2 text-rose-600 font-sans max-w-xs truncate" title={validation.errors.join(", ")}>
                            {validation.errors.join(", ") || "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {filePayload && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700">
              <h4 className="font-semibold text-dark-blue mb-1">{isEnglish ? "Billing Worklist Excel ready" : "Billing Worklist Excel listo"}</h4>
              <p className="text-xs leading-relaxed">
                {isEnglish
                  ? "The file will be processed on the server. Each row will import as a Draft claim using Provider NPI, Primary Insurance Code and Code1..Code6. Charges are calculated from System Settings / FCSO Fee Schedules."
                  : "El archivo se procesará en el servidor. Cada fila se importará como claim en Draft, usando Provider NPI, Primary Insurance Code y Code1..Code6. Los charges se calcularán desde System Settings / FCSO Fee Schedules."}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-200 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-h-[38px] flex-1">
            {isProcessing && importProgress && (
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="truncate text-[11px] font-semibold text-dark-blue">{importProgress.label}</p>
                  <span className="font-mono text-[11px] font-bold text-dark-blue">{Math.round(importProgress.percent)}%</span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-white ring-1 ring-blue-100"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(importProgress.percent)}
                >
                  <div
                    className="h-full rounded-full bg-primary-blue transition-all duration-500 ease-out"
                    style={{ width: `${importProgress.percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-3">
          <button
            onClick={handleClose}
            disabled={isProcessing}
            className="px-4 py-2 border border-slate-200 hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed rounded-xl text-xs font-semibold text-slate-600 transition-colors"
          >
            {isEnglish ? "Close" : "Cerrar"}
          </button>
          <button
            onClick={handleImportClick}
            disabled={(!filePayload && parsedRows.length === 0) || isProcessing || isRollingBack || importAlreadyFinalized || (isAnalysisResult && selectedImportCount <= 0)}
            className="bg-primary-blue hover:bg-secondary-blue disabled:bg-slate-300 disabled:cursor-not-allowed px-5 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 transition-all shadow-md"
            title={importAlreadyFinalized
              ? (isEnglish ? "This import batch is finalized. Close this window to start a new import." : "Este lote de importación ya finalizó. Cierre esta ventana para iniciar una nueva importación.")
              : isAnalysisResult
                ? (selectedImportCount <= 0
                  ? (isEnglish ? "No rows remain for the selected import decision." : "No quedan filas para la decisión de importación seleccionada.")
                  : (isEnglish ? "Import the selected decision." : "Importar la decisión seleccionada."))
              : undefined}
          >
            {isProcessing
              ? (isEnglish ? "Processing..." : "Procesando...")
              : importResult?.rollbackCompleted
                ? (isEnglish ? "Import Reverted" : "Importación revertida")
                : importCompletedSuccessfully
                ? (isEnglish ? "Import Completed" : "Importación completada")
                : isAnalysisResult
                ? (selectedImportCount <= 0
                  ? (isEnglish ? "Selected import completed" : "Importación seleccionada completada")
                  : pendingImportConfirmation === selectedImportDecision && selectedImportHasProblemRows
                    ? selectedImportConfirmationLabel
                    : selectedImportDecisionLabel)
                : (filePayload ? (isEnglish ? "Analyze file" : "Analizar archivo") : `${isEnglish ? "Analyze" : "Analizar"} ${parsedRows.length} ${isEnglish ? "Records" : "Registros"}`)}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
