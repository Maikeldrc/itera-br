import fs from "node:fs";
import { google } from "googleapis";

const REQUIRED_HEADERS = [
  "payer_id",
  "payer_name",
  "payer_type",
  "pverify_payer_code",
  "eligibility_supported",
  "claim_status_supported",
  "dental_eligibility_supported",
  "active"
];

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function text(value) {
  return String(value ?? "").trim();
}

function yesNo(value) {
  return /^yes$/i.test(text(value));
}

function rowToObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function objectToRow(item) {
  return REQUIRED_HEADERS.map(header => {
    const value = item[header];
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

const sheetId = argValue("--sheet-id") || process.env.GOOGLE_SHEET_ID;
const inputPath = argValue("--input");

if (!sheetId) {
  throw new Error("Missing --sheet-id or GOOGLE_SHEET_ID.");
}
if (!inputPath) {
  throw new Error("Missing --input path to normalized pVerify JSON.");
}

const sourceRows = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (!Array.isArray(sourceRows)) {
  throw new Error("Input JSON must be an array.");
}

const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

const existingResponse = await sheets.spreadsheets.values.get({
  spreadsheetId: sheetId,
  range: "Payers!A:ZZ"
});

const values = existingResponse.data.values || [];
const existingHeaders = values[0]?.length ? values[0] : REQUIRED_HEADERS;
const existingRows = values.slice(1)
  .map(row => rowToObject(existingHeaders, row))
  .filter(row => text(row.payer_id) || text(row.payer_name));

const byId = new Map();
existingRows.forEach(row => {
  const payerId = text(row.payer_id);
  if (!payerId) return;
  byId.set(payerId, {
    payer_id: payerId,
    payer_name: text(row.payer_name),
    payer_type: text(row.payer_type),
    pverify_payer_code: text(row.pverify_payer_code),
    eligibility_supported: row.eligibility_supported === true || /^true$/i.test(text(row.eligibility_supported)),
    claim_status_supported: row.claim_status_supported === true || /^true$/i.test(text(row.claim_status_supported)),
    dental_eligibility_supported: row.dental_eligibility_supported === true || /^true$/i.test(text(row.dental_eligibility_supported)),
    active: row.active === true || !/^false$/i.test(text(row.active))
  });
});

let created = 0;
let updated = 0;
let skipped = 0;

for (const row of sourceRows) {
  const payerCode = text(row["Payer Code"]);
  const payerName = text(row["Payer Name"]);
  if (!payerCode || !payerName) {
    skipped++;
    continue;
  }

  const next = {
    payer_id: payerCode,
    payer_name: payerName,
    payer_type: text(row.Type) || "Other",
    pverify_payer_code: payerCode,
    eligibility_supported: yesNo(row.Eligibility),
    claim_status_supported: yesNo(row["Claim Status"]),
    dental_eligibility_supported: yesNo(row["Dental Eligibility"]),
    active: true
  };

  if (byId.has(payerCode)) {
    byId.set(payerCode, { ...byId.get(payerCode), ...next });
    updated++;
  } else {
    byId.set(payerCode, next);
    created++;
  }
}

const sortedRows = Array.from(byId.values()).sort((a, b) => {
  const aPv = text(a.pverify_payer_code);
  const bPv = text(b.pverify_payer_code);
  if (!!aPv !== !!bPv) return aPv ? 1 : -1;
  return text(a.payer_name).localeCompare(text(b.payer_name)) || text(a.payer_id).localeCompare(text(b.payer_id));
});

await sheets.spreadsheets.values.clear({
  spreadsheetId: sheetId,
  range: "Payers!A:ZZ"
});

await sheets.spreadsheets.values.update({
  spreadsheetId: sheetId,
  range: "Payers!A1",
  valueInputOption: "RAW",
  requestBody: {
    values: [REQUIRED_HEADERS, ...sortedRows.map(objectToRow)]
  }
});

console.log(JSON.stringify({
  success: true,
  created,
  updated,
  skipped,
  totalPayers: sortedRows.length
}, null, 2));
