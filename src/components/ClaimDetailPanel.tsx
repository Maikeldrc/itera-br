/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  X,
  FileCheck,
  Lock,
  Unlock,
  AlertOctagon,
  Coins,
  History,
  FileText,
  Calendar,
  User,
  Plus,
  Send,
  Wrench,
  CheckCircle2,
  Info,
  Zap,
  Shield,
  RefreshCw,
  Sliders,
  Database,
  MessageSquareText,
  Search,
  Pencil,
  Trash2,
  Check,
  UserRound
} from "lucide-react";
import { Claim, ClaimStatus, ClaimClassification, ErrorCategory, Payment, Note, AuditLog, FeeSchedule, Payer } from "../types";
import { StatusBadge } from "./StatusBadge";
import { ClassificationBadge } from "./ClassificationBadge";
import { useFeedback } from "./FeedbackProvider";
import { validateServiceLineDetails } from "../serviceLineValidation";
import { validateCptRepeatLimitsByLine } from "../cptRepeatLimits";

const COMMON_CPT_DESCRIPTIONS: Record<string, string> = {
  "99453": "RPM - Preparación inicial de dispositivo, educación y entrenamiento del paciente.",
  "99454": "RPM - Suministro de dispositivo con transmisión programada diaria y grabaciones cada 30 días.",
  "99457": "RPM - Monitoreo fisiológico remoto por personal de salud, primeros 20 minutos de revisión mensual.",
  "99458": "RPM - Monitoreo fisiológico remoto, por cada periodo adicional de 20 minutos mensuales.",
  "99490": "CCM - Gestión de cuidado crónico, mínimo 20 minutos de personal clínico al mes bajo dirección médica.",
  "99439": "CCM - Gestión de cuidado crónico, periodo adicional de 20 minutos mensuales.",
  "99491": "CCM - Gestión de cuidado crónico por médico o profesional calificado, primeros 30 minutos.",
  "99484": "BHI - Servicios de integración de salud conductual general, 20 minutos mensuales.",
  "99495": "TCM - Gestión de transición de cuidado médico, complejidad moderada (comunicación en 2 días, visita en 14 días).",
  "99496": "TCM - Gestión de transición de cuidado médico, alta complejidad (comunicación en 2 días, visita en 7 días)."
};

const textValue = (value: unknown) => String(value ?? "").trim();
const splitCptCodes = (value: unknown) => textValue(value).split(/[\s,]+/).map(item => item.trim()).filter(Boolean);

const ERA_CODE_OPTIONS = [
  { code: "CO-4", label: "Procedure code inconsistent with modifier", group: "CARC" },
  { code: "CO-5", label: "Procedure code or bill type inconsistent with place of service", group: "CARC" },
  { code: "CO-6", label: "Procedure or revenue code inconsistent with patient's age", group: "CARC" },
  { code: "CO-7", label: "Procedure or revenue code inconsistent with patient's gender", group: "CARC" },
  { code: "CO-11", label: "Diagnosis inconsistent with procedure", group: "CARC" },
  { code: "CO-16", label: "Claim lacks information or has submission errors", group: "CARC" },
  { code: "CO-18", label: "Duplicate claim or service", group: "CARC" },
  { code: "CO-22", label: "May be covered by another payer per coordination of benefits", group: "CARC" },
  { code: "CO-23", label: "Impact of prior payer adjudication", group: "CARC" },
  { code: "CO-24", label: "Charges covered under capitation agreement", group: "CARC" },
  { code: "CO-29", label: "Time limit for filing has expired", group: "CARC" },
  { code: "CO-31", label: "Patient cannot be identified as insured", group: "CARC" },
  { code: "CO-45", label: "Charge exceeds fee schedule or contracted maximum", group: "CARC" },
  { code: "CO-50", label: "Non-covered service because it is not medically necessary", group: "CARC" },
  { code: "CO-96", label: "Non-covered charges", group: "CARC" },
  { code: "CO-97", label: "Payment included in another service or procedure", group: "CARC" },
  { code: "CO-109", label: "Claim or service not covered by this payer", group: "CARC" },
  { code: "CO-119", label: "Benefit maximum reached", group: "CARC" },
  { code: "CO-125", label: "Submission or billing error", group: "CARC" },
  { code: "CO-146", label: "Diagnosis was invalid for date of service", group: "CARC" },
  { code: "CO-151", label: "Payer deems information does not support service", group: "CARC" },
  { code: "CO-167", label: "Diagnosis not covered", group: "CARC" },
  { code: "CO-170", label: "Payment denied when performed by this type of provider", group: "CARC" },
  { code: "CO-171", label: "Payment denied when performed by this type of provider in this setting", group: "CARC" },
  { code: "CO-172", label: "Payment denied when performed by this type of provider to this patient", group: "CARC" },
  { code: "CO-173", label: "Payment denied because service was not prescribed", group: "CARC" },
  { code: "CO-176", label: "Prescription is not current", group: "CARC" },
  { code: "CO-181", label: "Procedure code was invalid on date of service", group: "CARC" },
  { code: "CO-182", label: "Procedure modifier was invalid on date of service", group: "CARC" },
  { code: "CO-183", label: "Referring provider not eligible to refer", group: "CARC" },
  { code: "CO-184", label: "Prescribing provider not eligible to prescribe", group: "CARC" },
  { code: "CO-185", label: "Rendering provider not eligible to perform service", group: "CARC" },
  { code: "CO-186", label: "Level of care change adjustment", group: "CARC" },
  { code: "CO-197", label: "Precertification, authorization, or notification absent", group: "CARC" },
  { code: "CO-204", label: "Service not covered under current benefit plan", group: "CARC" },
  { code: "CO-206", label: "NPI missing or invalid", group: "CARC" },
  { code: "CO-209", label: "Per regulatory or contractual requirements", group: "CARC" },
  { code: "CO-222", label: "Exceeds contracted or legislated fee arrangement", group: "CARC" },
  { code: "CO-226", label: "Information requested from billing provider was not provided", group: "CARC" },
  { code: "CO-234", label: "Procedure is not paid separately", group: "CARC" },
  { code: "CO-236", label: "This procedure or service is not paid separately", group: "CARC" },
  { code: "CO-242", label: "Services not provided by network or primary care provider", group: "CARC" },
  { code: "CO-243", label: "Services not authorized by network or primary care provider", group: "CARC" },
  { code: "CO-253", label: "Sequestration reduction", group: "CARC" },
  { code: "CO-256", label: "Service not payable per managed care contract", group: "CARC" },
  { code: "CO-272", label: "Coverage or program guidelines were not met", group: "CARC" },
  { code: "CO-273", label: "Coverage or program guidelines were exceeded", group: "CARC" },
  { code: "CO-284", label: "Primary payer amount exceeds allowed amount", group: "CARC" },
  { code: "OA-23", label: "Prior payer adjudication adjustment", group: "CARC" },
  { code: "OA-94", label: "Processed in excess of charges", group: "CARC" },
  { code: "PI-204", label: "Service not covered under current benefit plan", group: "CARC" },
  { code: "PR-1", label: "Deductible amount", group: "Patient" },
  { code: "PR-2", label: "Coinsurance amount", group: "Patient" },
  { code: "PR-3", label: "Copayment amount", group: "Patient" },
  { code: "PR-27", label: "Expenses incurred after coverage terminated", group: "Patient" },
  { code: "PR-45", label: "Patient responsibility after fee schedule or contract", group: "Patient" },
  { code: "PR-96", label: "Non-covered charges patient responsibility", group: "Patient" },
  { code: "PR-119", label: "Benefit maximum reached patient responsibility", group: "Patient" },
  { code: "PR-204", label: "Service not covered under current benefit plan", group: "Patient" },
  { code: "B7", label: "Provider was not certified or eligible for this service", group: "CARC" },
  { code: "B11", label: "Claim or service transferred to proper payer", group: "CARC" },
  { code: "B13", label: "Previously paid; payment for this claim/service may have been provided", group: "CARC" },
  { code: "B15", label: "Payment adjusted because service requires qualifying service", group: "CARC" },
  { code: "B16", label: "New patient qualifications were not met", group: "CARC" },
  { code: "B20", label: "Procedure partially or fully furnished by another provider", group: "CARC" },
  { code: "B22", label: "Payment adjusted based on diagnosis", group: "CARC" },
  { code: "M15", label: "Separately billed services/tests have been bundled", group: "RARC" },
  { code: "M20", label: "Missing/incomplete/invalid HCPCS", group: "RARC" },
  { code: "M25", label: "Information furnished does not substantiate medical necessity", group: "RARC" },
  { code: "M26", label: "Missing/incomplete/invalid ordering provider information", group: "RARC" },
  { code: "M27", label: "Missing/incomplete/invalid referring provider information", group: "RARC" },
  { code: "M51", label: "Missing/incomplete/invalid procedure code", group: "RARC" },
  { code: "M62", label: "Missing/incomplete/invalid treatment authorization code", group: "RARC" },
  { code: "M64", label: "Missing/incomplete/invalid other diagnosis", group: "RARC" },
  { code: "M76", label: "Missing/incomplete/invalid diagnosis or condition", group: "RARC" },
  { code: "M77", label: "Missing/incomplete/invalid place of service", group: "RARC" },
  { code: "M80", label: "Not covered when performed during same session/date as prior service", group: "RARC" },
  { code: "M81", label: "You are required to code to the highest level of specificity", group: "RARC" },
  { code: "M86", label: "Service denied because payment already made for same/similar service", group: "RARC" },
  { code: "M97", label: "Not paid to practitioner when provided to patient in facility", group: "RARC" },
  { code: "MA01", label: "Alert: if you disagree, appeal rights may apply", group: "RARC" },
  { code: "MA04", label: "Secondary payment cannot be considered without primary payer info", group: "RARC" },
  { code: "MA13", label: "Alert: you may be subject to penalties for incorrect billing", group: "RARC" },
  { code: "MA18", label: "Alert: claim information is also forwarded to supplemental insurer", group: "RARC" },
  { code: "MA27", label: "Missing/incomplete/invalid entitlement number or name", group: "RARC" },
  { code: "MA30", label: "Missing/incomplete/invalid type of bill", group: "RARC" },
  { code: "MA39", label: "Missing/incomplete/invalid gender", group: "RARC" },
  { code: "MA61", label: "Missing/incomplete/invalid Social Security number or HIC", group: "RARC" },
  { code: "MA63", label: "Missing/incomplete/invalid principal diagnosis", group: "RARC" },
  { code: "MA67", label: "Correction to a prior claim", group: "RARC" },
  { code: "MA83", label: "Did not indicate whether we are primary or secondary payer", group: "RARC" },
  { code: "MA92", label: "Missing/incomplete/invalid plan information", group: "RARC" },
  { code: "N4", label: "Missing/incomplete/invalid prior insurance carrier EOB", group: "RARC" },
  { code: "N20", label: "Service not payable with other service rendered same date", group: "RARC" },
  { code: "N29", label: "Missing documentation/orders/notes for service", group: "RARC" },
  { code: "N30", label: "Patient ineligible for this service", group: "RARC" },
  { code: "N31", label: "Missing/incomplete/invalid prescribing/referring provider", group: "RARC" },
  { code: "N34", label: "Incorrect claim form or format for this service", group: "RARC" },
  { code: "N35", label: "Program integrity review or missing requested documentation", group: "RARC" },
  { code: "N54", label: "Claim information missing/incomplete/invalid", group: "RARC" },
  { code: "N56", label: "Procedure code billed is not correct for service", group: "RARC" },
  { code: "N65", label: "Procedure code or modifier incorrect", group: "RARC" },
  { code: "N70", label: "Coverage terminated before date of service", group: "RARC" },
  { code: "N95", label: "This provider type/provider specialty may not bill this service", group: "RARC" },
  { code: "N102", label: "This claim has been denied without reviewing medical record", group: "RARC" },
  { code: "N115", label: "This decision was based on local coverage determination", group: "RARC" },
  { code: "N130", label: "Consult plan benefit documents for information about coverage", group: "RARC" },
  { code: "N180", label: "This item or service does not meet coverage requirements", group: "RARC" },
  { code: "N182", label: "Missing/incomplete/invalid treatment authorization number", group: "RARC" },
  { code: "N211", label: "Alert: another payer may be responsible for this service", group: "RARC" },
  { code: "N216", label: "Missing/incomplete/invalid provider NPI", group: "RARC" },
  { code: "N290", label: "Missing/incomplete/invalid rendering provider primary identifier", group: "RARC" },
  { code: "N382", label: "Missing/incomplete/invalid patient identifier", group: "RARC" },
  { code: "N425", label: "Statutorily excluded or does not meet definition of benefit", group: "RARC" },
  { code: "N522", label: "Duplicate claim/service", group: "RARC" },
  { code: "N575", label: "Medical records or notes do not support service", group: "RARC" },
  { code: "N657", label: "This should be billed with appropriate modifier", group: "RARC" },
] as const;

const FREQUENT_ERA_CODES = ["CO-45", "CO-253", "CO-97", "CO-16", "CO-18", "CO-29", "CO-50", "CO-96", "CO-197", "CO-204", "PR-1", "PR-2", "PR-3", "N575"];

const CARC_CODE_DESCRIPTIONS: Record<string, string> = ERA_CODE_OPTIONS.reduce((acc, item) => {
  acc[item.code] = `${item.group}: ${item.label}`;
  return acc;
}, {} as Record<string, string>);

type ServiceLineStatus =
  | "Not Billed"
  | "Submitted"
  | "Pending"
  | "Paid"
  | "Partially Paid"
  | "Denied"
  | "Rejected"
  | "Appealed"
  | "Corrected"
  | "Ready to Rebill"
  | "Resubmitted"
  | "Written Off";

interface ServiceLine {
  cpt: string;
  charged: number;
  allowed: number;
  adj: number;
  patResp: number;
  paid: number;
  secondaryPaid: number;
  secondaryPayerId: string;
  hasSecondaryPayment: boolean;
  balance: number;
  codes: string[];
  status: ServiceLineStatus;
  notes: ServiceLineNote[];
  nextAction: string;
  eftNumber: string;
  paymentDate: string;
}

interface ServiceLineNote {
  id: string;
  text: string;
  createdAt: string;
  createdBy: string;
  createdByEmail: string;
  updatedAt?: string;
  updatedBy?: string;
}

const SERVICE_LINE_STATUSES: ServiceLineStatus[] = [
  "Not Billed",
  "Submitted",
  "Pending",
  "Paid",
  "Partially Paid",
  "Denied",
  "Rejected",
  "Appealed",
  "Corrected",
  "Ready to Rebill",
  "Resubmitted",
  "Written Off"
];

const SERVICE_LINE_ACTIONS = [
  "No action",
  "Registrar EFT / Pago",
  "Verify ERA",
  "Request records",
  "Correct coding",
  "Check eligibility",
  "Obtain authorization",
  "Call payer",
  "File appeal",
  "Ready to rebill",
  "Monitor payment",
  "Close line"
];

interface EraCodePickerProps {
  codes: string[];
  lineKey: string;
  compact?: boolean;
  onChange: (codes: string[]) => void;
  disabled?: boolean;
}

function normalizeEraCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function EraCodePicker({ codes, lineKey, compact = false, onChange, disabled = false }: EraCodePickerProps) {
  const [draft, setDraft] = useState("");
  const [isExpanded, setIsExpanded] = useState(!compact);
  const normalizedCodes = codes.map(normalizeEraCode).filter(Boolean);
  const normalizedDraft = normalizeEraCode(draft);
  const datalistId = `era-code-options-${lineKey}`;
  const matchingOptions = ERA_CODE_OPTIONS.filter(item => {
    if (!normalizedDraft) return FREQUENT_ERA_CODES.includes(item.code);
    return (
      item.code.includes(normalizedDraft) ||
      item.label.toUpperCase().includes(normalizedDraft) ||
      item.group.toUpperCase().includes(normalizedDraft)
    );
  }).slice(0, compact ? 10 : 18);

  const addCode = (value: string) => {
    const code = normalizeEraCode(value);
    if (!code || normalizedCodes.includes(code)) return;
    onChange([...normalizedCodes, code]);
    setDraft("");
  };

  const toggleCode = (code: string) => {
    const normalized = normalizeEraCode(code);
    onChange(
      normalizedCodes.includes(normalized)
        ? normalizedCodes.filter(item => item !== normalized)
        : [...normalizedCodes, normalized]
    );
  };

  if (compact) {
    return (
      <div className="relative flex max-w-[220px] items-center gap-1">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap">
          {normalizedCodes.length === 0 && (
            <span className="text-[9px] italic text-slate-400">Sin códigos</span>
          )}
          {normalizedCodes.map(code => (
            <button
              disabled={disabled}
              type="button"
              key={code}
              onClick={() => toggleCode(code)}
              className="shrink-0 rounded border border-primary-blue bg-primary-blue px-1.5 py-0.5 font-mono text-[9px] font-bold text-white hover:border-rose-600 hover:bg-rose-600 disabled:opacity-80 disabled:hover:bg-primary-blue disabled:hover:border-primary-blue"
              title={`${CARC_CODE_DESCRIPTIONS[code] || "Código manual"}${disabled ? "" : " - click para quitar"}`}
            >
              {code} {disabled ? "" : "×"}
            </button>
          ))}
        </div>
        <button
          disabled={disabled}
          type="button"
          onClick={() => setIsExpanded(value => !value)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-primary-blue hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Añadir código CARC / RARC / MA"
          aria-label="Añadir código ERA"
        >
          {isExpanded && !disabled ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
        </button>

        {isExpanded && !disabled && (
          <div className="absolute right-0 top-8 z-30 w-80 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
            <div className="flex gap-1">
              <input
                type="text"
                list={datalistId}
                placeholder="Buscar código o descripción"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCode(draft);
                  }
                }}
                className="min-w-0 flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[10px] font-bold focus:bg-white"
              />
              <button type="button" onClick={() => addCode(draft)} className="rounded bg-primary-blue px-2 text-[9px] font-bold text-white">
                Add
              </button>
            </div>
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {matchingOptions.map(item => (
                <button
                  type="button"
                  key={item.code}
                  onClick={() => toggleCode(item.code)}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[8px] ${
                    normalizedCodes.includes(item.code)
                      ? "border-primary-blue bg-primary-blue text-white"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-blue-50"
                  }`}
                  title={item.label}
                >
                  {item.code}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-56 space-y-1.5">
      <datalist id={datalistId}>
        {ERA_CODE_OPTIONS.map(item => (
          <option key={item.code} value={item.code}>{item.label}</option>
        ))}
      </datalist>

      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {normalizedCodes.length === 0 ? (
            <span className="text-[9px] text-slate-400 italic">Sin códigos</span>
          ) : (
            normalizedCodes.map(code => (
              <button
                disabled={disabled}
                type="button"
                key={code}
                onClick={() => toggleCode(code)}
                className="shrink-0 bg-primary-blue text-white border border-primary-blue font-mono text-[9px] px-1.5 py-0.5 rounded font-bold shadow-xs hover:bg-rose-600 hover:border-rose-600 disabled:opacity-80 disabled:hover:bg-primary-blue disabled:hover:border-primary-blue"
                title={`${CARC_CODE_DESCRIPTIONS[code] || "Código manual"}${disabled ? "" : " - click para quitar"}`}
              >
                {code} {disabled ? "" : "×"}
              </button>
            ))
          )}
        </div>

        <div className="flex min-w-0 flex-1 gap-1">
          <select
            disabled={disabled}
            defaultValue=""
            onChange={(e) => {
              addCode(e.target.value);
              e.target.value = "";
            }}
            className="min-w-0 flex-1 border border-slate-200 rounded px-1.5 py-1 text-[9px] bg-white text-slate-600 font-semibold disabled:opacity-50"
            aria-label="Seleccionar código ERA rápido"
          >
            <option value="" disabled>Código rápido</option>
            <optgroup label="CARC / Ajustes">
              {ERA_CODE_OPTIONS.filter(item => ["CO-45", "CO-253", "CO-97", "CO-16", "CO-18", "CO-29", "CO-50", "CO-96", "CO-197", "CO-204", "OA-23"].includes(item.code)).map(item => (
                <option key={item.code} value={item.code}>{item.code} - {item.label}</option>
              ))}
            </optgroup>
            <optgroup label="Responsabilidad Paciente">
              {ERA_CODE_OPTIONS.filter(item => ["PR-1", "PR-2", "PR-3", "PR-27", "PR-96", "PR-119", "PR-204"].includes(item.code)).map(item => (
                <option key={item.code} value={item.code}>{item.code} - {item.label}</option>
              ))}
            </optgroup>
            <optgroup label="RARC / MA, M, N">
              {ERA_CODE_OPTIONS.filter(item => item.group === "RARC").map(item => (
                <option key={item.code} value={item.code}>{item.code} - {item.label}</option>
              ))}
            </optgroup>
          </select>
          <button
            disabled={disabled}
            type="button"
            onClick={() => setIsExpanded(value => !value)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title={isExpanded ? "Cerrar búsqueda" : "Buscar código"}
            aria-label={isExpanded ? "Cerrar búsqueda de código" : "Buscar código ERA"}
          >
            {isExpanded && !disabled ? <X className="h-3 w-3" /> : <Search className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-1.5">
          <div className="flex gap-1">
            <input
              type="text"
              list={datalistId}
              placeholder="Código o descripción"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCode(draft);
                }
              }}
              className="min-w-0 flex-1 border border-slate-200 rounded px-2 py-1 font-mono text-[10px] bg-slate-50 focus:bg-white font-bold"
            />
            <button
              type="button"
              onClick={() => addCode(draft)}
              className="px-2 py-1 rounded bg-slate-900 text-white text-[9px] font-bold hover:bg-primary-blue transition-colors"
            >
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {matchingOptions.map(item => {
              const isSelected = normalizedCodes.includes(item.code);
              return (
                <button
                  type="button"
                  key={item.code}
                  onClick={() => toggleCode(item.code)}
                  className={`text-[8px] px-1.5 py-0.5 rounded font-mono border transition-all ${
                    isSelected
                      ? "bg-primary-blue text-white border-primary-blue font-bold shadow-xs"
                      : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                  }`}
                  title={`${item.group}: ${item.label}`}
                >
                  {item.code}
                </button>
              );
            })}
          </div>
          {!compact && (
            <p className="text-[8px] leading-snug text-slate-400">
              Busca por código o problema. Acepta códigos manuales del ERA aunque no estén en la lista.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatFinancialValue(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value) || 0);
}

function FinancialSummary({
  totalBilled,
  adjustments,
  patientResponsibility,
  netPaid
}: {
  totalBilled: number;
  adjustments: number;
  patientResponsibility: number;
  netPaid: number;
}) {
  const paidPercent = totalBilled > 0 ? Math.round((netPaid / totalBilled) * 100) : 0;

  const cards = [
    {
      label: "TOTAL BILLED",
      value: totalBilled,
      className: "bg-slate-50 border-slate-200 text-slate-800",
      labelClassName: "text-slate-500",
      valueClassName: "text-black",
      note: ""
    },
    {
      label: "ADJUSTMENTS",
      value: adjustments,
      className: "bg-amber-50 border-amber-200 text-amber-600",
      labelClassName: "text-amber-600",
      valueClassName: "text-amber-600",
      note: ""
    },
    {
      label: "PATIENT RESP.",
      value: patientResponsibility,
      className: "bg-slate-50 border-slate-200 text-slate-900",
      labelClassName: "text-slate-500",
      valueClassName: "text-black",
      note: ""
    },
    {
      label: "NET PAID",
      value: netPaid,
      className: "bg-emerald-50 border-emerald-200 text-emerald-600",
      labelClassName: "text-emerald-600",
      valueClassName: "text-emerald-600",
      note: `${paidPercent}% of billed`
    }
  ];

  return (
    <section className="space-y-2.5">
      <h3 className="text-[11px] font-medium uppercase tracking-normal text-slate-500">FINANCIAL SUMMARY</h3>
      <div className="overflow-x-auto pb-1">
        <div className="grid grid-cols-4 gap-3 min-w-[760px]">
          {cards.map(card => (
            <div key={card.label} className={`rounded-lg border px-4 py-3 min-h-[76px] ${card.className}`}>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-[10px] font-bold uppercase tracking-normal ${card.labelClassName}`}>
                  {card.label}
                </span>
                {card.note && (
                  <span className="text-[10px] font-semibold text-emerald-700">
                    {card.note}
                  </span>
                )}
              </div>
              <div className={`mt-2 text-xl font-bold tracking-normal ${card.valueClassName}`}>
                {formatFinancialValue(card.value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

interface ClaimDetailPanelProps {
  claim: Claim;
  onClose: () => void;
  onUpdate: (updated: Partial<Claim>) => Promise<void>;
  onAddNote: (noteType: Note["note_type"], text: string) => Promise<void>;
  onAddPayment: (pmt: Partial<Payment>) => Promise<void>;
  notes: Note[];
  auditLogs: AuditLog[];
  userRole: string;
  currentUser: {
    name: string;
    email: string;
  };
  feeSchedules: FeeSchedule[];
  payers: Payer[];
  onSaveServiceLineNotes: (serviceLinesJson: string) => Promise<void>;
}

export function ClaimDetailPanel({
  claim,
  onClose,
  onUpdate,
  onAddNote,
  onAddPayment,
  notes,
  auditLogs,
  userRole,
  currentUser,
  feeSchedules,
  payers = [],
  onSaveServiceLineNotes
}: ClaimDetailPanelProps) {
  const { notify, confirmAction } = useFeedback();
  const isEnglish = localStorage.getItem("itera-language") !== "es";
  // Local form states
  const [status, setStatus] = useState<ClaimStatus>(claim.claim_status);
  const [classification, setClassification] = useState<ClaimClassification>(claim.claim_classification);
  const [billedBy, setBilledBy] = useState<"ITERA" | "Provider">(claim.billed_by);
  const [paymentReceivedBy, setPaymentReceivedBy] = useState<Claim["payment_received_by"]>(claim.payment_received_by);
  
  // Financial field states
  const [billedCharge, setBilledCharge] = useState(claim.billed_charge);
  const [allowedAmount, setAllowedAmount] = useState(claim.allowed_amount);
  const [paidAmount, setPaidAmount] = useState(claim.paid_amount);
  const [insuranceAdjustment, setInsuranceAdjustment] = useState(claim.insurance_adjustment);
  const [deniedAmount, setDeniedAmount] = useState(claim.denied_amount);
  const [writeOffAmount, setWriteOffAmount] = useState(claim.write_off_amount);
  const [uncollectibleAmount, setUncollectibleAmount] = useState(claim.uncollectible_amount);
  const [iteraDirect, setIteraDirect] = useState(claim.itera_direct_collection);
  const [providerDirect, setProviderDirect] = useState(claim.provider_direct_collection);
  const [paymentToPhysician, setPaymentToPhysician] = useState(claim.payment_to_physician);

  // Error & Correction Workflow
  const [errorFlag, setErrorFlag] = useState(claim.error_flag);
  const [errorCategory, setErrorCategory] = useState<ErrorCategory | "">(claim.error_category || "");
  const [locked, setLocked] = useState(claim.locked);
  const [lockReason, setLockReason] = useState(claim.lock_reason);
  const [correctionStatus, setCorrectionStatus] = useState<Claim["correction_status"]>(claim.correction_status);
  const [resubmissionDate, setResubmissionDate] = useState(claim.resubmission_date);
  const [correctedReference, setCorrectedReference] = useState(claim.corrected_claim_reference);

  // EOB / ERA Info
  const [eraReceived, setEraReceived] = useState<"Yes" | "No">(claim.era_received);
  const [eobReceived, setEobReceived] = useState<"Yes" | "No">(claim.eob_received);
  const [paymentDate, setPaymentDate] = useState(claim.payment_date);
  const [checkEftNumber, setCheckEftNumber] = useState(claim.check_or_eft_number);
  const [carcCode, setCarcCode] = useState(claim.carc_code);
  const [rarcCode, setRarcCode] = useState(claim.rarc_code);
  const [denialReason, setDenialReason] = useState(claim.denial_reason);

  // New Note state
  const [newNoteType, setNewNoteType] = useState<Note["note_type"]>("General");
  const [newNoteText, setNewNoteText] = useState("");

  // New Payment logger state
  const [logPaymentAmount, setLogPaymentAmount] = useState<number | "">("");
  const [logPaymentCheck, setLogPaymentCheck] = useState("");
  const [logPaymentSource, setLogPaymentSource] = useState("Manual");

  // Local state for CPT Service Lines Adjudication
  const [serviceLines, setServiceLines] = useState<ServiceLine[]>([]);
  const [secondaryEditorIndex, setSecondaryEditorIndex] = useState<number | null>(null);
  const [noteEditorIndex, setNoteEditorIndex] = useState<number | null>(null);
  const [serviceLineNoteDraft, setServiceLineNoteDraft] = useState("");
  const [editingServiceLineNoteId, setEditingServiceLineNoteId] = useState<string | null>(null);
  const [editingServiceLineNoteDraft, setEditingServiceLineNoteDraft] = useState("");
  const [isSavingServiceLineNote, setIsSavingServiceLineNote] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // ERA Quick Entry and Insurance change states
  const [isQuickEntryMode, setIsQuickEntryMode] = useState(true);
  const [isChangingInsurance, setIsChangingInsurance] = useState(false);
  const [newPayerIdState, setNewPayerIdState] = useState(claim.payer_id || "");
  const [insuranceChangeReason, setInsuranceChangeReason] = useState("");
  const [newMemberId, setNewMemberId] = useState("");

  const handleConfirmInsuranceChange = async () => {
    if (!newPayerIdState) {
      notify("Por favor selecciona una aseguradora válida.", "warning");
      return;
    }
    if (newPayerIdState === claim.payer_id) {
      notify("La aseguradora seleccionada es la misma que la actual. Selecciona una diferente para registrar el cambio.", "warning");
      return;
    }
    const selectedPayer = payers.find(p => p.payer_id === newPayerIdState);
    if (!selectedPayer) {
      notify("La aseguradora seleccionada no es válida.", "warning");
      return;
    }
    
    try {
      await onUpdate({
        payer_id: selectedPayer.payer_id,
        payer_name: selectedPayer.payer_name,
        insurance_change_reason: insuranceChangeReason || "Cambio reportado al procesar ERA",
        insurance_change_member_id: newMemberId || undefined,
      });
      
      setIsChangingInsurance(false);
      setInsuranceChangeReason("");
      setNewMemberId("");
      notify(`Seguro actualizado a ${selectedPayer.payer_name}. El cambio quedó registrado en el historial del claim.`, "success");
    } catch (err: any) {
      notify(`Error al registrar cambio de seguro: ${err.message}`, "error");
    }
  };

  // Helper to parse or auto-initialize service lines for a claim
  const initializeServiceLines = (c: Claim): ServiceLine[] => {
    const codes = splitCptCodes(c.cpt_hcpcs);
    
    let parsed: ServiceLine[] = [];
    if (c.service_lines_json) {
      try {
        parsed = JSON.parse(c.service_lines_json);
      } catch (err) {
        console.warn("Failed to parse service_lines_json", err);
      }
    }
    
    const result: ServiceLine[] = [];
    
    const dosParts = c.date_of_service_from ? c.date_of_service_from.split("-") : [];
    const claimYear = dosParts[0] ? parseInt(dosParts[0]) : 2026;
    const dosMonth = dosParts[1] ? parseInt(dosParts[1], 10) : 1;
    const isSemester1 = dosMonth >= 1 && dosMonth <= 6;

    codes.forEach((cptCode) => {
      const existing = parsed.find(p => p.cpt === cptCode) as (ServiceLine & { note?: string }) | undefined;
      if (existing) {
        result.push({
          cpt: existing.cpt,
          charged: existing.charged !== undefined ? existing.charged : 0,
          allowed: existing.allowed !== undefined ? existing.allowed : 0,
          adj: existing.adj !== undefined ? existing.adj : 0,
          patResp: existing.patResp !== undefined ? existing.patResp : 0,
          paid: existing.paid !== undefined ? existing.paid : 0,
          secondaryPaid: existing.secondaryPaid !== undefined ? existing.secondaryPaid : 0,
          secondaryPayerId: existing.secondaryPayerId || "",
          hasSecondaryPayment: existing.hasSecondaryPayment || Number(existing.secondaryPaid) > 0,
          balance: existing.balance !== undefined ? existing.balance : 0,
          codes: existing.codes || [],
          status: existing.status || (existing.paid > 0 ? "Paid" : "Pending"),
          notes: Array.isArray(existing.notes)
            ? existing.notes.map((note, index) => ({
                id: note.id || `legacy-${cptCode}-${index}`,
                text: note.text || "",
                createdAt: note.createdAt || c.updated_at || new Date().toISOString(),
                createdBy: note.createdBy || note.updatedBy || "Usuario no registrado",
                createdByEmail: note.createdByEmail || "",
                updatedAt: note.updatedAt,
                updatedBy: note.updatedBy
              }))
            : existing.note
              ? [{
                  id: `legacy-${cptCode}`,
                  text: existing.note,
                  createdAt: c.updated_at || new Date().toISOString(),
                  createdBy: c.updated_by || "Usuario no registrado",
                  createdByEmail: c.updated_by || ""
                }]
              : [],
          nextAction: existing.nextAction || "No action",
          eftNumber: existing.eftNumber || "",
          paymentDate: existing.paymentDate || ""
        });
      } else {
        const fsEntry = feeSchedules?.find(fs => fs.cpt_code === cptCode && fs.year === claimYear);
        const officialRate = fsEntry ? (isSemester1 ? fsEntry.semester1_rate : fsEntry.semester2_rate) : 50;
        const charged = officialRate;
        
        const isSingleCpt = codes.length === 1;
        const paid = isSingleCpt ? c.paid_amount : 0;
        const allowed = isSingleCpt ? c.allowed_amount : charged;
        const adj = charged - allowed;

        result.push({
          cpt: cptCode,
          charged: Number(charged.toFixed(2)),
          allowed: Number(allowed.toFixed(2)),
          adj: Number(adj.toFixed(2)),
          patResp: 0,
          paid: Number(paid.toFixed(2)),
          secondaryPaid: 0,
          secondaryPayerId: "",
          hasSecondaryPayment: false,
          balance: Number((allowed - paid).toFixed(2)),
          codes: c.carc_code ? [c.carc_code] : [],
          status: paid > 0 ? (paid >= allowed ? "Paid" : "Partially Paid") : "Pending",
          notes: [],
          nextAction: "No action",
          eftNumber: "",
          paymentDate: ""
        });
      }
    });
    
    return result;
  };

  // Sync state if claim changes
  useEffect(() => {
    setStatus(claim.claim_status);
    setClassification(claim.claim_classification);
    setBilledBy(claim.billed_by);
    setPaymentReceivedBy(claim.payment_received_by);
    setBilledCharge(claim.billed_charge);
    setAllowedAmount(claim.allowed_amount);
    setPaidAmount(claim.paid_amount);
    setInsuranceAdjustment(claim.insurance_adjustment);
    setDeniedAmount(claim.denied_amount);
    setWriteOffAmount(claim.write_off_amount);
    setUncollectibleAmount(claim.uncollectible_amount);
    setIteraDirect(claim.itera_direct_collection);
    setProviderDirect(claim.provider_direct_collection);
    setPaymentToPhysician(claim.payment_to_physician);
    setErrorFlag(claim.error_flag);
    setErrorCategory(claim.error_category || "");
    setLocked(claim.locked);
    setLockReason(claim.lock_reason);
    setCorrectionStatus(claim.correction_status);
    setResubmissionDate(claim.resubmission_date);
    setCorrectedReference(claim.corrected_claim_reference);
    setEraReceived(claim.era_received);
    setEobReceived(claim.eob_received);
    setPaymentDate(claim.payment_date);
    setCheckEftNumber(claim.check_or_eft_number);
    setCarcCode(claim.carc_code);
    setRarcCode(claim.rarc_code);
    setDenialReason(claim.denial_reason);
    setNewPayerIdState(claim.payer_id || "");
    setShowValidationErrors(false);
    
    setServiceLines(initializeServiceLines(claim));
  }, [claim, feeSchedules]);

  // Automatically compute totals from Service Lines when they change
  useEffect(() => {
    if (serviceLines.length === 0) return;
    
    const totalCharged = serviceLines.reduce((acc, l) => acc + (l.charged || 0), 0);
    const totalAllowed = serviceLines.reduce((acc, l) => acc + (l.allowed || 0), 0);
    const totalPaid = serviceLines.reduce((acc, l) => acc + (Number(l.paid) || 0) + (Number(l.secondaryPaid) || 0), 0);
    const totalAdj = serviceLines.reduce((acc, l) => acc + (l.adj || 0), 0);
    const totalDenied = serviceLines.reduce((acc, l) => acc + (l.codes?.length > 0 ? (l.charged - l.paid - l.secondaryPaid - l.patResp) : 0), 0);
    
    setBilledCharge(Number(totalCharged.toFixed(2)));
    setAllowedAmount(Number(totalAllowed.toFixed(2)));
    setPaidAmount(Number(totalPaid.toFixed(2)));
    setInsuranceAdjustment(Number(totalAdj.toFixed(2)));
    
    if (totalDenied > 0) {
      setDeniedAmount(Number(totalDenied.toFixed(2)));
    }

    // Auto update collections
    if (paymentReceivedBy === "ITERA") {
      setIteraDirect(Number(totalPaid.toFixed(2)));
      setProviderDirect(0);
    } else if (paymentReceivedBy === "Provider") {
      setProviderDirect(Number(totalPaid.toFixed(2)));
      setIteraDirect(0);
    }
  }, [serviceLines, paymentReceivedBy]);

  const handleUpdateServiceLine = (index: number, field: keyof ServiceLine, value: any) => {
    setServiceLines(prev => {
      const copy = [...prev];
      const line = { ...copy[index] };
      
      if (field === "codes") {
        line.codes = value;
      } else if (field === "status" || field === "nextAction" || field === "secondaryPayerId") {
        line[field] = value;
      } else if (field === "notes") {
        line.notes = value;
      } else if (field === "hasSecondaryPayment") {
        line.hasSecondaryPayment = Boolean(value);
        if (!value) {
          line.secondaryPaid = 0;
          line.secondaryPayerId = "";
        }
      } else if (field === "secondaryPaid") {
        line.secondaryPaid = value === "" ? "" : (Number(value) || 0);
        if (Number(line.secondaryPaid) > 0) {
          line.hasSecondaryPayment = true;
        }
      } else {
        line[field] = value === "" ? "" : (Number(value) || 0);
      }
      
      // Compute adj = charged - allowed
      const chargedNum = Number(line.charged) || 0;
      const allowedNum = Number(line.allowed) || 0;
      const paidNum = Number(line.paid) || 0;
      const secondaryPaidNum = Number(line.secondaryPaid) || 0;
      const patRespNum = Number(line.patResp) || 0;

      line.adj = Number((chargedNum - allowedNum).toFixed(2));
      line.balance = Number((allowedNum - paidNum - secondaryPaidNum - patRespNum).toFixed(2));
      
      copy[index] = line;
      return copy;
    });
  };

  const persistServiceLineNotes = async (nextServiceLines: ServiceLine[]) => {
    setIsSavingServiceLineNote(true);
    try {
      setServiceLines(nextServiceLines);
      await onSaveServiceLineNotes(JSON.stringify(nextServiceLines));
    } catch (error) {
      setServiceLines(serviceLines);
      notify(error instanceof Error ? error.message : "No se pudieron guardar las notas del CPT.", "error");
      throw error;
    } finally {
      setIsSavingServiceLineNote(false);
    }
  };

  const addServiceLineNote = async () => {
    if (noteEditorIndex === null || !serviceLineNoteDraft.trim() || isSavingServiceLineNote) return;
    const nextServiceLines = serviceLines.map((line, index) => index === noteEditorIndex
      ? {
          ...line,
          notes: [
            ...line.notes,
            {
              id: `cpt-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              text: serviceLineNoteDraft.trim(),
              createdAt: new Date().toISOString(),
              createdBy: currentUser.name,
              createdByEmail: currentUser.email
            }
          ]
        }
      : line);
    await persistServiceLineNotes(nextServiceLines);
    setServiceLineNoteDraft("");
  };

  const startEditingServiceLineNote = (note: ServiceLineNote) => {
    setEditingServiceLineNoteId(note.id);
    setEditingServiceLineNoteDraft(note.text);
  };

  const saveEditedServiceLineNote = async () => {
    if (noteEditorIndex === null || !editingServiceLineNoteId || !editingServiceLineNoteDraft.trim() || isSavingServiceLineNote) return;
    const nextServiceLines = serviceLines.map((line, index) => index === noteEditorIndex
      ? {
          ...line,
          notes: line.notes.map(note => note.id === editingServiceLineNoteId
            ? {
                ...note,
                text: editingServiceLineNoteDraft.trim(),
                updatedAt: new Date().toISOString(),
                updatedBy: currentUser.name
              }
            : note)
        }
      : line);
    await persistServiceLineNotes(nextServiceLines);
    setEditingServiceLineNoteId(null);
    setEditingServiceLineNoteDraft("");
  };

  const deleteServiceLineNote = async (noteId: string) => {
    if (noteEditorIndex === null || isSavingServiceLineNote) return;
    const confirmed = await confirmAction({
      title: "Eliminar nota",
      message: "¿Eliminar esta nota de forma permanente?",
      confirmLabel: "Eliminar nota",
      tone: "danger"
    });
    if (!confirmed) return;
    const nextServiceLines = serviceLines.map((line, index) => index === noteEditorIndex
      ? { ...line, notes: line.notes.filter(note => note.id !== noteId) }
      : line);
    await persistServiceLineNotes(nextServiceLines);
    if (editingServiceLineNoteId === noteId) {
      setEditingServiceLineNoteId(null);
      setEditingServiceLineNoteDraft("");
    }
  };

  // Read-only conditions based on roles
  const canEditClaims = ["Admin", "Billing Manager", "Reconciliation Specialist"].includes(userRole);
  const canCloseClaims = ["Admin", "Billing Manager"].includes(userRole);
  // When a claim is locked, it shouldn't allow any changes or payment entries, only notes/payers.
  const isReadOnly = !canEditClaims || locked;

  const handleSaveClaim = async () => {
    if (isReadOnly) return;
    try {
      const validationErrors = serviceLineValidationAllErrors;

      if (validationErrors.length > 0) {
        setShowValidationErrors(true);
        notify("Corrige los errores marcados debajo de cada service line antes de guardar.", "warning");
        return;
      }

      const updates: Partial<Claim> = {
        claim_status: status,
        claim_classification: classification,
        billed_by: billedBy,
        payment_received_by: paymentReceivedBy,
        billed_charge: Number(billedCharge),
        allowed_amount: Number(allowedAmount),
        paid_amount: Number(paidAmount),
        insurance_adjustment: Number(insuranceAdjustment),
        denied_amount: Number(deniedAmount),
        write_off_amount: Number(writeOffAmount),
        uncollectible_amount: Number(uncollectibleAmount),
        itera_direct_collection: Number(iteraDirect),
        provider_direct_collection: Number(providerDirect),
        payment_to_physician: Number(paymentToPhysician),
        error_flag: errorFlag,
        error_category: errorCategory || "",
        locked,
        lock_reason: lockReason,
        correction_status: correctionStatus,
        resubmission_date: resubmissionDate,
        corrected_claim_reference: correctedReference,
        era_received: eraReceived,
        eob_received: eobReceived,
        payment_date: paymentDate,
        check_or_eft_number: checkEftNumber,
        carc_code: carcCode,
        rarc_code: rarcCode,
        denial_reason: denialReason,
        service_lines_json: JSON.stringify(serviceLines)
      };

      await onUpdate(updates);
      setShowValidationErrors(false);
      notify("Claim guardado y conciliado correctamente.", "success");
    } catch (err: any) {
      notify(`Error al guardar claim: ${err.message}`, "error");
    }
  };

  const handlePostNote = async () => {
    if (!newNoteText.trim()) return;
    try {
      await onAddNote(newNoteType, newNoteText);
      setNewNoteText("");
      notify("Nota registrada.", "success");
    } catch (err: any) {
      notify(`Error al guardar nota: ${err.message}`, "error");
    }
  };

  const handleLogPayment = async () => {
    if (!logPaymentAmount || Number(logPaymentAmount) <= 0) {
      notify("Registra un valor numérico positivo de cobro.", "warning");
      return;
    }
    try {
      const receiver = paymentReceivedBy === "ITERA" || paymentReceivedBy === "Unknown" ? "ITERA" : "Provider";
      await onAddPayment({
        claim_id: claim.claim_id,
        amount: Number(logPaymentAmount),
        check_or_eft_number: logPaymentCheck || `EFT-${Date.now()}`,
        payment_received_by: receiver,
        payment_source: logPaymentSource,
        payment_date: new Date().toISOString().split("T")[0],
        notes: `Registrado manualmente desde el portal de conciliación.`
      });
      setLogPaymentAmount("");
      setLogPaymentCheck("");
      notify("Cobro aplicado correctamente.", "success");
    } catch (err: any) {
      notify(`Error al registrar cobro: ${err.message}`, "error");
    }
  };

  const filteredNotes = notes.filter(n => n.claim_id === claim.claim_id);
  const filteredAudits = auditLogs.filter(a => a.claim_id === claim.claim_id);
  
  const cptCodes = splitCptCodes(claim.cpt_hcpcs);
  const patientResponsibilityTotal = serviceLines.reduce((acc, line) => acc + (Number(line.patResp) || 0), 0);
  const totalAdjustments = Number(insuranceAdjustment || 0) + Number(deniedAmount || 0) + Number(writeOffAmount || 0) + Number(uncollectibleAmount || 0);
  const suggestedClaimStatus = (() => {
    if (serviceLines.length === 0) return ClaimStatus.Pending;

    const lineStatuses = serviceLines.map(line => line.status);
    const allPaid = lineStatuses.every(lineStatus => lineStatus === "Paid");
    const allDenied = lineStatuses.every(lineStatus => lineStatus === "Denied" || lineStatus === "Rejected");
    const hasPaid = lineStatuses.some(lineStatus => lineStatus === "Paid" || lineStatus === "Partially Paid");
    const hasDenied = lineStatuses.some(lineStatus => lineStatus === "Denied" || lineStatus === "Rejected");
    const hasAppeal = lineStatuses.some(lineStatus => lineStatus === "Appealed");
    const hasResubmission = lineStatuses.some(lineStatus => lineStatus === "Resubmitted");
    const hasRebill = lineStatuses.some(lineStatus => lineStatus === "Ready to Rebill");

    if (allPaid) return ClaimStatus.Paid;
    if (allDenied) return ClaimStatus.Denied;
    if (hasPaid && hasDenied) return ClaimStatus.PartiallyPaid;
    if (hasAppeal) return ClaimStatus.Appealed;
    if (hasResubmission) return ClaimStatus.Resubmitted;
    if (hasRebill) return ClaimStatus.ReadyToRebill;
    if (hasPaid) return ClaimStatus.PartiallyPaid;
    return ClaimStatus.Pending;
  })();
  const statusMatchesSuggestion = status === suggestedClaimStatus;
  const serviceLineValidation = validateServiceLineDetails(serviceLines, {
    ...claim,
    claim_status: status,
    billed_charge: Number(billedCharge),
    allowed_amount: Number(allowedAmount),
    paid_amount: Number(paidAmount)
  });
  const repeatLimitLineErrors = validateCptRepeatLimitsByLine(serviceLines, feeSchedules, claim.date_of_service_from);
  const serviceLineErrors = Object.keys({
    ...serviceLineValidation.lineErrors,
    ...repeatLimitLineErrors
  }).reduce<Record<number, string[]>>((acc, key) => {
    const index = Number(key);
    acc[index] = [
      ...(serviceLineValidation.lineErrors[index] || []),
      ...(repeatLimitLineErrors[index] || [])
    ];
    return acc;
  }, {});
  const claimValidationErrors = serviceLineValidation.claimErrors;
  const serviceLineValidationAllErrors = [
    ...serviceLineValidation.allErrors,
    ...Object.values(repeatLimitLineErrors).flat()
  ];

  const formatUSD = (val: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
  };

  const FIELD_LABELS: Record<string, string> = {
    claim_status: "Estado del Claim",
    claim_classification: "Clasificación",
    billed_by: "Facturado por",
    payment_received_by: "Pago recibido por",
    billed_charge: "Charge Facturado",
    allowed_amount: "Importe Permitido",
    paid_amount: "Importe Pagado",
    insurance_adjustment: "Ajuste Seguro",
    denied_amount: "Importe Denegado",
    write_off_amount: "Write-off",
    uncollectible_amount: "Incobrable",
    itera_direct_collection: "Colección ITERA",
    provider_direct_collection: "Colección Provider",
    payment_to_physician: "Pago Médico",
    locked: "Bloqueo Administrativo",
    lock_reason: "Motivo de Bloqueo",
    error_flag: "Bandera de Error",
    error_category: "Categoría de Error",
    correction_status: "Fase de Corrección",
    resubmission_date: "Fecha de Re-envío",
    corrected_claim_reference: "Referencia Claim Corregido",
    service_lines_json: "Notas CPT / Líneas de Servicio",
    payer_id: "🔄 Cambio de Seguro",
  };

  const renderClaimTimeline = (className = "") => {
    const sortedAudits = [...filteredAudits].sort((a, b) => b.changed_at.localeCompare(a.changed_at));
    const isEnglish = localStorage.getItem("itera-language") !== "es";
    const parseAuditServiceLines = (value: string | null) => {
      if (!value) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const formatAuditValue = (field: string, value: any) => {
      if (field === "paid" || field === "secondaryPaid" || field === "allowed" || field === "patResp" || field === "balance") {
        return formatUSD(Number(value) || 0);
      }
      if (field === "secondaryPayerId") {
        return payers.find(p => p.payer_id === value)?.payer_name || value || "None";
      }
      if (field === "codes") {
        return Array.isArray(value) && value.length > 0 ? value.join(", ") : "No codes";
      }
      return value || "N/A";
    };
    const getServiceLineEventSummary = (previousValue: string | null, newValue: string | null, reason: string) => {
      if (reason && reason !== "Service lines updated") return reason;

      const previousLines = parseAuditServiceLines(previousValue);
      const nextLines = parseAuditServiceLines(newValue);
      if (previousLines.length === 0 && nextLines.length > 0) {
        return `Service lines created: ${nextLines.map((line: any) => `CPT ${line.cpt}`).join(", ")}`;
      }
      if (previousLines.length > 0 && nextLines.length === 0) {
        return "Service lines removed";
      }

      const watchedFields = [
        ["status", "status"],
        ["paid", "primary paid"],
        ["secondaryPaid", "secondary paid"],
        ["secondaryPayerId", "secondary payer"],
        ["allowed", "allowed"],
        ["patResp", "patient resp."],
        ["balance", "balance"],
        ["codes", "ERA codes"],
        ["nextAction", "next action"],
        ["eftNumber", "EFT"],
        ["paymentDate", "payment date"]
      ] as const;
      const changes: string[] = [];

      nextLines.forEach((nextLine: any, index: number) => {
        const previousLine = previousLines.find((line: any) => line?.cpt === nextLine?.cpt) || previousLines[index];
        if (!previousLine) {
          changes.push(`CPT ${nextLine.cpt} added`);
          return;
        }

        const previousNotes = Array.isArray(previousLine.notes) ? previousLine.notes : [];
        const nextNotes = Array.isArray(nextLine.notes) ? nextLine.notes : [];
        if (previousNotes.length !== nextNotes.length) {
          changes.push(`CPT ${nextLine.cpt} notes ${previousNotes.length} -> ${nextNotes.length}`);
        }

        watchedFields.forEach(([field, label]) => {
          const previousRaw = field === "codes" ? JSON.stringify(previousLine[field] || []) : previousLine[field];
          const nextRaw = field === "codes" ? JSON.stringify(nextLine[field] || []) : nextLine[field];
          if (String(previousRaw ?? "") !== String(nextRaw ?? "")) {
            changes.push(`CPT ${nextLine.cpt} ${label}: ${formatAuditValue(field, previousLine[field])} -> ${formatAuditValue(field, nextLine[field])}`);
          }
        });
      });

      previousLines.forEach((previousLine: any) => {
        if (!nextLines.some((line: any) => line?.cpt === previousLine?.cpt)) {
          changes.push(`CPT ${previousLine.cpt} removed`);
        }
      });

      if (changes.length === 0) return "Service lines updated";
      return changes.length > 2 ? `${changes.slice(0, 2).join(" • ")} • +${changes.length - 2} more` : changes.join(" • ");
    };
    const getDisplayValue = (field: string, val: string | null) => {
      if (!val) return "N/A";
      if (field === "service_lines_json") {
        const lines = parseAuditServiceLines(val);
        return lines.length > 0 ? `${lines.length} CPT service line${lines.length === 1 ? "" : "s"}` : "No service lines";
      }
      if (field === "payer_id") {
        return payers.find(p => p.payer_id === val)?.payer_name || val;
      }
      return val;
    };
    return (
      <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary-blue" />
            <div>
              <h5 className="text-xs font-bold text-slate-800">
                {isEnglish ? "Claim Change Timeline" : "Timeline de Cambios del Claim"}
              </h5>
              <p className="text-[10px] text-slate-400">
                {isEnglish 
                  ? "Compact events showing user, field, previous value, new value, and date/time."
                  : "Eventos compactos con usuario, campo, valor anterior, valor nuevo y fecha/hora."}
              </p>
            </div>
          </div>
          <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-dark-blue">
            {sortedAudits.length} {isEnglish 
              ? (sortedAudits.length === 1 ? "event" : "events")
              : (sortedAudits.length === 1 ? "evento" : "eventos")}
          </span>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {sortedAudits.length === 0 ? (
            <div className="m-4 rounded-lg border border-dashed border-slate-200 py-7 text-center text-xs italic text-slate-400">
              {isEnglish ? "No changes saved yet for this claim." : "Ningún cambio guardado todavía para este claim."}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sortedAudits.map((audit) => {
                const isInsuranceChange = audit.field_name === "payer_id";
                const isServiceLinesChange = audit.field_name === "service_lines_json";
                const friendlyFieldName = FIELD_LABELS[audit.field_name] || audit.field_name;
                const serviceLineSummary = isServiceLinesChange
                  ? getServiceLineEventSummary(audit.previous_value, audit.new_value, audit.reason)
                  : "";
                if (isServiceLinesChange) {
                  return (
                    <div
                      key={audit.audit_id}
                      className="grid min-w-[980px] grid-cols-[130px_190px_minmax(360px,1fr)_170px] items-center gap-2 px-4 py-2 text-[10px] hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50">
                          <History className="h-3 w-3 text-primary-blue" />
                        </span>
                        <span className="whitespace-nowrap rounded-md bg-primary-blue px-1.5 py-0.5 text-[8px] font-bold uppercase text-white">
                          {audit.action_type}
                        </span>
                      </div>

                      <span className="truncate font-semibold text-slate-700" title={audit.field_name}>
                        {friendlyFieldName}
                      </span>

                      <div className="flex min-w-0 items-center gap-2 rounded-md border border-blue-100 bg-blue-50/50 px-2 py-1.5">
                        <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-primary-blue">
                          {isEnglish ? "Event" : "Evento"}
                        </span>
                        <span className="truncate font-semibold text-slate-700" title={serviceLineSummary}>
                          {serviceLineSummary}
                        </span>
                      </div>

                      <div className="flex min-w-0 items-center justify-end gap-2 font-mono text-[9px] text-slate-400">
                        <span className="truncate font-bold text-slate-500" title={audit.changed_by}>
                          {audit.changed_by}
                        </span>
                        <span className="shrink-0">{new Date(audit.changed_at).toLocaleString(isEnglish ? "en-US" : "es-ES")}</span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={audit.audit_id}
                    className={`grid min-w-[980px] grid-cols-[130px_140px_minmax(120px,1.2fr)_14px_minmax(120px,1.2fr)_minmax(220px,2.2fr)_170px] items-center gap-2 px-4 py-2 text-[10px] hover:bg-slate-50 ${isInsuranceChange ? "bg-emerald-50/40 border-l-2 border-l-emerald-400" : ""}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${isInsuranceChange ? "border-emerald-200 bg-emerald-100" : "border-blue-200 bg-blue-50"}`}>
                        {isInsuranceChange
                          ? <Shield className="h-3 w-3 text-emerald-600" />
                          : <History className="h-3 w-3 text-primary-blue" />}
                      </span>
                      <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase text-white ${isInsuranceChange ? "bg-emerald-600" : "bg-primary-blue"}`}>
                        {audit.action_type}
                      </span>
                    </div>

                    <span className={`truncate font-semibold ${isInsuranceChange ? "text-emerald-700" : "font-mono text-slate-700"}`} title={audit.field_name}>
                      {friendlyFieldName}
                    </span>

                    <div className="flex min-w-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1">
                      <span className="shrink-0 text-[8px] font-bold uppercase tracking-wider text-slate-400">
                        {isEnglish ? "Before" : "Antes"}
                      </span>
                      <span className={`truncate text-slate-500 ${isInsuranceChange ? "font-semibold text-slate-700" : "font-mono"}`} title={getDisplayValue(audit.field_name, audit.previous_value)}>
                        {getDisplayValue(audit.field_name, audit.previous_value)}
                      </span>
                    </div>

                    <span className="text-center font-bold text-slate-300">→</span>

                    <div className={`flex min-w-0 items-center gap-1 rounded-md border px-2 py-1 ${isInsuranceChange ? "border-emerald-200 bg-emerald-50" : "border-emerald-100 bg-emerald-50/60"}`}>
                      <span className="shrink-0 text-[8px] font-bold uppercase tracking-wider text-emerald-600">
                        {isEnglish ? "After" : "Después"}
                      </span>
                      <span className={`truncate font-bold text-emerald-800 ${isInsuranceChange ? "" : "font-mono"}`} title={getDisplayValue(audit.field_name, audit.new_value)}>
                        {getDisplayValue(audit.field_name, audit.new_value)}
                      </span>
                    </div>

                    <span className="truncate text-slate-500 font-medium" title={audit.reason}>
                      {audit.reason}
                    </span>

                    <div className="flex min-w-0 items-center justify-end gap-2 font-mono text-[9px] text-slate-400">
                      <span className="truncate font-bold text-slate-500" title={audit.changed_by}>
                        {audit.changed_by}
                      </span>
                      <span className="shrink-0">{new Date(audit.changed_at).toLocaleString(isEnglish ? "en-US" : "es-ES")}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-100 animate-fade-in">
      <div className="bg-white w-screen h-screen flex flex-col overflow-hidden transition-all duration-300">
        
        {/* Detail Panel Header */}
        <div className="relative shrink-0 overflow-x-auto border-b border-slate-200 bg-gradient-to-r from-white via-sky-50/50 to-emerald-50/40 px-4 py-3">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
            aria-label={isEnglish ? "Close panel" : "Cerrar panel"}
          >
            <X className="w-4.5 h-4.5" />
          </button>

          <div className="grid min-w-[1180px] grid-cols-[1.35fr_1fr_1.35fr_1fr_1fr] gap-2 pr-9">
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/80 px-3 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-blue text-white shadow-sm">
                <FileCheck className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-sm font-bold tracking-wide text-dark-blue">{claim.claim_id}</span>
                  <StatusBadge status={claim.claim_status} />
                  <ClassificationBadge classification={claim.claim_classification} />
                </div>
                <p className="mt-0.5 truncate text-[9px] text-slate-500">{isEnglish ? "Quick audit and reconciliation" : "Auditoría y conciliación rápida"}</p>
              </div>
            </div>

            <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
              <span className="itera-label block">{isEnglish ? "Patient" : "Paciente"}</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-800">{claim.patient_display_name_masked}</span>
              <span className="block truncate font-mono text-[9px] text-slate-400">ID: {claim.patient_id}</span>
            </div>

            <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
              <span className="itera-label block">{isEnglish ? "Provider / Clinic" : "Médico / Clinic"}</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-800">{claim.provider_name}</span>
              <span className="block truncate font-mono text-[9px] text-slate-400">NPI: {claim.provider_npi} • {claim.practice_name}</span>
            </div>

            <div className="min-w-0 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 shadow-sm">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-emerald-700">{isEnglish ? "Insurance" : "Aseguradora"}</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-emerald-800">{claim.payer_name}</span>
              <span className="block truncate font-mono text-[9px] text-emerald-600/70">ID: {claim.payer_id}</span>
            </div>

            <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
              <span className="itera-label block">{isEnglish ? "Visit" : "Visita"}</span>
              <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-800">DOS: {claim.date_of_service_from}</span>
              <span className="block truncate font-mono text-[9px] text-slate-400">Tipo: {claim.service_type || "N/A"}</span>
            </div>
          </div>
        </div>

        {/* Sub-Header Tab Selector */}
        <div className="bg-white px-5 py-2.5 flex flex-wrap gap-2 items-center justify-between border-b border-slate-200 text-xs text-slate-600 shrink-0 select-none">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsQuickEntryMode(true)}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                isQuickEntryMode
                  ? "bg-primary-blue text-white shadow-sm"
                  : "border border-slate-200 bg-slate-50 hover:border-blue-200 hover:bg-blue-50 hover:text-dark-blue"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{isEnglish ? "Quick ERA Entry" : "Carga Rápida ERA (Optimizado PC)"}</span>
            </button>
            <button
              onClick={() => setIsQuickEntryMode(false)}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                !isQuickEntryMode
                  ? "bg-primary-blue text-white shadow-sm"
                  : "border border-slate-200 bg-slate-50 hover:border-blue-200 hover:bg-blue-50 hover:text-dark-blue"
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{isEnglish ? "Full Audit Worksheet" : "Ficha Completa de Auditoría"}</span>
            </button>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[10px] text-slate-400 font-mono">
            <span className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-slate-500">{isEnglish ? "Tip: use [TAB] to move between cells" : "Tip: [TAB] para saltar celdas"}</span>
            <span>{isEnglish ? "Adjustments calculate instantly" : "Ajustes calculan al instante"}</span>
          </div>
        </div>

        {/* Conditionally Render Body */}
        {isQuickEntryMode ? (
          <div className="flex-1 overflow-y-auto p-4 lg:p-6 bg-slate-50 font-sans">
            
            {/* ALERT BANNERS */}
            {locked && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex gap-3 text-red-800 text-xs">
                <Lock className="w-4 h-4 text-red-600 shrink-0 mt-0.5 animate-pulse" />
                <div>
                  <h5 className="font-bold uppercase tracking-wider text-rose-800">Claim Bloqueado (Locked)</h5>
                  <p className="mt-1 font-semibold text-slate-700">{lockReason || "Este claim está bloqueado debido a errores financieros o administrativos."}</p>
                </div>
              </div>
            )}
            
            {errorFlag && !locked && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex gap-3 text-amber-800 text-xs">
                <AlertOctagon className="w-4 h-4 text-accent-orange shrink-0 mt-0.5 animate-bounce-subtle" />
                <div>
                  <h5 className="font-bold uppercase tracking-wider text-amber-800">Error en Claim Detectado</h5>
                  <p className="mt-1 font-semibold text-slate-700">Categoría: {errorCategory || "No especificado"}. Requiere corregir antes de re-facturar.</p>
                </div>
              </div>
            )}

            <div className="mb-6">
              <FinancialSummary
                totalBilled={Number(billedCharge)}
                adjustments={totalAdjustments}
                patientResponsibility={patientResponsibilityTotal}
                netPaid={Number(paidAmount)}
              />
            </div>

            {/* FULL-WIDTH SECTION: Service Lines Capture */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col space-y-3 mb-6 animate-fade-in w-full">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-4.5 h-4.5 text-amber-500 animate-pulse" />
                  <div>
                    <h4 className="font-bold text-slate-800 text-xs">Captura de Líneas del ERA (Service Lines)</h4>
                    <p className="text-[10px] text-slate-400">Concilia pagos primarios y secundarios de manera independiente por cada CPT.</p>
                  </div>
                </div>
                <span className="rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1 text-[9px] font-semibold text-dark-blue">
                  Charged proviene de Billing y es solo lectura
                </span>
              </div>

              <div className="w-full overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[1680px] text-left border-collapse text-[10px] font-sans">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 font-bold bg-slate-50 text-[9px] uppercase tracking-wider select-none">
                      <th className="px-3 py-3 w-44">CPT Code</th>
                      <th className="px-3 py-3 w-36">Status</th>
                      <th className="px-3 py-3 w-24 text-right">Charged</th>
                      <th className="px-3 py-3 w-24 text-right">Allowed</th>
                      <th className="px-3 py-3 w-20 text-right">Adj</th>
                      <th className="px-3 py-3 w-24 text-right">Pat. resp</th>
                      <th className="px-3 py-3 w-52 text-right">Paid (P + S + Total)</th>
                      <th className="px-3 py-3 w-20 text-right">Balance</th>
                      <th className="px-3 py-3 w-36">EFT / Cheque #</th>
                      <th className="px-3 py-3 w-32">Fecha Pago</th>
                      <th className="px-3 py-3 min-w-[240px]">CARC / RARC / MA</th>
                      <th className="px-3 py-3 min-w-[170px]">Next action</th>
                      <th className="px-3 py-3 w-20 text-center">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {serviceLines.map((line, idx) => {
                      const fsEntry = feeSchedules?.find(fs => fs.cpt_code === line.cpt);
                      const desc = fsEntry?.description || COMMON_CPT_DESCRIPTIONS[line.cpt] || "Procedimiento";
                      const lineValidationErrors = showValidationErrors ? serviceLineErrors[idx] || [] : [];
                      
                      return (
                        <React.Fragment key={`${line.cpt}-${idx}`}>
                          <tr className={`bg-white hover:bg-slate-50/60 transition-colors align-top ${lineValidationErrors.length > 0 ? "border-l-4 border-l-amber-400" : ""}`}>
                            <td className="px-3 py-3">
                              <span className="font-mono font-bold text-dark-blue text-[12px] block">{line.cpt}</span>
                              <span className="text-[9px] text-slate-400 block max-w-[160px] truncate mt-0.5" title={desc}>{desc}</span>
                            </td>
                            <td className="px-3 py-3">
                              <select
                                disabled={isReadOnly}
                                value={line.status}
                                onChange={(e) => handleUpdateServiceLine(idx, "status", e.target.value)}
                                className={`w-full rounded-lg border px-2 py-1.5 text-[10px] font-bold ${line.status === "Paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : line.status === "Denied" || line.status === "Rejected" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"} disabled:opacity-50`}
                              >
                                {SERVICE_LINE_STATUSES.map(lineStatus => <option key={lineStatus} value={lineStatus}>{lineStatus}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="w-full rounded-lg border border-slate-200 bg-slate-100 px-2 py-1.5 text-right font-mono text-[11px] font-bold text-slate-600">
                                {formatUSD(line.charged)}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <input
                                disabled={isReadOnly}
                                type="number"
                                step="0.01"
                                value={line.allowed}
                                onChange={(e) => handleUpdateServiceLine(idx, "allowed", e.target.value)}
                                className="w-full text-right border border-slate-200 rounded-lg py-1.5 px-2 font-mono font-bold bg-white focus:border-primary-blue text-[11px] disabled:opacity-50"
                              />
                            </td>
                            <td className="px-3 py-3 text-right font-mono font-semibold text-amber-600">
                              {formatUSD(line.adj)}
                            </td>
                            <td className="px-3 py-2.5">
                              <input
                                disabled={isReadOnly}
                                type="number"
                                step="0.01"
                                value={line.patResp}
                                onChange={(e) => handleUpdateServiceLine(idx, "patResp", e.target.value)}
                                className="w-full text-right border border-slate-200 rounded-lg py-1.5 px-2 font-mono font-bold bg-white focus:border-primary-blue text-[11px] disabled:opacity-50"
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                                <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] font-bold text-emerald-600">P</span>
                                  <input
                                    disabled={isReadOnly}
                                    type="number"
                                    step="0.01"
                                    value={line.paid}
                                    onChange={(e) => handleUpdateServiceLine(idx, "paid", e.target.value)}
                                    className="w-[4.5rem] rounded-lg border border-emerald-200 bg-emerald-50/40 py-1.5 pl-5 pr-1.5 text-right font-mono text-[10px] font-bold text-emerald-700 focus:bg-white disabled:opacity-50"
                                    aria-label={`Pago primario CPT ${line.cpt}`}
                                    title="Pago primario"
                                  />
                                </div>
                                {line.hasSecondaryPayment && (
                                  <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] font-bold text-primary-blue">S</span>
                                    <input
                                      disabled={isReadOnly}
                                      type="number"
                                      step="0.01"
                                      value={line.secondaryPaid}
                                      onChange={(e) => handleUpdateServiceLine(idx, "secondaryPaid", e.target.value)}
                                      className="w-[4.5rem] rounded-lg border border-blue-200 bg-blue-50/50 py-1.5 pl-5 pr-1.5 text-right font-mono text-[10px] font-bold text-primary-blue focus:bg-white disabled:opacity-50"
                                      aria-label={`Pago secundario CPT ${line.cpt}`}
                                      title="Pago secundario"
                                    />
                                  </div>
                                )}
                                <button
                                  disabled={isReadOnly}
                                  type="button"
                                  onClick={() => setSecondaryEditorIndex(idx)}
                                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                    line.hasSecondaryPayment
                                      ? "border-blue-300 bg-blue-50 text-primary-blue"
                                      : "border-slate-200 bg-white text-slate-400 hover:border-blue-300 hover:text-primary-blue"
                                  } disabled:cursor-not-allowed disabled:opacity-50`}
                                  title={line.hasSecondaryPayment ? "Editar payer secundario" : "Agregar pago secundario"}
                                  aria-label={`Configurar pago secundario CPT ${line.cpt}`}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                                <span
                                  className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 font-mono text-[8px] font-bold text-slate-700"
                                  title={`Primario ${formatUSD(Number(line.paid))} + secundario ${formatUSD(Number(line.secondaryPaid))}`}
                                >
                                  T {formatUSD(Number(line.paid) + Number(line.secondaryPaid))}
                                </span>
                              </div>
                            </td>
                            <td className={`px-3 py-3 text-right font-mono font-bold ${line.balance !== 0 ? "text-amber-600" : "text-slate-600"}`}>
                              {formatUSD(line.balance)}
                            </td>
                            <td className="px-3 py-2.5">
                              <input
                                disabled={isReadOnly}
                                type="text"
                                placeholder="EFT-000000"
                                value={line.eftNumber || ""}
                                onChange={(e) => handleUpdateServiceLine(idx, "eftNumber", e.target.value)}
                                className="w-full text-left border border-slate-200 rounded-lg py-1.5 px-2 font-mono text-[10px] font-bold bg-white focus:border-primary-blue focus:bg-blue-50/30 disabled:opacity-50 placeholder-slate-300"
                                aria-label={`EFT CPT ${line.cpt}`}
                                title="Número de EFT o cheque para este CPT"
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <input
                                disabled={isReadOnly}
                                type="date"
                                value={line.paymentDate || ""}
                                onChange={(e) => handleUpdateServiceLine(idx, "paymentDate", e.target.value)}
                                className="w-full border border-slate-200 rounded-lg py-1.5 px-2 font-mono text-[10px] bg-white focus:border-primary-blue disabled:opacity-50"
                                aria-label={`Fecha pago CPT ${line.cpt}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <EraCodePicker
                                codes={line.codes}
                                lineKey={`quick-${idx}`}
                                compact
                                onChange={(nextCodes) => handleUpdateServiceLine(idx, "codes", nextCodes)}
                                disabled={isReadOnly}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <select
                                disabled={isReadOnly}
                                value={line.nextAction}
                                onChange={(e) => handleUpdateServiceLine(idx, "nextAction", e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-[9px] font-semibold text-slate-600 disabled:opacity-50"
                              >
                                {SERVICE_LINE_ACTIONS.map(action => <option key={action} value={action}>{action}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  setNoteEditorIndex(idx);
                                  setServiceLineNoteDraft("");
                                }}
                                className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-primary-blue"
                                aria-label={`Notas CPT ${line.cpt}`}
                                title="Ver o añadir notas"
                              >
                                <MessageSquareText className="h-4 w-4" />
                                {line.notes.length > 0 && (
                                  <span className="absolute -right-2 -top-2 min-w-5 rounded-full border-2 border-white bg-primary-blue px-1 text-[8px] font-bold leading-4 text-white">
                                    {line.notes.length}
                                  </span>
                                )}
                              </button>
                            </td>
                          </tr>
                          {lineValidationErrors.length > 0 && (
                            <tr className="bg-amber-50/70">
                              <td colSpan={11} className="px-4 py-2">
                                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-800">
                                  <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                                    {lineValidationErrors.map(error => (
                                      <span key={error}>• {error}</span>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* CPT workflow controls */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* CARD 1: Cierre Financiero & Workflow */}
              <div className="flex h-full flex-col gap-4">
                {/* Workflow & Estado */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
                  <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                    <Sliders className="w-4 h-4 text-primary-blue" />
                    <h5 className="font-bold text-slate-800 text-xs">Workflow & Estado</h5>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Estado agregado del Claim</label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as ClaimStatus)}
                        disabled={isReadOnly}
                        className="w-full min-h-8 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-700 shadow-sm focus:border-primary-blue disabled:cursor-not-allowed disabled:bg-slate-100"
                      >
                        {Object.values(ClaimStatus).map(claimStatus => (
                          <option key={claimStatus} value={claimStatus}>{claimStatus}</option>
                        ))}
                      </select>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-2 py-1.5">
                        <span className="text-[9px] font-semibold text-slate-600">
                          Sugerido por CPT: <strong className="text-dark-blue">{suggestedClaimStatus}</strong>
                        </span>
                        {!statusMatchesSuggestion && !isReadOnly && (
                          <button
                            type="button"
                            onClick={() => setStatus(suggestedClaimStatus)}
                            className="rounded-md border border-blue-200 bg-white px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-primary-blue hover:bg-blue-100"
                          >
                            Aplicar
                          </button>
                        )}
                      </div>
                      {showValidationErrors && claimValidationErrors.length > 0 && (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold text-amber-800">
                          <div className="mb-1 flex items-center gap-1.5 font-bold">
                            <AlertOctagon className="h-3.5 w-3.5 text-amber-600" />
                            Validación del claim
                          </div>
                          <div className="space-y-1">
                            {claimValidationErrors.map(error => (
                              <div key={error}>• {error}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Clasificación</label>
                      <select
                        value={classification}
                        onChange={(e) => setClassification(e.target.value as any)}
                        className="w-full p-1.5 border border-slate-200 rounded font-semibold text-slate-700 bg-slate-50 cursor-pointer text-[11px] text-ellipsis overflow-hidden whitespace-nowrap"
                      >
                        <option value="Clean Claim">Clean Claim</option>
                        <option value="Clinical Denial">Clinical Denial</option>
                        <option value="Administrative Denial">Administrative Denial</option>
                        <option value="Technical Error">Technical Error</option>
                        <option value="Eligibility Error">Eligibility Error</option>
                        <option value="Underpaid">Underpaid</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Seguro y Cambio de Seguro (Trazable) */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
                  <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                    <Shield className="w-4 h-4 text-emerald-600" />
                    <h5 className="font-bold text-slate-800 text-xs">Aseguradora Registrada</h5>
                  </div>

                  {!isChangingInsurance ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="min-w-0">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">Seguro actual</span>
                        <span className="block truncate text-[11px] font-bold text-slate-700">{claim.payer_name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setNewPayerIdState(claim.payer_id);
                          setIsChangingInsurance(true);
                        }}
                        className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-bold text-primary-blue hover:bg-blue-100"
                      >
                        Cambiar
                      </button>
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2 text-xs">
                      <div className="font-bold text-slate-700 text-[11px] flex items-center justify-between">
                        <span>Reportar Cambio de Seguro</span>
                        <button type="button" onClick={() => setIsChangingInsurance(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                          Cancelar
                        </button>
                      </div>
                      <select
                        value={newPayerIdState}
                        onChange={(e) => setNewPayerIdState(e.target.value)}
                        className="w-full p-1.5 border border-slate-200 bg-white rounded font-medium text-slate-700 text-xs cursor-pointer"
                      >
                        <option value="">-- Seleccionar Nuevo --</option>
                        {payers.map(p => <option key={p.payer_id} value={p.payer_id}>{p.payer_name}</option>)}
                      </select>
                      <textarea
                        placeholder="Motivo del cambio de cobertura..."
                        value={insuranceChangeReason}
                        onChange={(e) => setInsuranceChangeReason(e.target.value)}
                        className="w-full p-1.5 border border-slate-200 bg-white rounded text-xs h-10 resize-none"
                      />
                      <button
                        type="button"
                        onClick={handleConfirmInsuranceChange}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 rounded-lg text-center shadow-xs transition-colors cursor-pointer text-xs"
                      >
                        Aplicar Cambio y Dejar Traza
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* CARD 2: Pago y Depósito ERA */}
              <div className="flex h-full">
                {/* Datos de Depósito del Cheque / EFT */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3 flex-1 min-h-[258px]">
                  <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                    <Calendar className="w-4 h-4 text-primary-blue" />
                    <h5 className="font-bold text-slate-800 text-xs">Pago y Depósito ERA</h5>
                  </div>
                  
                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase">¿Recibió ERA / EOB?</label>
                      <div className="flex gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => setEraReceived("Yes")}
                          className={`flex-1 text-center py-1 rounded border text-xs font-bold transition-all cursor-pointer ${
                            eraReceived === "Yes"
                              ? "bg-blue-50 text-primary-blue border-primary-blue"
                              : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          Sí, ERA
                        </button>
                        <button
                          type="button"
                          onClick={() => setEraReceived("No")}
                          className={`flex-1 text-center py-1 rounded border text-xs font-bold transition-all cursor-pointer ${
                            eraReceived === "No"
                              ? "bg-blue-50 text-primary-blue border-primary-blue"
                              : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          No ERA
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cheque / EFT #</label>
                        <input
                          type="text"
                          placeholder="EFT-483829"
                          value={checkEftNumber}
                          onChange={(e) => setCheckEftNumber(e.target.value)}
                          className="w-full p-1.5 border border-slate-200 rounded font-mono font-bold text-slate-700 text-xs bg-slate-50 focus:bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Fecha de Pago</label>
                        <input
                          type="date"
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                          className="w-full p-1 border border-slate-200 rounded font-mono font-bold text-slate-700 text-xs bg-slate-50 focus:bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Receptor de Cobro</label>
                      <select
                        value={paymentReceivedBy}
                        onChange={(e) => setPaymentReceivedBy(e.target.value as any)}
                        className="w-full p-1.5 border border-slate-200 rounded font-semibold text-slate-700 bg-slate-50 text-xs cursor-pointer"
                      >
                        <option value="ITERA">ITERA (Banco de ITERA)</option>
                        <option value="Provider">Provider (Directo en Clínica)</option>
                        <option value="Split">Split (Monto dividido)</option>
                        <option value="Unknown">Unknown (Sin clasificar)</option>
                      </select>
                    </div>
                  </div>
                </div>

              </div>

              {/* CARD 3: Notas de Seguimiento */}
              <div className="lg:col-span-2">
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3 flex flex-col h-full">
                  <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                    <FileText className="w-4 h-4 text-primary-blue" />
                    <h5 className="font-bold text-slate-800 text-xs">Notas de Seguimiento</h5>
                  </div>

                  <div className="space-y-2 text-xs">
                    <textarea
                      placeholder="Escribe una observación del ERA..."
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded text-xs h-16 resize-none focus:ring-1 focus:ring-primary-blue bg-slate-50/50"
                    />
                    <div className="flex gap-2 items-center justify-end">
                      <button
                        type="button"
                        onClick={handlePostNote}
                        disabled={!newNoteText.trim()}
                        className="bg-primary-blue hover:bg-secondary-blue disabled:opacity-50 text-white font-bold px-3 py-1 rounded-lg text-[11px] transition-all cursor-pointer"
                      >
                        Anotar
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2 pt-2 border-t border-slate-100 mt-2 max-h-[160px] min-h-[110px]">
                    {filteredNotes.length === 0 ? (
                      <p className="text-[10px] italic text-slate-400 text-center py-4">Sin anotaciones de seguimiento en este claim.</p>
                    ) : (
                      filteredNotes.map((n) => (
                        <div key={n.note_id} className="bg-slate-50 p-2 rounded border border-slate-200 text-[10px] leading-relaxed">
                          <div className="flex justify-between text-[8px] text-slate-400 font-mono mb-1">
                            <span className="font-bold text-primary-blue uppercase">{n.note_type}</span>
                            <span>{new Date(n.created_at).toLocaleDateString()}</span>
                          </div>
                          <p className="text-slate-700 whitespace-pre-wrap">{n.note_text}</p>
                          <p className="text-[8px] text-right text-slate-400 font-mono mt-0.5">— {n.created_by}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

            </div>
            {renderClaimTimeline("mt-6")}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 bg-slate-50 grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans">
          <div className="lg:col-span-3">
            <FinancialSummary
              totalBilled={Number(billedCharge)}
              adjustments={totalAdjustments}
              patientResponsibility={patientResponsibilityTotal}
              netPaid={Number(paidAmount)}
            />
          </div>
          
          {/* COLUMN 1 & 2: Financials & Workflow inputs */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* ALERT BANNERS */}
            {locked && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3 text-red-800 text-xs">
                <Lock className="w-4 h-4 text-red-600 shrink-0 mt-0.5 animate-pulse" />
                <div>
                  <h5 className="font-bold uppercase tracking-wider text-rose-800">Claim Bloqueado (Locked)</h5>
                  <p className="mt-1 font-semibold text-slate-700">{lockReason || "Este claim está bloqueado debido a errores financieros o administrativos."}</p>
                </div>
              </div>
            )}
            
            {errorFlag && !locked && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-amber-800 text-xs">
                <AlertOctagon className="w-4 h-4 text-accent-orange shrink-0 mt-0.5 animate-bounce-subtle" />
                <div>
                  <h5 className="font-bold uppercase tracking-wider text-amber-800">Error en Claim Detectado</h5>
                  <p className="mt-1 font-semibold text-slate-700">Categoría: {errorCategory || "No especificado"}. Requiere corregir antes de re-facturar.</p>
                </div>
              </div>
            )}

            {/* SECTION A: Claim Metadata Summary */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                <FileText className="w-4.5 h-4.5 text-primary-blue" />
                <h4 className="font-bold text-slate-800 text-sm">Resumen Administrativo de Claim</h4>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="block text-slate-400 font-mono">CPT/HCPCS</span>
                  <span className="font-bold text-slate-700 font-mono text-xs">{claim.cpt_hcpcs} (x{claim.units} {claim.units === 1 ? "unidad" : "unidades"})</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-mono">Tipo de Servicio</span>
                  <span className="font-bold text-slate-700 font-mono">{claim.service_type}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-mono">NPI de Proveedor</span>
                  <span className="font-bold text-slate-700 font-mono">{claim.provider_npi}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-mono">Aseguradora (Payer)</span>
                  <span className="font-bold text-slate-700">{claim.payer_name}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-mono">Fecha de Servicio (DOS)</span>
                  <span className="font-bold text-slate-700 font-mono">{claim.date_of_service_from}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-mono">Mes de Servicio</span>
                  <span className="font-bold text-slate-700 font-mono">{claim.month_of_service}</span>
                </div>
              </div>

              {/* Owner assignment inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Facturado por (Billed Owner)</label>
                  <select
                    disabled={isReadOnly}
                    value={billedBy}
                    onChange={(e) => setBilledBy(e.target.value as any)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-slate-50 font-semibold text-slate-700"
                  >
                    <option value="ITERA">ITERA (ITERA Health handles claim submission)</option>
                    <option value="Provider">Provider (Medical Practice submitted directly)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Receptor de Cobro (Payment Receiver)</label>
                  <select
                    disabled={isReadOnly}
                    value={paymentReceivedBy}
                    onChange={(e) => setPaymentReceivedBy(e.target.value as any)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-slate-50 font-semibold text-slate-700"
                  >
                    <option value="ITERA">ITERA (Received directly at ITERA's bank)</option>
                    <option value="Provider">Provider (Received directly at Clinic bank)</option>
                    <option value="Split">Split (Co-pay/insurance portion split collections)</option>
                    <option value="Unknown">Unknown (Missing matching ERA deposit)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* NEW SECTION: CPT SERVICE LINES DETAIL */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <Coins className="w-4.5 h-4.5 text-primary-blue" />
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">Líneas de Servicio a nivel de Código CPT</h4>
                    <p className="text-[10px] text-slate-400">Edición en lote y desglose por código para la conciliación rápida del claim.</p>
                  </div>
                </div>
                <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-mono font-bold">
                  {serviceLines.length} {serviceLines.length === 1 ? "Línea" : "Líneas"}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[11px] font-sans">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider bg-slate-50 text-[9px]">
                      <th className="p-2">CPT Code</th>
                      <th className="p-2 w-28">Status</th>
                      <th className="p-2 text-right w-24">Facturado (Billed)</th>
                      <th className="p-2 text-right w-24">Permitido (Allowed)</th>
                      <th className="p-2 text-right w-20">Ajuste (Adj)</th>
                      <th className="p-2 text-right w-20">Resp. Pat.</th>
                      <th className="p-2 text-right w-48">Pagado (P + S + Total)</th>
                      <th className="p-2 text-right w-20">Balance</th>
                      <th className="p-2 w-36">EFT / Cheque #</th>
                      <th className="p-2 w-28">Fecha Pago</th>
                      <th className="p-2 w-48">Códigos ERA / CARC</th>
                      <th className="p-2 w-40">Next Action</th>
                      <th className="p-2 w-16 text-center">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {serviceLines.map((line, idx) => {
                      const fsEntry = feeSchedules?.find(fs => fs.cpt_code === line.cpt);
                      const desc = fsEntry?.description || COMMON_CPT_DESCRIPTIONS[line.cpt] || "Servicio médico asociado.";
                      const lineValidationErrors = showValidationErrors ? serviceLineErrors[idx] || [] : [];
                      
                      return (
                        <React.Fragment key={`${line.cpt}-${idx}`}>
                        <tr className={`hover:bg-slate-50/50 transition-colors ${lineValidationErrors.length > 0 ? "border-l-4 border-l-amber-400" : ""}`}>
                          <td className="p-2">
                            <span className="font-mono font-bold text-primary-blue text-xs block">{line.cpt}</span>
                            <span className="text-[9px] text-slate-400 block max-w-[140px] truncate" title={desc}>
                              {desc}
                            </span>
                          </td>
                          <td className="p-2">
                            <select
                              disabled={isReadOnly}
                              value={line.status}
                              onChange={(e) => handleUpdateServiceLine(idx, "status", e.target.value)}
                              className="w-full border border-slate-200 rounded p-1.5 bg-slate-50 text-[10px] font-bold"
                            >
                              {SERVICE_LINE_STATUSES.map(lineStatus => <option key={lineStatus} value={lineStatus}>{lineStatus}</option>)}
                            </select>
                          </td>
                          <td className="p-2 text-right">
                            <span className="inline-block w-20 rounded border border-slate-200 bg-slate-100 p-1 font-mono font-semibold text-slate-600">
                              {formatUSD(line.charged)}
                            </span>
                          </td>
                          <td className="p-2 text-right">
                            {isReadOnly ? (
                              <span className="font-mono font-semibold text-slate-600">{formatUSD(line.allowed)}</span>
                            ) : (
                              <input
                                type="number"
                                step="0.01"
                                value={line.allowed}
                                onChange={(e) => handleUpdateServiceLine(idx, "allowed", e.target.value)}
                                className="w-20 text-right border border-slate-200 rounded p-1 font-mono font-bold bg-slate-50 focus:bg-white text-xs"
                              />
                            )}
                          </td>
                          <td className="p-2 text-right">
                            <span className="font-mono text-slate-500 font-medium">
                              {formatUSD(line.adj)}
                            </span>
                          </td>
                          <td className="p-2 text-right">
                            {isReadOnly ? (
                              <span className="font-mono font-semibold text-slate-600">{formatUSD(line.patResp)}</span>
                            ) : (
                              <input
                                type="number"
                                step="0.01"
                                value={line.patResp}
                                onChange={(e) => handleUpdateServiceLine(idx, "patResp", e.target.value)}
                                className="w-16 text-right border border-slate-200 rounded p-1 font-mono font-bold bg-slate-50 focus:bg-white text-xs"
                              />
                            )}
                          </td>
                          <td className="p-2 text-right">
                            {isReadOnly ? (
                              <div className="space-y-0.5 text-right font-mono text-[10px] font-bold">
                                <div className="text-emerald-700">P {formatUSD(Number(line.paid))}</div>
                                {Number(line.secondaryPaid) > 0 && (
                                  <div className="text-primary-blue">S {formatUSD(Number(line.secondaryPaid))}</div>
                                )}
                                <div className="text-slate-700">T {formatUSD(Number(line.paid) + Number(line.secondaryPaid))}</div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                                <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] font-bold text-emerald-600">P</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={line.paid}
                                    onChange={(e) => handleUpdateServiceLine(idx, "paid", e.target.value)}
                                    className="w-[4.5rem] rounded border border-emerald-200 bg-emerald-50/40 py-1 pl-5 pr-1.5 text-right font-mono text-xs font-bold text-emerald-700 focus:bg-white"
                                    title="Pago del payer primario"
                                  />
                                </div>
                                {line.hasSecondaryPayment && (
                                  <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] font-bold text-primary-blue">S</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={line.secondaryPaid}
                                      onChange={(e) => handleUpdateServiceLine(idx, "secondaryPaid", e.target.value)}
                                      className="w-[4.5rem] rounded border border-blue-200 bg-blue-50/50 py-1 pl-5 pr-1.5 text-right font-mono text-xs font-bold text-primary-blue focus:bg-white"
                                      title="Pago del payer secundario"
                                    />
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setSecondaryEditorIndex(idx)}
                                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                    line.hasSecondaryPayment
                                      ? "border-blue-300 bg-blue-50 text-primary-blue"
                                      : "border-slate-200 bg-white text-slate-400 hover:border-blue-300 hover:text-primary-blue"
                                  }`}
                                  title={line.hasSecondaryPayment ? "Editar payer secundario" : "Agregar pago secundario"}
                                  aria-label={`Configurar pago secundario CPT ${line.cpt}`}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                                <span
                                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 font-mono text-[9px] font-bold text-slate-700"
                                  title={`Primario ${formatUSD(Number(line.paid))} + secundario ${formatUSD(Number(line.secondaryPaid))}`}
                                >
                                  T {formatUSD(Number(line.paid) + Number(line.secondaryPaid))}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="p-2 text-right">
                            <span className={`font-mono font-bold text-xs ${line.balance !== 0 ? "text-amber-600" : "text-slate-400"}`}>
                              {formatUSD(line.balance)}
                            </span>
                          </td>
                          <td className="p-2">
                            {isReadOnly ? (
                              <span className="font-mono font-bold text-slate-600 text-[10px]">{line.eftNumber || "—"}</span>
                            ) : (
                              <input
                                type="text"
                                placeholder="EFT-000000"
                                value={line.eftNumber || ""}
                                onChange={(e) => handleUpdateServiceLine(idx, "eftNumber", e.target.value)}
                                className="w-full text-left border border-slate-200 rounded p-1 font-mono text-[10px] font-bold bg-white focus:border-primary-blue"
                                title="Número de EFT o cheque para este CPT"
                              />
                            )}
                          </td>
                          <td className="p-2">
                            {isReadOnly ? (
                              <span className="font-mono text-slate-600 text-[10px]">{line.paymentDate || "—"}</span>
                            ) : (
                              <input
                                type="date"
                                value={line.paymentDate || ""}
                                onChange={(e) => handleUpdateServiceLine(idx, "paymentDate", e.target.value)}
                                className="w-full border border-slate-200 rounded p-1 font-mono text-[10px] bg-white focus:border-primary-blue"
                              />
                            )}
                          </td>
                          <td className="p-2">
                            {isReadOnly ? (
                              <div className="flex flex-wrap gap-1">
                                {line.codes.length === 0 ? (
                                  <span className="text-slate-400 italic">—</span>
                                ) : (
                                  line.codes.map(c => (
                                    <span
                                      key={c}
                                      className="bg-slate-100 text-slate-700 font-mono text-[9px] px-1 rounded font-bold border border-slate-200"
                                      title={CARC_CODE_DESCRIPTIONS[c]}
                                    >
                                      {c}
                                    </span>
                                  ))
                                )}
                              </div>
                            ) : (
                              <EraCodePicker
                                codes={line.codes}
                                lineKey={`detail-${idx}`}
                                compact
                                onChange={(nextCodes) => handleUpdateServiceLine(idx, "codes", nextCodes)}
                              />
                            )}
                          </td>
                          <td className="p-2">
                            <select
                              disabled={isReadOnly}
                              value={line.nextAction}
                              onChange={(e) => handleUpdateServiceLine(idx, "nextAction", e.target.value)}
                              className="w-full border border-slate-200 rounded p-1.5 bg-slate-50 text-[9px] font-semibold"
                            >
                              {SERVICE_LINE_ACTIONS.map(action => <option key={action} value={action}>{action}</option>)}
                            </select>
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setNoteEditorIndex(idx);
                                setServiceLineNoteDraft("");
                              }}
                              className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-blue-50 hover:text-primary-blue"
                              aria-label={`Notas CPT ${line.cpt}`}
                            >
                              <MessageSquareText className="h-4 w-4" />
                              {line.notes.length > 0 && (
                                <span className="absolute -right-2 -top-2 min-w-5 rounded-full border-2 border-white bg-primary-blue px-1 text-[8px] font-bold leading-4 text-white">
                                  {line.notes.length}
                                </span>
                              )}
                            </button>
                          </td>
                        </tr>
                        {lineValidationErrors.length > 0 && (
                          <tr className="bg-amber-50/70">
                            <td colSpan={13} className="px-3 py-2">
                              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-800">
                                <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                                <div className="flex flex-wrap gap-x-4 gap-y-1">
                                  {lineValidationErrors.map(error => (
                                    <span key={error}>• {error}</span>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Fee Schedule explanation alert */}
              <div className="bg-blue-50/40 p-3 rounded-lg border border-blue-100/30 flex gap-2.5 text-[10px] text-slate-600">
                <Info className="w-4 h-4 text-primary-blue shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-800">Cálculo de Honorarios Oficiales FCSO:</span> Este claim fue prestado en el mes <span className="font-mono font-bold">{claim.month_of_service}</span> (Semestre {claim.date_of_service_from ? (parseInt(claim.date_of_service_from.split("-")[1], 10) <= 6 ? "1" : "2") : "1"}).
                  {serviceLines.map((line) => {
                    const fsEntry = feeSchedules?.find(fs => fs.cpt_code === line.cpt);
                    if (fsEntry) {
                      return (
                        <div key={line.cpt} className="mt-1 font-semibold text-slate-700">
                          • Tarifa CPT {line.cpt}: Semestre 1 (${fsEntry.semester1_rate.toFixed(2)}) / Semestre 2 (${fsEntry.semester2_rate.toFixed(2)}). Cargo Facturado Esperado: ${(claim.date_of_service_from && parseInt(claim.date_of_service_from.split("-")[1], 10) <= 6 ? fsEntry.semester1_rate : fsEntry.semester2_rate).toFixed(2)}.
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            </div>

            {/* SECTION B: Financial Detail Inputs */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5 mb-4">
                <Coins className="w-4.5 h-4.5 text-primary-blue" />
                <div>
                  <h4 className="font-bold text-slate-800 text-sm">Valores de Conciliación</h4>
                  <p className="text-[10px] text-slate-400">Edita solo los valores que requieran override manual.</p>
                </div>
              </div>

              {/* Editable values for Billing / Reconciliation Staff */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-xs">
                <div>
                  <label className="block text-slate-500 font-mono mb-1">Cargo Facturado ($)</label>
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={billedCharge}
                    onChange={(e) => setBilledCharge(Number(e.target.value))}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-mono mb-1">Permitido Aseguradora ($)</label>
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={allowedAmount}
                    onChange={(e) => setAllowedAmount(Number(e.target.value))}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-mono mb-1">Pagado ($)</label>
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(Number(e.target.value))}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-mono mb-1">Ajuste Contractual ($)</label>
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={insuranceAdjustment}
                    onChange={(e) => setInsuranceAdjustment(Number(e.target.value))}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-rose-500/80 font-mono mb-1">Denegado (Denial) ($)</label>
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={deniedAmount}
                    onChange={(e) => setDeniedAmount(Number(e.target.value))}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-mono mb-1">Castigo (Write-off) ($)</label>
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={writeOffAmount}
                    onChange={(e) => setWriteOffAmount(Number(e.target.value))}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-mono mb-1">Incobrable (Uncollectible) ($)</label>
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={uncollectibleAmount}
                    onChange={(e) => setUncollectibleAmount(Number(e.target.value))}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-blue-600 font-mono mb-1">Cobro Directo ITERA ($)</label>
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={iteraDirect}
                    onChange={(e) => setIteraDirect(Number(e.target.value))}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-sky-600 font-mono mb-1">Cobro Directo Médico ($)</label>
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={providerDirect}
                    onChange={(e) => setProviderDirect(Number(e.target.value))}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono font-semibold"
                  />
                </div>
              </div>

              {/* Physician Payout override field */}
              <div className="pt-4 border-t border-slate-100 mt-4">
                <label className="block text-xs font-semibold text-slate-600 mb-1">PAGO DIRECTO EFECTUADO AL MÉDICO (Payment to Physician) ($)</label>
                <div className="flex gap-3">
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={paymentToPhysician}
                    onChange={(e) => setPaymentToPhysician(Number(e.target.value))}
                    className="p-1.5 border border-slate-200 rounded bg-slate-50 font-mono text-xs w-48 font-semibold text-dark-blue"
                  />
                  <div className="text-[10px] text-slate-500 self-center">
                    Ajuste manual de distribución de ingresos. El saldo final (Ending A/P) recalculará automáticamente restando este pago.
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION C: Payment / ERA / EOB Information */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                <FileCheck className="w-4.5 h-4.5 text-primary-blue" />
                <h4 className="font-bold text-slate-800 text-sm">Información de Pago / ERA / EOB</h4>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-slate-500 mb-1">ERA Recibido</label>
                  <select
                    disabled={isReadOnly}
                    value={eraReceived}
                    onChange={(e) => setEraReceived(e.target.value as any)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50"
                  >
                    <option value="Yes">Sí (Yes)</option>
                    <option value="No">No (No)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">EOB Recibido</label>
                  <select
                    disabled={isReadOnly}
                    value={eobReceived}
                    onChange={(e) => setEobReceived(e.target.value as any)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50"
                  >
                    <option value="Yes">Sí (Yes)</option>
                    <option value="No">No (No)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Fecha de Pago</label>
                  <input
                    type="date"
                    disabled={isReadOnly}
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 text-slate-600 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Cheque / EFT #</label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    placeholder="EFT-881273"
                    value={checkEftNumber}
                    onChange={(e) => setCheckEftNumber(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-500 font-mono mb-1">CARC Code (Payer Adjustment)</label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    placeholder="e.g. 16, 96, 2"
                    value={carcCode}
                    onChange={(e) => setCarcCode(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-mono mb-1">RARC Code (Payer Remittance)</label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    placeholder="e.g. MA130, N4"
                    value={rarcCode}
                    onChange={(e) => setRarcCode(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
                <div className="col-span-1 sm:col-span-3">
                  <label className="block text-slate-500 mb-1">Detalle / Motivo de Denegación (Payer Notes)</label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    placeholder="Patient eligibility error / Timely filing expired..."
                    value={denialReason}
                    onChange={(e) => setDenialReason(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50"
                  />
                </div>
              </div>
            </div>

            {/* SECTION D: Correction & Appeals Workflow */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                <Wrench className="w-4.5 h-4.5 text-primary-blue" />
                <h4 className="font-bold text-slate-800 text-sm">Flujo de Corrección y Resubmissions</h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <input
                    type="checkbox"
                    disabled={isReadOnly}
                    checked={errorFlag}
                    onChange={(e) => setErrorFlag(e.target.checked)}
                    id="chk-error-flag"
                    className="rounded border-slate-300 text-primary-blue h-4 w-4"
                  />
                  <label htmlFor="chk-error-flag" className="font-semibold text-slate-700 cursor-pointer">Marcar con Error</label>
                </div>

                <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <input
                    type="checkbox"
                    disabled={isReadOnly}
                    checked={locked}
                    onChange={(e) => setLocked(e.target.checked)}
                    id="chk-lock-flag"
                    className="rounded border-slate-300 text-primary-blue h-4 w-4"
                  />
                  <label htmlFor="chk-lock-flag" className="font-semibold text-slate-700 cursor-pointer">Bloquear Claim (Locked)</label>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Categoría del Error</label>
                  <select
                    disabled={isReadOnly}
                    value={errorCategory}
                    onChange={(e) => setErrorCategory(e.target.value as any)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 text-xs text-slate-700 font-medium"
                  >
                    <option value="">Ninguno (Sin Error)</option>
                    {Object.values(ErrorCategory).map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              {locked && (
                <div>
                  <label className="block text-xs font-semibold text-rose-600 mb-1">Motivo de Bloqueo Administrativo</label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    placeholder="Especifica por qué queda congelada la conciliación..."
                    value={lockReason}
                    onChange={(e) => setLockReason(e.target.value)}
                    className="w-full p-2 border border-red-200 bg-rose-50/10 text-xs rounded-lg font-semibold text-slate-800"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-3 border-t border-slate-100">
                <div>
                  <label className="block text-slate-500 mb-1">Fase de Corrección</label>
                  <select
                    disabled={isReadOnly}
                    value={correctionStatus}
                    onChange={(e) => setCorrectionStatus(e.target.value as any)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
                  >
                    <option value="">Sin Cambios</option>
                    <option value="Pending">Pendiente de Revisión</option>
                    <option value="Corrected">Corregido</option>
                    <option value="Ready to Rebill">Listo para Re-facturar</option>
                    <option value="Resubmitted">Re-presentado a Payer (Resubmitted)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-500 mb-1">Fecha de Re-envío</label>
                  <input
                    type="date"
                    disabled={isReadOnly}
                    value={resubmissionDate}
                    onChange={(e) => setResubmissionDate(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono text-slate-600"
                  />
                </div>

                <div>
                  <label className="block text-slate-500 mb-1">Referencia Claim Corregido</label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    placeholder="e.g. CLM-2026-013-A"
                    value={correctedReference}
                    onChange={(e) => setCorrectedReference(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* COLUMN 3: Payment Logger, Notes panel, Audit logs */}
          <div className="space-y-6">
            
            {/* IN-APP PAYMENT RECIEVED LOGGER */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <Coins className="w-4.5 h-4.5 text-primary-blue" />
                <h4 className="font-bold text-slate-800 text-xs">Registrar Cobro Real (Payment Recieved)</h4>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Agrega cobros recibidos de aseguradoras o copagos de forma directa a la cuenta de conciliación de este claim.
              </p>
              
              <div className="space-y-2.5 text-xs">
                <div>
                  <label className="block text-slate-500 font-mono text-[10px] mb-0.5">Monto del Depósito ($)</label>
                  <input
                    disabled={isReadOnly}
                    type="number"
                    placeholder="0.00"
                    value={logPaymentAmount}
                    onChange={(e) => setLogPaymentAmount(e.target.value ? Number(e.target.value) : "")}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono font-bold text-slate-800 text-sm disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-mono text-[10px] mb-0.5">EFT / Cheque Código de Referencia</label>
                  <input
                    disabled={isReadOnly}
                    type="text"
                    placeholder="CHK-88122"
                    value={logPaymentCheck}
                    onChange={(e) => setLogPaymentCheck(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 font-mono disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 text-[10px] mb-0.5">Canal de Cobro</label>
                  <select
                    disabled={isReadOnly}
                    value={logPaymentSource}
                    onChange={(e) => setLogPaymentSource(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded bg-slate-50 text-slate-700 disabled:opacity-50"
                  >
                    <option value="ERA">ERA (Electronic Remittance)</option>
                    <option value="Manual">Confirmación Manual Banco</option>
                    <option value="Patient Check">Copago Paciente / Cheque</option>
                  </select>
                </div>
                <button
                  disabled={isReadOnly}
                  onClick={handleLogPayment}
                  className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs p-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Aplicar Cobro Recibido
                </button>
              </div>
            </div>

            {/* SECTION E: Notes logs and creation */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <FileText className="w-4.5 h-4.5 text-primary-blue" />
                <h4 className="font-bold text-slate-800 text-xs">Notas de Auditoría Administrativa</h4>
              </div>

              <div className="space-y-2 text-xs">

                <div>
                  <textarea
                    rows={3}
                    placeholder="Ingresa los comentarios de auditoría..."
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50 focus:outline-hidden focus:ring-1 focus:ring-primary-blue text-xs text-slate-800"
                  />
                </div>
                <button
                  onClick={handlePostNote}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Agregar Nota al Historial
                </button>
              </div>

              {/* Feed of Notes */}
              <div className="space-y-3 pt-3 border-t border-slate-100 max-h-64 overflow-y-auto">
                {filteredNotes.length === 0 ? (
                  <p className="text-[10px] text-slate-400 italic text-center py-4">No hay comentarios registrados para este claim.</p>
                ) : (
                  filteredNotes.map((n) => {
                    const noteDate = new Date(n.created_at);
                    const formattedDateTime = `${noteDate.toLocaleDateString()} a las ${noteDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                    return (
                      <div key={n.note_id} className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs leading-relaxed transition-all hover:border-slate-300">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5 border-b border-slate-100 pb-1">
                          <span className="font-bold text-primary-blue tracking-wide uppercase px-1.5 py-0.5 bg-blue-50 border border-blue-100 rounded text-[9px]">
                            {n.note_type}
                          </span>
                          <span className="font-mono text-slate-400">{formattedDateTime}</span>
                        </div>
                        <p className="text-slate-700 font-medium whitespace-pre-wrap">{n.note_text}</p>
                        <div className="text-[9px] font-mono text-slate-400 mt-2 flex items-center justify-end gap-1 select-none">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          <span>Registrado por:</span> <span className="font-bold text-slate-600">{n.created_by}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* SECTION F: Audit Trail panel */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <History className="w-4.5 h-4.5 text-primary-blue" />
                <h4 className="font-bold text-slate-800 text-xs">Log de Auditoría HIPAA</h4>
              </div>
              <p className="text-[9px] text-slate-400 leading-normal">
                Control de cambios inalterable exigido por normativas de seguridad de salud para vigilar PHI.
              </p>

              <div className="space-y-2.5 max-h-52 overflow-y-auto pt-1 text-[10px] font-mono text-slate-600">
                {filteredAudits.length === 0 ? (
                  <p className="italic text-center text-slate-400 py-4 font-sans text-xs">Ningún cambio registrado en el historial.</p>
                ) : (
                  filteredAudits.map((a) => (
                    <div key={a.audit_id} className="p-2 border-l-2 border-primary-blue bg-slate-50 rounded-r-lg">
                      <div className="flex justify-between font-bold text-slate-800 text-[9px]">
                        <span className="uppercase text-primary-blue">{a.action_type}</span>
                        <span>{new Date(a.changed_at).toLocaleTimeString()}</span>
                      </div>
                      <div className="mt-1">
                        <span className="text-slate-400">Campo:</span> <span className="font-bold text-slate-700">{a.field_name}</span>
                      </div>
                      {a.previous_value && (
                        <div className="text-slate-400 text-[9px] truncate">
                          Previo: <span className="line-through">{a.previous_value}</span>
                        </div>
                      )}
                      <div className="text-slate-800 font-semibold truncate">
                        Nuevo: {a.new_value}
                      </div>
                      <div className="text-[9px] text-slate-500 italic mt-0.5">
                        Motivo: {a.reason}
                      </div>
                      <div className="text-[8px] text-right text-slate-400 mt-1">— {a.changed_by}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="lg:col-span-3">
            {renderClaimTimeline()}
          </div>
        </div>
        )}

        {secondaryEditorIndex !== null && serviceLines[secondaryEditorIndex] && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 p-4">
            <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 bg-blue-50 px-4 py-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-primary-blue">Pago secundario</p>
                  <h4 className="text-sm font-bold text-dark-blue">CPT {serviceLines[secondaryEditorIndex].cpt}</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setSecondaryEditorIndex(null)}
                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:text-slate-700"
                  aria-label="Cerrar pago secundario"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div>
                    <span className="itera-label block">Pago primario</span>
                    <span className="mt-1 block font-mono font-bold text-slate-700">
                      {formatUSD(Number(serviceLines[secondaryEditorIndex].paid))}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="itera-label block">Total combinado</span>
                    <span className="mt-1 block font-mono font-bold text-emerald-700">
                      {formatUSD(Number(serviceLines[secondaryEditorIndex].paid) + Number(serviceLines[secondaryEditorIndex].secondaryPaid))}
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_5.5rem]">
                  <div>
                    <label className="itera-label mb-1 block">Payer secundario</label>
                    <select
                      value={serviceLines[secondaryEditorIndex].secondaryPayerId}
                      onChange={(e) => handleUpdateServiceLine(secondaryEditorIndex, "secondaryPayerId", e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                    >
                      <option value="">Seleccionar payer...</option>
                      {payers.filter(payer => payer.payer_id !== claim.payer_id).map(payer => (
                        <option key={payer.payer_id} value={payer.payer_id}>{payer.payer_name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="itera-label mb-1 block">Importe</label>
                    <input
                      type="number"
                      step="0.01"
                      value={serviceLines[secondaryEditorIndex].secondaryPaid}
                      onChange={(e) => handleUpdateServiceLine(secondaryEditorIndex, "secondaryPaid", e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-blue-200 bg-blue-50/40 px-2 py-2 text-right font-mono text-sm font-bold text-primary-blue"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
                {serviceLines[secondaryEditorIndex].hasSecondaryPayment ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleUpdateServiceLine(secondaryEditorIndex, "hasSecondaryPayment", false);
                      setSecondaryEditorIndex(null);
                    }}
                    className="text-[10px] font-bold text-rose-600 hover:text-rose-700"
                  >
                    Retirar secundario
                  </button>
                ) : <span />}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSecondaryEditorIndex(null)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold text-slate-600"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleUpdateServiceLine(secondaryEditorIndex, "hasSecondaryPayment", true);
                      setSecondaryEditorIndex(null);
                    }}
                    disabled={!serviceLines[secondaryEditorIndex].secondaryPayerId || Number(serviceLines[secondaryEditorIndex].secondaryPaid) <= 0}
                    className="rounded-lg bg-primary-blue px-3 py-1.5 text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Aplicar pago
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {noteEditorIndex !== null && serviceLines[noteEditorIndex] && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 p-4">
            <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 bg-blue-50 px-4 py-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-primary-blue">Notas de Service Line</p>
                  <h4 className="text-sm font-bold text-dark-blue">
                    CPT {serviceLines[noteEditorIndex].cpt}
                    <span className="ml-2 rounded-full bg-primary-blue px-2 py-0.5 text-[9px] text-white">
                      {serviceLines[noteEditorIndex].notes.length}
                    </span>
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setNoteEditorIndex(null)}
                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:text-slate-700"
                  aria-label="Cerrar notas CPT"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {serviceLines[noteEditorIndex].notes.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-[10px] italic text-slate-400">
                    No hay notas registradas para este CPT.
                  </p>
                ) : (
                  serviceLines[noteEditorIndex].notes.map(note => (
                    <div key={note.id} className="group rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {editingServiceLineNoteId === note.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editingServiceLineNoteDraft}
                            onChange={(event) => setEditingServiceLineNoteDraft(event.target.value)}
                            rows={3}
                            autoFocus
                            className="w-full resize-none rounded-lg border border-primary-blue bg-white p-2 text-xs text-slate-700"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingServiceLineNoteId(null);
                                setEditingServiceLineNoteDraft("");
                              }}
                              disabled={isSavingServiceLineNote}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold text-slate-500"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={saveEditedServiceLineNote}
                              disabled={!editingServiceLineNoteDraft.trim() || isSavingServiceLineNote}
                              className="flex items-center gap-1 rounded-md bg-primary-blue px-2 py-1 text-[9px] font-bold text-white disabled:opacity-40"
                            >
                              <Check className="h-3 w-3" />
                              Guardar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <p className="whitespace-pre-wrap text-xs text-slate-700">{note.text}</p>
                            <div className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                onClick={() => startEditingServiceLineNote(note)}
                                disabled={isSavingServiceLineNote}
                                className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-blue-200 hover:text-primary-blue disabled:opacity-40"
                                aria-label="Editar nota"
                                title="Editar nota"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteServiceLineNote(note.id)}
                                disabled={isSavingServiceLineNote}
                                className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-rose-200 hover:text-rose-600 disabled:opacity-40"
                                aria-label="Eliminar nota"
                                title="Eliminar nota"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 text-[8px] text-slate-400">
                            <span className="flex items-center gap-1 font-semibold text-slate-500" title={note.createdByEmail || note.createdBy}>
                              <UserRound className="h-3 w-3" />
                              {note.createdBy}
                            </span>
                            <span className="font-mono">
                              {new Date(note.createdAt).toLocaleString()}
                              {note.updatedAt && ` · Editada ${new Date(note.updatedAt).toLocaleString()} por ${note.updatedBy}`}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2 border-t border-slate-200 bg-white p-4">
                <textarea
                  value={serviceLineNoteDraft}
                  onChange={(e) => setServiceLineNoteDraft(e.target.value)}
                  placeholder="Añadir una nota para este CPT..."
                  rows={3}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs focus:bg-white"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setNoteEditorIndex(null)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold text-slate-600"
                  >
                    Cerrar
                  </button>
                  <button
                    type="button"
                    onClick={addServiceLineNote}
                    disabled={!serviceLineNoteDraft.trim() || isSavingServiceLineNote}
                    className="rounded-lg bg-primary-blue px-3 py-1.5 text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isSavingServiceLineNote ? "Guardando..." : "Añadir nota"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Detail Panel Footer */}
        <div className="bg-slate-100 p-4 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-600 transition-colors"
          >
            {isEnglish ? "Close Panel" : "Cerrar Panel"}
          </button>
          
          {canEditClaims && (
            <button
              onClick={handleSaveClaim}
              className="bg-primary-blue hover:bg-secondary-blue px-6 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 transition-all shadow-md shadow-blue-500/10"
            >
              <Send className="w-3.5 h-3.5" />
              {isEnglish ? "Save and Recalculate Reconciliation" : "Guardar y Recalcular Conciliación"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
