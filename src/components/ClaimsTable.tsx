/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Lock,
  Unlock,
  AlertOctagon,
  Eye,
  CheckCircle2,
  MoreHorizontal,
  Coins,
  ShieldAlert,
  X,
  Plus,
  Trash2,
  Paperclip,
  Calendar,
  User,
  FileText,
  Check,
  Loader2
} from "lucide-react";
import { Claim, ClaimStatus, ClaimClassification, UserRole, type User as AppUser } from "../types";
import { StatusBadge } from "./StatusBadge";
import { ClassificationBadge } from "./ClassificationBadge";
import { useFeedback } from "./FeedbackProvider";
import { useLanguage } from "./LanguageProvider";
import { PENDING_ERA_ACTION } from "../serviceLineValidation";
import {
  CARC_CATALOG,
  RARC_CATALOG,
  buildIssueCodes,
  getCarcOptionsForGroup,
  getDefaultCarcForGroup,
  getQuickIssuePreset,
  getQuickIssuePresetLabels,
  normalizeIssueCombination,
  quickCodesForCategory,
  type IssueGroupCode
} from "../registerIssueCoding";

interface ClaimsTableProps {
  claims: Claim[];
  selectedClaimIds: string[];
  onSelectClaim: (claimId: string, isSelected: boolean) => void;
  onSelectAllClaims: (claimIds: string[]) => void;
  onViewDetails: (claim: Claim) => void;
  onUpdateClaim?: (updates: Partial<Claim>, targetClaimId?: string) => Promise<void>;
  onSaveServiceLineNotes?: (serviceLinesJson: string, targetClaimId?: string) => Promise<void>;
  onDeleteClaim?: (claim: Claim, reason: string) => Promise<void>;
  userRole?: UserRole | string;
  allUsers?: AppUser[];
}

interface ServiceLineRow {
  row_id: string;
  claim: Claim;
  cpt: string;
  units: number;
  charged: number;
  allowed: number;
  paid: number;
  secondaryPaid: number;
  adj: number;
  patResp: number;
  balance: number;
  status: string;
  locked?: boolean;
  lock_reason?: string;
}

const getCptRowStatus = (line: any, fallbackStatus: string = "Pending") => {
  const totalPaid = (Number(line?.paid) || 0) + (Number(line?.secondaryPaid) || 0);
  if (totalPaid > 0) return ClaimStatus.Paid;
  return line?.status || fallbackStatus;
};

const textValue = (value: unknown) => String(value ?? "").trim();

const splitCptCodes = (value: unknown) =>
  textValue(value).split(/[\s,]+/).map(item => item.trim()).filter(Boolean);

const getClaimCptCodes = (claim: Claim) => {
  const codes = splitCptCodes(claim.cpt_hcpcs);

  if (claim.service_lines_json) {
    try {
      const serviceLines = JSON.parse(claim.service_lines_json);
      if (Array.isArray(serviceLines)) {
        serviceLines.forEach(line => {
          if (line?.cpt) codes.push(String(line.cpt).trim());
        });
      }
    } catch (err) {
      console.warn("Failed to parse service_lines_json", err);
    }
  }

  return Array.from(new Set(codes.filter(Boolean)));
};

const getServiceLinesForClaim = (claim: Claim): ServiceLineRow[] => {
  const codes = splitCptCodes(claim.cpt_hcpcs);
  
  let parsed: any[] = [];
  if (claim.service_lines_json) {
    try {
      parsed = JSON.parse(claim.service_lines_json);
    } catch (err) {
      console.warn("Failed to parse service_lines_json", err);
    }
  }

  if (parsed && parsed.length > 0) {
    return parsed.map((sl, idx) => ({
      row_id: `${claim.claim_id}-${sl.cpt || "unknown"}-${idx}`,
      claim,
      cpt: textValue(sl.cpt) || textValue(claim.cpt_hcpcs) || "N/A",
      units: sl.units !== undefined ? sl.units : 1,
      charged: sl.charged !== undefined ? sl.charged : 0,
      allowed: sl.allowed !== undefined ? sl.allowed : 0,
      paid: sl.paid !== undefined ? sl.paid : 0,
      secondaryPaid: sl.secondaryPaid !== undefined ? sl.secondaryPaid : 0,
      adj: sl.adj !== undefined ? sl.adj : 0,
      patResp: sl.patResp !== undefined ? sl.patResp : 0,
      balance: sl.balance !== undefined ? sl.balance : 0,
      status: getCptRowStatus(sl),
      locked: !!sl.locked,
      lock_reason: sl.lock_reason || ""
    }));
  }

  if (codes.length === 0) {
    return [{
      row_id: `${claim.claim_id}-unknown-0`,
      claim,
      cpt: textValue(claim.cpt_hcpcs) || "N/A",
      units: claim.units || 1,
      charged: claim.billed_charge,
      allowed: claim.allowed_amount,
      paid: claim.paid_amount,
      secondaryPaid: 0,
      adj: claim.insurance_adjustment,
      patResp: 0,
      balance: claim.ar_balance,
      status: claim.paid_amount > 0 ? ClaimStatus.Paid : claim.claim_status
    }];
  }

  return codes.map((cptCode, idx) => {
    const isFirst = idx === 0;
    return {
      row_id: `${claim.claim_id}-${cptCode}-${idx}`,
      claim,
      cpt: cptCode,
      units: isFirst ? (claim.units || 1) : 1,
      charged: isFirst ? claim.billed_charge : 0,
      allowed: isFirst ? claim.allowed_amount : 0,
      paid: isFirst ? claim.paid_amount : 0,
      secondaryPaid: 0,
      adj: isFirst ? claim.insurance_adjustment : 0,
      patResp: 0,
      balance: isFirst ? claim.ar_balance : 0,
      status: isFirst && claim.paid_amount > 0 ? ClaimStatus.Paid : (isFirst ? claim.claim_status : "Pending")
    };
  });
};

function applyPrimaryPaymentToServiceLine(line: any, inputAmount: number) {
  const normalized = normalizePaymentServiceLine(line);
  const charged = normalized.charged;
  const existingAllowed = normalized.allowed;
  const patResp = normalized.patResp;
  const secondaryPaid = normalized.secondaryPaid;
  const primaryPaid = Number(Math.max(0, inputAmount).toFixed(2));
  const allowed = Number(Math.max(existingAllowed, charged, primaryPaid + secondaryPaid + patResp).toFixed(2));
  const adj = roundMoney(Math.max(0, charged - allowed));

  return {
    ...normalized,
    charged,
    allowed,
    adj,
    paid: primaryPaid,
    secondaryPaid,
    patResp,
    balance: calculateCasBalance(charged, primaryPaid, secondaryPaid, adj),
    status: primaryPaid > 0
      ? "Paid"
      : (line.status === "Paid" || line.status === "Partially Paid" ? "Pending" : line.status || "Pending"),
    nextAction: line.nextAction || "No action",
    notes: Array.isArray(line.notes) ? line.notes : [],
    codes: Array.isArray(line.codes) ? line.codes : []
  };
}

function numberOrZero(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function calculateCasBalance(charged: number, paid: number, secondaryPaid: number, adjustment: number) {
  return roundMoney(Math.max(0, charged - paid - secondaryPaid - adjustment));
}

function normalizePaymentServiceLine(line: any) {
  const charged = Number(numberOrZero(line.charged).toFixed(2));
  const allowedSource = line.allowed === undefined || line.allowed === null || line.allowed === ""
    ? charged
    : numberOrZero(line.allowed);
  const allowed = Number(allowedSource.toFixed(2));
  const paid = Number(numberOrZero(line.paid).toFixed(2));
  const secondaryPaid = Number(numberOrZero(line.secondaryPaid).toFixed(2));
  const patResp = Number(numberOrZero(line.patResp).toFixed(2));
  const adj = roundMoney(Math.max(0, charged - allowed));

  return {
    ...line,
    charged,
    allowed,
    adj,
    paid,
    secondaryPaid,
    patResp,
    balance: calculateCasBalance(charged, paid, secondaryPaid, adj),
    status: line.status || "Pending",
    nextAction: line.nextAction || "No action",
    notes: Array.isArray(line.notes) ? line.notes : [],
    codes: Array.isArray(line.codes) ? line.codes : [],
    hasSecondaryPayment: Boolean(line.hasSecondaryPayment) || secondaryPaid > 0
  };
}

const STATUS_CATEGORY_CATALOG = [
  { code: "A0", description: "Acknowledgement/Forwarded - The claim/encounter has been forwarded to the next entity." },
  { code: "A1", description: "Acknowledgement/Receipt - The claim/encounter has been received." },
  { code: "A2", description: "Acknowledgement/Acceptance - The claim/encounter has been accepted." },
  { code: "A3", description: "Acknowledgement/Returned as rejected - The claim/encounter has been rejected." },
  { code: "A4", description: "Acknowledgement/Not Found - The claim/encounter cannot be found." },
  { code: "A6", description: "Acknowledgement/Pending - The claim/encounter is pending." },
  { code: "A7", description: "Acknowledgement/Rejected for Invalid Information - The claim/encounter has invalid data." }
];

const STATUS_CODE_CATALOG = [
  { code: "21", description: "Missing or invalid information." },
  { code: "33", description: "Subscriber and subscriber id not found." },
  { code: "35", description: "Claim/encounter not identified." },
  { code: "116", description: "Claim submitted to incorrect payer." },
  { code: "128", description: "Entity's tax id not on file." },
  { code: "562", description: "Entity's National Provider Identifier (NPI) is missing or invalid." }
];

const ENTITY_IDENTIFIER_CATALOG = [
  { code: "QC", description: "Patient" },
  { code: "IL", description: "Subscriber" },
  { code: "85", description: "Billing Provider" },
  { code: "82", description: "Rendering Provider" },
  { code: "PR", description: "Payer" },
  { code: "FA", description: "Facility" }
];

type SortField = "claim_id" | "date_of_service_from" | "billed_charge" | "paid_amount" | "ar_balance" | "ending_ap_to_physician" | "updated_at" | "patient_display_name_masked" | "provider_name" | "cpt_hcpcs" | "billed_by" | "claim_status" | "payer_name";
type SortOrder = "asc" | "desc";

export function ClaimsTable({
  claims,
  selectedClaimIds,
  onSelectClaim,
  onSelectAllClaims,
  onViewDetails,
  onUpdateClaim,
  onSaveServiceLineNotes,
  onDeleteClaim,
  userRole,
  allUsers = []
}: ClaimsTableProps) {
  const [viewMode, setViewMode] = useState<"patient" | "cpt">("patient");
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const activeAssignableUsers = allUsers
    .filter(user => user.active)
    .sort((a, b) => a.name.localeCompare(b.name));
  const defaultAssignedUserId = activeAssignableUsers[0]?.user_id || "unassigned";
  const getAssignedUser = (userId: string) => activeAssignableUsers.find(user => user.user_id === userId);

  // State to track which row has its actions menu open
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);

  const openActionMenu = (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const menuHeight = 200;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuHeight ? rect.bottom + 4 : rect.top - menuHeight - 4;
    const right = window.innerWidth - rect.right;
    setMenuPosition({ top, right });
    setActiveActionMenu(activeActionMenu === id ? null : id);
  };

  // States for the inline multi-cpt quick payment modal
  const [activePaymentClaim, setActivePaymentClaim] = useState<Claim | null>(null);
  const [activePaymentCpt, setActivePaymentCpt] = useState<string | undefined>(undefined);
  const [paymentInputs, setPaymentInputs] = useState<Record<string, string>>({});

  // States for the Register Claim Issue dialog
  const [activeIssueClaim, setActiveIssueClaim] = useState<Claim | null>(null);
  const [activeIssueCpt, setActiveIssueCpt] = useState<string | undefined>(undefined);
  const [issueStatus, setIssueStatus] = useState<string>("Denied");
  const [issueSource, setIssueSource] = useState<string>("ERA / 835");
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [codingMode, setCodingMode] = useState<"quick" | "advanced">("quick");
  const [denialCombinations, setDenialCombinations] = useState<Array<{
    id: string;
    level: "Claim" | "Service Line";
    groupCode: "CO" | "PR" | "OA" | "PI";
    carc: string;
    rarcs: string[];
    amount: number;
    patientResponsibility: number;
    cpt?: string;
    notes?: string;
  }>>([]);
  const [rejectionData, setRejectionData] = useState({
    rejectionSource: "Clearinghouse",
    statusCategoryCode: "",
    statusCode: "",
    entityIdentifier: "",
    message: "",
    affectedEntity: "Claim",
    affectedField: "Eligibility",
    correctiveAction: "",
    resubmitRequired: "Yes",
    notes: ""
  });
  const [nextActionData, setNextActionData] = useState({
    nextAction: "Correct and Resubmit",
    assignedTo: "unassigned",
    dueDate: "",
    priority: "Medium",
    followUpDate: "",
    taskStatus: "Open"
  });
  const [internalCategory, setInternalCategory] = useState<string>("Eligibility / Coverage");
  const [attachments, setAttachments] = useState<Array<{ name: string; size: string; type: string }>>([]);
  const [issueNote, setIssueNote] = useState<string>("");
  const [issueSubmitMode, setIssueSubmitMode] = useState<"draft" | "apply" | null>(null);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [pendingOperationLabel, setPendingOperationLabel] = useState<string | null>(null);
  
  const { promptAction, notify } = useFeedback();
  const { language } = useLanguage();
  const isEnglish = language === "en";

  const runPendingOperation = async (label: string, action: () => Promise<void>) => {
    if (pendingOperationLabel) return;
    setPendingOperationLabel(label);
    try {
      await action();
    } catch (err: any) {
      notify(err.message || (isEnglish ? "The operation could not be completed." : "No se pudo completar la operación."), "error");
    } finally {
      setPendingOperationLabel(null);
    }
  };

  // Register Claim Issue function
  const handleSaveClaimIssue = async (statusOverride?: string) => {
    if (!activeIssueClaim) return;
    if (issueSubmitMode || pendingOperationLabel) return;
    const localIsEnglish = localStorage.getItem("itera-language") !== "es";
    const mode = statusOverride ? "draft" : "apply";
    setIssueSubmitMode(mode);
    setPendingOperationLabel(
      mode === "draft"
        ? (localIsEnglish ? "Saving issue draft..." : "Guardando borrador de incidencia...")
        : (localIsEnglish ? "Applying claim issue..." : "Aplicando incidencia del claim...")
    );
    try {
      const actualStatus = statusOverride || issueStatus;

      // Smart Validation
      if (selectedLines.length === 0 && actualStatus !== "Pending") {
        notify(localIsEnglish ? "Select at least one affected CPT line before applying the issue." : "Seleccione al menos una línea CPT afectada antes de aplicar la incidencia.", "warning");
        return;
      }
      if (actualStatus === "Denied" && codingMode === "advanced" && denialCombinations.length === 0) {
        notify(localIsEnglish ? "Please add at least one CARC/RARC combination for a Denial." : "Por favor, agregue al menos una combinación de CARC/RARC para una denegación.", "warning");
        return;
      }
      if ((actualStatus === "Partially Paid" || actualStatus === "Paid with Adjustment") && codingMode === "advanced" && denialCombinations.length === 0) {
        notify(localIsEnglish ? "Please add at least one adjustment combination with the adjudicated amount." : "Agregue al menos una combinación de ajuste con el importe adjudicado.", "warning");
        return;
      }
      if (actualStatus === "Rejected" && !rejectionData.message && !rejectionData.statusCode) {
        notify(localIsEnglish ? "Please specify a rejection message or status code." : "Por favor, especifique un mensaje de rechazo o código de estado.", "warning");
        return;
      }

      // Parse current service lines
      let serviceLines: any[] = [];
      if (activeIssueClaim.service_lines_json) {
        try {
          serviceLines = JSON.parse(activeIssueClaim.service_lines_json);
        } catch (e) {
          console.error(e);
        }
      }

      // Initialize if empty
      if (serviceLines.length === 0 && activeIssueClaim.cpt_hcpcs) {
        const cpts = splitCptCodes(activeIssueClaim.cpt_hcpcs);
        serviceLines = cpts.map(cpt => ({
          cpt: cpt,
          charged: activeIssueClaim.billed_charge / cpts.length,
          allowed: (activeIssueClaim.allowed_amount || activeIssueClaim.billed_charge) / cpts.length,
          adj: (activeIssueClaim.billed_charge - (activeIssueClaim.allowed_amount || activeIssueClaim.billed_charge)) / cpts.length,
          paid: 0,
          secondaryPaid: 0,
          patResp: 0,
          balance: (activeIssueClaim.allowed_amount || activeIssueClaim.billed_charge) / cpts.length,
          status: "Pending",
          units: 1,
          notes: [],
          codes: []
        }));
      }

      let updatedLines = [...serviceLines];

      // Status mapping for service lines
      let targetLineStatus = "Pending";
      if (actualStatus === "Denied") targetLineStatus = "Denied";
      else if (actualStatus === "Rejected") targetLineStatus = "Rejected";
      else if (actualStatus === "Partially Paid") targetLineStatus = "Partially Paid";
      else if (actualStatus === "Paid with Adjustment") targetLineStatus = "Paid";
      else if (actualStatus === "Pending / Additional Information Needed") targetLineStatus = "Pending";
      else if (actualStatus === "Recoupment / Takeback") targetLineStatus = "Written Off";

      const balanceValidationErrors: string[] = [];
      const affectedLinesForAllocation = updatedLines.filter((line: any) => selectedLines.includes(line.cpt));
      const affectedChargeTotal = affectedLinesForAllocation.reduce((sum: number, line: any) => sum + (Number(line.charged) || 0), 0);
      const claimLevelAllocations = new Map<string, Map<string, number>>();
      denialCombinations
        .filter(comb => comb.level === "Claim")
        .forEach(comb => {
          const amount = roundMoney(Number(comb.amount) || 0);
          const lineAllocations = new Map<string, number>();
          let allocated = 0;
          affectedLinesForAllocation.forEach((line: any, index: number) => {
            const isLast = index === affectedLinesForAllocation.length - 1;
            const weight = affectedChargeTotal > 0
              ? (Number(line.charged) || 0) / affectedChargeTotal
              : 1 / Math.max(affectedLinesForAllocation.length, 1);
            const lineAmount = isLast ? roundMoney(amount - allocated) : roundMoney(amount * weight);
            allocated = roundMoney(allocated + lineAmount);
            lineAllocations.set(line.cpt, lineAmount);
          });
          claimLevelAllocations.set(comb.id, lineAllocations);
        });

      const getCombinationAmountForLine = (comb: typeof denialCombinations[number], line: any) => {
        if (comb.level === "Claim") {
          return claimLevelAllocations.get(comb.id)?.get(line.cpt) || 0;
        }
        return comb.cpt === line.cpt ? Number(comb.amount) || 0 : 0;
      };

      updatedLines = updatedLines.map((line: any) => {
        if (selectedLines.includes(line.cpt)) {
          // Add notes
          const nextNotes = [...(line.notes || [])];
          if (issueNote) nextNotes.push(issueNote);
          if (actualStatus === "Rejected" && rejectionData.message) {
            nextNotes.push(`Rejection Msg: ${rejectionData.message}`);
          }

          // Add codes
          let nextCodes = [...(line.codes || [])];
          if (actualStatus === "Denied" || actualStatus === "Partially Paid" || actualStatus === "Paid with Adjustment") {
            if (codingMode === "advanced") {
              nextCodes.push(...buildIssueCodes(
                denialCombinations
                  .filter(comb => comb.level === "Claim" || comb.cpt === line.cpt)
                  .map(comb => ({ groupCode: comb.groupCode, carc: comb.carc, rarcs: comb.rarcs }))
              ));
            } else {
              nextCodes.push(...quickCodesForCategory(internalCategory));
            }
          } else if (actualStatus === "Rejected") {
            if (rejectionData.statusCode) {
              nextCodes.push(`277CA-${rejectionData.statusCode}`);
            }
          }

          // Financial Updates for Denied / Adjusted
          let lineAdj = line.adj || 0;
          let linePatResp = line.patResp || 0;
          let linePaid = Number(line.paid) || 0;
          if (actualStatus === "Denied" || actualStatus === "Partially Paid" || actualStatus === "Paid with Adjustment") {
            if (codingMode === "advanced") {
              const activeCombs = denialCombinations.filter(c => c.level === "Claim" || c.cpt === line.cpt);
              lineAdj = roundMoney(activeCombs.reduce((sum, c) => sum + getCombinationAmountForLine(c, line), 0));
              linePatResp = roundMoney(activeCombs.reduce((sum, c) => {
                if (c.groupCode === "PR") return sum + getCombinationAmountForLine(c, line);
                return sum + (Number(c.patientResponsibility) || 0);
              }, 0));
            } else {
              if (actualStatus === "Denied") {
                lineAdj = line.charged;
                linePaid = 0;
              } else if (actualStatus === "Partially Paid") {
                const defaultPaid = linePaid > 0 ? linePaid : Number((line.charged / 2).toFixed(2));
                lineAdj = Math.max(0, line.charged - defaultPaid);
                linePaid = defaultPaid;
              } else {
                lineAdj = 0;
                linePaid = linePaid > 0 ? linePaid : line.charged;
              }
            }
          }

          const finalAllowed = Math.max(0, line.charged - lineAdj);
          const finalPaid = actualStatus === "Partially Paid" || actualStatus === "Paid with Adjustment"
            ? Math.min(Math.max(0, linePaid || finalAllowed), finalAllowed)
            : 0;
          const rawBalance = roundMoney(line.charged - finalPaid - lineAdj);
          if (rawBalance < -0.01) {
            balanceValidationErrors.push(`CPT ${line.cpt}: CAS adjustments exceed the remaining charge by $${Math.abs(rawBalance).toFixed(2)}.`);
          }

          return {
            ...line,
            allowed: roundMoney(finalAllowed),
            adj: roundMoney(lineAdj),
            patResp: roundMoney(linePatResp),
            paid: roundMoney(finalPaid),
            balance: roundMoney(Math.max(0, rawBalance)),
            status: targetLineStatus,
            codes: Array.from(new Set(nextCodes)).filter(Boolean),
            notes: nextNotes,
            nextAction: nextActionData.nextAction
          };
        }
        return line;
      });

      if (balanceValidationErrors.length > 0) {
        notify(
          `${localIsEnglish ? "Review adjudication amounts before applying:" : "Revise los montos de adjudicación antes de aplicar:"} ${balanceValidationErrors.join(" ")}`,
          "warning"
        );
        return;
      }

      // Recalculate totals
      const totalLinePaid = updatedLines.reduce((sum, line) => sum + (Number(line.paid) || 0) + (Number(line.secondaryPaid) || 0), 0);
      const totalLineCharged = updatedLines.reduce((sum, line) => sum + (Number(line.charged) || 0), 0);
      const totalLineAllowed = updatedLines.reduce((sum, line) => sum + (Number(line.allowed) || 0), 0);
      const totalLineDenied = updatedLines
        .filter(line => line.status === "Denied" || line.status === "Rejected")
        .reduce((sum, line) => sum + (Number(line.allowed) || Number(line.charged)), 0);

      // Determine claim status
      const allRejected = updatedLines.every(line => line.status === "Rejected");
      const allDenied = updatedLines.every(line => line.status === "Denied");
      const allPaid = updatedLines.every(line => line.status === "Paid");
      const anyPaid = updatedLines.some(line => line.status === "Paid" || line.status === "Partially Paid");

      let targetClaimStatus = ClaimStatus.Pending;
      if (allRejected) targetClaimStatus = ClaimStatus.Rejected;
      else if (allDenied) targetClaimStatus = ClaimStatus.Denied;
      else if (allPaid) targetClaimStatus = ClaimStatus.Paid;
      else if (anyPaid) targetClaimStatus = ClaimStatus.PartiallyPaid;
      else if (actualStatus === "Recoupment / Takeback") targetClaimStatus = ClaimStatus.WrittenOff;
      else if (actualStatus === "Pending / Additional Information Needed") targetClaimStatus = ClaimStatus.Pending;

      const codesSummary = codingMode === "advanced" 
        ? denialCombinations.map(c => {
            const normalized = normalizeIssueCombination({ groupCode: c.groupCode, carc: c.carc, rarcs: c.rarcs });
            return `${normalized.carc}${normalized.rarcs.length > 0 ? ` (${normalized.rarcs.join(",")})` : ""}`;
          }).join("; ")
        : (actualStatus === "Rejected" ? `Rejection: ${rejectionData.statusCode || "Custom"}` : "Quick Issue");
      const assignedUser = getAssignedUser(nextActionData.assignedTo);
      const assignedSummary = assignedUser
        ? `${assignedUser.name} <${assignedUser.email}> (${assignedUser.role})`
        : "Unassigned";

      const noteContent = `[Issue: ${actualStatus}] Source: ${issueSource} | Cat: ${internalCategory} | Codes: ${codesSummary} | Action: ${nextActionData.nextAction} | Assigned: ${assignedSummary}. ${issueNote ? `Note: ${issueNote}` : ""}`;

      if (onUpdateClaim) {
        await onUpdateClaim({
          service_lines_json: JSON.stringify(updatedLines),
          billed_charge: totalLineCharged,
          allowed_amount: totalLineAllowed,
          paid_amount: totalLinePaid,
          denied_amount: totalLineDenied,
          claim_status: targetClaimStatus,
          last_note: noteContent.substring(0, 500)
        }, activeIssueClaim.claim_id);
      }

      notify(localIsEnglish ? "Claim Issue registered successfully!" : "¡Incidencia de Reclamación registrada con éxito!", "success");
      setActiveIssueClaim(null);
    } catch (err: any) {
      notify(err.message || "Error", "error");
    } finally {
      setIssueSubmitMode(null);
      setPendingOperationLabel(null);
    }
  };

  const handleQuickPayment = async (claim: Claim, cptCode?: string) => {
    const isEnglish = localStorage.getItem("itera-language") !== "es";
    let startedPaymentSave = false;

    // Patient-view (no specific CPT): open the inline multi-CPT dialog
    if (!cptCode) {
      let serviceLines: any[] = [];
      if (claim.service_lines_json) {
        try { serviceLines = JSON.parse(claim.service_lines_json); } catch (e) { console.error(e); }
      }
      const initialInputs: Record<string, string> = {};
      serviceLines.forEach((line: any) => {
        if (line.paid !== undefined && line.paid !== null && Number(line.paid) > 0) {
          initialInputs[line.cpt] = String(line.paid);
        }
      });

      setActivePaymentClaim(claim);
      setActivePaymentCpt(undefined);
      setPaymentInputs(initialInputs);
      return;
    }

    // CPT-specific: single prompt then save
    try {
      // Parse current service lines
      let serviceLines: any[] = [];
      if (claim.service_lines_json) {
        try { serviceLines = JSON.parse(claim.service_lines_json); } catch (e) { console.error(e); }
      }
      if (serviceLines.length === 0 && claim.cpt_hcpcs) {
        const cpts = splitCptCodes(claim.cpt_hcpcs);
        serviceLines = cpts.map(cpt => ({
          cpt,
          charged: claim.billed_charge / cpts.length,
          allowed: (claim.allowed_amount || claim.billed_charge) / cpts.length,
          adj: (claim.billed_charge - (claim.allowed_amount || claim.billed_charge)) / cpts.length,
          paid: 0,
          secondaryPaid: 0,
          patResp: 0,
          balance: (claim.allowed_amount || claim.billed_charge) / cpts.length,
          status: "Pending",
          nextAction: "No action",
          units: 1,
          notes: [],
          codes: []
        }));
      }

      const amountStr = await promptAction({
        title: isEnglish ? "Register Quick Payment" : "Registrar Pago Rápido",
        message: isEnglish ? `Enter payment amount for CPT ${cptCode}:` : `Ingrese el monto para CPT ${cptCode}:`,
        inputLabel: isEnglish ? "Payment Amount ($)" : "Monto del Pago ($)",
        placeholder: "0.00",
        inputType: "number",
        cancelLabel: isEnglish ? "Cancel" : "Cancelar",
        confirmLabel: isEnglish ? "Register" : "Registrar"
      });

      if (amountStr === null) return;
      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount <= 0) {
        notify(isEnglish ? "Please enter a valid amount." : "Por favor ingrese un monto válido.", "warning");
        return;
      }
      if (isSavingPayment || pendingOperationLabel) return;
      startedPaymentSave = true;
      setIsSavingPayment(true);
      setPendingOperationLabel(isEnglish ? "Registering quick payment..." : "Registrando pago rápido...");

      const updatedLines = serviceLines.map((line: any) => {
        if (line.cpt === cptCode) {
          return applyPrimaryPaymentToServiceLine(line, amount);
        }
        return normalizePaymentServiceLine(line);
      });

      const totalLinePaid = updatedLines.reduce((sum: number, line: any) => sum + (Number(line.paid) || 0) + (Number(line.secondaryPaid) || 0), 0);
      const totalLineCharged = updatedLines.reduce((sum: number, line: any) => sum + (Number(line.charged) || 0), 0);
      const totalLineAllowed = updatedLines.reduce((sum: number, line: any) => sum + (Number(line.allowed) || 0), 0);
      const allPaid = updatedLines.every((line: any) => line.status === "Paid");
      const targetClaimStatus = allPaid ? ("Paid" as ClaimStatus) : ("Partially Paid" as ClaimStatus);

      if (onUpdateClaim) {
        await onUpdateClaim({
          service_lines_json: JSON.stringify(updatedLines),
          billed_charge: totalLineCharged,
          allowed_amount: totalLineAllowed,
          paid_amount: totalLinePaid,
          claim_status: targetClaimStatus
        }, claim.claim_id);
      } else if (onSaveServiceLineNotes) {
        await onSaveServiceLineNotes(JSON.stringify(updatedLines), claim.claim_id);
      }

      notify(isEnglish ? "Quick payment registered successfully!" : "¡Pago rápido registrado con éxito!", "success");
    } catch (err: any) {
      notify(err.message || "Error", "error");
    } finally {
      if (startedPaymentSave) {
        setIsSavingPayment(false);
        setPendingOperationLabel(null);
      }
    }
  };

  // Sorting logic
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
    setCurrentPage(1);
  };

  const sortedClaims = [...claims].sort((a, b) => {
    let valA = a[sortField];
    let valB = b[sortField];

    if (typeof valA === "string" && typeof valB === "string") {
      return sortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    if (typeof valA === "number" && typeof valB === "number") {
      return sortOrder === "asc" ? valA - valB : valB - valA;
    }
    return 0;
  });

  // Flatten to service lines
  const serviceLineRows = React.useMemo(() => {
    const rows: ServiceLineRow[] = [];
    claims.forEach((claim) => {
      const sls = getServiceLinesForClaim(claim);
      rows.push(...sls);
    });
    return rows;
  }, [claims]);

  const sortedServiceLines = React.useMemo(() => {
    if (viewMode !== "cpt") return [];
    return [...serviceLineRows].sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortField === "date_of_service_from") {
        valA = a.claim.date_of_service_from;
        valB = b.claim.date_of_service_from;
      } else if (sortField === "billed_charge") {
        valA = a.charged;
        valB = b.charged;
      } else if (sortField === "paid_amount") {
        valA = a.paid + a.secondaryPaid;
        valB = b.paid + b.secondaryPaid;
      } else if (sortField === "ar_balance") {
        valA = a.balance;
        valB = b.balance;
      } else if (sortField === "ending_ap_to_physician") {
        valA = a.claim.ending_ap_to_physician;
        valB = b.claim.ending_ap_to_physician;
      } else if (sortField === "updated_at") {
        valA = a.claim.updated_at;
        valB = b.claim.updated_at;
      } else if (sortField === "patient_display_name_masked") {
        valA = a.claim.patient_display_name_masked;
        valB = b.claim.patient_display_name_masked;
      } else if (sortField === "provider_name") {
        valA = a.claim.provider_name;
        valB = b.claim.provider_name;
      } else if (sortField === "cpt_hcpcs") {
        valA = a.cpt;
        valB = b.cpt;
      } else if (sortField === "billed_by") {
        valA = a.claim.billed_by;
        valB = b.claim.billed_by;
      } else if (sortField === "claim_status") {
        valA = a.status;
        valB = b.status;
      } else if (sortField === "payer_name") {
        valA = a.claim.payer_name;
        valB = b.claim.payer_name;
      } else {
        valA = a.claim.claim_id;
        valB = b.claim.claim_id;
      }

      if (typeof valA === "string" && typeof valB === "string") {
        return sortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      if (typeof valA === "number" && typeof valB === "number") {
        return sortOrder === "asc" ? valA - valB : valB - valA;
      }
      return 0;
    });
  }, [viewMode, serviceLineRows, sortField, sortOrder]);

  // Pagination logic
  const totalItems = viewMode === "patient" ? sortedClaims.length : sortedServiceLines.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const paginatedClaims = sortedClaims.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const paginatedServiceLines = sortedServiceLines.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSelectAllChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const idsToSelect = viewMode === "patient"
        ? paginatedClaims.map(c => c.claim_id)
        : paginatedServiceLines.map(sl => sl.claim.claim_id);
      const uniqueIds = Array.from(new Set([...selectedClaimIds, ...idsToSelect]));
      onSelectAllClaims(uniqueIds);
    } else {
      const idsToRemove = viewMode === "patient"
        ? paginatedClaims.map(c => c.claim_id)
        : paginatedServiceLines.map(sl => sl.claim.claim_id);
      onSelectAllClaims(selectedClaimIds.filter(id => !idsToRemove.includes(id)));
    }
  };

  const isAllPaginatedSelected =
    viewMode === "patient"
      ? (paginatedClaims.length > 0 && paginatedClaims.every(c => selectedClaimIds.includes(c.claim_id)))
      : (paginatedServiceLines.length > 0 && paginatedServiceLines.every(sl => selectedClaimIds.includes(sl.claim.claim_id)));

  // Numeric currency helper
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
  };

  // Date of service formatter: YYYY-MM-DD -> MM-YY
  const formatDos = (dateStr: string) => {
    if (!dateStr) return "N/A";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    const [year, month] = parts;
    const shortYear = year.slice(-2);
    return `${month}-${shortYear}`;
  };

  const isAdmin = userRole === UserRole.Admin;

  const requestSoftDeleteClaim = async (claim: Claim) => {
    if (!onDeleteClaim || !isAdmin) return;
    const reason = await promptAction({
      title: isEnglish ? "Delete claim" : "Eliminar claim",
      message: isEnglish
        ? `This will hide ${claim.claim_id} from operational views while keeping the full audit trail. Enter the reason.`
        : `Esto ocultará ${claim.claim_id} de las vistas operativas manteniendo toda la trazabilidad. Ingresa la razón.`,
      inputLabel: isEnglish ? "Reason" : "Razón",
      placeholder: isEnglish ? "Entered in error, duplicate claim..." : "Introducido por error, claim duplicado...",
      inputType: "text",
      cancelLabel: isEnglish ? "Cancel" : "Cancelar",
      confirmLabel: isEnglish ? "Delete claim" : "Eliminar claim"
    });
    if (!reason || !reason.trim()) return;
    if (pendingOperationLabel) return;
    setPendingOperationLabel(isEnglish ? "Deleting claim..." : "Eliminando claim...");
    try {
      await onDeleteClaim(claim, reason.trim());
      notify(isEnglish ? "Claim deleted from operational views." : "Claim eliminado de las vistas operativas.", "success");
    } catch (err: any) {
      notify(err.message || (isEnglish ? "Failed to delete claim." : "No se pudo eliminar el claim."), "error");
    } finally {
      setPendingOperationLabel(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      {/* Table Sub-header for View Mode Toggle */}
      <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            {isEnglish ? "Grouping" : "Agrupamiento"}
          </span>
          <span className="text-[11px] text-slate-400">
            ({viewMode === "patient" 
              ? (isEnglish ? "One claim per row" : "Un reclamo por fila") 
              : (isEnglish ? "One CPT code per row" : "Un código CPT por fila")})
          </span>
        </div>
        <div className="flex bg-slate-200/60 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => { setViewMode("patient"); setCurrentPage(1); }}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
              viewMode === "patient"
                ? "bg-white text-primary-blue shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {isEnglish ? "Patient View (Claims)" : "Vista Paciente (Reclamos)"}
          </button>
          <button
            type="button"
            onClick={() => { setViewMode("cpt"); setCurrentPage(1); }}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
              viewMode === "cpt"
                ? "bg-white text-primary-blue shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {isEnglish ? "Detailed View (CPTs)" : "Vista Detallada (CPTs)"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[10px] uppercase tracking-widest font-bold select-none">
              <th className="px-4 py-3 text-center w-12">
                <input
                  type="checkbox"
                  checked={isAllPaginatedSelected}
                  onChange={handleSelectAllChange}
                  className="rounded border-slate-300 text-primary-blue focus:ring-primary-blue h-3.5 w-3.5 cursor-pointer"
                />
              </th>
              <th onClick={() => handleSort("patient_display_name_masked")} className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-1">
                  {isEnglish ? "Patient" : "Paciente"}
                  {sortField === "patient_display_name_masked" && (sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th onClick={() => handleSort("provider_name")} className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-1">
                  {isEnglish ? "Provider / Physician" : "Proveedor / Médico"}
                  {sortField === "provider_name" && (sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th onClick={() => handleSort("date_of_service_from")} className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-1">
                  DOS
                  {sortField === "date_of_service_from" && (sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th onClick={() => handleSort("cpt_hcpcs")} className="px-4 py-3 text-center cursor-pointer hover:bg-slate-100 transition-colors">
                <div className="flex items-center justify-center gap-1">
                  {viewMode === "patient" ? "CPT Codes" : (isEnglish ? "CPT Code" : "Código CPT")}
                  {sortField === "cpt_hcpcs" && (sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th onClick={() => handleSort("billed_by")} className="px-4 py-3 text-center cursor-pointer hover:bg-slate-100 transition-colors">
                <div className="flex items-center justify-center gap-1">
                  {isEnglish ? "Billed By" : "Facturado por"}
                  {sortField === "billed_by" && (sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th onClick={() => handleSort("claim_status")} className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-1">
                  {isEnglish ? "Status" : "Estado"}
                  {sortField === "claim_status" && (sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th onClick={() => handleSort("payer_name")} className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-1">
                  {isEnglish ? "Primary Payer" : "Pagador Primario"}
                  {sortField === "payer_name" && (sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>

              <th onClick={() => handleSort("paid_amount")} className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 transition-colors">
                <div className="flex items-center justify-end gap-1">
                  {isEnglish ? "Paid" : "Pagado"}
                  {sortField === "paid_amount" && (sortOrder === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th className="px-4 py-3 text-center w-24">{isEnglish ? "Actions" : "Acciones"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {viewMode === "patient" ? (
              paginatedClaims.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center p-12 text-slate-500 font-sans">
                    {isEnglish ? "No claims found for the selected filters." : "No se encontraron claims para los filtros seleccionados."}
                  </td>
                </tr>
              ) : (
                paginatedClaims.map((claim) => {
                  const isSelected = selectedClaimIds.includes(claim.claim_id);
                  const hasError = claim.error_flag;
                  const isLocked = claim.locked;

                  return (
                    <tr
                      key={claim.claim_id}
                      onClick={() => onViewDetails(claim)}
                      className={`hover:bg-blue-50/20 cursor-pointer transition-colors ${
                        isSelected ? "bg-blue-50/40" : ""
                      } ${isLocked ? "bg-red-50/10" : ""}`}
                    >
                      {/* Checkbox */}
                      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => onSelectClaim(claim.claim_id, e.target.checked)}
                          className="rounded border-slate-300 text-primary-blue focus:ring-primary-blue h-3.5 w-3.5 cursor-pointer"
                        />
                      </td>

                      {/* Masked Patient with flags */}
                      <td className="px-4 py-3 font-sans">
                        <div className="flex items-center gap-1.5">
                          <div className="font-semibold text-slate-700">{claim.patient_display_name_masked}</div>
                          {isLocked && (
                            <Lock className="w-3.5 h-3.5 text-rose-600 shrink-0" title={`Locked: ${claim.lock_reason}`} />
                          )}
                          {hasError && !isLocked && (
                            <AlertOctagon className="w-3.5 h-3.5 text-accent-orange shrink-0 animate-pulse" title={`Blocked Error: ${claim.error_category}`} />
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">ID: {claim.patient_id}</div>
                      </td>

                      {/* Provider */}
                      <td className="px-4 py-3 font-sans">
                        <div className="font-semibold text-slate-700">{claim.provider_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{claim.practice_name}</div>
                      </td>

                      {/* DOS */}
                      <td className="px-4 py-3 font-mono text-slate-500">{formatDos(claim.date_of_service_from)}</td>

                      {/* All CPT codes in this claim */}
                      <td className="px-4 py-3">
                        <div className="flex min-w-28 max-w-48 flex-wrap justify-center gap-1">
                          {getClaimCptCodes(claim).length > 0 ? (
                            getClaimCptCodes(claim).map(code => (
                              <span
                                key={code}
                                className="rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-dark-blue"
                              >
                                {code}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] italic text-slate-400">Sin CPT</span>
                          )}
                        </div>
                      </td>

                      {/* Billed By */}
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${claim.billed_by === "ITERA" ? "bg-[#1b98e0]/10 text-[#004e89]" : "bg-slate-100 text-slate-600"}`}>
                          {claim.billed_by}
                        </span>
                      </td>

                      {/* Status Badge */}
                      <td className="px-4 py-3">
                        <StatusBadge status={claim.claim_status} />
                      </td>

                      {/* Primary Payer */}
                      <td className="px-4 py-3 font-sans">
                        <div className="text-xs font-semibold text-slate-700">{claim.payer_name}</div>
                        <div className="text-[10px] text-slate-400">{claim.payer_id}</div>
                      </td>


                      {/* Financial Values */}
                      <td className="px-4 py-3 text-right font-semibold font-mono text-emerald-600">
                        {formatCurrency(claim.paid_amount)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-center relative" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => openActionMenu(claim.claim_id, e)}
                          className="inline-flex items-center justify-center p-1.5 bg-slate-50 hover:bg-slate-200 border border-slate-200 rounded text-slate-700 hover:text-dark-blue hover:border-dark-blue transition-all cursor-pointer"
                          aria-label="Acciones"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>

                        {activeActionMenu === claim.claim_id && (
                          <>
                            <div
                              className="fixed inset-0 z-[190]"
                              onClick={() => setActiveActionMenu(null)}
                            />
                            <div
                              style={{ position: "fixed", top: menuPosition?.top, right: menuPosition?.right }}
                              className="w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg z-[200] font-sans text-left">
                              <button
                                onClick={() => {
                                  setActiveActionMenu(null);
                                  onViewDetails(claim);
                                }}
                                className="flex w-full items-center gap-2 rounded px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 hover:text-dark-blue cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                {localStorage.getItem("itera-language") !== "es" ? "Details" : "Ver Detalles"}
                              </button>
                              <button
                                disabled={isLocked}
                                onClick={() => {
                                  setActiveActionMenu(null);
                                  // Parse and open payment modal for unpaid service lines
                                  let serviceLines: any[] = [];
                                  if (claim.service_lines_json) {
                                    try { serviceLines = JSON.parse(claim.service_lines_json); } catch {}
                                  }
                                  if (serviceLines.length === 0 && claim.cpt_hcpcs) {
                                    const cpts = splitCptCodes(claim.cpt_hcpcs);
                                    serviceLines = cpts.map(c => ({ cpt: c, charged: claim.billed_charge / cpts.length, status: "Pending" }));
                                  }
                                  const initialInputs: Record<string, string> = {};
                                  serviceLines.forEach(l => {
                                    if (l.status !== "Paid") initialInputs[l.cpt] = "";
                                  });
                                  setPaymentInputs(initialInputs);
                                  setActivePaymentClaim(claim);
                                  setActivePaymentCpt(undefined);
                                }}
                                className="flex w-full items-center gap-2 rounded px-3 py-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                              >
                                <Coins className="w-3.5 h-3.5" />
                                {isEnglish ? "Quick Payment" : "Registrar pago rápido"}
                              </button>
                              <button
                                disabled={isLocked}
                                onClick={() => {
                                  setActiveActionMenu(null);
                                  setActiveIssueClaim(claim);
                                  setActiveIssueCpt(undefined);
                                  setIssueStatus("Denied");
                                  setIssueSource("ERA / 835");
                                  setCodingMode("quick");
                                  setDenialCombinations([]);
                                  setInternalCategory("Eligibility / Coverage");
                                  setNextActionData({
                                    nextAction: "Correct and Resubmit",
                                    assignedTo: defaultAssignedUserId,
                                    dueDate: "",
                                    priority: "Medium",
                                    followUpDate: "",
                                    taskStatus: "Open"
                                  });
                                  setIssueNote("");
                                  let initialLines: string[] = [];
                                  if (claim.service_lines_json) {
                                    try {
                                      const sls = JSON.parse(claim.service_lines_json);
                                      initialLines = sls.filter((l: any) => l.status !== "Paid").map((l: any) => l.cpt);
                                    } catch {}
                                  }
                                  if (initialLines.length === 0 && claim.cpt_hcpcs) {
                                    initialLines = splitCptCodes(claim.cpt_hcpcs);
                                  }
                                  setSelectedLines(initialLines);
                                }}
                                className="flex w-full items-center gap-2 rounded px-3 py-2 text-[11px] font-bold text-rose-700 hover:bg-rose-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                              >
                                <ShieldAlert className="w-3.5 h-3.5" />
                                {isEnglish ? "Register Issue" : "Registrar incidencia"}
                              </button>
                              <button
                                onClick={async () => {
                                  setActiveActionMenu(null);
                                  if (isLocked) {
                                    if (onUpdateClaim) {
                                      await runPendingOperation(isEnglish ? "Unlocking claim..." : "Desbloqueando claim...", async () => {
                                        await onUpdateClaim({
                                          locked: false,
                                          lock_reason: "",
                                          claim_status: claim.claim_status === ClaimStatus.BlockedByError ? ClaimStatus.Pending : claim.claim_status
                                        }, claim.claim_id);
                                        notify(isEnglish ? "Claim unlocked successfully!" : "¡Reclamación desbloqueada con éxito!", "success");
                                      });
                                    }
                                  } else {
                                    const reason = await promptAction({
                                      title: isEnglish ? "Block Claim" : "Bloquear Reclamación",
                                      message: isEnglish ? "Enter the block reason:" : "Ingrese la causa del bloqueo:",
                                      inputLabel: isEnglish ? "Reason" : "Causa",
                                      placeholder: isEnglish ? "Missing document, coding review..." : "Falta documento, revisión de código...",
                                      inputType: "text",
                                      cancelLabel: isEnglish ? "Cancel" : "Cancelar",
                                      confirmLabel: isEnglish ? "Block" : "Bloquear"
                                    });
                                    if (reason && reason.trim() !== "") {
                                      if (onUpdateClaim) {
                                        await runPendingOperation(isEnglish ? "Blocking claim..." : "Bloqueando claim...", async () => {
                                          await onUpdateClaim({
                                            locked: true,
                                            lock_reason: reason.trim(),
                                            error_flag: true,
                                            error_category: "Billing Error" as any,
                                            claim_status: ClaimStatus.BlockedByError
                                          }, claim.claim_id);
                                          notify(isEnglish ? "Claim blocked successfully!" : "¡Reclamación bloqueada con éxito!", "success");
                                        });
                                      }
                                    }
                                  }
                                }}
                                disabled={!!pendingOperationLabel}
                                className={`flex w-full items-center gap-2 rounded px-3 py-2 text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-wait ${
                                  isLocked ? "text-slate-700 hover:bg-slate-50" : "text-amber-700 hover:bg-amber-50"
                                }`}
                              >
                                {pendingOperationLabel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />)}
                                {isLocked 
                                  ? (isEnglish ? "Unlock Claim" : "Desbloquear Reclamación") 
                                  : (isEnglish ? "Block Claim" : "Bloquear Reclamación")}
                              </button>
                              {isAdmin && onDeleteClaim && (
                                <button
                                  onClick={async () => {
                                    setActiveActionMenu(null);
                                    await requestSoftDeleteClaim(claim);
                                  }}
                                  disabled={!!pendingOperationLabel}
                                  className="flex w-full items-center gap-2 rounded border-t border-slate-100 px-3 py-2 text-[11px] font-bold text-rose-700 hover:bg-rose-50 cursor-pointer disabled:opacity-40 disabled:cursor-wait"
                                >
                                  {pendingOperationLabel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                  {isEnglish ? "Delete claim" : "Eliminar claim"}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )
            ) : (
              paginatedServiceLines.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center p-12 text-slate-500 font-sans">
                    {isEnglish ? "No service lines found for the selected filters." : "No se encontraron líneas de servicio para los filtros seleccionados."}
                  </td>
                </tr>
              ) : (
                paginatedServiceLines.map((slRow) => {
                  const claim = slRow.claim;
                  const isSelected = selectedClaimIds.includes(claim.claim_id);
                  const hasError = claim.error_flag;
                  const isLocked = claim.locked;

                  // Pro-rate Ending AP based on this service line's share of total billed, or divide equally
                  const numLines = claim.service_lines_json ? JSON.parse(claim.service_lines_json).length : (splitCptCodes(claim.cpt_hcpcs).length || 1);
                  const proRatedAp = numLines > 0 ? (claim.ending_ap_to_physician / numLines) : 0;

                  return (
                    <tr
                      key={slRow.row_id}
                      onClick={() => onViewDetails(claim)}
                      className={`hover:bg-blue-50/20 cursor-pointer transition-colors ${
                        isSelected ? "bg-blue-50/40" : ""
                      } ${isLocked ? "bg-red-50/10" : ""}`}
                    >
                      {/* Checkbox */}
                      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => onSelectClaim(claim.claim_id, e.target.checked)}
                          className="rounded border-slate-300 text-primary-blue focus:ring-primary-blue h-3.5 w-3.5 cursor-pointer"
                        />
                      </td>

                      {/* Patient Info */}
                      <td className="px-4 py-3 font-sans">
                        <div className="flex items-center gap-1.5">
                          <div className="font-semibold text-slate-700">{claim.patient_display_name_masked}</div>
                          {isLocked && (
                            <Lock className="w-3.5 h-3.5 text-rose-600 shrink-0" title={`Locked: ${claim.lock_reason}`} />
                          )}
                          {hasError && !isLocked && (
                            <AlertOctagon className="w-3.5 h-3.5 text-accent-orange shrink-0 animate-pulse" title={`Blocked Error: ${claim.error_category}`} />
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">ID: {claim.patient_id}</div>
                      </td>

                      {/* Provider Info */}
                      <td className="px-4 py-3 font-sans">
                        <div className="font-semibold text-slate-700">{claim.provider_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{claim.practice_name}</div>
                      </td>

                      {/* DOS */}
                      <td className="px-4 py-3 font-mono text-slate-500">{formatDos(claim.date_of_service_from)}</td>

                      {/* CPT Code */}
                      <td className="px-4 py-3 text-center font-mono font-bold text-primary-blue text-xs">
                        <div className="flex items-center justify-center gap-1.5">
                          <span>{slRow.cpt}</span>
                          {slRow.locked && (
                            <Lock className="w-3.5 h-3.5 text-rose-600 shrink-0" title={`Locked: ${slRow.lock_reason}`} />
                          )}
                        </div>
                      </td>

                      {/* Billed By */}
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${claim.billed_by === "ITERA" ? "bg-[#1b98e0]/10 text-[#004e89]" : "bg-slate-100 text-slate-600"}`}>
                          {claim.billed_by}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge status={slRow.status as ClaimStatus} />
                      </td>

                      {/* Primary Payer */}
                      <td className="px-4 py-3 font-sans">
                        <div className="text-xs font-semibold text-slate-700">{claim.payer_name}</div>
                        <div className="text-[10px] text-slate-400">{claim.payer_id}</div>
                      </td>


                      {/* CPT Financial Values */}
                      <td className="px-4 py-3 text-right font-semibold font-mono text-emerald-600">
                        {formatCurrency(slRow.paid + slRow.secondaryPaid)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-center relative" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => openActionMenu(slRow.row_id, e)}
                          className="inline-flex items-center justify-center p-1.5 bg-slate-50 hover:bg-slate-200 border border-slate-200 rounded text-slate-700 hover:text-dark-blue hover:border-dark-blue transition-all cursor-pointer"
                          aria-label="Acciones"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>

                        {activeActionMenu === slRow.row_id && (
                          <>
                            <div
                              className="fixed inset-0 z-[190]"
                              onClick={() => setActiveActionMenu(null)}
                            />
                            <div
                              style={{ position: "fixed", top: menuPosition?.top, right: menuPosition?.right }}
                              className="w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg z-[200] font-sans text-left">
                              <button
                                onClick={() => {
                                  setActiveActionMenu(null);
                                  onViewDetails(claim);
                                }}
                                className="flex w-full items-center gap-2 rounded px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 hover:text-dark-blue cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                {localStorage.getItem("itera-language") !== "es" ? "Details" : "Ver Detalles"}
                              </button>
                              <button
                                disabled={isLocked}
                                onClick={() => {
                                  setActiveActionMenu(null);
                                  const initialInputs: Record<string, string> = {};
                                  initialInputs[slRow.cpt] = "";
                                  setPaymentInputs(initialInputs);
                                  setActivePaymentClaim(claim);
                                  setActivePaymentCpt(slRow.cpt);
                                }}
                                className="flex w-full items-center gap-2 rounded px-3 py-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                              >
                                <Coins className="w-3.5 h-3.5" />
                                {isEnglish ? "Quick Payment" : "Registrar pago rápido"}
                              </button>
                              <button
                                disabled={isLocked}
                                onClick={() => {
                                  setActiveActionMenu(null);
                                  setActiveIssueClaim(claim);
                                  setActiveIssueCpt(slRow.cpt);
                                  setIssueStatus("Denied");
                                  setIssueSource("ERA / 835");
                                  setCodingMode("quick");
                                  setDenialCombinations([]);
                                  setInternalCategory("Eligibility / Coverage");
                                  setNextActionData({
                                    nextAction: "Correct and Resubmit",
                                    assignedTo: defaultAssignedUserId,
                                    dueDate: "",
                                    priority: "Medium",
                                    followUpDate: "",
                                    taskStatus: "Open"
                                  });
                                  setIssueNote("");
                                  setSelectedLines([slRow.cpt]);
                                }}
                                className="flex w-full items-center gap-2 rounded px-3 py-2 text-[11px] font-bold text-rose-700 hover:bg-rose-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                              >
                                <ShieldAlert className="w-3.5 h-3.5" />
                                {isEnglish ? "Register Issue" : "Registrar incidencia"}
                              </button>
                              <button
                                onClick={async () => {
                                  setActiveActionMenu(null);
                                  // Parse current service lines
                                  let serviceLines: any[] = [];
                                  if (claim.service_lines_json) {
                                    try { serviceLines = JSON.parse(claim.service_lines_json); } catch {}
                                  }
                                  if (serviceLines.length === 0 && claim.cpt_hcpcs) {
                                    const cpts = splitCptCodes(claim.cpt_hcpcs);
                                    serviceLines = cpts.map(c => ({
                                      cpt: c,
                                      charged: claim.billed_charge / cpts.length,
                                      allowed: (claim.allowed_amount || claim.billed_charge) / cpts.length,
                                      adj: (claim.billed_charge - (claim.allowed_amount || claim.billed_charge)) / cpts.length,
                                      paid: 0,
                                      secondaryPaid: 0,
                                      patResp: 0,
                                      balance: (claim.allowed_amount || claim.billed_charge) / cpts.length,
                                      status: "Pending",
                                      units: 1,
                                      notes: [],
                                      codes: []
                                    }));
                                  }

                                  const targetLine = serviceLines.find(l => l.cpt === slRow.cpt);
                                  const lineIsLocked = targetLine ? !!targetLine.locked : false;

                                  if (lineIsLocked) {
                                    const updatedLines = serviceLines.map(l => {
                                      if (l.cpt === slRow.cpt) return { ...l, locked: false, lock_reason: "" };
                                      return l;
                                    });
                                    await runPendingOperation(isEnglish ? "Unlocking CPT..." : "Desbloqueando CPT...", async () => {
                                      if (onUpdateClaim) {
                                        await onUpdateClaim({ service_lines_json: JSON.stringify(updatedLines) }, claim.claim_id);
                                      } else if (onSaveServiceLineNotes) {
                                        await onSaveServiceLineNotes(JSON.stringify(updatedLines), claim.claim_id);
                                      }
                                      notify(isEnglish ? "CPT code unlocked successfully!" : "¡Código CPT desbloqueado con éxito!", "success");
                                    });
                                  } else {
                                    const reason = await promptAction({
                                      title: isEnglish ? `Block CPT ${slRow.cpt}` : `Bloquear CPT ${slRow.cpt}`,
                                      message: isEnglish ? "Enter the block reason:" : "Ingrese la causa del bloqueo:",
                                      inputLabel: isEnglish ? "Reason" : "Causa",
                                      placeholder: isEnglish ? "Incomplete documentation, needs review..." : "Documentación incompleta, necesita revisión...",
                                      inputType: "text",
                                      cancelLabel: isEnglish ? "Cancel" : "Cancelar",
                                      confirmLabel: isEnglish ? "Block" : "Bloquear"
                                    });
                                    if (reason && reason.trim() !== "") {
                                      const updatedLines = serviceLines.map(l => {
                                        if (l.cpt === slRow.cpt) return { ...l, locked: true, lock_reason: reason.trim() };
                                        return l;
                                      });
                                      await runPendingOperation(isEnglish ? "Blocking CPT..." : "Bloqueando CPT...", async () => {
                                        if (onUpdateClaim) {
                                          await onUpdateClaim({ service_lines_json: JSON.stringify(updatedLines) }, claim.claim_id);
                                        } else if (onSaveServiceLineNotes) {
                                          await onSaveServiceLineNotes(JSON.stringify(updatedLines), claim.claim_id);
                                        }
                                        notify(isEnglish ? "CPT code blocked successfully!" : "¡Código CPT bloqueado con éxito!", "success");
                                      });
                                    }
                                  }
                                }}
                                disabled={!!pendingOperationLabel}
                                className={`flex w-full items-center gap-2 rounded px-3 py-2 text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-wait ${
                                  slRow.locked ? "text-slate-700 hover:bg-slate-50" : "text-amber-700 hover:bg-amber-50"
                                }`}
                              >
                                {pendingOperationLabel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (slRow.locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />)}
                                {slRow.locked
                                  ? (isEnglish ? `Unlock CPT ${slRow.cpt}` : `Desbloquear CPT ${slRow.cpt}`)
                                  : (isEnglish ? `Block CPT ${slRow.cpt}` : `Bloquear CPT ${slRow.cpt}`)}
                              </button>
                              {isAdmin && onDeleteClaim && (
                                <button
                                  onClick={async () => {
                                    setActiveActionMenu(null);
                                    await requestSoftDeleteClaim(claim);
                                  }}
                                  disabled={!!pendingOperationLabel}
                                  className="flex w-full items-center gap-2 rounded border-t border-slate-100 px-3 py-2 text-[11px] font-bold text-rose-700 hover:bg-rose-50 cursor-pointer disabled:opacity-40 disabled:cursor-wait"
                                >
                                  {pendingOperationLabel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                  {isEnglish ? "Delete claim" : "Eliminar claim"}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalItems > 0 && (
        <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex items-center justify-between font-sans text-xs">
          <div className="flex items-center gap-4">
            <span className="text-slate-500 font-medium">
              {isEnglish ? "Showing" : "Mostrando"}{" "}
              <span className="font-bold text-slate-700">{(currentPage - 1) * itemsPerPage + 1}</span>{" "}
              {isEnglish ? "to" : "a"}{" "}
              <span className="font-bold text-slate-700">{Math.min(totalItems, currentPage * itemsPerPage)}</span>{" "}
              {isEnglish ? "of" : "de"}{" "}
              <span className="font-bold text-slate-700">{totalItems}</span>{" "}
              {isEnglish ? "records" : "registros"}
            </span>
            <div className="flex items-center gap-1.5 text-slate-500 font-medium">
              <span>{isEnglish ? "Show:" : "Mostrar:"}</span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="py-1 px-2 border border-slate-200 bg-white rounded font-bold text-slate-700 cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-primary-blue focus:border-primary-blue text-xs"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 border border-slate-200 rounded font-semibold text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {isEnglish ? "Previous" : "Anterior"}
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setCurrentPage(p)}
                className={`px-3 py-1.5 border rounded font-bold transition-all cursor-pointer ${
                  currentPage === p
                    ? "bg-[#1b98e0] border-[#1b98e0] text-white shadow-xs"
                    : "border-slate-200 text-slate-600 bg-white hover:bg-slate-100"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 border border-slate-200 rounded font-semibold text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {isEnglish ? "Next" : "Siguiente"}
            </button>
          </div>
        </div>
      )}

      {/* CUSTOM INLINE MULTI-CPT QUICK PAYMENT DIALOG */}
      {activePaymentClaim && (() => {
        // Find CPT codes that need payment inputs
        let serviceLines: any[] = [];
        if (activePaymentClaim.service_lines_json) {
          try { serviceLines = JSON.parse(activePaymentClaim.service_lines_json); } catch {}
        }
        if (serviceLines.length === 0 && activePaymentClaim.cpt_hcpcs) {
          const cpts = splitCptCodes(activePaymentClaim.cpt_hcpcs);
          serviceLines = cpts.map(c => ({
            cpt: c,
            charged: activePaymentClaim.billed_charge / cpts.length,
            allowed: (activePaymentClaim.allowed_amount || activePaymentClaim.billed_charge) / cpts.length,
            adj: (activePaymentClaim.billed_charge - (activePaymentClaim.allowed_amount || activePaymentClaim.billed_charge)) / cpts.length,
            paid: 0,
            secondaryPaid: 0,
            patResp: 0,
            balance: (activePaymentClaim.allowed_amount || activePaymentClaim.billed_charge) / cpts.length,
            nextAction: "No action",
            notes: [],
            codes: [],
            status: "Pending"
          }));
        }

        // Show all lines so that any lines with existing payments are visible and editable
        const targetLines = activePaymentCpt
          ? serviceLines.filter(l => l.cpt === activePaymentCpt)
          : serviceLines;

        const handleSavePayments = async () => {
          if (isSavingPayment || pendingOperationLabel) return;
          setIsSavingPayment(true);
          setPendingOperationLabel(isEnglish ? "Registering quick payment..." : "Registrando pago rápido...");
          try {
            let updatedLines = [];
            if (activePaymentClaim.service_lines_json) {
              try { updatedLines = JSON.parse(activePaymentClaim.service_lines_json); } catch {}
            }
            if (updatedLines.length === 0 && activePaymentClaim.cpt_hcpcs) {
              const cpts = splitCptCodes(activePaymentClaim.cpt_hcpcs);
              updatedLines = cpts.map(c => ({
                cpt: c,
                charged: activePaymentClaim.billed_charge / cpts.length,
                allowed: (activePaymentClaim.allowed_amount || activePaymentClaim.billed_charge) / cpts.length,
                adj: (activePaymentClaim.billed_charge - (activePaymentClaim.allowed_amount || activePaymentClaim.billed_charge)) / cpts.length,
                paid: 0,
                secondaryPaid: 0,
                patResp: 0,
                balance: (activePaymentClaim.allowed_amount || activePaymentClaim.billed_charge) / cpts.length,
                status: "Pending",
                nextAction: "No action",
                units: 1,
                notes: [],
                codes: []
              }));
            }

            // Map all inputs
            let anyInputFilled = false;
            updatedLines = updatedLines.map((line: any) => {
              // If it's a target line and has an input value
              const hasInput = paymentInputs[line.cpt] !== undefined && paymentInputs[line.cpt].trim() !== "";
              if ((!activePaymentCpt || line.cpt === activePaymentCpt) && hasInput) {
                const val = parseFloat(paymentInputs[line.cpt]);
                if (!isNaN(val) && val > 0) {
                  anyInputFilled = true;
                  return applyPrimaryPaymentToServiceLine(line, val);
                }
              }
              return normalizePaymentServiceLine(line);
            });

            if (!anyInputFilled) {
              notify(isEnglish ? "Please enter at least one valid payment amount." : "Por favor ingrese al menos un monto de pago válido.", "warning");
              return;
            }

            const totalLinePaid = updatedLines.reduce((sum, line) => sum + (Number(line.paid) || 0) + (Number(line.secondaryPaid) || 0), 0);
            const totalLineCharged = updatedLines.reduce((sum, line) => sum + (Number(line.charged) || 0), 0);
            const totalLineAllowed = updatedLines.reduce((sum, line) => sum + (Number(line.allowed) || 0), 0);

            const allPaid = updatedLines.every(line => line.status === "Paid");
            const targetClaimStatus = allPaid ? ("Paid" as ClaimStatus) : ("Partially Paid" as ClaimStatus);

            const newJson = JSON.stringify(updatedLines);

            if (onUpdateClaim) {
              await onUpdateClaim({
                service_lines_json: newJson,
                billed_charge: totalLineCharged,
                allowed_amount: totalLineAllowed,
                paid_amount: totalLinePaid,
                claim_status: targetClaimStatus
              }, activePaymentClaim.claim_id);
            } else {
              if (onSaveServiceLineNotes) {
                await onSaveServiceLineNotes(newJson, activePaymentClaim.claim_id);
              }
            }

            notify(isEnglish ? "Quick payment registered successfully!" : "¡Pago rápido registrado con éxito!", "success");
            setActivePaymentClaim(null);
            setPaymentInputs({});
          } catch (err: any) {
            notify(err.message || "Error", "error");
          } finally {
            setIsSavingPayment(false);
            setPendingOperationLabel(null);
          }
        };

        return (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/40 p-4">
            <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-fade-in font-sans">
              <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl p-2 bg-emerald-50 text-emerald-600">
                    <Coins className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      {isEnglish ? "Register Quick Payment" : "Registrar Pago Rápido"}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {isEnglish 
                        ? `Enter payment amounts for CPT codes in claim: ${activePaymentClaim.claim_id}` 
                        : `Ingrese los montos de pago para los CPTs de la reclamación: ${activePaymentClaim.claim_id}`}
                    </p>
                  </div>
                </div>
                <button type="button" disabled={isSavingPayment} onClick={() => setActivePaymentClaim(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 disabled:cursor-wait">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-4">
                {targetLines.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-4">
                    {isEnglish ? "All CPT codes are already paid on this claim." : "Todos los códigos CPT ya están pagados en esta reclamación."}
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {targetLines.map((line) => (
                      <div key={line.cpt} className="flex items-center justify-between py-3 gap-4">
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-bold text-primary-blue bg-blue-50 px-2 py-0.5 rounded border border-blue-100 self-start">
                            CPT {line.cpt}
                          </span>
                          <span className="text-[10px] text-slate-400 mt-1">
                            {isEnglish ? "Billed" : "Facturado"}: {formatCurrency(line.charged)}
                          </span>
                        </div>
                        <div className="relative w-[5.5rem] shrink-0">
                          <span className="absolute left-3 top-2 text-xs font-semibold text-slate-400">$</span>
                          <input
                            autoFocus={targetLines[0].cpt === line.cpt}
                            type="number"
                            placeholder="0.00"
                            value={paymentInputs[line.cpt] || ""}
                            onChange={(e) => setPaymentInputs({ ...paymentInputs, [line.cpt]: e.target.value })}
                            disabled={isSavingPayment}
                            className="w-full pl-6 pr-2 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:outline-hidden focus:ring-1 focus:ring-primary-blue focus:border-primary-blue focus:bg-white text-slate-800 font-mono text-right disabled:opacity-60 disabled:cursor-wait"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 p-5 border-t border-slate-100 bg-slate-50">
                <button
                  type="button"
                  disabled={isSavingPayment}
                  onClick={() => setActivePaymentClaim(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                >
                  {isEnglish ? "Cancel" : "Cancelar"}
                </button>
                <button
                  type="button"
                  disabled={targetLines.length === 0 || isSavingPayment}
                  onClick={handleSavePayments}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary-blue hover:bg-secondary-blue px-4 py-2 text-xs font-bold text-white shadow-md cursor-pointer disabled:opacity-40 disabled:cursor-wait"
                >
                  {isSavingPayment && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isSavingPayment ? (isEnglish ? "Registering..." : "Registrando...") : (isEnglish ? "Register" : "Registrar")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* REGISTER CLAIM ISSUE COMPREHENSIVE DIALOG */}
      {activeIssueClaim && (() => {
        const claimServiceLines = (() => {
          if (activeIssueClaim.service_lines_json) {
            try {
              return JSON.parse(activeIssueClaim.service_lines_json);
            } catch {
              return [];
            }
          }
          return [];
        })();

        const handleCancelIssue = () => {
          setActiveIssueClaim(null);
          setIssueNote("");
        };

        const handleAddCombination = () => {
          setDenialCombinations(prev => [
            ...prev,
            {
              id: `comb-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              level: activeIssueCpt ? "Service Line" : "Claim",
              groupCode: "CO",
              carc: "CO-16",
              rarcs: [],
              amount: 0,
              patientResponsibility: 0,
              cpt: activeIssueCpt || (claimServiceLines[0]?.cpt || "")
            }
          ]);
        };

        const handleRemoveCombination = (id: string) => {
          setDenialCombinations(prev => prev.filter(c => c.id !== id));
        };

        const handleUpdateCombination = (id: string, field: string, value: any) => {
          setDenialCombinations(prev => prev.map(c => {
            if (c.id === id) {
              const updated = { ...c, [field]: value };
              if (field === "groupCode") {
                updated.groupCode = value as IssueGroupCode;
                updated.carc = getDefaultCarcForGroup(updated.groupCode);
                updated.patientResponsibility = updated.groupCode === "PR" ? Number(updated.amount) || 0 : 0;
              }
              if (field === "carc") {
                updated.carc = value;
              }
              if (field === "amount") {
                updated.amount = Number(value) || 0;
                if (updated.groupCode === "PR") {
                  updated.patientResponsibility = updated.amount;
                }
              }
              if (field === "patientResponsibility") {
                updated.patientResponsibility = updated.groupCode === "PR" ? Number(updated.amount) || 0 : Number(value) || 0;
              }
              // Smart suggestions based on RARC/CARC
              if (updated.carc === "CO-109") {
                setInternalCategory("Incorrect Payer");
              }
              if (field === "rarcs") {
                if (value.includes("N105")) setInternalCategory("Railroad Medicare");
                if (value.includes("N781") || value.includes("N782") || value.includes("N783")) setInternalCategory("QMB / Medicaid");
              }
              return updated;
            }
            return c;
          }));
        };

        const handleQuickChipSelect = (chip: string) => {
          const preset = getQuickIssuePreset(chip);
          if (!preset) return;
          setInternalCategory(preset.category);

          // Auto inject code combination
          setDenialCombinations([
            {
              id: `comb-quick-${Date.now()}`,
              level: activeIssueCpt ? "Service Line" : "Claim",
              groupCode: preset.carc.split("-")[0] as IssueGroupCode,
              carc: preset.carc,
              rarcs: preset.rarcs,
              amount: activeIssueClaim.billed_charge,
              patientResponsibility: preset.carc.startsWith("PR") ? activeIssueClaim.billed_charge : 0,
              cpt: activeIssueCpt || (claimServiceLines[0]?.cpt || "")
            }
          ]);
          setCodingMode("advanced");
          notify(isEnglish ? `Quick preset applied: ${preset.carc}` : `Ajuste rápido aplicado: ${preset.carc}`, "info");
        };

        const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
          const filesList = e.target.files;
          if (filesList && filesList.length > 0) {
            const file = filesList[0];
            setAttachments(prev => [
              ...prev,
              { name: file.name, size: `${(file.size / 1024).toFixed(1)} KB`, type: file.type }
            ]);
            notify(isEnglish ? "Document attached successfully!" : "¡Documento adjuntado correctamente!", "success");
          }
        };

        const handleRemoveAttachment = (name: string) => {
          setAttachments(prev => prev.filter(a => a.name !== name));
        };

        // Smart warnings computation
        const warnings: string[] = [];
        if (issueStatus === "Rejected") {
          warnings.push("This may not be an adjudicated denial. Correct and resubmit may be required instead of appeal.");
        }
        denialCombinations.forEach(c => {
          if (c.groupCode === "CO" && c.patientResponsibility > 0) {
            warnings.push(`Combination ${c.carc}: Contractual Obligations (CO) should not be billed to the patient. Normally transferred to write-off.`);
          }
          if (c.groupCode === "PR" && (Number(c.amount) || 0) === 0) {
            warnings.push(`Combination ${c.carc}: Patient Responsibility (PR) code added but CAS Adjustment Amount is $0.00.`);
          }
          if (c.carc === "CO-109" && internalCategory !== "Incorrect Payer" && internalCategory !== "Railroad Medicare") {
            warnings.push("CARC CO-109 (Claim not covered by payer) detected. Consider setting Category to Incorrect Payer.");
          }
          if (c.rarcs.includes("N105") && internalCategory !== "Railroad Medicare") {
            warnings.push("RARC N105 (Railroad Medicare) detected. Consider setting Category to Railroad Medicare.");
          }
          if (c.rarcs.includes("N781") && internalCategory !== "QMB / Medicaid") {
            warnings.push("RARC N781 (QMB Patient) detected. Consider setting Category to QMB / Medicaid.");
          }
        });

        return (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4 animate-fade-in font-sans">
            <div className="w-full max-w-[82rem] max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              
              {/* Header */}
              <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl p-2 bg-rose-50 text-rose-600 shadow-xs">
                    <ShieldAlert className="h-5.5 w-5.5 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-900">
                      {isEnglish ? "Register Claim Issue" : "Registrar Incidencia de Reclamación"}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {isEnglish 
                        ? `Mark CPT code(s) or claim lines as Denied, Rejected, Partially Paid, or Pending Action inside Claim: ${activeIssueClaim.claim_id}`
                        : `Marque los códigos CPT o líneas de reclamación como Denegados, Rechazados, Parcialmente Pagados, o Pendientes dentro del Claim: ${activeIssueClaim.claim_id}`}
                    </p>
                  </div>
                </div>
                <button type="button" onClick={handleCancelIssue} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Warnings display */}
              {warnings.length > 0 && (
                <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 space-y-1">
                  {warnings.map((w, idx) => (
                    <div key={idx} className="flex gap-2 text-[10px] font-semibold text-amber-800 items-start">
                      <AlertOctagon className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <span>{isEnglish ? w : `Advertencia: ${w}`}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Scrollable Container */}
              <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* LEFT COLUMN: Outcome, Source, Line Selection, Next Action */}
                <div className="lg:col-span-5 space-y-6">
                  
                  {/* Section A: Outcome & Source */}
                  <div className="bg-slate-50/50 p-5 rounded-xl border border-slate-200/80 space-y-4">
                    <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 pb-2 mb-1">
                      {isEnglish ? "1. Outcome & Source" : "1. Resultado y Origen"}
                    </h4>
                    
                    <div className="grid grid-cols-1 gap-3.5 text-xs">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Outcome Status</label>
                        <select 
                          value={issueStatus}
                          onChange={(e) => setIssueStatus(e.target.value)}
                          className="w-full py-1.5 px-2.5 border border-slate-200 bg-white rounded-lg font-semibold text-slate-700"
                        >
                          <option value="Denied">Denied</option>
                          <option value="Rejected">Rejected</option>
                          <option value="Partially Paid">Partially Paid</option>
                          <option value="Paid with Adjustment">Paid with Adjustment</option>
                          <option value="Pending / Additional Information Needed">Pending / Info Needed</option>
                          <option value="Recoupment / Takeback">Recoupment / Takeback</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Issue Source</label>
                        <select 
                          value={issueSource}
                          onChange={(e) => setIssueSource(e.target.value)}
                          className="w-full py-1.5 px-2.5 border border-slate-200 bg-white rounded-lg font-semibold text-slate-700"
                        >
                          <option value="ERA / 835">ERA / 835</option>
                          <option value="Paper EOB">Paper EOB</option>
                          <option value="Payer Portal">Payer Portal</option>
                          <option value="Clearinghouse">Clearinghouse</option>
                          <option value="277CA">277CA Report</option>
                          <option value="999">999 Acknowledgement</option>
                          <option value="TA1">TA1 Interchange Acknowledgement</option>
                          <option value="Manual Review">Manual Review</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Section B: Affected Service Lines */}
                  <div className="bg-slate-50/50 p-5 rounded-xl border border-slate-200/80 space-y-4">
                    <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 pb-2 mb-1">
                      {isEnglish ? "2. Affected CPT Lines" : "2. Líneas CPT Afectadas"}
                    </h4>
                    
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="w-full text-left border-collapse text-[10px]">
                        <thead>
                          <tr className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200">
                            <th className="p-2 w-8 text-center">
                              <input 
                                type="checkbox"
                                checked={selectedLines.length === claimServiceLines.length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedLines(claimServiceLines.map((l: any) => l.cpt));
                                  } else {
                                    setSelectedLines([]);
                                  }
                                }}
                                className="rounded border-slate-300"
                              />
                            </th>
                            <th className="p-2">CPT</th>
                            <th className="p-2 text-right">Charged</th>
                            <th className="p-2 text-right">Paid</th>
                            <th className="p-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                          {claimServiceLines.map((line: any) => (
                            <tr key={line.cpt} className="hover:bg-slate-50">
                              <td className="p-2 text-center">
                                <input 
                                  type="checkbox"
                                  checked={selectedLines.includes(line.cpt)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedLines(prev => [...prev, line.cpt]);
                                    } else {
                                      setSelectedLines(prev => prev.filter(c => c !== line.cpt));
                                    }
                                  }}
                                  className="rounded border-slate-300"
                                />
                              </td>
                              <td className="p-2 font-mono font-bold text-primary-blue">{line.cpt}</td>
                              <td className="p-2 text-right font-mono">${Number(line.charged).toFixed(2)}</td>
                              <td className="p-2 text-right font-mono">${(Number(line.paid) + Number(line.secondaryPaid || 0)).toFixed(2)}</td>
                              <td className="p-2">
                                <span className={`inline-block px-1.5 py-0.5 rounded-sm text-[8px] font-bold uppercase ${line.status === "Paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                                  {line.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Section C: Operational Actions & Task */}
                  <div className="bg-slate-50/50 p-5 rounded-xl border border-slate-200/80 space-y-4">
                    <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 pb-2 mb-1">
                      {isEnglish ? "3. RCM Next Action & Task" : "3. Próxima Acción RCM y Tarea"}
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="col-span-2">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Operational Next Action</label>
                        <select 
                          value={nextActionData.nextAction}
                          onChange={(e) => setNextActionData(prev => ({ ...prev, nextAction: e.target.value }))}
                          className="w-full py-1.5 px-2.5 border border-slate-200 bg-white rounded-lg font-semibold text-slate-700"
                        >
                          <option value="Correct and Resubmit">Correct and Resubmit</option>
                          <option value={PENDING_ERA_ACTION}>{isEnglish ? "Pending ERA" : "ERA pendiente"}</option>
                          <option value="Appeal">Appeal Payer Denial</option>
                          <option value="Request Medical Records">Request Medical Records</option>
                          <option value="Request Authorization">Request Authorization</option>
                          <option value="Verify Eligibility">Verify Eligibility</option>
                          <option value="Update Payer">Update Payer Profile</option>
                          <option value="Bill Secondary Payer">Bill Secondary Payer</option>
                          <option value="Transfer to Patient Responsibility">Transfer to Patient Responsibility</option>
                          <option value="Write Off">Write Off Balance</option>
                          <option value="Reprocess / Reopen">Reprocess / Reopen Claim</option>
                          <option value="Contact Payer">Contact Payer Agent</option>
                          <option value="Contact Practice">Contact Medical Practice</option>
                          <option value="No Action Required">No Action Required</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Assign Task To</label>
                        <select 
                          value={nextActionData.assignedTo}
                          onChange={(e) => setNextActionData(prev => ({ ...prev, assignedTo: e.target.value }))}
                          className="w-full py-1.5 px-2 bg-white border border-slate-200 rounded-lg text-slate-600"
                        >
                          {activeAssignableUsers.map(user => (
                            <option key={user.user_id} value={user.user_id}>
                              {user.name} - {user.role}
                            </option>
                          ))}
                          <option value="unassigned">Unassigned</option>
                        </select>
                        {activeAssignableUsers.length === 0 && (
                          <p className="mt-1 text-[9px] font-semibold text-amber-600">
                            {isEnglish ? "No active registered users are available." : "No hay usuarios activos registrados disponibles."}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Due Date</label>
                        <input 
                          type="date"
                          value={nextActionData.dueDate}
                          onChange={(e) => setNextActionData(prev => ({ ...prev, dueDate: e.target.value }))}
                          className="w-full py-1 px-2 border border-slate-200 rounded-lg font-mono text-slate-600 bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Task Priority</label>
                        <select 
                          value={nextActionData.priority}
                          onChange={(e) => setNextActionData(prev => ({ ...prev, priority: e.target.value }))}
                          className="w-full py-1.5 px-2 bg-white border border-slate-200 rounded-lg text-slate-700 font-semibold"
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                          <option value="Urgent">Urgent</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Follow-up Date</label>
                        <input 
                          type="date"
                          value={nextActionData.followUpDate}
                          onChange={(e) => setNextActionData(prev => ({ ...prev, followUpDate: e.target.value }))}
                          className="w-full py-1 px-2 border border-slate-200 rounded-lg font-mono text-slate-600 bg-white"
                        />
                      </div>
                    </div>
                  </div>

                </div>

                {/* RIGHT COLUMN: Coding Modes, rejection codes, internal categories, attachments */}
                <div className="lg:col-span-7 space-y-6">
                  
                  {/* Category & Internal Analysis */}
                  <div className="bg-slate-50/50 p-5 rounded-xl border border-slate-200/80">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Internal Denial/Issue Category (for KPI & Reporting)
                    </label>
                    <select 
                      value={internalCategory}
                      onChange={(e) => setInternalCategory(e.target.value)}
                      className="w-full py-1.5 px-2.5 border border-slate-200 bg-white rounded-lg font-bold text-slate-700 text-xs"
                    >
                      <option value="Eligibility / Coverage">Eligibility / Coverage Issue</option>
                      <option value="Incorrect Payer">Incorrect Payer Address/ID</option>
                      <option value="Railroad Medicare">Railroad Medicare Route</option>
                      <option value="Coordination of Benefits">Coordination of Benefits (COB)</option>
                      <option value="Authorization / Referral">Authorization / Referral Missing</option>
                      <option value="Medical Necessity">Medical Necessity Not Established</option>
                      <option value="Documentation">Incomplete/Missing Medical Documentation</option>
                      <option value="Coding / Modifier">Coding Error / Incompatible Modifiers</option>
                      <option value="Bundling">Bundled Service / Inclusive Line</option>
                      <option value="Duplicate Claim">Duplicate Submission</option>
                      <option value="Timely Filing">Timely Filing Limit Expired</option>
                      <option value="Benefit Limitation">Plan Benefit Maximum Limitation</option>
                      <option value="Provider Enrollment / Credentialing">Credentialing / Practice Enrollment</option>
                      <option value="NPI / Provider Data">NPI / Provider Registry Error</option>
                      <option value="Patient Responsibility">Deductible / Co-pay / PR</option>
                      <option value="QMB / Medicaid">QMB / Medicaid Cost-Sharing Limit</option>
                      <option value="Contractual Adjustment">Contractual Rate Adjustment</option>
                      <option value="Payment Posting">Payment Posting Misalignment</option>
                      <option value="Recoupment">Payer Recoupment / Takeback</option>
                      <option value="Other">Other Operational Issue</option>
                    </select>
                  </div>

                  {/* Mode Selector and Coding Panels */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        {issueStatus === "Rejected" ? "Rejection details" : "Issue Adjudication Coding"}
                      </span>
                      {issueStatus !== "Rejected" && (
                        <div className="flex bg-slate-200 p-0.5 rounded-md">
                          <button
                            type="button"
                            onClick={() => setCodingMode("quick")}
                            className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${codingMode === "quick" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}
                          >
                            Quick Chips
                          </button>
                          <button
                            type="button"
                            onClick={() => setCodingMode("advanced")}
                            className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${codingMode === "advanced" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}
                          >
                            Advanced Code Combinations
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="p-5 space-y-4">
                      {issueStatus === "Rejected" ? (
                        /* REJECTION CODES PANEL */
                        <div className="space-y-3.5 text-xs">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Claim Status Category Code</label>
                              <select
                                value={rejectionData.statusCategoryCode}
                                onChange={(e) => setRejectionData(prev => ({ ...prev, statusCategoryCode: e.target.value }))}
                                className="w-full py-1.5 px-2 border border-slate-200 rounded-lg bg-white"
                              >
                                <option value="">-- None --</option>
                                {STATUS_CATEGORY_CATALOG.map(c => <option key={c.code} value={c.code}>{c.code}: {c.description.substring(0, 40)}...</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Claim Status Code</label>
                              <select
                                value={rejectionData.statusCode}
                                onChange={(e) => setRejectionData(prev => ({ ...prev, statusCode: e.target.value }))}
                                className="w-full py-1.5 px-2 border border-slate-200 rounded-lg bg-white"
                              >
                                <option value="">-- None --</option>
                                {STATUS_CODE_CATALOG.map(c => <option key={c.code} value={c.code}>{c.code}: {c.description.substring(0, 45)}</option>)}
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Entity Identifier Code</label>
                              <select
                                value={rejectionData.entityIdentifier}
                                onChange={(e) => setRejectionData(prev => ({ ...prev, entityIdentifier: e.target.value }))}
                                className="w-full py-1.5 px-2 border border-slate-200 rounded-lg bg-white"
                              >
                                <option value="">-- None --</option>
                                {ENTITY_IDENTIFIER_CATALOG.map(c => <option key={c.code} value={c.code}>{c.code}: {c.description}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Affected Entity / Level</label>
                              <select
                                value={rejectionData.affectedEntity}
                                onChange={(e) => setRejectionData(prev => ({ ...prev, affectedEntity: e.target.value }))}
                                className="w-full py-1.5 px-2 border border-slate-200 rounded-lg bg-white"
                              >
                                <option value="Patient">Patient</option>
                                <option value="Subscriber">Subscriber</option>
                                <option value="Billing Provider">Billing Provider</option>
                                <option value="Rendering Provider">Rendering Provider</option>
                                <option value="Payer">Payer</option>
                                <option value="Claim">Entire Claim</option>
                                <option value="Service Line">Service Line</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Affected Field</label>
                              <select
                                value={rejectionData.affectedField}
                                onChange={(e) => setRejectionData(prev => ({ ...prev, affectedField: e.target.value }))}
                                className="w-full py-1.5 px-2 border border-slate-200 rounded-lg bg-white"
                              >
                                <option value="NPI">NPI</option>
                                <option value="DOB">DOB</option>
                                <option value="Member ID">Member ID</option>
                                <option value="Payer ID">Payer ID</option>
                                <option value="Diagnosis">Diagnosis Code</option>
                                <option value="CPT">CPT Code</option>
                                <option value="Modifier">CPT Modifier</option>
                                <option value="Authorization">Authorization Number</option>
                                <option value="Eligibility">Eligibility check</option>
                                <option value="COB">COB metadata</option>
                                <option value="Other">Other Field</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Resubmission Required</label>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setRejectionData(prev => ({ ...prev, resubmitRequired: "Yes" }))}
                                  className={`flex-1 py-1 rounded font-bold ${rejectionData.resubmitRequired === "Yes" ? "bg-red-50 text-red-700 border border-red-200" : "bg-slate-50 text-slate-600 border border-slate-200"}`}
                                >
                                  Yes
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRejectionData(prev => ({ ...prev, resubmitRequired: "No" }))}
                                  className={`flex-1 py-1 rounded font-bold ${rejectionData.resubmitRequired === "No" ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-slate-50 text-slate-600 border border-slate-200"}`}
                                >
                                  No
                                </button>
                              </div>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Raw Rejection Message (Clearinghouse/Payer)</label>
                            <textarea
                              rows={2}
                              value={rejectionData.message}
                              onChange={(e) => setRejectionData(prev => ({ ...prev, message: e.target.value }))}
                              placeholder="E.g. SUBSCRIBER NOT FOUND; STATUS CODE 33..."
                              className="w-full py-1.5 px-2.5 border border-slate-200 rounded-lg font-mono text-[11px]"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Corrective Action Guidance</label>
                            <input
                              type="text"
                              value={rejectionData.correctiveAction}
                              onChange={(e) => setRejectionData(prev => ({ ...prev, correctiveAction: e.target.value }))}
                              placeholder="E.g. Verify Member ID on eligibility portal and resubmit."
                              className="w-full py-1.5 px-2 border border-slate-200 rounded-lg"
                            />
                          </div>
                        </div>
                      ) : codingMode === "quick" ? (
                        /* QUICK MODE PRESETS */
                        <div className="space-y-4">
                          <p className="text-[10px] text-slate-400 italic">
                            Select a frequent denial reason to auto-configure standard X12 CARC/RARC codes:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {getQuickIssuePresetLabels().map(preset => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => handleQuickChipSelect(preset)}
                                className="px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-all cursor-pointer"
                              >
                                {preset}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        /* ADVANCED MULTI-COMBINATIONS BUILDER */
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Combinations Count: {denialCombinations.length}</span>
                            <button
                              type="button"
                              onClick={handleAddCombination}
                              className="flex items-center gap-1 px-3 py-1 rounded bg-slate-800 text-white text-[10px] font-bold hover:bg-slate-900 cursor-pointer"
                            >
                              <Plus className="h-3 w-3" />
                              Add Code Combination
                            </button>
                          </div>

                          {denialCombinations.length === 0 ? (
                            <div className="text-center py-6 border border-dashed border-slate-200 rounded-lg text-slate-400 text-xs italic">
                              No code combinations added yet. Click "+ Add Code Combination" to start.
                            </div>
                          ) : (
                            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                              {denialCombinations.map((comb) => (
                                <div key={comb.id} className="p-3 border border-slate-200 rounded-lg bg-slate-50/50 space-y-2.5 relative">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveCombination(comb.id)}
                                    className="absolute top-2.5 right-2.5 text-slate-400 hover:text-rose-600 p-0.5"
                                    title="Remove this combination"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                  
                                  <div className="grid grid-cols-12 gap-2 text-xs">
                                    <div className="col-span-3">
                                      <label className="block text-[8px] font-bold text-slate-400 uppercase">Level</label>
                                      <select
                                        value={comb.level}
                                        onChange={(e) => handleUpdateCombination(comb.id, "level", e.target.value)}
                                        className="w-full py-1 px-1 bg-white border border-slate-200 rounded text-[10px]"
                                      >
                                        <option value="Claim">Claim Level</option>
                                        <option value="Service Line">Service Line</option>
                                      </select>
                                    </div>

                                    {comb.level === "Service Line" && (
                                      <div className="col-span-3">
                                        <label className="block text-[8px] font-bold text-slate-400 uppercase">CPT</label>
                                        <select
                                          value={comb.cpt}
                                          onChange={(e) => handleUpdateCombination(comb.id, "cpt", e.target.value)}
                                          className="w-full py-1 px-1 bg-white border border-slate-200 rounded text-[10px] font-bold text-primary-blue"
                                        >
                                          {claimServiceLines.map((l: any) => <option key={l.cpt} value={l.cpt}>{l.cpt}</option>)}
                                        </select>
                                      </div>
                                    )}

                                    <div className="col-span-3">
                                      <label className="block text-[8px] font-bold text-slate-400 uppercase">Group Code</label>
                                      <select
                                        value={comb.groupCode}
                                        onChange={(e) => handleUpdateCombination(comb.id, "groupCode", e.target.value)}
                                        className="w-full py-1 px-1 bg-white border border-slate-200 rounded text-[10px]"
                                      >
                                        <option value="CO">CO (Contractual)</option>
                                        <option value="PR">PR (Patient Resp.)</option>
                                        <option value="OA">OA (Other Adjust.)</option>
                                        <option value="PI">PI (Payer Initiated)</option>
                                      </select>
                                    </div>

                                    <div className="col-span-3">
                                      <label className="block text-[8px] font-bold text-slate-400 uppercase">CARC Code</label>
                                      <select
                                        value={comb.carc}
                                        onChange={(e) => handleUpdateCombination(comb.id, "carc", e.target.value)}
                                        className="w-full py-1 px-1 bg-white border border-slate-200 rounded text-[10px] font-bold"
                                      >
                                        {getCarcOptionsForGroup(comb.groupCode).map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                                      </select>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-12 gap-2 text-xs">
                                    <div className="col-span-6">
                                      <label className="block text-[8px] font-bold text-slate-400 uppercase">RARC Codes (Multi-check)</label>
                                      <div className="border border-slate-200 rounded bg-white max-h-24 overflow-y-auto p-1.5 space-y-1">
                                        {RARC_CATALOG.map(r => (
                                          <label key={r.code} className="flex items-center gap-1.5 text-[9px] cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={comb.rarcs.includes(r.code)}
                                              onChange={(e) => {
                                                const next = e.target.checked
                                                  ? [...comb.rarcs, r.code]
                                                  : comb.rarcs.filter(x => x !== r.code);
                                                handleUpdateCombination(comb.id, "rarcs", next);
                                              }}
                                              className="rounded text-[8px] h-3 w-3"
                                            />
                                            <span className="font-bold text-slate-700">{r.code}</span>
                                            <span className="truncate text-slate-400" title={r.description}>- {r.description.substring(0, 30)}...</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="col-span-3">
                                      <label className="block text-[8px] font-bold text-slate-400 uppercase">Adj Amount ($)</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={comb.amount || ""}
                                        onChange={(e) => handleUpdateCombination(comb.id, "amount", Number(e.target.value) || 0)}
                                        className="w-full py-1 px-1.5 border border-slate-200 rounded text-[10px] font-mono text-right"
                                      />
                                    </div>

                                    <div className="col-span-3">
                                      <label className="block text-[8px] font-bold text-slate-400 uppercase">
                                        {comb.groupCode === "PR" ? "Patient Resp (Derived)" : "Patient Resp ($)"}
                                      </label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={comb.patientResponsibility || ""}
                                        onChange={(e) => handleUpdateCombination(comb.id, "patientResponsibility", Number(e.target.value) || 0)}
                                        disabled={comb.groupCode === "PR"}
                                        title={comb.groupCode === "PR" ? "For PR codes, Patient Responsibility is derived from CAS Adjustment Amount and is not subtracted again." : undefined}
                                        className="w-full py-1 px-1.5 border border-slate-200 rounded text-[10px] font-mono text-right disabled:bg-slate-100 disabled:text-slate-500"
                                      />
                                      {comb.groupCode === "PR" && (
                                        <p className="mt-1 text-[8px] leading-tight text-slate-400">
                                          Informational only; balance uses CAS adjustment once.
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Auto description display */}
                                  <div className="text-[9px] text-slate-400 italic font-medium flex flex-wrap gap-x-2 pt-1 border-t border-slate-100">
                                    <span>CARC: {CARC_CATALOG.find(c => c.code === comb.carc)?.description}</span>
                                    {comb.rarcs.length > 0 && (
                                      <span>| RARCs: {comb.rarcs.map(rc => RARC_CATALOG.find(r => r.code === rc)?.description).join("; ")}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Supporting Documents & Attachments */}
                  <div className="bg-slate-50/50 p-5 rounded-xl border border-slate-200/80 space-y-4">
                    <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 pb-2 mb-1">
                      Supporting Documents
                    </h4>
                    
                    <div className="flex gap-3 items-center">
                      <label className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 text-[11px] font-bold text-slate-600 cursor-pointer shadow-xs">
                        <Paperclip className="h-3.5 w-3.5 text-slate-500" />
                        <span>Choose files to attach...</span>
                        <input 
                          type="file"
                          onChange={handleFileUpload}
                          className="hidden"
                          accept=".pdf,.png,.jpg,.jpeg,.txt,.xml"
                        />
                      </label>
                      <span className="text-[10px] text-slate-400">Attach portal screenshots, clearinghouse reports, EOBs.</span>
                    </div>

                    {attachments.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                        {attachments.map(att => (
                          <div key={att.name} className="flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-white text-[10px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                              <span className="truncate font-semibold text-slate-700" title={att.name}>{att.name}</span>
                              <span className="text-slate-400 shrink-0 font-mono">({att.size})</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveAttachment(att.name)}
                              className="text-slate-400 hover:text-rose-600 px-1 font-bold text-xs"
                            >
                              &times;
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* General issue notes */}
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">General Issue Note / Adjudication Message</label>
                    <textarea
                      rows={2.5}
                      value={issueNote}
                      onChange={(e) => setIssueNote(e.target.value)}
                      placeholder="Write additional description or manual reasons here..."
                      className="w-full py-2 px-3 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:outline-hidden focus:ring-1 focus:ring-primary-blue focus:border-primary-blue focus:bg-white text-slate-800 font-medium"
                    />
                  </div>

                </div>

              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
                <span className="text-[10px] text-slate-400 font-medium font-mono">
                  Adjudicated in FHIR ExplanationsOfBenefit & Tasks logs
                </span>
                
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    disabled={!!issueSubmitMode}
                    onClick={handleCancelIssue}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-wait"
                  >
                    {isEnglish ? "Cancel" : "Cancelar"}
                  </button>
                  <button
                    type="button"
                    disabled={!!issueSubmitMode}
                    onClick={() => handleSaveClaimIssue("Pending")}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white text-slate-700 px-4 py-2 text-xs font-bold hover:bg-slate-50 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-wait"
                  >
                    {issueSubmitMode === "draft" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {issueSubmitMode === "draft" ? (isEnglish ? "Saving..." : "Guardando...") : (isEnglish ? "Save Draft" : "Guardar Borrador")}
                  </button>
                  <button
                    type="button"
                    disabled={!!issueSubmitMode}
                    onClick={() => handleSaveClaimIssue()}
                    className="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 px-5 py-2 text-xs font-bold text-white shadow-md hover:shadow-rose-600/20 cursor-pointer transition-all disabled:opacity-60 disabled:cursor-wait"
                  >
                    {issueSubmitMode === "apply" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {issueSubmitMode === "apply" ? (isEnglish ? "Applying..." : "Aplicando...") : (isEnglish ? "Apply Issue" : "Aplicar Incidencia")}
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {pendingOperationLabel && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-[260] flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-700 shadow-2xl"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary-blue" />
          <span>{pendingOperationLabel}</span>
        </div>
      )}
    </div>
  );
}
