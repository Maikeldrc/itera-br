/**
 * ITERA Billing & Reconciliation - Google Sheets production setup.
 *
 * How to run:
 * 1. Open the target Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Paste this file into Code.gs or add it as a new script file.
 * 4. Run setupIteraBillingWorkbook().
 *
 * The script creates all sheets needed by the current app plus production-ready
 * tables for service lines, jobs, roles and backups. Existing data is preserved.
 */

const ITERA_APP_SCHEMA_VERSION = "2026-07-08.1";

const TABLES = [
  {
    name: "Claims",
    frozenColumns: 1,
    headers: [
      "claim_id", "patient_id", "patient_display_name_masked", "practice_id", "practice_name",
      "provider_id", "provider_name", "provider_npi", "payer_id", "payer_name", "service_type",
      "cpt_hcpcs", "modifiers", "units", "date_of_service_from", "date_of_service_to",
      "month_of_service", "billed_by", "payment_received_by", "claim_status", "claim_classification",
      "billed_charge", "allowed_amount", "paid_amount", "insurance_adjustment", "denied_amount",
      "write_off_amount", "uncollectible_amount", "net_collectible_revenue", "itera_direct_collection",
      "provider_direct_collection", "total_collections", "ar_balance", "itera_ar", "provider_ar",
      "account_payable_to_physician", "payment_to_physician", "ending_ap_to_physician",
      "net_itera_revenue", "net_provider_revenue", "era_received", "eob_received", "payment_date",
      "check_or_eft_number", "carc_code", "rarc_code", "denial_reason", "error_flag", "error_category",
      "locked", "lock_reason", "correction_status", "resubmission_date", "corrected_claim_reference",
      "last_note", "service_lines_json", "created_at", "updated_at", "updated_by",
      "cpt_description", "submission_date", "itera_billed_fee", "billable_flag", "voided_flag", "corrected_claim_flag"
    ]
  },
  {
    name: "Service_Lines",
    frozenColumns: 2,
    headers: [
      "service_line_id", "claim_id", "cpt", "service_type", "charged", "allowed", "adj",
      "pat_resp", "paid_primary", "paid_secondary", "secondary_payer_id", "has_secondary_payment",
      "balance", "status", "codes_json", "next_action", "eft_number", "payment_date",
      "notes_count", "created_at", "updated_at", "updated_by"
    ]
  },
  {
    name: "Payments",
    frozenColumns: 1,
    headers: [
      "payment_id", "claim_id", "payment_date", "payment_received_by", "payer_name", "amount",
      "check_or_eft_number", "era_id", "eob_id", "payment_source", "notes", "created_at", "updated_at"
    ]
  },
  {
    name: "Notes",
    frozenColumns: 1,
    headers: [
      "note_id", "claim_id", "note_type", "note_text", "created_by", "created_at"
    ]
  },
  {
    name: "Service_Line_Notes",
    frozenColumns: 2,
    headers: [
      "note_id", "service_line_id", "claim_id", "cpt", "note_text", "created_by",
      "created_by_email", "created_at", "updated_by", "updated_at", "deleted", "deleted_at", "deleted_by"
    ]
  },
  {
    name: "Audit_Log",
    frozenColumns: 1,
    headers: [
      "audit_id", "claim_id", "action_type", "field_name", "previous_value", "new_value",
      "reason", "changed_by", "changed_at"
    ]
  },
  {
    name: "Audit_Events",
    frozenColumns: 1,
    headers: [
      "event_id", "timestamp", "user_id", "user_email", "event_type", "entity_type", "entity_id",
      "claim_id", "service_line_id", "field_name", "previous_value", "new_value", "ip_address",
      "user_agent", "reason", "metadata_json"
    ]
  },
  {
    name: "Providers",
    frozenColumns: 1,
    headers: [
      "provider_id", "provider_name", "npi", "practice_id", "practice_name", "active"
    ],
    seedRows: [
      ["PROV_01", "Dr. Robert Chen", "1982736450", "PRAC_01", "Metropolitan Care Group", true]
    ]
  },
  {
    name: "Payers",
    frozenColumns: 1,
    headers: [
      "payer_id", "payer_name", "payer_type", "pverify_payer_code",
      "eligibility_supported", "claim_status_supported", "dental_eligibility_supported", "active"
    ],
    seedRows: [
      ["PAY_01", "Medicare Texas (Novitas)", "Medicare", "", false, false, false, true],
      ["PAY_02", "Blue Cross Blue Shield (BCBS)", "Commercial", "", false, false, false, true],
      ["PAY_03", "Aetna Health", "Commercial", "", false, false, false, true],
      ["PAY_04", "UnitedHealthcare (UHC)", "Commercial", "", false, false, false, true],
      ["PAY_05", "Cigna Health", "Commercial", "", false, false, false, true]
    ]
  },
  {
    name: "Users",
    frozenColumns: 1,
    headers: [
      "user_id", "name", "email", "role", "active"
    ],
    seedRows: [
      ["USR_001", "System Admin", "admin@itera.health", "Admin", true]
    ]
  },
  {
    name: "Roles",
    frozenColumns: 1,
    headers: [
      "role", "description", "permissions_json", "active"
    ],
    seedRows: [
      ["Admin", "Full administrative access", JSON.stringify(["*"]), true],
      ["Billing Manager", "Billing operations and configuration access", JSON.stringify(["claims:read", "claims:write", "reports:read", "exports:create", "settings:write"]), true],
      ["Reconciliation Specialist", "Claim and CPT reconciliation operations", JSON.stringify(["claims:read", "claims:write", "reports:read"]), true],
      ["Provider Viewer", "Read-oriented provider access", JSON.stringify(["claims:read", "reports:read"]), true],
      ["Auditor", "Audit and reporting review", JSON.stringify(["claims:read", "reports:read", "audit:read"]), true]
    ]
  },
  {
    name: "Settings",
    frozenColumns: 1,
    headers: [
      "setting_key", "setting_value", "description"
    ],
    seedRows: [
      ["SCHEMA_VERSION", ITERA_APP_SCHEMA_VERSION, "Workbook schema version installed by Apps Script."],
      ["PROVIDER_SHARE_PERCENT", "70", "Default percentage share paid to the provider."],
      ["ITERA_SHARE_PERCENT", "30", "Default percentage share kept by ITERA Health."],
      ["PAYMENT_BASIS", "COLLECTIONS", "Reconciliation basis: COLLECTIONS or BILLED."],
      ["GOOGLE_SHEET_INTEGRATION_ACTIVE", "true", "Whether Google Sheets synchronization is enabled."],
      ["DEFAULT_LANGUAGE", "en", "Default application language."],
      ["RETENTION_YEARS", "6", "HIPAA-aligned record retention period."],
      ["ALLOW_DIRECT_SHEET_EDITS", "false", "All production changes should go through the app."]
    ]
  },
  {
    name: "FeeSchedules",
    frozenColumns: 1,
    headers: [
      "id", "cpt_code", "year", "semester1_rate", "semester2_rate", "description"
    ],
    seedRows: [
      ["FSCH-001", "99453", 2026, 19.20, 19.50, "RPM - Device set-up and patient education"],
      ["FSCH-002", "99454", 2026, 62.44, 63.10, "RPM - Device supply and daily recordings"],
      ["FSCH-003", "99457", 2026, 51.04, 51.80, "RPM - Treatment management services first 20 min"],
      ["FSCH-004", "99458", 2026, 41.12, 41.90, "RPM - Treatment management services additional 20 min"],
      ["FSCH-005", "99490", 2026, 65.20, 66.00, "CCM - Clinical staff time first 20 min"],
      ["FSCH-006", "99439", 2026, 48.15, 48.95, "CCM - Clinical staff time additional 20 min"],
      ["FSCH-007", "99491", 2026, 85.30, 86.20, "CCM - Physician or qualified health professional"],
      ["FSCH-008", "99424", 2026, 73.40, 74.20, "Principal care management first 30 min"]
    ]
  },
  {
    name: "Fee_Schedule",
    frozenColumns: 1,
    headers: [
      "fee_schedule_id", "cpt_hcpcs", "cpt_description", "service_type",
      "unit_price", "itera_fee", "effective_date", "active"
    ]
  },
  {
    name: "Eligibility_Coverage",
    frozenColumns: 1,
    headers: [
      "coverage_id", "practice_id", "practice_name", "service_type", "period",
      "total_eligible_patients", "notes", "created_at", "updated_at"
    ]
  },
  {
    name: "Import_Jobs",
    frozenColumns: 1,
    headers: [
      "import_id", "file_name", "file_hash_sha256", "source_type", "uploaded_by",
      "uploaded_at", "total_rows", "created_claims", "rejected_rows", "status", "errors_json"
    ]
  },
  {
    name: "Export_Jobs",
    frozenColumns: 1,
    headers: [
      "export_id", "export_type", "requested_by", "requested_at", "filters_json",
      "row_count", "status", "metadata_json"
    ]
  },
  {
    name: "Backups_Index",
    frozenColumns: 1,
    headers: [
      "backup_id", "backup_file_id", "backup_file_name", "backup_drive_url",
      "created_by", "created_at", "source_spreadsheet_id", "status", "notes"
    ]
  },
  {
    name: "ERA_Codes",
    frozenColumns: 1,
    headers: [
      "code", "code_type", "group", "description", "active"
    ],
    seedRows: [
      ["CO-45", "CARC", "Contractual Obligation", "Charge exceeds fee schedule/maximum allowable or contracted arrangement.", true],
      ["CO-253", "CARC", "Contractual Obligation", "Sequestration reduction.", true],
      ["PR-1", "CARC", "Patient Responsibility", "Deductible amount.", true],
      ["PR-2", "CARC", "Patient Responsibility", "Coinsurance amount.", true],
      ["PR-3", "CARC", "Patient Responsibility", "Co-payment amount.", true],
      ["OA-23", "CARC", "Other Adjustment", "Prior payer adjudication impact.", true],
      ["MA18", "RARC", "Remark", "Alert: duplicate claim/service.", true],
      ["N130", "RARC", "Remark", "Consult plan benefit documents/guidelines.", true]
    ]
  }
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("ITERA Setup")
    .addItem("Create / Update Schema", "setupIteraBillingWorkbook")
    .addItem("Create Daily Backup Copy", "createIteraDailyBackup")
    .addToUi();
}

function setupIteraBillingWorkbook() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  TABLES.forEach(table => ensureTable_(spreadsheet, table));
  ensureNamedRangeIndex_(spreadsheet);
  SpreadsheetApp.getUi().alert("ITERA Billing workbook schema is ready.");
}

function ensureTable_(spreadsheet, table) {
  let sheet = spreadsheet.getSheetByName(table.name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(table.name);
  }

  ensureHeaders_(sheet, table.headers);
  styleHeader_(sheet, table.headers.length);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(table.frozenColumns || 0);
  applyColumnFormats_(sheet, table.headers);
  ensureSeedRows_(sheet, table.headers, table.seedRows || []);
  protectHeaderRow_(sheet);
  autoResize_(sheet, table.headers.length);
}

function ensureHeaders_(sheet, headers) {
  const width = headers.length;
  const current = sheet.getRange(1, 1, 1, Math.max(width, sheet.getLastColumn() || 1)).getValues()[0];
  const existing = current.map(value => String(value || "").trim()).filter(Boolean);

  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, width).setValues([headers]);
    return;
  }

  const merged = existing.slice();
  headers.forEach(header => {
    if (merged.indexOf(header) === -1) merged.push(header);
  });
  sheet.getRange(1, 1, 1, merged.length).setValues([merged]);
}

function styleHeader_(sheet, width) {
  const range = sheet.getRange(1, 1, 1, width);
  range
    .setFontWeight("bold")
    .setFontColor("#0f2942")
    .setBackground("#e8f1f2")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 34);
  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), width).createFilter();
  }
}

function applyColumnFormats_(sheet, headers) {
  headers.forEach((header, index) => {
    const col = index + 1;
    const range = sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1);
    if (/_date$/.test(header) || header.endsWith("_at") || header === "changed_at" || header === "payment_date" || header === "submission_date") {
      range.setNumberFormat("yyyy-mm-dd");
    } else if (header === "month_of_service" || header === "period") {
      range.setNumberFormat("@");
    } else if (
      header.includes("amount") ||
      header.includes("charge") ||
      header.includes("paid") ||
      header.includes("collection") ||
      header.includes("balance") ||
      header.includes("revenue") ||
      header.includes("fee") ||
      header.includes("rate") ||
      header === "adj" ||
      header === "allowed" ||
      header === "charged" ||
      header === "pat_resp"
    ) {
      range.setNumberFormat("$#,##0.00");
    } else if (
      header.endsWith("_id") ||
      header === "patient_id" ||
      header === "provider_npi" ||
      header === "npi" ||
      header === "check_or_eft_number" ||
      header === "cpt_hcpcs" ||
      header === "cpt_code" ||
      header === "cpt"
    ) {
      range.setNumberFormat("@");
    }
  });
}

function ensureSeedRows_(sheet, headers, seedRows) {
  if (!seedRows.length) return;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) return;

  const normalizedRows = seedRows.map(row => {
    const next = row.slice();
    while (next.length < headers.length) next.push("");
    return next.slice(0, headers.length);
  });
  sheet.getRange(2, 1, normalizedRows.length, headers.length).setValues(normalizedRows);
}

function protectHeaderRow_(sheet) {
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  const alreadyProtected = protections.some(protection => protection.getRange().getA1Notation() === "1:1");
  if (alreadyProtected) return;

  const protection = sheet.getRange("1:1").protect();
  protection.setDescription("ITERA schema header row - do not edit manually.");
  protection.setWarningOnly(true);
}

function autoResize_(sheet, width) {
  for (let col = 1; col <= width; col++) {
    sheet.autoResizeColumn(col);
    const currentWidth = sheet.getColumnWidth(col);
    sheet.setColumnWidth(col, Math.min(Math.max(currentWidth, 110), 260));
  }
}

function ensureNamedRangeIndex_(spreadsheet) {
  const settings = spreadsheet.getSheetByName("Settings");
  if (!settings) return;
  const values = settings.getDataRange().getValues();
  const keyCol = 1;
  const existingKeys = values.slice(1).map(row => String(row[keyCol - 1] || ""));
  if (existingKeys.indexOf("LAST_SCHEMA_SETUP_AT") === -1) {
    settings.appendRow(["LAST_SCHEMA_SETUP_AT", new Date().toISOString(), "Last time setupIteraBillingWorkbook was executed."]);
  }
}

function createIteraDailyBackup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd-HHmmss");
  const backupName = "itera-claim-reconciliation-backup-" + timestamp;
  const sourceFile = DriveApp.getFileById(spreadsheet.getId());
  const backupFile = sourceFile.makeCopy(backupName, sourceFile.getParents().next());
  const backupSheet = spreadsheet.getSheetByName("Backups_Index");
  if (backupSheet) {
    backupSheet.appendRow([
      "BKP-" + timestamp,
      backupFile.getId(),
      backupName,
      backupFile.getUrl(),
      Session.getActiveUser().getEmail(),
      new Date().toISOString(),
      spreadsheet.getId(),
      "Created",
      "Manual or scheduled Apps Script backup."
    ]);
  }
  return backupFile.getUrl();
}
