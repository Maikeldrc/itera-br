/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import zlib from "zlib";
import * as XLSX from "xlsx";
import { createServer as createViteServer } from "vite";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { GoogleSheetsService } from "./src/googleSheetsService";
import { calculateClaimFinancials, validateClaim } from "./src/reconciliationEngine";
import { runReconciliationEngineTests } from "./src/reconciliationEngine.test";
import { runReportsEngineTests } from "./src/reportsEngine.test";
import { Claim, Payment, Note, ClaimStatus, ClaimClassification, ErrorCategory, Payer, User, UserRole } from "./src/types";
import { generateClaimId } from "./src/claimId";
import { validateClaimCptRepeatLimits, validateClaimCptRepeatLimitsAgainstExisting } from "./src/cptRepeatLimits";
import { validateUniquePatientProvider } from "./src/patientRegistrationValidation";
import { runPatientRegistrationValidationTests } from "./src/patientRegistrationValidation.test";
import { canUserAccessProvider, filterClaimsForUser, filterProvidersForUser } from "./src/accessControl";
import { applyApiSecurityHeaders } from "./src/securityHeaders";
import { API_ROLE_GROUPS } from "./src/apiAuthorizationPolicy";

type AppRequest = express.Request & {
  appUser?: User;
  firebaseUid?: string;
};

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function columnIndex(cellRef: string) {
  const letters = cellRef.replace(/[0-9]/g, "");
  return letters.split("").reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function textValue(value: unknown) {
  return String(value ?? "").trim();
}

function importField(row: Record<string, unknown>, names: string[]) {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value])
  );
  for (const name of names) {
    const value = normalized.get(name.trim().toLowerCase());
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function equivalentExternalCode(left: unknown, right: unknown) {
  const normalize = (value: unknown) => {
    const raw = textValue(value).toLowerCase();
    const withoutLeadingZeros = raw.replace(/^0+(?=\d)/, "");
    return new Set([raw, withoutLeadingZeros]);
  };
  const leftValues = normalize(left);
  const rightValues = normalize(right);
  return Array.from(leftValues).some(value => rightValues.has(value));
}

function readZipEntries(buffer: Buffer): Record<string, Buffer> {
  const entries: Record<string, Buffer> = {};
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === eocdSig) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Invalid XLSX file: ZIP directory not found.");

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const fileName = buffer.slice(centralOffset + 46, centralOffset + 46 + fileNameLength).toString("utf8");

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    entries[fileName] = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function parseXlsxRows(fileBase64: string): Record<string, string>[] {
  const base64 = fileBase64.includes(",") ? fileBase64.split(",").pop() || "" : fileBase64;
  const entries = readZipEntries(Buffer.from(base64, "base64"));
  const sharedStringsXml = entries["xl/sharedStrings.xml"]?.toString("utf8") || "";
  const sharedStrings = Array.from(sharedStringsXml.matchAll(/<si[\s\S]*?<\/si>/g)).map(match => {
    const text = Array.from(match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(item => decodeXml(item[1])).join("");
    return text;
  });
  const sheetName = Object.keys(entries).find(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("Invalid XLSX file: no worksheet found.");

  const sheetXml = entries[sheetName].toString("utf8");
  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const values: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\sr="([^"]+)"/)?.[1] || "";
      const type = attrs.match(/\st="([^"]+)"/)?.[1] || "";
      const idx = ref ? columnIndex(ref) : values.length;
      let value = "";
      if (type === "inlineStr") {
        value = decodeXml(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || "");
      } else {
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
        value = type === "s" ? (sharedStrings[Number(raw)] || "") : decodeXml(raw);
      }
      values[idx] = value;
    }
    rows.push(values.map(value => value || ""));
  }

  const headers = rows[0]?.map(header => header.trim()) || [];
  return rows.slice(1)
    .filter(row => row.some(value => String(value || "").trim() !== ""))
    .map(row => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = String(row[index] || "").trim();
      });
      return record;
    });
}

function parseWorkbookRows(fileBase64: string): Record<string, string>[] {
  const base64 = fileBase64.includes(",") ? fileBase64.split(",").pop() || "" : fileBase64;
  const workbook = XLSX.read(Buffer.from(base64, "base64"), { type: "buffer", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Invalid Excel file: no worksheet found.");
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
  const nonEmptyRows = rows.filter(row => row.some(value => String(value ?? "").trim() !== ""));
  const headers = (nonEmptyRows[0] || []).map(header => String(header ?? "").trim());
  return nonEmptyRows.slice(1).map(row => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = String(row[index] ?? "").trim();
    });
    return record;
  });
}

function parseCsvRows(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      i++;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(current);
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  row.push(current);
  if (row.some(cell => cell.trim() !== "")) rows.push(row);

  const headers = (rows.shift() || []).map(header => header.trim());
  return rows.map(cells => Object.fromEntries(headers.map((header, index) => [header, String(cells[index] || "").trim()])));
}

function parseUploadedTableRows(fileBase64: string, fileName = ""): Record<string, string>[] {
  const base64 = fileBase64.includes(",") ? fileBase64.split(",").pop() || "" : fileBase64;
  if (fileName.toLowerCase().endsWith(".csv")) {
    return parseCsvRows(Buffer.from(base64, "base64").toString("utf8"));
  }
  return parseWorkbookRows(fileBase64);
}

function excelSerialToIsoDate(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (/^\d{1,2}-\d{4}$/.test(value)) {
    const [month, year] = value.split("-");
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    return `${year}-${month.padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }
  const serial = Number(value);
  if (Number.isFinite(serial) && serial > 20000) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + serial * 86400000).toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function firstDayOfMonth(dateIso: string) {
  return dateIso ? `${dateIso.slice(0, 7)}-01` : new Date().toISOString().slice(0, 10);
}

function parseMoney(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  const numeric = Number(text.replace(/[,$()\s]/g, "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  return Number((negative ? -Math.abs(numeric) : numeric).toFixed(2));
}

function normalizeMatchText(value: unknown) {
  return textValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function entityNamesMatch(left: unknown, right: unknown) {
  const leftText = normalizeMatchText(left);
  const rightText = normalizeMatchText(right);
  return Boolean(leftText && rightText && (
    leftText === rightText ||
    leftText.includes(rightText) ||
    rightText.includes(leftText)
  ));
}

function findMatchingPayer(payers: Payer[], value: unknown) {
  const normalized = normalizeMatchText(value);
  if (!normalized) return null;
  return payers.find(payer =>
    normalizeMatchText(payer.payer_name) === normalized ||
    normalizeMatchText(payer.payer_id) === normalized ||
    normalizeMatchText(payer.pverify_payer_code) === normalized
  ) || null;
}

function parseServiceLines(claim: Partial<Claim>) {
  try {
    const parsed = claim.service_lines_json ? JSON.parse(claim.service_lines_json) : [];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // Fall through to CPT fallback.
  }
  const cpts = textValue(claim.cpt_hcpcs).split(/[,;/]+/).map(item => item.trim()).filter(Boolean);
  return cpts.map(cpt => ({
    cpt,
    units: 1,
    charged: cpts.length ? Number(claim.billed_charge || 0) / cpts.length : Number(claim.billed_charge || 0),
    allowed: cpts.length ? Number(claim.allowed_amount || claim.billed_charge || 0) / cpts.length : Number(claim.allowed_amount || claim.billed_charge || 0),
    adj: 0,
    paid: 0,
    secondaryPaid: 0,
    patResp: 0,
    balance: cpts.length ? Number(claim.ar_balance || claim.billed_charge || 0) / cpts.length : Number(claim.ar_balance || claim.billed_charge || 0),
    status: claim.claim_status || "Pending",
    nextAction: "No action",
    notes: [],
    codes: []
  }));
}

function linePaymentTotal(line: any) {
  return Number(line?.paid || 0) + Number(line?.secondaryPaid || 0);
}

const PAYMENT_IMPORT_FIELD_LABELS = {
  cptCode: "CPT Code",
  facilityName: "Facility Name",
  renderingProviderName: "Rendering Provider",
  patientName: "Patient Name",
  patientAcctNo: "Patient Account No",
  payerName: "Payer Name",
  serviceDate: "Service Date",
  claimDate: "Claim Date",
  paymentDate: "Payment Date",
  checkNo: "Check / EFT #",
  paymentType: "Payment Type",
  payerType: "Payer Type",
  claimNo: "Claim Number",
  cptGroupName: "CPT Group Name",
  externalPaymentId: "Payment ID",
  payment: "Total Payment",
  payerPayment: "Payer Payment",
  patientPayment: "Patient Payment",
  contractualAdjustment: "Contractual Adjustment",
  payerWithheld: "Payer Withheld",
  allowedAmount: "Allowed Amount",
  coinsurance: "Co-Insurance Amount",
  deductible: "Deductible Amount",
  copay: "Copay",
  balance: "Balance",
  responsibleParty: "Currently Responsible",
  primaryPolicyNumber: "Primary Policy Number",
  secondaryPayerName: "Secondary Insurance",
  secondaryPolicyNumber: "Secondary Policy Number",
  dateOfBirth: "Date of Birth",
  cptDescription: "CPT Description"
} as const;

type PaymentImportFieldKey = keyof typeof PAYMENT_IMPORT_FIELD_LABELS;
type PaymentImportMapping = Partial<Record<PaymentImportFieldKey, string>>;

const PAYMENT_IMPORT_FIELD_ALIASES: Record<PaymentImportFieldKey, string[]> = {
  cptCode: ["CPT Code", "CPT"],
  facilityName: ["Facility Name", "Practice Name"],
  renderingProviderName: ["Rendering Provider Name", "Provider", "Rendering Provider"],
  patientName: ["Patient Name", "Full Name (Last name First name Mi)", "Full Name", "Patient"],
  patientAcctNo: ["Patient Acct No", "Patient Account No", "Account Number", "MRN", "Patient ID"],
  payerName: ["Payer Name", "Payer", "Primary Insurance Name", "Insurance"],
  serviceDate: ["Service Date", "DOS", "Date Of Service (From) Date", "Date of Service"],
  claimDate: ["Claim Date", "Original Primary Submission Date"],
  paymentDate: ["Payment Date", "Payment Posted Date", "Payment Deposit Date", "Payment Check Date", "Payment EOB Date"],
  checkNo: ["Payment Check No", "Check No", "EFT", "Check", "Check / EFT #"],
  paymentType: ["Payment Type"],
  payerType: ["Payer Type"],
  claimNo: ["Claim No", "Claim ID", "Claim Number"],
  cptGroupName: ["CPT Group Name"],
  externalPaymentId: ["Payment ID"],
  payment: ["Payment", "Total Payment"],
  payerPayment: ["Payer Payment", "Insurance Payment Column with Reversal and Refund as Negative Payment"],
  patientPayment: ["Patient Payment", "Patient Payment Column  with Reversal and Refund as Negative Payment", "Patient Payment Column with Reversal and Refund as Negative Payment"],
  contractualAdjustment: ["Contractual Adjustment", "Contractual Adj"],
  payerWithheld: ["Payer Withheld"],
  allowedAmount: ["Allowed Amount"],
  coinsurance: ["Co-Insurance Amount", "Coinsurance Amount"],
  deductible: ["Deductible Amount"],
  copay: ["Copayment Applied To A Charge", "Copay"],
  balance: ["Balance"],
  responsibleParty: ["Currently Responsible"],
  primaryPolicyNumber: ["Primary Policy Number"],
  secondaryPayerName: ["Secondary Insurance Name"],
  secondaryPolicyNumber: ["Secondary Policy Number"],
  dateOfBirth: ["Date Of Birth", "DOB", "Date of Birth"],
  cptDescription: ["CPT Description"]
};

const PAYMENT_IMPORT_REQUIRED_FIELDS: PaymentImportFieldKey[] = ["patientAcctNo", "cptCode", "serviceDate"];
const PAYMENT_IMPORT_PAYMENT_FIELDS: PaymentImportFieldKey[] = ["payment", "payerPayment", "patientPayment"];

function getUploadedTableHeaders(rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  const headers: string[] = [];
  rows.slice(0, 25).forEach(row => {
    Object.keys(row || {}).forEach(header => {
      const trimmed = header.trim();
      const key = trimmed.toLowerCase();
      if (trimmed && !seen.has(key)) {
        seen.add(key);
        headers.push(trimmed);
      }
    });
  });
  return headers;
}

function paymentImportHeadersSignature(headers: string[]) {
  return headers.map(header => normalizeMatchText(header)).filter(Boolean).sort().join("|");
}

function autoDetectPaymentImportMapping(headers: string[]): PaymentImportMapping {
  const normalizedHeaderMap = new Map(headers.map(header => [normalizeMatchText(header), header]));
  const mapping: PaymentImportMapping = {};
  (Object.keys(PAYMENT_IMPORT_FIELD_ALIASES) as PaymentImportFieldKey[]).forEach(field => {
    const match = PAYMENT_IMPORT_FIELD_ALIASES[field].find(alias => normalizedHeaderMap.has(normalizeMatchText(alias)));
    if (match) mapping[field] = normalizedHeaderMap.get(normalizeMatchText(match)) || match;
  });
  return mapping;
}

function paymentImportMappingIssues(mapping: PaymentImportMapping) {
  const missingRequired = PAYMENT_IMPORT_REQUIRED_FIELDS.filter(field => !textValue(mapping[field]));
  const hasPaymentSource = PAYMENT_IMPORT_PAYMENT_FIELDS.some(field => textValue(mapping[field]));
  return {
    missingRequired,
    missingPayment: !hasPaymentSource,
    valid: missingRequired.length === 0 && hasPaymentSource
  };
}

function mappedImportField(row: Record<string, unknown>, mapping: PaymentImportMapping | undefined, field: PaymentImportFieldKey, fallbackNames: string[] = []) {
  const names = [mapping?.[field], ...fallbackNames].filter(Boolean) as string[];
  return importField(row, names);
}

function normalizePaymentImportRow(row: Record<string, unknown>, index: number, mapping?: PaymentImportMapping) {
  const payerPayment = parseMoney(mappedImportField(row, mapping, "payerPayment", ["Payer Payment"]));
  const patientPayment = parseMoney(mappedImportField(row, mapping, "patientPayment", ["Patient Payment"]));
  const explicitPayment = parseMoney(mappedImportField(row, mapping, "payment", ["Payment"]));
  const payment = explicitPayment || Number((payerPayment + patientPayment).toFixed(2));
  const paymentDate =
    excelSerialToIsoDate(mappedImportField(row, mapping, "paymentDate", ["Payment Date"])) ||
    excelSerialToIsoDate(importField(row, ["Payment Posted Date"])) ||
    excelSerialToIsoDate(importField(row, ["Payment Deposit Date"])) ||
    excelSerialToIsoDate(importField(row, ["Payment Check Date"]));

  return {
    rowNumber: index + 1,
    cptCode: mappedImportField(row, mapping, "cptCode", ["CPT Code", "CPT"]),
    facilityName: mappedImportField(row, mapping, "facilityName", ["Facility Name"]),
    renderingProviderName: mappedImportField(row, mapping, "renderingProviderName", ["Rendering Provider Name", "Provider"]),
    patientName: mappedImportField(row, mapping, "patientName", ["Patient Name"]),
    patientAcctNo: mappedImportField(row, mapping, "patientAcctNo", ["Patient Acct No", "Patient Account No", "MRN", "Patient ID"]),
    payerName: mappedImportField(row, mapping, "payerName", ["Payer Name", "Payer"]),
    serviceDate: excelSerialToIsoDate(mappedImportField(row, mapping, "serviceDate", ["Service Date", "DOS"])),
    claimDate: excelSerialToIsoDate(mappedImportField(row, mapping, "claimDate", ["Claim Date"])),
    paymentDate,
    checkNo: mappedImportField(row, mapping, "checkNo", ["Payment Check No", "Check No", "EFT", "Check"]),
    paymentType: mappedImportField(row, mapping, "paymentType", ["Payment Type"]),
    payerType: mappedImportField(row, mapping, "payerType", ["Payer Type"]),
    claimNo: mappedImportField(row, mapping, "claimNo", ["Claim No", "Claim ID", "Claim Number"]),
    cptGroupName: mappedImportField(row, mapping, "cptGroupName", ["CPT Group Name"]),
    externalPaymentId: mappedImportField(row, mapping, "externalPaymentId", ["Payment ID"]),
    payment,
    payerPayment,
    patientPayment,
    contractualAdjustment: parseMoney(mappedImportField(row, mapping, "contractualAdjustment", ["Contractual Adjustment"])),
    payerWithheld: parseMoney(mappedImportField(row, mapping, "payerWithheld", ["Payer Withheld"])),
    allowedAmount: parseMoney(mappedImportField(row, mapping, "allowedAmount", ["Allowed Amount"])),
    coinsurance: parseMoney(mappedImportField(row, mapping, "coinsurance", ["Co-Insurance Amount"])),
    deductible: parseMoney(mappedImportField(row, mapping, "deductible", ["Deductible Amount"])),
    copay: parseMoney(mappedImportField(row, mapping, "copay", ["Copayment Applied To A Charge"])),
    balance: parseMoney(mappedImportField(row, mapping, "balance", ["Balance"])),
    responsibleParty: mappedImportField(row, mapping, "responsibleParty", ["Currently Responsible"]),
    primaryPolicyNumber: mappedImportField(row, mapping, "primaryPolicyNumber", ["Primary Policy Number"]),
    secondaryPayerName: mappedImportField(row, mapping, "secondaryPayerName", ["Secondary Insurance Name"]),
    secondaryPolicyNumber: mappedImportField(row, mapping, "secondaryPolicyNumber", ["Secondary Policy Number"]),
    dateOfBirth: excelSerialToIsoDate(mappedImportField(row, mapping, "dateOfBirth", ["Date Of Birth", "DOB"])),
    cptDescription: mappedImportField(row, mapping, "cptDescription", ["CPT Description"])
  };
}

type PaymentImportNormalizedRow = ReturnType<typeof normalizePaymentImportRow>;

function fillDownPaymentImportRows(rows: PaymentImportNormalizedRow[]) {
  const carryFields: Array<keyof PaymentImportNormalizedRow> = [
    "facilityName",
    "renderingProviderName",
    "patientName",
    "patientAcctNo",
    "payerName",
    "claimNo",
    "serviceDate",
    "claimDate"
  ];
  const lastSeen: Partial<PaymentImportNormalizedRow> = {};
  const patientAcctByName = new Map<string, string>();

  return rows.map(row => {
    const filled = { ...row };
    const patientNameKey = normalizeMatchText(filled.patientName);
    if (patientNameKey && filled.patientAcctNo) {
      patientAcctByName.set(patientNameKey, filled.patientAcctNo);
    }
    if (!filled.patientAcctNo && patientNameKey && patientAcctByName.has(patientNameKey)) {
      filled.patientAcctNo = patientAcctByName.get(patientNameKey) || "";
    }

    const isContinuationRow = !textValue(row.patientName) && !textValue(row.patientAcctNo);
    if (isContinuationRow) {
      for (const field of carryFields) {
        if (!textValue(filled[field]) && textValue(lastSeen[field])) {
          (filled as any)[field] = lastSeen[field];
        }
      }
    }

    for (const field of carryFields) {
      if (textValue(filled[field])) {
        (lastSeen as any)[field] = filled[field];
      }
    }
    return filled;
  });
}

function countBy<T>(items: T[], selector: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = selector(item);
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function serviceLinesFromClaim(claim: Partial<Claim>) {
  try {
    const parsed = claim.service_lines_json ? JSON.parse(claim.service_lines_json) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function summarizeImport(
  importRows: Record<string, unknown>[],
  importedClaims: Claim[],
  errors: { row: number; claimId?: string; errors: string[] }[]
) {
  const inputPatients = new Set(importRows.map(row => importField(row, ["MRN", "patient_id"])).filter(Boolean));
  const importedPatients = new Set(importedClaims.map(claim => textValue(claim.patient_id)).filter(Boolean));
  const importedProviders = new Set(importedClaims.map(claim => textValue(claim.provider_npi || claim.provider_id)).filter(Boolean));
  const importedPayers = new Set(importedClaims.map(claim => textValue(claim.payer_id || claim.payer_name)).filter(Boolean));
  const cptCounts: Record<string, number> = {};

  importedClaims.forEach(claim => {
    const lines = serviceLinesFromClaim(claim);
    if (lines.length > 0) {
      lines.forEach(line => {
        const cpt = textValue(line?.cpt);
        if (!cpt) return;
        const units = Number(line?.units);
        cptCounts[cpt] = (cptCounts[cpt] || 0) + (Number.isFinite(units) && units > 0 ? Math.floor(units) : 1);
      });
      return;
    }
    textValue(claim.cpt_hcpcs)
      .split(/[\s,]+/)
      .filter(Boolean)
      .forEach(cpt => {
        cptCounts[cpt] = (cptCounts[cpt] || 0) + 1;
      });
  });

  const errorReasonCounts = countBy(
    errors.flatMap(item => item.errors),
    reason => reason
  );

  return {
    totalRowsRead: importRows.length,
    importedRows: importedClaims.length,
    rejectedRows: errors.length,
    accountedRows: importedClaims.length + errors.length,
    allRowsAccounted: importedClaims.length + errors.length === importRows.length,
    uniquePatientsInFile: inputPatients.size,
    uniquePatientsImported: importedPatients.size,
    uniqueProvidersImported: importedProviders.size,
    uniquePayersImported: importedPayers.size,
    uniqueCptCodesImported: Object.keys(cptCounts).length,
    totalCptUnitsImported: Object.values(cptCounts).reduce((sum, count) => sum + count, 0),
    cptCodeCounts: cptCounts,
    totalBilledChargeImported: Number(importedClaims.reduce((sum, claim) => sum + Number(claim.billed_charge || 0), 0).toFixed(2)),
    topRejectionReasons: Object.entries(errorReasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count }))
  };
}

function parseAllowedOrigins() {
  const configured = (process.env.ALLOWED_ORIGIN || process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return process.env.NODE_ENV === "production"
    ? []
    : ["http://127.0.0.1:3000", "http://127.0.0.1:3001", "http://127.0.0.1:3002", "http://localhost:3000", "http://localhost:3001", "http://localhost:3002"];
}

function getOperatorEmail(req: AppRequest) {
  return req.appUser?.email || (req.headers["x-user-email"] as string) || "egomez@itera.health";
}

function claimPeriod(claim: Partial<Claim>) {
  return textValue(claim.month_of_service || claim.date_of_service_from || claim.date_of_service_to).slice(0, 7);
}

function buildReconciliationConfig(settings: Array<{ setting_key: string; setting_value: string }>) {
  const get = (key: string, fallback: string) => settings.find(s => s.setting_key === key)?.setting_value || fallback;
  return {
    providerSharePercent: Number(get("PROVIDER_SHARE_PERCENT", "70")),
    iteraSharePercent: Number(get("ITERA_SHARE_PERCENT", "30")),
    contractPaymentModel: get("CONTRACT_PAYMENT_MODEL", "PERCENTAGE") === "FEE" ? "FEE" as const : "PERCENTAGE" as const,
    iteraFeeWhenProviderBills: Number(get("ITERA_FEE_WHEN_PROVIDER_BILLS", "0")),
    physicianFeeWhenIteraBills: Number(get("PHYSICIAN_FEE_WHEN_ITERA_BILLS", "0"))
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const authRequired = process.env.REQUIRE_AUTH === "true";
  const allowedOrigins = parseAllowedOrigins();
  const firebaseProjectId = process.env.IDENTITY_PLATFORM_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

  if (authRequired) {
    if (!firebaseProjectId) {
      throw new Error("REQUIRE_AUTH=true requires IDENTITY_PLATFORM_PROJECT_ID, FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT.");
    }
    if (getApps().length === 0) {
      initializeApp({ projectId: firebaseProjectId });
    }
  }

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Email");
    applyApiSecurityHeaders((name, value) => res.setHeader(name, value));
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    if (req.method === "OPTIONS") return res.status(204).send();
    next();
  });

  // Middleware for parsing JSON
  app.use(express.json({ limit: "50mb" }));

  // Initialize our Google Sheets / Memory database service
  const sheetsService = new GoogleSheetsService();
  
  // Start sync immediately and make auth wait for it to avoid cold-start authorization races.
  const initialSyncPromise = sheetsService.syncWithGoogleSheets().then(res => {
    if (res.success) {
      console.log("Initial Google Sheets sync completed successfully.");
    } else {
      console.warn("Initial Google Sheets sync failed or was bypassed. Operating in-memory mode.");
    }
    return res;
  }).catch(err => {
    console.error("Initial Google Sheets sync failed:", err);
    return { success: false, error: err?.message || String(err) };
  });

  // Automatically execute reconciliation engine unit tests on server start for audit/verification
  const testResults = runReconciliationEngineTests();
  const reportTestFailures = runReportsEngineTests();
  const patientValidationFailures = runPatientRegistrationValidationTests();
  if (reportTestFailures.length === 0) {
    testResults.push({ name: "Reports Engine aggregation, coverage and aging", success: true });
  } else {
    reportTestFailures.forEach(error => testResults.push({ name: "Reports Engine", success: false, error }));
  }
  if (patientValidationFailures.length === 0) {
    testResults.push({ name: "Patient/provider duplicate registration validation", success: true });
  } else {
    patientValidationFailures.forEach(error => testResults.push({ name: "Patient registration validation", success: false, error }));
  }
  const failedTests = testResults.filter(r => !r.success);
  if (failedTests.length > 0) {
    console.error("❌ Reconciliation Engine Unit Tests FAILED:", failedTests);
  } else {
    console.log("✅ All Reconciliation Engine Unit Tests passed successfully.");
  }

  const authenticateRequest = async (req: AppRequest, res: express.Response, next: express.NextFunction) => {
    try {
      await initialSyncPromise;
      const users = await sheetsService.getUsers();
      if (!authRequired) {
        const requestedEmail = ((req.headers["x-user-email"] as string) || "").toLowerCase();
        req.appUser = users.find(user => user.email.toLowerCase() === requestedEmail && user.active)
          || users.find(user => user.email === "egomez@itera.health" && user.active)
          || users.find(user => user.active);
        if (req.appUser?.role === UserRole.Admin) {
          void sheetsService.maybeCreateScheduledBackup("system@itera.health").catch(err => console.warn("Scheduled backup check failed:", err?.message || err));
        }
        return next();
      }

      const authorization = req.headers.authorization || "";
      const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
      if (!token) return res.status(401).json({ error: "Authentication required." });

      const decoded = await getAuth().verifyIdToken(token);
      const email = String(decoded.email || "").toLowerCase();
      if (!email) return res.status(403).json({ error: "Authenticated account has no email." });

      const user = users.find(item => item.email.toLowerCase() === email);
      if (!user || !user.active) return res.status(403).json({ error: "User is not authorized for this application." });
      req.appUser = user;
      req.firebaseUid = decoded.uid;
      if (req.appUser.role === UserRole.Admin) {
        void sheetsService.maybeCreateScheduledBackup("system@itera.health").catch(err => console.warn("Scheduled backup check failed:", err?.message || err));
      }
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired authentication token." });
    }
  };

  const requireRoles = (...roles: UserRole[]) => (req: AppRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.appUser) return res.status(401).json({ error: "Authentication required." });
    if (!roles.includes(req.appUser.role)) return res.status(403).json({ error: "Insufficient permissions." });
    next();
  };

  const canAccessClaim = (req: AppRequest, claim: Claim) =>
    !!req.appUser && canUserAccessProvider(req.appUser, claim.provider_id, claim.provider_npi);

  const allowedSupportingDocumentTypes = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "text/plain",
    "application/xml",
    "text/xml"
  ]);
  const maxSupportingDocumentBytes = Number(process.env.SUPPORTING_DOCUMENT_MAX_BYTES || 15 * 1024 * 1024);
  const decodeUploadBase64 = (value: unknown) => {
    const raw = textValue(value);
    const base64 = raw.includes(",") ? raw.split(",").pop() || "" : raw;
    return Buffer.from(base64, "base64");
  };
  const inferSupportingDocumentMimeType = (fileName: string, mimeType: string) => {
    if (mimeType && mimeType !== "application/octet-stream") return mimeType;
    const extension = path.extname(fileName).toLowerCase();
    if (extension === ".pdf") return "application/pdf";
    if (extension === ".png") return "image/png";
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".txt") return "text/plain";
    if (extension === ".xml") return "application/xml";
    return mimeType || "application/octet-stream";
  };

  // --- API Routes ---

  // Connection and Diagnostic Status
  app.get("/api/status", (req, res) => {
    const sheetStatus = sheetsService.getConnectionStatus();
    res.json({
      status: "online",
      time: new Date().toISOString(),
      authRequired,
      googleSheets: sheetStatus,
      testsRun: testResults.length,
      testsPassed: testResults.length - failedTests.length
    });
  });

  app.use("/api", authenticateRequest);

  app.get("/api/auth/me", (req: AppRequest, res) => {
    res.json({ user: req.appUser, firebaseUid: req.firebaseUid || null });
  });

  // Force sync from Google Sheets
  app.post("/api/sync", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    const result = await sheetsService.syncWithGoogleSheets();
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  });

  app.post("/api/admin/clear-operational-data", requireRoles(...API_ROLE_GROUPS.adminOnly), async (_req: AppRequest, res) => {
    try {
      if (textValue(_req.body?.confirmationPhrase) !== "CLEAR OPERATIONAL DATA") {
        return res.status(400).json({ success: false, error: "Confirmation phrase is required." });
      }
      const result = await sheetsService.clearOperationalData();
      await sheetsService.addUserActivityLog({
        user_email: getOperatorEmail(_req),
        action: "Clear operational data",
        entity_type: "System",
        entity_id: "Claims,Payments,Notes,Audit_Log",
        metadata_json: JSON.stringify(result)
      });
      res.json({
        success: true,
        message: "Operational test data cleared.",
        ...result
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to clear operational data." });
    }
  });

  app.get("/api/admin/backups", requireRoles(...API_ROLE_GROUPS.adminOnly), async (_req: AppRequest, res) => {
    try {
      const scheduled = await sheetsService.maybeCreateScheduledBackup("system@itera.health");
      res.json({
        success: true,
        config: sheetsService.getBackupConfiguration(),
        scheduledCreated: scheduled,
        backups: await sheetsService.listSpreadsheetBackups()
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to load backups." });
    }
  });

  app.put("/api/admin/backups/settings", requireRoles(...API_ROLE_GROUPS.adminOnly), async (req: AppRequest, res) => {
    try {
      const config = await sheetsService.updateBackupConfiguration({
        enabled: req.body?.enabled !== false,
        frequencyHours: Number(req.body?.frequencyHours || 24),
        backupDriveFolderId: textValue(req.body?.backupDriveFolderId)
      });
      res.json({ success: true, config });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to update backup settings." });
    }
  });

  app.post("/api/admin/backups", requireRoles(...API_ROLE_GROUPS.adminOnly), async (req: AppRequest, res) => {
    try {
      const backup = await sheetsService.createSpreadsheetBackup(getOperatorEmail(req), textValue(req.body?.notes) || "Manual backup from System Settings.");
      await sheetsService.addUserActivityLog({
        user_email: getOperatorEmail(req),
        action: "Create backup",
        entity_type: "Backup",
        entity_id: backup.backup_file_id,
        metadata_json: JSON.stringify({ backup_file_name: backup.backup_file_name, backup_drive_url: backup.backup_drive_url })
      });
      res.status(201).json({ success: true, backup, config: sheetsService.getBackupConfiguration() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to create backup." });
    }
  });

  app.post("/api/admin/backups/:fileId/restore", requireRoles(...API_ROLE_GROUPS.adminOnly), async (req: AppRequest, res) => {
    try {
      if (textValue(req.body?.confirm) !== "RESTORE") {
        return res.status(400).json({ success: false, error: "RESTORE confirmation is required." });
      }
      const result = await sheetsService.restoreSpreadsheetBackup(req.params.fileId, getOperatorEmail(req));
      await sheetsService.addUserActivityLog({
        user_email: getOperatorEmail(req),
        action: "Restore backup",
        entity_type: "Backup",
        entity_id: req.params.fileId,
        metadata_json: JSON.stringify({ restoredTabs: result.restoredTabs, preRestoreBackup: result.preRestoreBackup.backup_file_id })
      });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to restore backup." });
    }
  });

  app.get("/api/admin/operations", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (_req: AppRequest, res) => {
    try {
      const jobs = await sheetsService.getJobs();
      const importHistory = await sheetsService.getImportHistory();
      const reviewTasks = await sheetsService.getReviewTasks();
      const notifications = await sheetsService.getNotifications();
      const importMappingTemplates = await sheetsService.getImportMappingTemplates("", true);
      const importExceptions = [
        ...reviewTasks
          .filter(task => !["Resolved", "Dismissed"].includes(task.status))
          .map(task => ({
            exception_id: task.task_id,
            type: "Review Task",
            source: task.source,
            claim_id: task.claim_id,
            cpt_code: task.cpt_code,
            reason: task.reason,
            severity: task.priority,
            status: task.status,
            assigned_to: task.assigned_to,
            due_date: task.due_date,
            created_at: task.created_at
          })),
        ...importHistory
          .filter(item => Number(item.rejected_rows || 0) > 0 || Number(item.review_rows || 0) > 0)
          .map(item => ({
            exception_id: item.import_id,
            type: "Import Result",
            source: item.import_type,
            claim_id: "",
            cpt_code: "",
            reason: `${item.rejected_rows || 0} rejected row(s), ${item.review_rows || 0} review row(s) in ${item.file_name || "uploaded file"}.`,
            severity: Number(item.rejected_rows || 0) > 0 ? "High" : "Medium",
            status: item.status,
            assigned_to: item.requested_by,
            due_date: "",
            created_at: item.imported_at
          })),
        ...jobs
          .filter(job => job.status === "failed")
          .map(job => ({
            exception_id: job.job_id,
            type: "Failed Job",
            source: job.job_type,
            claim_id: "",
            cpt_code: "",
            reason: job.error_message || "Job failed.",
            severity: "High",
            status: job.status,
            assigned_to: job.requested_by,
            due_date: "",
            created_at: job.requested_at
          }))
      ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      res.json({
        success: true,
        health: sheetsService.getSystemHealth(),
        metrics: sheetsService.getRcmProductivityMetrics(),
        jobs,
        importHistory,
        activity: await sheetsService.getUserActivityLogs(),
        reviewTasks,
        notifications,
        importExceptions,
        importMappingTemplates,
        bankDeposits: await sheetsService.getBankDeposits(),
        monthlyClosures: await sheetsService.getMonthlyClosures()
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to load operations center." });
    }
  });

  app.get("/api/payment-reconciliation-import/templates", requireRoles(...API_ROLE_GROUPS.claimWrite), async (_req: AppRequest, res) => {
    try {
      res.json({ success: true, templates: await sheetsService.getImportMappingTemplates("Payment Import") });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Payment import templates could not be loaded." });
    }
  });

  app.post("/api/admin/monthly-closures", requireRoles(...API_ROLE_GROUPS.adminOnly), async (req: AppRequest, res) => {
    try {
      const period = textValue(req.body?.period);
      if (!/^\d{4}-\d{2}$/.test(period)) {
        return res.status(400).json({ success: false, error: "Period must use YYYY-MM format." });
      }
      const close = await sheetsService.createMonthlyClose(period, getOperatorEmail(req), textValue(req.body?.notes));
      await sheetsService.addUserActivityLog({
        user_email: getOperatorEmail(req),
        action: "Monthly close",
        entity_type: "Monthly_Closure",
        entity_id: close.close_id,
        metadata_json: JSON.stringify({ period, backup_file_id: close.backup_file_id })
      });
      res.status(201).json({ success: true, close });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to close month." });
    }
  });

  app.post("/api/admin/bank-deposits", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req: AppRequest, res) => {
    try {
      const deposit = await sheetsService.createBankDeposit({
        deposit_date: textValue(req.body?.deposit_date),
        check_or_eft_number: textValue(req.body?.check_or_eft_number),
        payer_name: textValue(req.body?.payer_name),
        deposit_amount: Number(req.body?.deposit_amount || 0),
        matched_payment_total: Number(req.body?.matched_payment_total || 0),
        notes: textValue(req.body?.notes)
      });
      await sheetsService.addUserActivityLog({
        user_email: getOperatorEmail(req),
        action: "Create bank deposit",
        entity_type: "Bank_Deposit",
        entity_id: deposit.deposit_id,
        metadata_json: JSON.stringify(deposit)
      });
      res.status(201).json({ success: true, deposit });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to create bank deposit." });
    }
  });

  app.post("/api/admin/bank-deposits/import", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const fileName = textValue(req.body?.fileName);
      const importRows = req.body?.fileBase64
        ? parseUploadedTableRows(String(req.body.fileBase64), fileName)
        : req.body?.rows;
      if (!Array.isArray(importRows)) {
        return res.status(400).json({ success: false, error: "Rows or fileBase64 are required." });
      }

      const normalized = fillDownPaymentImportRows(
        importRows.map((row: Record<string, unknown>, index: number) => normalizePaymentImportRow(row, index))
      );
      const payments = await sheetsService.getPayments();
      const groups = new Map<string, typeof normalized>();
      normalized.forEach(row => {
        const depositDate = row.paymentDate || new Date().toISOString().slice(0, 10);
        const key = [
          depositDate,
          normalizeMatchText(row.checkNo || "NO_CHECK"),
          normalizeMatchText(row.payerName || "NO_PAYER")
        ].join("|");
        const current = groups.get(key) || [];
        current.push(row);
        groups.set(key, current);
      });

      const created = [];
      const resultRows = [];
      for (const [key, groupRows] of groups.entries()) {
        const [depositDate] = key.split("|");
        const checkNo = groupRows.find(row => row.checkNo)?.checkNo || "";
        const payerName = groupRows.find(row => row.payerName)?.payerName || "";
        const depositAmount = Number(groupRows.reduce((sum, row) => sum + Number(row.payment || 0), 0).toFixed(2));
        const matchedPayments = payments.filter(payment => {
          const sameCheck = checkNo && normalizeMatchText(payment.check_or_eft_number) === normalizeMatchText(checkNo);
          const samePayer = payerName && entityNamesMatch(payment.payer_name, payerName);
          return Boolean(sameCheck && (!payerName || samePayer));
        });
        const matchedPaymentTotal = Number(matchedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0).toFixed(2));
        const deposit = await sheetsService.createBankDeposit({
          deposit_date: depositDate,
          check_or_eft_number: checkNo,
          payer_name: payerName,
          deposit_amount: depositAmount,
          matched_payment_total: matchedPaymentTotal,
          notes: `Imported from ${fileName || "deposit report"}. Source rows: ${groupRows.map(row => row.rowNumber).join(", ")}.`
        });
        created.push(deposit);
        resultRows.push({
          deposit,
          sourceRows: groupRows.map(row => row.rowNumber),
          matchedPaymentIds: matchedPayments.map(payment => payment.payment_id)
        });
      }

      const summary = {
        totalRowsRead: importRows.length,
        depositGroups: created.length,
        matchedDeposits: created.filter(item => item.status === "Matched").length,
        mismatchDeposits: created.filter(item => item.status !== "Matched").length,
        totalDepositAmount: Number(created.reduce((sum, item) => sum + Number(item.deposit_amount || 0), 0).toFixed(2)),
        totalMatchedPayments: Number(created.reduce((sum, item) => sum + Number(item.matched_payment_total || 0), 0).toFixed(2))
      };
      const importHistory = await sheetsService.createImportHistory({
        import_type: "Bank Deposits",
        file_name: fileName,
        requested_by: operatorEmail,
        total_rows: summary.totalRowsRead,
        imported_rows: summary.depositGroups,
        rejected_rows: 0,
        review_rows: summary.mismatchDeposits,
        total_amount: summary.totalDepositAmount,
        summary_json: JSON.stringify(summary),
        status: summary.mismatchDeposits > 0 ? "Imported with mismatches" : "Imported"
      });
      await sheetsService.createJob({
        job_type: "Bank deposit import",
        status: "completed",
        requested_by: operatorEmail,
        progress: 100,
        summary_json: JSON.stringify(summary)
      });
      await sheetsService.addUserActivityLog({
        user_email: operatorEmail,
        action: "Import bank deposits",
        entity_type: "Import",
        entity_id: importHistory.import_id,
        metadata_json: JSON.stringify(summary)
      });
      for (const mismatch of created.filter(item => item.status !== "Matched").slice(0, 50)) {
        await sheetsService.createReviewTask({
          source: "Bank Deposit Import",
          reason: `Deposit ${mismatch.check_or_eft_number || mismatch.deposit_id} has difference ${mismatch.difference}.`,
          priority: "Medium",
          status: "Open"
        });
      }

      res.status(201).json({ success: true, summary, deposits: resultRows });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to import bank deposits." });
    }
  });

  app.put("/api/review-tasks/:id", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const updated = await sheetsService.updateReviewTask(req.params.id, {
        assigned_to: textValue(req.body?.assigned_to),
        priority: req.body?.priority,
        status: req.body?.status,
        due_date: textValue(req.body?.due_date)
      });
      if (!updated) return res.status(404).json({ success: false, error: "Review task not found." });
      await sheetsService.addUserActivityLog({
        user_email: getOperatorEmail(req),
        action: "Update review task",
        entity_type: "Review_Task",
        entity_id: updated.task_id,
        metadata_json: JSON.stringify(updated)
      });
      res.json({ success: true, task: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to update review task." });
    }
  });

  app.post("/api/supporting-documents", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const claimId = textValue(req.body.claimId);
      const fileName = textValue(req.body.fileName);
      const mimeType = inferSupportingDocumentMimeType(fileName, textValue(req.body.mimeType) || "application/octet-stream");
      const fileBase64 = req.body.fileBase64;

      if (!claimId || !fileName || !fileBase64) {
        return res.status(400).json({ error: "claimId, fileName and fileBase64 are required." });
      }
      if (!allowedSupportingDocumentTypes.has(mimeType)) {
        return res.status(400).json({ error: "Unsupported file type. Allowed: PDF, PNG, JPG, JPEG, TXT, XML." });
      }

      const claims = await sheetsService.getClaims(true);
      const claim = claims.find(c => c.claim_id === claimId && !c.deleted_flag);
      if (!claim) return res.status(404).json({ error: "Claim not found." });
      if (!canAccessClaim(req, claim)) {
        return res.status(403).json({ error: "This user does not have access to this provider." });
      }
      if (sheetsService.isPeriodClosed(claimPeriod(claim))) {
        return res.status(423).json({ error: `Period ${claimPeriod(claim)} is closed. Reopen the period before uploading supporting documents.` });
      }

      const buffer = decodeUploadBase64(fileBase64);
      if (buffer.length === 0) {
        return res.status(400).json({ error: "The uploaded file is empty." });
      }
      if (buffer.length > maxSupportingDocumentBytes) {
        return res.status(413).json({ error: `File exceeds the ${Math.round(maxSupportingDocumentBytes / 1024 / 1024)} MB upload limit.` });
      }

      const operatorEmail = getOperatorEmail(req);
      const uploaded = await sheetsService.uploadSupportingDocument({
        claimId,
        fileName,
        mimeType,
        buffer,
        uploadedBy: operatorEmail
      });

      await sheetsService.addAuditLog({
        audit_id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        claim_id: claimId,
        action_type: "Update",
        field_name: "supporting_documents",
        previous_value: "",
        new_value: uploaded.webViewLink || uploaded.fileId,
        reason: `Supporting document uploaded: ${uploaded.name}`,
        changed_by: operatorEmail,
        changed_at: new Date().toISOString()
      });

      res.status(201).json({ success: true, document: uploaded });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to upload supporting document." });
    }
  });

  // GET Claims (with filter, search, sorting)
  app.get("/api/claims", async (req: AppRequest, res) => {
    try {
      const claims = await sheetsService.getClaims();
      res.json(filterClaimsForUser(claims, req.appUser));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to retrieve claims" });
    }
  });

  // GET Single Claim Detail
  app.get("/api/claims/:id", async (req: AppRequest, res) => {
    try {
      const claims = await sheetsService.getClaims();
      const claim = claims.find(c => c.claim_id === req.params.id);
      if (!claim) {
        return res.status(404).json({ error: "Claim not found" });
      }
      if (!canAccessClaim(req, claim)) {
        return res.status(403).json({ error: "This user does not have access to this provider." });
      }
      res.json(claim);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to retrieve claim" });
    }
  });

  // POST Create New Claim
  app.post("/api/claims", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const rawClaim = req.body;

      // Claim IDs are always generated server-side to guarantee uniqueness.
      const claims = await sheetsService.getClaims(true);
      rawClaim.claim_id = generateClaimId(
        claims.map(c => c.claim_id),
        rawClaim.patient_id,
        rawClaim.date_of_service_from
      );

      // 2. Calculate billed_charge using FCSO-style Fee Schedule if applicable
      const serviceDate = rawClaim.date_of_service_from;
      if (serviceDate && rawClaim.cpt_hcpcs) {
        const parts = serviceDate.split("-");
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        const isSemester2 = month >= 7 && month <= 12;

        const feeSchedules = await sheetsService.getFeeSchedules();
        const matched = feeSchedules.find(f => textValue(f.cpt_code) === textValue(rawClaim.cpt_hcpcs) && Number(f.year) === year);
        if (matched) {
          const rate = isSemester2 ? matched.semester2_rate : matched.semester1_rate;
          rawClaim.billed_charge = rate * (Number(rawClaim.units) || 1);
        }
      }

      // Ensure calculations are run
      const settings = await sheetsService.getSettings();
      const calculated = calculateClaimFinancials(rawClaim, buildReconciliationConfig(settings));

      if (sheetsService.isPeriodClosed(claimPeriod(calculated))) {
        return res.status(423).json({ error: `Period ${claimPeriod(calculated)} is closed. Reopen the period before creating claims.` });
      }

      if (!canUserAccessProvider(req.appUser || {}, calculated.provider_id, calculated.provider_npi)) {
        return res.status(403).json({ error: "This user does not have access to this provider." });
      }

      // Validate
      const validationErrors = validateClaim(calculated);
      validationErrors.push(...validateUniquePatientProvider(calculated, claims));
      validationErrors.push(...validateClaimCptRepeatLimits(calculated, await sheetsService.getFeeSchedules()));
      validationErrors.push(...validateClaimCptRepeatLimitsAgainstExisting(
        calculated,
        await sheetsService.getFeeSchedules(),
        claims
      ));
      if (validationErrors.length > 0) {
        return res.status(400).json({ error: "Validation failed", details: validationErrors });
      }

      const created = await sheetsService.createClaim(calculated, operatorEmail);
      res.status(210).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create claim" });
    }
  });

  // PUT Update Existing Claim
  app.put("/api/claims/:id", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const rawClaimUpdates = req.body;

      const claims = await sheetsService.getClaims(true);
      const existing = claims.find(c => c.claim_id === req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Claim not found" });
      }
      if (existing.deleted_flag) {
        return res.status(410).json({ error: "Claim has been deleted" });
      }
      if (!canAccessClaim(req, existing)) {
        return res.status(403).json({ error: "This user does not have access to this provider." });
      }
      if (sheetsService.isPeriodClosed(claimPeriod(existing))) {
        return res.status(423).json({ error: `Period ${claimPeriod(existing)} is closed. Reopen the period before updating this claim.` });
      }

      // Capture payer state BEFORE merge so we can detect changes explicitly
      const prevPayerId   = existing.payer_id;
      const prevPayerName = existing.payer_name;

      // Merge and calculate financials
      const merged = { ...existing, ...rawClaimUpdates };
      
      const settings = await sheetsService.getSettings();
      const calculated = calculateClaimFinancials(merged, buildReconciliationConfig(settings));

      if (!canUserAccessProvider(req.appUser || {}, calculated.provider_id, calculated.provider_npi)) {
        return res.status(403).json({ error: "This user does not have access to this provider." });
      }

      // Validate
      const validationErrors = validateClaim(calculated);
      validationErrors.push(...validateUniquePatientProvider(calculated, claims, req.params.id));
      validationErrors.push(...validateClaimCptRepeatLimits(calculated, await sheetsService.getFeeSchedules()));
      validationErrors.push(...validateClaimCptRepeatLimitsAgainstExisting(
        calculated,
        await sheetsService.getFeeSchedules(),
        claims,
        req.params.id
      ));
      if (validationErrors.length > 0) {
        return res.status(400).json({ error: "Validation failed", details: validationErrors });
      }

      const updated = await sheetsService.updateClaim(req.params.id, calculated, operatorEmail);

      // Explicit insurance change audit log — bypass diff mechanism for reliability
      if (prevPayerId !== updated.payer_id) {
        const changeReason = (rawClaimUpdates.insurance_change_reason as string) || "Change reported while processing ERA";
        const memberId     = (rawClaimUpdates.insurance_change_member_id as string) || "";
        const reason = `Insurance changed from "${prevPayerName || prevPayerId}" to "${updated.payer_name || updated.payer_id}"` +
          (changeReason ? ` — Reason: ${changeReason}` : "") +
          (memberId     ? ` — Member ID: ${memberId}`   : "");

        const auditRecord = {
          audit_id:       `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          claim_id:       updated.claim_id,
          action_type:    "Update" as const,
          field_name:     "payer_id",
          previous_value: prevPayerId,
          new_value:      updated.payer_id,
          reason,
          changed_by:     operatorEmail,
          changed_at:     new Date().toISOString()
        };
        await sheetsService.addAuditLog(auditRecord);
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update claim" });
    }
  });

  // DELETE Claim (soft delete, Admin only)
  app.delete("/api/claims/:id", requireRoles(...API_ROLE_GROUPS.adminOnly), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const reason = String(req.body?.reason || "").trim() || "Claim entered in error";
      const claims = await sheetsService.getClaims(true);
      const existing = claims.find(c => c.claim_id === req.params.id);
      if (!existing) return res.status(404).json({ error: "Claim not found" });
      if (!canAccessClaim(req, existing)) {
        return res.status(403).json({ error: "This user does not have access to this provider." });
      }
      if (sheetsService.isPeriodClosed(claimPeriod(existing))) {
        return res.status(423).json({ error: `Period ${claimPeriod(existing)} is closed. Reopen the period before deleting this claim.` });
      }
      const deleted = await sheetsService.softDeleteClaim(req.params.id, operatorEmail, reason);
      res.json({ success: true, claim: deleted });
    } catch (err: any) {
      const status = /not found/i.test(err.message || "") ? 404 : 500;
      res.status(status).json({ error: err.message || "Failed to delete claim" });
    }
  });

  // POST Bulk Update Claims
  app.post("/api/claims/bulk-update", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const { claimIds, updates } = req.body;

      if (!claimIds || !Array.isArray(claimIds) || claimIds.length === 0) {
        return res.status(400).json({ error: "No claim IDs provided." });
      }

      // To handle bulk financial updates properly, we fetch, merge, recompute financials, then save each
      const settings = await sheetsService.getSettings();
      const reconciliationConfig = buildReconciliationConfig(settings);

      let successCount = 0;
      for (const id of claimIds) {
        const claim = sheetsService.claims.find(c => c.claim_id === id);
        if (claim && !claim.deleted_flag) {
          if (!canAccessClaim(req, claim)) {
            return res.status(403).json({ error: `This user does not have access to claim ${id}.` });
          }
          if (sheetsService.isPeriodClosed(claimPeriod(claim))) {
            return res.status(423).json({ error: `Period ${claimPeriod(claim)} is closed. Reopen the period before updating claim ${id}.` });
          }
          const merged = { ...claim, ...updates };
          const recomputed = calculateClaimFinancials(merged, reconciliationConfig);
          if (!canUserAccessProvider(req.appUser || {}, recomputed.provider_id, recomputed.provider_npi)) {
            return res.status(403).json({ error: `This update would move claim ${id} outside the user's provider access.` });
          }

          const validationErrors = validateClaim(recomputed);
          validationErrors.push(...validateClaimCptRepeatLimits(recomputed, await sheetsService.getFeeSchedules()));
          validationErrors.push(...validateClaimCptRepeatLimitsAgainstExisting(
            recomputed,
            await sheetsService.getFeeSchedules(),
            sheetsService.claims,
            id
          ));
          if (validationErrors.length > 0) {
            return res.status(400).json({
              error: `Validation failed for claim ${id}`,
              details: validationErrors
            });
          }

          await sheetsService.updateClaim(id, recomputed, operatorEmail);
          successCount++;
        }
      }

      res.json({ success: true, updatedCount: successCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Bulk update failed" });
    }
  });

  // GET Payments
  app.get("/api/payments", async (req: AppRequest, res) => {
    try {
      const payments = await sheetsService.getPayments();
      const visibleClaimIds = new Set(filterClaimsForUser(await sheetsService.getClaims(), req.appUser).map(claim => claim.claim_id));
      res.json(payments.filter(payment => visibleClaimIds.has(payment.claim_id)));
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load payments" });
    }
  });

  // POST Create Payment and link to Claim
  app.post("/api/payments", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const paymentData = req.body as Payment;

      if (!paymentData.claim_id) {
        return res.status(400).json({ error: "Claim ID is required for a payment." });
      }
      if (!Number.isFinite(Number(paymentData.amount)) || Number(paymentData.amount) <= 0) {
        return res.status(400).json({ error: "Payment amount must be greater than zero." });
      }
      const paymentClaim = sheetsService.claims.find(c => c.claim_id === paymentData.claim_id && !c.deleted_flag);
      if (!paymentClaim) return res.status(404).json({ error: "Claim not found." });
      if (!canAccessClaim(req, paymentClaim)) {
        return res.status(403).json({ error: "This user does not have access to this provider." });
      }
      if (sheetsService.isPeriodClosed(claimPeriod(paymentClaim))) {
        return res.status(423).json({ error: `Period ${claimPeriod(paymentClaim)} is closed. Reopen the period before logging payments.` });
      }

      // Add payment
      const payment = await sheetsService.createPayment(paymentData);

      // Now we find the claim and add the payment to direct collections
      const claim = sheetsService.claims.find(c => c.claim_id === paymentData.claim_id);
      if (claim) {
        // Increase direct collections depending on who received the payment
        if (paymentData.payment_received_by === "ITERA") {
          claim.itera_direct_collection = Number((claim.itera_direct_collection + paymentData.amount).toFixed(2));
        } else {
          claim.provider_direct_collection = Number((claim.provider_direct_collection + paymentData.amount).toFixed(2));
        }

        // Adjust state variables based on payment
        claim.payment_date = paymentData.payment_date;
        claim.check_or_eft_number = paymentData.check_or_eft_number;
        claim.paid_amount = Number((claim.paid_amount + paymentData.amount).toFixed(2));
        claim.claim_classification = paymentData.payment_received_by === "ITERA" ? ClaimClassification.IteraCollected : ClaimClassification.ProviderCollected;
        
        // Recalculate everything else
        const settings = await sheetsService.getSettings();
        const calculated = calculateClaimFinancials(claim, buildReconciliationConfig(settings));

        // Save
        await sheetsService.updateClaim(claim.claim_id, calculated, operatorEmail);
      }

      res.status(211).json(payment);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to log payment" });
    }
  });

  // GET Notes
  app.get("/api/notes", async (req: AppRequest, res) => {
    try {
      const notes = await sheetsService.getNotes();
      const visibleClaimIds = new Set(filterClaimsForUser(await sheetsService.getClaims(), req.appUser).map(claim => claim.claim_id));
      res.json(notes.filter(note => visibleClaimIds.has(note.claim_id)));
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load notes" });
    }
  });

  // POST Create Note for Claim
  app.post("/api/notes", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const authorEmail = getOperatorEmail(req);
      const noteData = req.body as Note;

      if (!noteData.claim_id) {
        return res.status(400).json({ error: "Claim ID is required for a note." });
      }
      const noteClaim = sheetsService.claims.find(c => c.claim_id === noteData.claim_id && !c.deleted_flag);
      if (!noteClaim) return res.status(404).json({ error: "Claim not found." });
      if (!canAccessClaim(req, noteClaim)) {
        return res.status(403).json({ error: "This user does not have access to this provider." });
      }
      if (sheetsService.isPeriodClosed(claimPeriod(noteClaim))) {
        return res.status(423).json({ error: `Period ${claimPeriod(noteClaim)} is closed. Reopen the period before adding notes.` });
      }

      const note = await sheetsService.createNote(noteData, authorEmail);

      // Update claim's last_note
      const claim = sheetsService.claims.find(c => c.claim_id === noteData.claim_id);
      if (claim) {
        claim.last_note = noteData.note_text;
        // Simple update
        await sheetsService.updateClaim(claim.claim_id, claim, authorEmail);
      }

      res.status(211).json(note);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create note" });
    }
  });

  // GET Audit Logs
  app.get("/api/audit-logs", requireRoles(...API_ROLE_GROUPS.auditRead), async (req: AppRequest, res) => {
    try {
      const logs = await sheetsService.getAuditLogs();
      const visibleClaimIds = new Set(filterClaimsForUser(await sheetsService.getClaims(), req.appUser).map(claim => claim.claim_id));
      res.json(logs.filter(log => !log.claim_id || visibleClaimIds.has(log.claim_id)));
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load audit logs" });
    }
  });

  // GET Providers
  app.get("/api/providers", async (req: AppRequest, res) => {
    res.json(filterProvidersForUser(await sheetsService.getProviders(), req.appUser));
  });

  app.post("/api/providers", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      const provider = req.body as any;
      if (!provider.provider_id || !provider.provider_name || !provider.npi) {
        return res.status(400).json({ error: "Provider ID, name and NPI are required." });
      }
      res.status(201).json(await sheetsService.createProvider({ ...provider, active: provider.active !== false }));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create provider" });
    }
  });

  app.put("/api/providers/:id", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      res.json(await sheetsService.updateProvider(req.params.id, req.body));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update provider" });
    }
  });

  app.delete("/api/providers/:id", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      await sheetsService.deleteProvider(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete provider" });
    }
  });

  // GET Payers
  app.get("/api/payers", async (req, res) => {
    res.json(await sheetsService.getPayers());
  });

  app.post("/api/payers", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      const payer = req.body as Payer;
      if (!payer.payer_id?.trim() || !payer.payer_name?.trim() || !payer.payer_type?.trim()) {
        return res.status(400).json({ error: "Payer ID, name and type are required." });
      }
      res.status(201).json(await sheetsService.createPayer({ ...payer, active: payer.active !== false }));
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to create payer." });
    }
  });

  app.post("/api/payers/import-pverify", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (rows.length === 0) {
        return res.status(400).json({ error: "Rows are required for pVerify payer import." });
      }
      res.json(await sheetsService.importPverifyPayers(rows));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to import pVerify payers." });
    }
  });

  app.put("/api/payers/:id", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      res.json(await sheetsService.updatePayer(req.params.id, req.body));
    } catch (err: any) {
      res.status(404).json({ error: err.message || "Failed to update payer." });
    }
  });

  app.delete("/api/payers/:id", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      await sheetsService.deletePayer(req.params.id);
      res.status(204).send();
    } catch (err: any) {
      res.status(404).json({ error: err.message || "Failed to delete payer." });
    }
  });

  // GET Users
  app.get("/api/users", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    res.json(await sheetsService.getUsers());
  });

  app.post("/api/users", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      const user = req.body as any;
      if (!user.name?.trim() || !user.email?.trim() || !user.role) {
        return res.status(400).json({ error: "Name, email and role are required." });
      }
      if (!Object.values(UserRole).includes(user.role)) {
        return res.status(400).json({ error: "Invalid user role." });
      }
      res.status(201).json(await sheetsService.createUser({ ...user, active: user.active !== false }));
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to create user." });
    }
  });

  app.put("/api/users/:id", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      if (req.body.role && !Object.values(UserRole).includes(req.body.role)) {
        return res.status(400).json({ error: "Invalid user role." });
      }
      res.json(await sheetsService.updateUser(req.params.id, req.body));
    } catch (err: any) {
      res.status(404).json({ error: err.message || "Failed to update user." });
    }
  });

  app.delete("/api/users/:id", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      await sheetsService.deleteUser(req.params.id);
      res.status(204).send();
    } catch (err: any) {
      res.status(404).json({ error: err.message || "Failed to delete user." });
    }
  });

  app.post("/api/payment-reconciliation-import/apply-payer-change", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const claimId = textValue(req.body?.claimId);
      const reportPayerName = textValue(req.body?.reportPayerName);

      if (!claimId || !reportPayerName) {
        return res.status(400).json({ error: "claimId and reportPayerName are required." });
      }

      const claim = (await sheetsService.getClaims()).find(item => item.claim_id === claimId && !item.deleted_flag);
      if (!claim) return res.status(404).json({ error: "Claim not found." });
      if (!canAccessClaim(req, claim)) {
        return res.status(403).json({ error: "This user does not have access to this provider." });
      }
      if (sheetsService.isPeriodClosed(claimPeriod(claim))) {
        return res.status(423).json({ error: `Period ${claimPeriod(claim)} is closed. Reopen the period before changing claim insurance.` });
      }

      const payers = await sheetsService.getPayers();
      const matchedPayer = findMatchingPayer(payers, reportPayerName);
      const previousPayerId = claim.payer_id || "";
      const previousPayerName = claim.payer_name || previousPayerId || "Unknown";
      const newPayerId = matchedPayer?.payer_id || reportPayerName;
      const newPayerName = matchedPayer?.payer_name || reportPayerName;

      if (entityNamesMatch(previousPayerName || previousPayerId, newPayerName || newPayerId)) {
        return res.json({
          success: true,
          changed: false,
          claim,
          previousPayerId,
          previousPayerName,
          newPayerId,
          newPayerName,
          matchedCatalogPayer: Boolean(matchedPayer)
        });
      }

      const traceNote = `Payment Import payer update: ${previousPayerName} -> ${newPayerName}.`;
      const updated = await sheetsService.updateClaim(claimId, {
        ...claim,
        payer_id: newPayerId,
        payer_name: newPayerName,
        last_note: `${traceNote} ${claim.last_note || ""}`.trim()
      }, operatorEmail);

      await sheetsService.addAuditLog({
        audit_id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        claim_id: updated.claim_id,
        action_type: "Update",
        field_name: "payer_id",
        previous_value: previousPayerId,
        new_value: newPayerId,
        reason: `Insurance changed from "${previousPayerName}" to "${newPayerName}" from Payment Import report.`,
        changed_by: operatorEmail,
        changed_at: new Date().toISOString()
      });

      res.json({
        success: true,
        changed: true,
        claim: updated,
        previousPayerId,
        previousPayerName,
        newPayerId,
        newPayerName,
        matchedCatalogPayer: Boolean(matchedPayer)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to apply payer change." });
    }
  });

  // GET Settings
  app.get("/api/settings", async (req, res) => {
    res.json(await sheetsService.getSettings());
  });

  // PUT Settings
  app.put("/api/settings", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      const { key, value } = req.body;
      const updated = await sheetsService.updateSettings(key, value);
      let recalculatedClaims = 0;
      if ([
        "PROVIDER_SHARE_PERCENT",
        "ITERA_SHARE_PERCENT",
        "CONTRACT_PAYMENT_MODEL",
        "ITERA_FEE_WHEN_PROVIDER_BILLS",
        "PHYSICIAN_FEE_WHEN_ITERA_BILLS"
      ].includes(textValue(key))) {
        const settings = await sheetsService.getSettings();
        const config = buildReconciliationConfig(settings);
        const claims = await sheetsService.getClaims(true);
        const recalculated = claims
          .filter(claim => !claim.deleted_flag && !sheetsService.isPeriodClosed(claimPeriod(claim)))
          .map(claim => calculateClaimFinancials(claim, config));
        recalculatedClaims = await sheetsService.replaceClaimsFinancials(
          recalculated,
          getOperatorEmail(req as AppRequest),
          `Contract setting ${key} changed. Open-period claim financials recalculated.`
        );
      }
      res.json({ ...updated, recalculatedClaims });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update setting" });
    }
  });

  // GET Fee Schedules
  app.get("/api/fee-schedules", async (req, res) => {
    try {
      res.json(await sheetsService.getFeeSchedules());
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to retrieve fee schedules" });
    }
  });

  app.get("/api/report-fee-schedules", async (_req, res) => {
    res.json(await sheetsService.getReportFeeSchedules());
  });

  app.get("/api/eligibility-coverage", async (_req, res) => {
    res.json(await sheetsService.getEligibilityCoverage());
  });

  // POST Create Fee Schedule
  app.post("/api/fee-schedules", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      const created = await sheetsService.createFeeSchedule(req.body);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to create fee schedule" });
    }
  });

  // PUT Update Fee Schedule
  app.put("/api/fee-schedules/:id", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      const updated = await sheetsService.updateFeeSchedule(req.params.id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to update fee schedule" });
    }
  });

  // DELETE Fee Schedule
  app.delete("/api/fee-schedules/:id", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req, res) => {
    try {
      const success = await sheetsService.deleteFeeSchedule(req.params.id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete fee schedule" });
    }
  });

  // POST Import Claims CSV
  app.post("/api/import-csv", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const { rows, fileBase64, retryRows, fileName } = req.body;
      const retryRowSet = Array.isArray(retryRows)
        ? new Set(retryRows.map(row => Number(row)).filter(row => Number.isFinite(row) && row > 0))
        : null;
      const parsedRows = fileBase64 ? parseXlsxRows(fileBase64) : rows;
      const importRows = retryRowSet
        ? parsedRows?.filter((_: unknown, index: number) => retryRowSet.has(index + 1))
        : parsedRows;

      if (!importRows || !Array.isArray(importRows)) {
        return res.status(400).json({ error: "Rows or XLSX file content are required for import." });
      }

      const settings = await sheetsService.getSettings();
      const reconciliationConfig = buildReconciliationConfig(settings);
      const providers = await sheetsService.getProviders();
      const payers = await sheetsService.getPayers();
      const feeSchedules = await sheetsService.getFeeSchedules();
      const existingClaims = await sheetsService.getClaims();

      const claimsToImport: Claim[] = [];
      const errors: { row: number; claimId?: string; errors: string[] }[] = [];

      for (let i = 0; i < importRows.length; i++) {
        const row = importRows[i];
        const rowErrors: string[] = [];
        const isBillingWorklist = !!(
          importField(row, ["MRN"]) ||
          importField(row, ["Provider NPI"]) ||
          importField(row, ["Code1"]) ||
          importField(row, ["Month Of"])
        );

        if (isBillingWorklist) {
          const mrn = importField(row, ["MRN"]);
          const providerNpi = importField(row, ["Provider NPI"]);
          const payerCode = importField(row, ["Primary Insurance Code", "Primary Insurance", "Insurance Code", "Payer ID"]);
          const monthDate = excelSerialToIsoDate(importField(row, ["Month Of"]));
          const serviceFrom = firstDayOfMonth(monthDate);
          const serviceTo = monthDate || serviceFrom;
          const year = Number((serviceTo || serviceFrom).slice(0, 4));
          const month = Number((serviceTo || serviceFrom).slice(5, 7));
          const isSemester2 = month >= 7;
          const provider = providers.find(item => item.npi === providerNpi && item.active !== false);
          const payer = payers.find(item =>
            item.active !== false &&
            (
              equivalentExternalCode(item.payer_id, payerCode) ||
              equivalentExternalCode(item.pverify_payer_code, payerCode) ||
              equivalentExternalCode(item.payer_name, payerCode)
            )
          );
          const codes = ["Code1", "Code2", "Code3", "Code4", "Code5", "Code6"]
            .map(key => importField(row, [key]))
            .filter(Boolean);

          if (!mrn) rowErrors.push("MRN is required.");
          if (!providerNpi) rowErrors.push("Provider NPI is required.");
          if (!provider) rowErrors.push(`Provider NPI ${providerNpi || "(blank)"} is not registered in Settings.`);
          if (provider && !canUserAccessProvider(req.appUser || {}, provider.provider_id, provider.npi)) {
            rowErrors.push(`Current user does not have access to provider ${provider.provider_name}.`);
          }
          if (!payerCode) rowErrors.push("Primary Insurance Code is required.");
          if (!payer) rowErrors.push(`Primary Insurance Code ${payerCode || "(blank)"} is not registered in Settings.`);
          if (!serviceTo) rowErrors.push("Month Of is required.");
          if (codes.length === 0) rowErrors.push("At least one CPT code is required.");

          const feeFallbackNotes: string[] = [];
          const unitsByCode = codes.reduce<Record<string, number>>((acc, code) => {
            acc[code] = (acc[code] || 0) + 1;
            return acc;
          }, {});
          const uniqueCodes = Object.keys(unitsByCode);
          const serviceLines = uniqueCodes.map(code => {
            const feeCandidates = feeSchedules
              .filter(item => textValue(item.cpt_code) === code)
              .sort((a, b) => Math.abs(Number(a.year) - year) - Math.abs(Number(b.year) - year));
            const exactFee = feeCandidates.find(item => Number(item.year) === year);
            const fee = exactFee || feeCandidates[0];
            if (!fee) {
              rowErrors.push(`Fee Schedule missing for CPT ${code}.`);
              return null;
            }
            if (!exactFee) {
              feeFallbackNotes.push(`CPT ${code} used ${fee.year} fee because ${year} fee was not found`);
            }
            const rate = Number(isSemester2 ? fee.semester2_rate : fee.semester1_rate);
            const units = unitsByCode[code];
            const charged = Number((rate * units).toFixed(2));
            return {
              cpt: code,
              units,
              charged,
              allowed: charged,
              adj: 0,
              patResp: 0,
              paid: 0,
              secondaryPaid: 0,
              balance: charged,
              codes: [],
              status: "Not Billed",
              nextAction: "No action",
              notes: [],
              eftNumber: "",
              paymentDate: "",
              hasSecondaryPayment: false,
              secondaryPayerId: ""
            };
          }).filter(Boolean) as any[];

          if (rowErrors.length > 0) {
            errors.push({ row: i + 1, claimId: mrn ? `MRN ${mrn}` : undefined, errors: rowErrors });
            continue;
          }

          const billedCharge = Number(serviceLines.reduce((sum, line) => sum + Number(line.charged || 0), 0).toFixed(2));
          const claimId = generateClaimId(
            [...existingClaims, ...claimsToImport].map(claim => claim.claim_id),
            mrn,
            serviceTo
          );
          const claimObj: Partial<Claim> = {
            claim_id: claimId,
            patient_id: mrn,
            patient_display_name_masked: importField(row, ["Patient"]) || `${importField(row, ["First Name"])} ${importField(row, ["Last Name"])}`.trim() || `MRN ${mrn}`,
            practice_id: provider!.practice_id,
            practice_name: provider!.practice_name,
            provider_id: provider!.provider_id,
            provider_name: provider!.provider_name,
            provider_npi: provider!.npi,
            payer_id: payer!.payer_id,
            payer_name: String(row["Primary Insurance Name"] || payer!.payer_name).trim() || payer!.payer_name,
            service_type: importField(row, ["Service"]) || "CCM",
            cpt_hcpcs: uniqueCodes.join(", "),
            modifiers: "",
            units: serviceLines.reduce((sum, line) => sum + Number(line.units || 1), 0),
            date_of_service_from: serviceFrom,
            date_of_service_to: serviceTo,
            month_of_service: serviceTo.slice(0, 7),
            billed_by: "ITERA",
            payment_received_by: "Unknown",
            claim_status: ClaimStatus.Draft,
            claim_classification: ClaimClassification.CleanClaim,
            billed_charge: billedCharge,
            allowed_amount: billedCharge,
            paid_amount: 0,
            insurance_adjustment: 0,
            denied_amount: 0,
            write_off_amount: 0,
            uncollectible_amount: 0,
            itera_direct_collection: 0,
            provider_direct_collection: 0,
            payment_to_physician: 0,
            era_received: "No",
            eob_received: "No",
            payment_date: "",
            check_or_eft_number: "",
            carc_code: "",
            rarc_code: "",
            denial_reason: "",
            error_flag: false,
            error_category: "",
            locked: false,
            lock_reason: "",
            correction_status: "",
            resubmission_date: "",
            corrected_claim_reference: "",
            last_note: `Imported as Draft from billing worklist. Primary Insurance Code: ${payerCode || "N/A"}. Care Manager: ${importField(row, ["Care Manager"]) || "N/A"}. Sex: ${importField(row, ["Sex"]) || "N/A"}. DOB: ${excelSerialToIsoDate(importField(row, ["Date of Birth"])) || importField(row, ["Date of Birth"]) || "N/A"}.${feeFallbackNotes.length > 0 ? ` Fee fallback: ${feeFallbackNotes.join("; ")}.` : ""}`,
            service_lines_json: JSON.stringify(serviceLines)
          };

          const calculated = calculateClaimFinancials(claimObj, reconciliationConfig);
          const validationErrors = validateClaim(calculated);
          validationErrors.push(...validateClaimCptRepeatLimits(calculated, feeSchedules));
          validationErrors.push(...validateClaimCptRepeatLimitsAgainstExisting(
            calculated,
            feeSchedules,
            [...existingClaims, ...claimsToImport]
          ));
          if (validationErrors.length > 0) {
            errors.push({ row: i + 1, claimId: calculated.claim_id, errors: validationErrors });
          } else {
            claimsToImport.push(calculated);
          }
          continue;
        }
        
        // Parse CSV fields
        const claimObj: Partial<Claim> = {
          claim_id: row.claim_id?.trim(),
          patient_id: row.patient_id?.trim() || `PAT-${Math.floor(Math.random() * 10000)}`,
          patient_display_name_masked: row.patient_display_name_masked?.trim() || "P*** N**",
          practice_id: row.practice_id?.trim() || "PRAC_01",
          practice_name: row.practice_name?.trim() || "Metropolitan Care Group",
          provider_id: row.provider_id?.trim() || "PROV_01",
          provider_name: row.provider_name?.trim() || "Dr. Robert Chen",
          provider_npi: row.provider_npi?.trim() || "1982736450",
          payer_id: row.payer_id?.trim() || "PAY_01",
          payer_name: row.payer_name?.trim() || "Medicare Texas (Novitas)",
          service_type: row.service_type?.trim() || "CCM",
          cpt_hcpcs: row.cpt_hcpcs?.trim() || "99490",
          modifiers: row.modifiers?.trim() || "",
          units: Number(row.units || 1),
          date_of_service_from: row.date_of_service_from?.trim() || new Date().toISOString().split("T")[0],
          date_of_service_to: row.date_of_service_to?.trim() || new Date().toISOString().split("T")[0],
          month_of_service: row.month_of_service?.trim() || new Date().toISOString().slice(0, 7),
          billed_by: (row.billed_by?.trim() === "Provider" ? "Provider" : "ITERA") as any,
          payment_received_by: (["ITERA", "Provider", "Split", "Unknown"].includes(row.payment_received_by) ? row.payment_received_by : "Unknown") as any,
          claim_status: (row.claim_status?.trim() || ClaimStatus.Submitted) as any,
          claim_classification: (row.claim_classification?.trim() || ClaimClassification.CleanClaim) as any,
          billed_charge: Number(row.billed_charge || 150),
          allowed_amount: Number(row.allowed_amount || 0),
          paid_amount: Number(row.paid_amount || 0),
          insurance_adjustment: Number(row.insurance_adjustment || 0),
          denied_amount: Number(row.denied_amount || 0),
          write_off_amount: Number(row.write_off_amount || 0),
          uncollectible_amount: Number(row.uncollectible_amount || 0),
          itera_direct_collection: Number(row.itera_direct_collection || 0),
          provider_direct_collection: Number(row.provider_direct_collection || 0),
          payment_to_physician: Number(row.payment_to_physician || 0),
          era_received: (row.era_received === "Yes" ? "Yes" : "No") as any,
          eob_received: (row.eob_received === "Yes" ? "Yes" : "No") as any,
          payment_date: row.payment_date?.trim() || "",
          check_or_eft_number: row.check_or_eft_number?.trim() || "",
          carc_code: row.carc_code?.trim() || "",
          rarc_code: row.rarc_code?.trim() || "",
          denial_reason: row.denial_reason?.trim() || "",
          error_flag: row.error_flag === "true" || row.error_flag === true,
          error_category: row.error_category?.trim() || "",
          locked: row.locked === "true" || row.locked === true,
          lock_reason: row.lock_reason?.trim() || "",
          correction_status: row.correction_status?.trim() || "",
          resubmission_date: row.resubmission_date?.trim() || "",
          corrected_claim_reference: row.corrected_claim_reference?.trim() || "",
          last_note: row.last_note?.trim() || "Imported via CSV file.",
        };

        // Recalculate
        const calculated = calculateClaimFinancials(claimObj, reconciliationConfig);

        // Validate
        const validationErrors = validateClaim(calculated);
        validationErrors.push(...(!canUserAccessProvider(req.appUser || {}, calculated.provider_id, calculated.provider_npi)
          ? ["Current user does not have access to this provider."]
          : []));
        if (sheetsService.isPeriodClosed(claimPeriod(calculated))) {
          validationErrors.push(`Period ${claimPeriod(calculated)} is closed. Reopen the period before importing this claim.`);
        }
        validationErrors.push(...validateClaimCptRepeatLimits(calculated, feeSchedules));
        validationErrors.push(...validateClaimCptRepeatLimitsAgainstExisting(
          calculated,
          feeSchedules,
          [...existingClaims, ...claimsToImport]
        ));
        if (validationErrors.length > 0) {
          errors.push({ row: i + 1, claimId: calculated.claim_id, errors: validationErrors });
        } else {
          claimsToImport.push(calculated);
        }
      }

      let importedClaims: Claim[] = [];
      if (claimsToImport.length > 0) {
        importedClaims = await sheetsService.createClaimsBulk(claimsToImport, operatorEmail);
      }

      const summary = summarizeImport(importRows, importedClaims, errors);
      await sheetsService.createJob({
        job_type: retryRowSet ? "Claims corrected rows import" : "Claims import",
        status: errors.length > 0 ? "failed" : "completed",
        requested_by: operatorEmail,
        progress: 100,
        summary_json: JSON.stringify(summary),
        error_message: errors.length > 0 ? `${errors.length} rejected row(s)` : ""
      });
      await sheetsService.createImportHistory({
        import_type: retryRowSet ? "Claims corrected rows" : "Claims",
        file_name: textValue(fileName),
        requested_by: operatorEmail,
        total_rows: Number(summary.totalRowsRead || importRows.length || 0),
        imported_rows: importedClaims.length,
        rejected_rows: errors.length,
        review_rows: 0,
        total_amount: Number(summary.totalBilledChargeImported || 0),
        summary_json: JSON.stringify(summary),
        status: errors.length > 0 ? "Completed with errors" : "Completed"
      });
      await sheetsService.addUserActivityLog({
        user_email: operatorEmail,
        action: retryRowSet ? "Import corrected claim rows" : "Import claims",
        entity_type: "Import",
        entity_id: textValue(fileName),
        metadata_json: JSON.stringify({ importedCount: importedClaims.length, errorCount: errors.length })
      });

      res.json({
        success: errors.length === 0 && summary.allRowsAccounted,
        importedCount: importedClaims.length,
        errorCount: errors.length,
        errors: errors,
        summary
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Import process failed" });
    }
  });

  app.post("/api/payment-reconciliation-import/analyze-schema", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const { rows, fileBase64, fileName } = req.body;
      const importRows = fileBase64 ? parseUploadedTableRows(fileBase64, textValue(fileName)) : rows;
      if (!importRows || !Array.isArray(importRows)) {
        return res.status(400).json({ error: "Rows or XLSX file content are required for payment import schema analysis." });
      }

      const headers = getUploadedTableHeaders(importRows);
      const headersSignature = paymentImportHeadersSignature(headers);
      const autoMapping = autoDetectPaymentImportMapping(headers);
      const requirements = paymentImportMappingIssues(autoMapping);
      const templates = (await sheetsService.getImportMappingTemplates("Payment Import")).map(template => ({
        templateId: template.template_id,
        templateName: template.template_name,
        providerName: template.provider_name,
        systemName: template.system_name,
        headersSignature: template.headers_signature,
        mapping: (() => {
          try {
            return JSON.parse(template.mapping_json || "{}");
          } catch {
            return {};
          }
        })(),
        exactHeaderMatch: template.headers_signature === headersSignature
      }));
      const preferredTemplate = templates.find(template => template.exactHeaderMatch);
      const mapping = preferredTemplate?.mapping || autoMapping;
      const finalRequirements = paymentImportMappingIssues(mapping);
      const previewRows = fillDownPaymentImportRows(
        importRows.slice(0, 5).map((row: Record<string, unknown>, index: number) => normalizePaymentImportRow(row, index, mapping))
      );

      res.json({
        success: true,
        headers,
        headersSignature,
        fieldLabels: PAYMENT_IMPORT_FIELD_LABELS,
        requiredFields: PAYMENT_IMPORT_REQUIRED_FIELDS,
        paymentFields: PAYMENT_IMPORT_PAYMENT_FIELDS,
        autoMapping,
        mapping,
        requirements: finalRequirements,
        templates,
        selectedTemplateId: preferredTemplate?.templateId || "",
        previewRows
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Payment import schema analysis failed." });
    }
  });

  app.post("/api/payment-reconciliation-import/templates", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const { templateName, providerName, systemName, headersSignature, mapping } = req.body;
      if (!mapping || typeof mapping !== "object") {
        return res.status(400).json({ error: "A column mapping is required." });
      }
      const requirements = paymentImportMappingIssues(mapping);
      if (!requirements.valid) {
        return res.status(400).json({ error: "The mapping is incomplete. Patient account, CPT, service date and a payment amount source are required." });
      }
      const saved = await sheetsService.createImportMappingTemplate({
        template_name: textValue(templateName) || "Payment import mapping",
        import_type: "Payment Import",
        provider_name: textValue(providerName),
        system_name: textValue(systemName),
        headers_signature: textValue(headersSignature),
        mapping_json: JSON.stringify(mapping),
        created_by: operatorEmail
      });
      await sheetsService.addUserActivityLog({
        user_email: operatorEmail,
        action: "Create payment import mapping template",
        entity_type: "Import_Mapping_Template",
        entity_id: saved.template_id,
        metadata_json: JSON.stringify({ templateName: saved.template_name, systemName: saved.system_name })
      });
      res.json({ success: true, template: saved });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Payment import mapping template could not be saved." });
    }
  });

  app.put("/api/payment-reconciliation-import/templates/:templateId", requireRoles(...API_ROLE_GROUPS.billingAdmin), async (req: AppRequest, res) => {
    try {
      const updates: any = {};
      if (req.body?.template_name !== undefined || req.body?.templateName !== undefined) {
        updates.template_name = textValue(req.body?.template_name ?? req.body?.templateName);
      }
      if (req.body?.provider_name !== undefined || req.body?.providerName !== undefined) {
        updates.provider_name = textValue(req.body?.provider_name ?? req.body?.providerName);
      }
      if (req.body?.system_name !== undefined || req.body?.systemName !== undefined) {
        updates.system_name = textValue(req.body?.system_name ?? req.body?.systemName);
      }
      if (req.body?.active !== undefined) updates.active = Boolean(req.body.active);
      const updated = await sheetsService.updateImportMappingTemplate(req.params.templateId, updates);
      if (!updated) return res.status(404).json({ error: "Payment import template not found." });
      await sheetsService.addUserActivityLog({
        user_email: getOperatorEmail(req),
        action: "Update payment import mapping template",
        entity_type: "Import_Mapping_Template",
        entity_id: updated.template_id,
        metadata_json: JSON.stringify(updates)
      });
      res.json({ success: true, template: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Payment import template could not be updated." });
    }
  });

  app.post("/api/payment-reconciliation-import", requireRoles(...API_ROLE_GROUPS.claimWrite), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const { rows, fileBase64, apply, fileName, mapping } = req.body;
      const importRows = fileBase64 ? parseUploadedTableRows(fileBase64, textValue(fileName)) : rows;

      if (!importRows || !Array.isArray(importRows)) {
        return res.status(400).json({ error: "Rows or XLSX file content are required for payment reconciliation import." });
      }
      const importMapping = mapping && typeof mapping === "object" ? mapping as PaymentImportMapping : undefined;
      if (importMapping) {
        const mappingIssues = paymentImportMappingIssues(importMapping);
        if (!mappingIssues.valid) {
          return res.status(400).json({ error: "The payment import column mapping is incomplete. Patient account, CPT, service date and a payment amount source are required." });
        }
      }

      const settings = await sheetsService.getSettings();
      const reconciliationConfig = buildReconciliationConfig(settings);
      const claims = (await sheetsService.getClaims()).filter(claim => !claim.deleted_flag);
      const payments = await sheetsService.getPayments();
      const payers = await sheetsService.getPayers();
      const existingPaymentById = new Map(
        payments
          .map(payment => [textValue(payment.payment_id).toLowerCase(), payment] as const)
          .filter(([paymentId]) => Boolean(paymentId))
      );

      const normalizedRows = fillDownPaymentImportRows(
        importRows.map((row: Record<string, unknown>, index: number) => normalizePaymentImportRow(row, index, importMapping))
      );
      const analyzedRows = normalizedRows.map(row => {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!row.cptCode) errors.push("CPT Code is required.");
        if (!row.serviceDate) errors.push("Service Date is required.");
        if (!row.paymentDate) warnings.push("Payment date is missing; today's date will be used if imported.");
        if (!Number.isFinite(row.payment) || row.payment <= 0) errors.push("Payment amount must be greater than zero.");

        const claimNo = normalizeMatchText(row.claimNo);
        const patientAcct = normalizeMatchText(row.patientAcctNo);
        const payerName = normalizeMatchText(row.payerName);
        const providerName = normalizeMatchText(row.renderingProviderName);
        const cptCode = textValue(row.cptCode);

        const matchesOperationalKeys = (claim: Claim) => {
          const samePatient = patientAcct && normalizeMatchText(claim.patient_id) === patientAcct;
          const claimDosFrom = textValue(claim.date_of_service_from).slice(0, 10);
          const claimDosTo = textValue(claim.date_of_service_to).slice(0, 10);
          const claimMonth = textValue(claim.month_of_service).slice(0, 7);
          const rowMonth = row.serviceDate ? row.serviceDate.slice(0, 7) : "";
          const sameDos = row.serviceDate && (
            claimDosFrom === row.serviceDate ||
            claimDosTo === row.serviceDate ||
            (claimMonth && rowMonth && claimMonth === rowMonth)
          );
          return Boolean(samePatient && sameDos);
        };

        let candidates = claims.filter(claim => {
          const serviceLines = parseServiceLines(claim);
          const hasCpt = serviceLines.some(line => textValue(line?.cpt) === cptCode);
          if (!hasCpt) return false;

          if (claimNo) {
            return normalizeMatchText(claim.claim_id) === claimNo;
          }

          return matchesOperationalKeys(claim);
        });

        if (claimNo && candidates.length === 0) {
          candidates = claims.filter(claim => {
            const serviceLines = parseServiceLines(claim);
            const hasCpt = serviceLines.some(line => textValue(line?.cpt) === cptCode);
            return hasCpt && matchesOperationalKeys(claim);
          });
          if (candidates.length > 0) {
            warnings.push("External Claim No did not match the internal claim ID; matched by Patient Acct No, CPT and DOS instead.");
          }
        }

        if (candidates.length > 1 && payerName) {
          const payerFiltered = candidates.filter(claim => entityNamesMatch(claim.payer_name, payerName));
          if (payerFiltered.length > 0) candidates = payerFiltered;
        }
        if (candidates.length > 1 && providerName) {
          const providerFiltered = candidates.filter(claim => normalizeMatchText(claim.provider_name).includes(providerName) || providerName.includes(normalizeMatchText(claim.provider_name)));
          if (providerFiltered.length > 0) candidates = providerFiltered;
        }
        candidates = candidates.filter(claim => canAccessClaim(req, claim));

        const claim = candidates.length === 1 ? candidates[0] : null;
        const serviceLines = claim ? parseServiceLines(claim) : [];
        const sameCptLineIndexes = claim
          ? serviceLines
              .map((line, index) => ({ line, index }))
              .filter(item => textValue(item.line?.cpt) === cptCode)
              .map(item => item.index)
          : [];
        const unpaidLineIndex = sameCptLineIndexes.find(index => linePaymentTotal(serviceLines[index]) <= 0);
        const lineIndex = unpaidLineIndex ?? sameCptLineIndexes[0] ?? -1;
        const targetLine = lineIndex >= 0 ? serviceLines[lineIndex] : null;
        const existingPayment = row.externalPaymentId
          ? existingPaymentById.get(row.externalPaymentId.toLowerCase()) || null
          : null;

        if (errors.length === 0 && candidates.length === 0) {
          errors.push(`No matching claim/CPT found for Patient Acct No ${row.patientAcctNo || "blank"}, CPT ${cptCode || "blank"} and DOS ${row.serviceDate || "blank"}.`);
        }
        if (errors.length === 0 && candidates.length > 1) errors.push("Multiple matching claims found; requires human review.");
        if (errors.length === 0 && claim && !canAccessClaim(req, claim)) errors.push("Current user does not have access to the matched provider.");
        if (errors.length === 0 && claim && sheetsService.isPeriodClosed(claimPeriod(claim))) {
          errors.push(`Period ${claimPeriod(claim)} is closed. Reopen the period before importing payment activity.`);
        }
        if (errors.length === 0 && claim && lineIndex < 0) errors.push("Matched claim does not contain the CPT code.");
        if (errors.length === 0 && claim && existingPayment && existingPayment.claim_id !== claim.claim_id) {
          errors.push(`Payment ID ${row.externalPaymentId} already exists in Payments for claim ${existingPayment.claim_id || "unknown"}.`);
        }
        if (errors.length === 0 && claim && existingPayment && existingPayment.claim_id === claim.claim_id) {
          warnings.push(`Payment ID ${row.externalPaymentId} already exists in Payments for this claim; the import will update the unpaid CPT line without creating a duplicate payment record.`);
        }

        const claimPayerName = claim?.payer_name || "";
        const reportPayerName = row.payerName || "";
        const payerMismatch = Boolean(claim && reportPayerName && claimPayerName && !entityNamesMatch(claimPayerName, reportPayerName));
        const suggestedPayer = payerMismatch ? findMatchingPayer(payers, reportPayerName) : null;
        if (payerMismatch) {
          warnings.push(`Payer mismatch: claim has "${claimPayerName}", report has "${reportPayerName}".`);
        }

        const hasExistingPayment = Boolean(
          claim && linePaymentTotal(targetLine) > 0
        );
        if (errors.length === 0 && hasExistingPayment) {
          warnings.push("Matched claim/CPT already has payment activity. It was not overwritten.");
        }

        return {
          ...row,
          claimId: claim?.claim_id || "",
          patientId: claim?.patient_id || row.patientAcctNo || "",
          patientName: row.patientName || claim?.patient_display_name_masked || "",
          providerName: claim?.provider_name || row.renderingProviderName || "",
          payerName: claim?.payer_name || row.payerName || "",
          claimPayerName,
          reportPayerName,
          payerMismatch,
          suggestedPayerId: suggestedPayer?.payer_id || "",
          suggestedPayerName: suggestedPayer?.payer_name || reportPayerName,
          existingPaymentId: existingPayment?.payment_id || "",
          existingPaymentClaimId: existingPayment?.claim_id || "",
          lineIndex,
          status: errors.length > 0 ? "rejected" : (hasExistingPayment || payerMismatch ? "needs_review" : "ready"),
          errors,
          warnings
        };
      });

      const readyRows = analyzedRows.filter(row => row.status === "ready");
      const reviewRows = analyzedRows.filter(row => row.status === "needs_review");
      const rejectedRows = analyzedRows.filter(row => row.status === "rejected");
      const importedPayments: Payment[] = [];
      const updatedClaims: Claim[] = [];

      if (apply && readyRows.length > 0) {
        const rowsByClaim = readyRows.reduce<Record<string, typeof readyRows>>((acc, row) => {
          if (!row.claimId) return acc;
          acc[row.claimId] = acc[row.claimId] || [];
          acc[row.claimId].push(row);
          return acc;
        }, {});

        for (const [claimId, claimRows] of Object.entries(rowsByClaim)) {
          const claim = claims.find(item => item.claim_id === claimId);
          if (!claim) continue;
          let serviceLines = parseServiceLines(claim);
          let claimPaymentTotal = 0;
          let latestPaymentDate = claim.payment_date || "";
          let latestCheckNo = claim.check_or_eft_number || "";
          const lineAllocations = new Map<number, {
            rows: typeof claimRows;
            totalPayment: number;
            payerPayment: number;
            patientPayment: number;
            contractualAdjustment: number;
          }>();

          const addLineAllocation = (index: number, row: typeof claimRows[number]) => {
            const current = lineAllocations.get(index) || {
              rows: [],
              totalPayment: 0,
              payerPayment: 0,
              patientPayment: 0,
              contractualAdjustment: 0
            };
            current.rows.push(row);
            current.totalPayment = Number((current.totalPayment + Number(row.payment || 0)).toFixed(2));
            current.payerPayment = Number((current.payerPayment + Number(row.payerPayment || 0)).toFixed(2));
            current.patientPayment = Number((current.patientPayment + Number(row.patientPayment || 0)).toFixed(2));
            current.contractualAdjustment = Number((current.contractualAdjustment + Number(row.contractualAdjustment || 0)).toFixed(2));
            lineAllocations.set(index, current);
          };

          for (const row of claimRows) {
            const sameCptIndexes = serviceLines
              .map((line, index) => ({ line, index }))
              .filter(item => textValue(item.line?.cpt) === textValue(row.cptCode))
              .map(item => item.index);
            const targetIndex = sameCptIndexes.find(index =>
              !lineAllocations.has(index) && linePaymentTotal(serviceLines[index]) <= 0
            ) ?? sameCptIndexes.find(index => !lineAllocations.has(index)) ?? row.lineIndex;
            if (targetIndex >= 0) addLineAllocation(targetIndex, row);
          }

          serviceLines = serviceLines.map((line, index) => {
            const allocation = lineAllocations.get(index);
            if (!allocation) return line;
            const matchingRows = allocation.rows;
            const totalPayment = allocation.totalPayment;
            const payerPayment = allocation.payerPayment;
            const patientPayment = allocation.patientPayment;
            const contractualAdjustment = allocation.contractualAdjustment;
            const charged = Number(line?.charged || 0);
            const paid = Number((Number(line?.paid || 0) + totalPayment).toFixed(2));
            const maxAdjustment = Number(Math.max(0, charged - paid - Number(line?.secondaryPaid || 0) - Number(line?.patResp || 0)).toFixed(2));
            const adj = contractualAdjustment > 0
              ? Number(Math.min(contractualAdjustment, maxAdjustment).toFixed(2))
              : Number(line?.adj || 0);
            const allowed = Number(Math.max(0, charged - adj).toFixed(2));
            const balance = Number(Math.max(0, charged - adj - paid - Number(line?.secondaryPaid || 0) - Number(line?.patResp || 0)).toFixed(2));
            const notes = Array.isArray(line?.notes) ? [...line.notes] : [];
            notes.push(`Payment Import: payer ${payerPayment.toFixed(2)}, patient ${patientPayment.toFixed(2)}, contractual adjustment applied ${adj.toFixed(2)}${contractualAdjustment > adj ? ` (report adjustment ${contractualAdjustment.toFixed(2)} exceeded this CPT line capacity)` : ""}.`);
            claimPaymentTotal = Number((claimPaymentTotal + totalPayment).toFixed(2));
            const paymentDate = matchingRows.map(row => row.paymentDate).filter(Boolean).sort().pop() || "";
            const checkNo = matchingRows.map(row => row.checkNo).filter(Boolean).pop() || "";
            if (paymentDate) latestPaymentDate = paymentDate;
            if (checkNo) latestCheckNo = checkNo;
            return {
              ...line,
              charged,
              allowed,
              adj,
              paid,
              balance,
              paymentDate: paymentDate || line?.paymentDate || "",
              eftNumber: checkNo || line?.eftNumber || "",
              status: balance <= 0 ? "Paid" : "Partially Paid",
              nextAction: balance <= 0 ? "No action" : (line?.nextAction || "Monitor payment"),
              notes
            };
          });

          const totalLineCharged = Number(serviceLines.reduce((sum, line) => sum + Number(line.charged || 0), 0).toFixed(2));
          const totalLineAllowed = Number(serviceLines.reduce((sum, line) => sum + Number(line.allowed || 0), 0).toFixed(2));
          const totalLinePaid = Number(serviceLines.reduce((sum, line) => sum + Number(line.paid || 0) + Number(line.secondaryPaid || 0), 0).toFixed(2));
          const totalLineAdj = Number(serviceLines.reduce((sum, line) => sum + Number(line.adj || 0), 0).toFixed(2));
          const allLinesPaid = serviceLines.every(line => textValue(line.status) === "Paid");
          const paymentReceivedBy = claim.billed_by === "Provider" ? "Provider" : "ITERA";

          const updated = calculateClaimFinancials({
            ...claim,
            service_lines_json: JSON.stringify(serviceLines),
            billed_charge: totalLineCharged || claim.billed_charge,
            allowed_amount: totalLineAllowed,
            paid_amount: totalLinePaid,
            insurance_adjustment: totalLineAdj,
            itera_direct_collection: paymentReceivedBy === "ITERA"
              ? Number((Number(claim.itera_direct_collection || 0) + claimPaymentTotal).toFixed(2))
              : Number(claim.itera_direct_collection || 0),
            provider_direct_collection: paymentReceivedBy === "Provider"
              ? Number((Number(claim.provider_direct_collection || 0) + claimPaymentTotal).toFixed(2))
              : Number(claim.provider_direct_collection || 0),
            payment_received_by: paymentReceivedBy,
            claim_status: allLinesPaid ? ClaimStatus.Paid : ClaimStatus.PartiallyPaid,
            claim_classification: paymentReceivedBy === "ITERA" ? ClaimClassification.IteraCollected : ClaimClassification.ProviderCollected,
            era_received: "No",
            eob_received: claimRows.some(row => row.paymentDate) ? "Yes" : claim.eob_received,
            payment_date: latestPaymentDate || new Date().toISOString().slice(0, 10),
            check_or_eft_number: latestCheckNo,
            last_note: `Payment Import applied ${claimRows.length} payment row(s). ${claim.last_note || ""}`.trim()
          }, reconciliationConfig);

          const validationErrors = validateClaim(updated);
          if (validationErrors.length > 0) {
            claimRows.forEach(row => {
              row.status = "rejected";
              row.errors = validationErrors;
            });
            continue;
          }

          const savedClaim = await sheetsService.updateClaim(claimId, updated, operatorEmail);
          updatedClaims.push(savedClaim);

          for (const row of claimRows) {
            const existingPayment = row.externalPaymentId
              ? existingPaymentById.get(row.externalPaymentId.toLowerCase()) || null
              : null;
            if (!existingPayment || existingPayment.claim_id !== claimId) {
              const payment: Payment = {
                payment_id: row.externalPaymentId || `PMT-IMP-${Date.now()}-${row.rowNumber}`,
                claim_id: claimId,
                payment_date: row.paymentDate || new Date().toISOString().slice(0, 10),
                payment_received_by: paymentReceivedBy,
                payer_name: row.payerName || savedClaim.payer_name,
                amount: Number(row.payment || 0),
                check_or_eft_number: row.checkNo || "",
                era_id: "",
                eob_id: row.paymentDate ? `EOB-${row.paymentDate}` : "",
                payment_source: "Payment Import",
                notes: `Imported from payer payment report row ${row.rowNumber}. CPT ${row.cptCode}. Payment type: ${row.paymentType || "N/A"}. Payer withheld: ${Number(row.payerWithheld || 0).toFixed(2)}.`,
                created_at: "",
                updated_at: ""
              };
              const savedPayment = await sheetsService.createPayment(payment);
              existingPaymentById.set(textValue(savedPayment.payment_id).toLowerCase(), savedPayment);
              importedPayments.push(savedPayment);
            }
            row.status = "imported";
          }
        }
      }

      const resultRows = analyzedRows;
      const summary = {
        totalRowsRead: importRows.length,
        readyToImport: readyRows.length,
        importedRows: apply ? resultRows.filter(row => row.status === "imported").length : 0,
        needsReviewRows: resultRows.filter(row => row.status === "needs_review").length,
        rejectedRows: resultRows.filter(row => row.status === "rejected").length,
        matchedClaims: new Set(resultRows.map(row => row.claimId).filter(Boolean)).size,
        matchedCptCodes: new Set(resultRows.map(row => row.cptCode).filter(Boolean)).size,
        totalPaymentInFile: Number(normalizedRows.reduce((sum, row) => sum + Number(row.payment || 0), 0).toFixed(2)),
        totalPaymentImported: Number(resultRows.filter(row => row.status === "imported").reduce((sum, row) => sum + Number(row.payment || 0), 0).toFixed(2))
      };

      const importHistory = await sheetsService.createImportHistory({
        import_type: apply ? "Payment Import applied" : "Payment Import analysis",
        file_name: textValue(fileName),
        requested_by: operatorEmail,
        total_rows: summary.totalRowsRead,
        imported_rows: summary.importedRows,
        rejected_rows: summary.rejectedRows,
        review_rows: summary.needsReviewRows,
        total_amount: summary.totalPaymentInFile,
        summary_json: JSON.stringify(summary),
        status: apply ? "Applied" : "Analyzed"
      });
      await sheetsService.createJob({
        job_type: apply ? "Payment Import" : "Payment Import analysis",
        status: summary.rejectedRows > 0 ? "failed" : "completed",
        requested_by: operatorEmail,
        progress: 100,
        summary_json: JSON.stringify(summary),
        error_message: summary.rejectedRows > 0 ? `${summary.rejectedRows} rejected row(s)` : ""
      });
      await sheetsService.addUserActivityLog({
        user_email: operatorEmail,
        action: apply ? "Apply payment import" : "Analyze payment import",
        entity_type: "Import",
        entity_id: importHistory.import_id,
        metadata_json: JSON.stringify({ fileName: textValue(fileName), summary })
      });
      if (apply) {
        const reviewCandidates = resultRows.filter(row => row.status === "needs_review" || row.status === "rejected");
        for (const row of reviewCandidates.slice(0, 100)) {
          await sheetsService.createReviewTask({
            source: "Payment Import",
            claim_id: row.claimId || "",
            cpt_code: row.cptCode || "",
            reason: [...(row.errors || []), ...(row.warnings || [])].join(" ") || "Payment import row requires review.",
            assigned_to: "",
            priority: row.status === "rejected" ? "High" : "Medium",
            status: "Open",
            due_date: ""
          });
        }
      }

      res.json({
        success: summary.rejectedRows === 0 && summary.needsReviewRows === 0,
        applied: Boolean(apply),
        importedCount: resultRows.filter(row => row.status === "imported").length,
        updatedClaims: updatedClaims.length,
        summary,
        rows: resultRows.slice(0, 500)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Payment reconciliation import failed." });
    }
  });

  // Vite development middleware vs Static serving for Production
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting in DEVELOPMENT mode with Vite Middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ITERA Claim Reconciliation Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Critical failure during Express server startup:", err);
});
