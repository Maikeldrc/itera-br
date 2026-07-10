/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from "react";
import { X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { ClaimStatus, ClaimClassification } from "../types";
import { useFeedback } from "./FeedbackProvider";
import { useLanguage } from "./LanguageProvider";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (payload: any[] | { fileName: string; fileBase64: string }) => Promise<{ success: boolean; importedCount: number; errorCount: number; errors: any[] }>;
}

export function ImportModal({ isOpen, onClose, onImport }: ImportModalProps) {
  const { notify } = useFeedback();
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const [file, setFile] = useState<File | null>(null);
  const [filePayload, setFilePayload] = useState<{ fileName: string; fileBase64: string } | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [validationResults, setValidationResults] = useState<{ row: number; claim_id: string; status: "valid" | "invalid"; errors: string[] }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importResult, setImportResult] = useState<{ importedCount: number; errorCount: number; errors: any[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const reader = new FileReader();
    const isXlsx = selectedFile.name.toLowerCase().endsWith(".xlsx");
    reader.onload = (event) => {
      if (isXlsx) {
        const fileBase64 = event.target?.result as string;
        setFilePayload({ fileName: selectedFile.name, fileBase64 });
        setParsedRows([{ file_name: selectedFile.name, import_type: "Billing Worklist XLSX" }]);
        setValidationResults([{ row: 1, claim_id: selectedFile.name, status: "valid", errors: [] }]);
      } else {
        const text = event.target?.result as string;
        parseCSV(text);
      }
    };
    if (isXlsx) {
      reader.readAsDataURL(selectedFile);
    } else {
      reader.readAsText(selectedFile);
    }
  };

  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return;

    // Retrieve headers
    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
    const dataRows: any[] = [];
    const validations: typeof validationResults = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle quotes in split
      const rowValues = line.split(",").map(val => val.trim().replace(/^"|"$/g, ""));
      const claimObj: any = {};
      headers.forEach((header, index) => {
        claimObj[header] = rowValues[index] || "";
      });

      dataRows.push(claimObj);

      // Simple frontend validation
      const errors: string[] = [];
      const rowNum = i;
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
      if (!isBillingWorklist && (!claimObj.billed_by || (claimObj.billed_by !== "ITERA" && claimObj.billed_by !== "Provider"))) {
        errors.push(isEnglish ? "Billed by must be 'ITERA' or 'Provider'." : "Billed by debe ser 'ITERA' o 'Provider'.");
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
    }

    setParsedRows(dataRows);
    setValidationResults(validations);
  };

  const handleImportClick = async () => {
    setIsProcessing(true);
    try {
      const res = await onImport(filePayload || parsedRows);
      setImportResult(res);
      if (res.success) {
        setParsedRows([]);
        setValidationResults([]);
        setFile(null);
        setFilePayload(null);
      }
    } catch (err) {
      console.error(err);
      notify(isEnglish ? "File import failed." : "Error al importar el archivo.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const triggerSelectFile = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-dark-blue p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary-blue" />
            <h3 className="font-semibold text-lg font-display">{isEnglish ? "Import Claims from CSV / XLSX" : "Importar Claims desde CSV / XLSX"}</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
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
          {!file && (
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={triggerSelectFile}
              className="border-2 border-dashed border-slate-300 hover:border-primary-blue rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors bg-slate-50 hover:bg-blue-50/10 group"
            >
              <Upload className="w-10 h-10 text-slate-400 group-hover:text-primary-blue transition-colors" />
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700">{isEnglish ? "Drag and drop your CSV or XLSX file here" : "Arrastre y suelte su archivo CSV o XLSX aquí"}</p>
                <p className="text-xs text-slate-500 mt-1">{isEnglish ? "or click to select a local file" : "o haga clic para seleccionar un archivo local"}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={handleFileChange}
              />
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
                    {(file.size / 1024).toFixed(1)} KB - {filePayload ? (isEnglish ? "XLSX ready to process" : "XLSX listo para procesar") : `${parsedRows.length} ${isEnglish ? "records loaded" : "registros cargados"}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setFile(null);
                  setFilePayload(null);
                  setParsedRows([]);
                  setValidationResults([]);
                  setImportResult(null);
                }}
                className="text-xs text-rose-500 hover:text-rose-700 font-medium font-mono"
              >
                {isEnglish ? "Remove" : "Eliminar"}
              </button>
            </div>
          )}

          {/* Import Results Summary */}
          {importResult && (
            <div className={`p-4 rounded-xl border flex gap-3 ${importResult.errorCount === 0 ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-rose-50 border-rose-100 text-rose-800"}`}>
              {importResult.errorCount === 0 ? (
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="text-sm">
                <h5 className="font-semibold mb-1">{isEnglish ? "Import Result" : "Resultado de Importación"}</h5>
                <p>{isEnglish ? "Successfully imported" : "Importados correctamente"}: <span className="font-bold">{importResult.importedCount} claims</span></p>
                {importResult.errorCount > 0 && (
                  <p className="mt-1 font-semibold text-rose-700">{isEnglish ? "Rejected due to errors" : "Rechazados por errores"}: {importResult.errorCount} {isEnglish ? "records" : "registros"}.</p>
                )}
                {importResult.errors.length > 0 && (
                  <div className="mt-2 bg-white/80 border border-rose-100 rounded-lg p-2.5 space-y-1 text-xs text-rose-700 max-h-40 overflow-y-auto font-mono">
                    {importResult.errors.map((err, i) => (
                      <div key={i}>
                        {isEnglish ? "Row" : "Fila"} {err.row} (ID: {err.claimId}): {err.errors.join("; ")}
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
              <h4 className="font-semibold text-dark-blue mb-1">{isEnglish ? "Billing Worklist XLSX ready" : "Billing Worklist XLSX listo"}</h4>
              <p className="text-xs leading-relaxed">
                {isEnglish
                  ? "The file will be processed on the server. Each row will import as a Draft claim using Provider NPI, Primary Insurance Code and Code1..Code6. Charges are calculated from System Settings / FCSO Fee Schedules."
                  : "El archivo se procesará en el servidor. Cada fila se importará como claim en Draft, usando Provider NPI, Primary Insurance Code y Code1..Code6. Los charges se calcularán desde System Settings / FCSO Fee Schedules."}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-600 transition-colors"
          >
            {isEnglish ? "Close" : "Cerrar"}
          </button>
          <button
            onClick={handleImportClick}
            disabled={(!filePayload && parsedRows.length === 0) || isProcessing}
            className="bg-primary-blue hover:bg-secondary-blue disabled:bg-slate-300 disabled:cursor-not-allowed px-5 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 transition-all shadow-md"
          >
            {isProcessing
              ? (isEnglish ? "Processing..." : "Procesando...")
              : (filePayload ? (isEnglish ? "Import XLSX" : "Importar XLSX") : `${isEnglish ? "Import" : "Importar"} ${parsedRows.length} ${isEnglish ? "Records" : "Registros"}`)}
          </button>
        </div>
      </div>
    </div>
  );
}
