/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { google } from "googleapis";
import { Readable } from "stream";
import { Claim, Payment, Note, AuditLog, Provider, Payer, User, Setting, FeeSchedule, EligibilityCoverage, ReportFeeSchedule, BackupRecord } from "./types";
import { SEED_CLAIMS, SEED_PAYMENTS, SEED_NOTES, SEED_AUDIT_LOGS, SEED_PROVIDERS, SEED_PAYERS, SEED_USERS, SEED_SETTINGS, SEED_FEE_SCHEDULES, SEED_ELIGIBILITY_COVERAGE, SEED_REPORT_FEE_SCHEDULES } from "./seedData";
import { normalizeUserAccess } from "./accessControl";

function hasNonEmptySheetRow(row: unknown[]) {
  return row.some(value => String(value ?? "").trim() !== "");
}

function hasMeaningfulAuditLog(log: Partial<AuditLog>) {
  return [
    log.audit_id,
    log.claim_id,
    log.action_type,
    log.field_name,
    log.changed_at
  ].some(value => String(value ?? "").trim() !== "");
}

/**
 * Service to manage read/write operations to Google Sheets.
 * Falls back to an in-memory database with seed data only for local/demo mode.
 * In production with a Google Sheet configured, the spreadsheet is the source of truth even when it is empty.
 */
export class GoogleSheetsService {
  private isConfigured: boolean = false;
  private useSeedData: boolean = false;
  private clientEmail?: string;
  private privateKey?: string;
  private sheetId?: string;
  private authClient: any = null;
  private sheets: any = null;
  private drive: any = null;

  // In-memory data store for fallback/caching
  public claims: Claim[] = [];
  public payments: Payment[] = [];
  public notes: Note[] = [];
  public auditLogs: AuditLog[] = [];
  public providers: Provider[] = [];
  public payers: Payer[] = [];
  public users: User[] = [];
  public settings: Setting[] = [];
  public feeSchedules: FeeSchedule[] = [];
  public eligibilityCoverage: EligibilityCoverage[] = [];
  public reportFeeSchedules: ReportFeeSchedule[] = [];
  private scheduledBackupInFlight = false;

  constructor() {
    this.clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    this.privateKey = process.env.GOOGLE_PRIVATE_KEY;
    this.sheetId = process.env.GOOGLE_SHEET_ID;
    this.useSeedData = this.shouldUseSeedData();

    if (this.useSeedData) {
      this.loadSeedData();
    }

    if (this.sheetId && this.clientEmail && this.privateKey) {
      try {
        const formattedKey = this.privateKey.replace(/\\n/g, "\n");
        this.authClient = new google.auth.JWT({
          email: this.clientEmail,
          key: formattedKey,
          scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
        });
        this.sheets = google.sheets({ version: "v4", auth: this.authClient });
        this.drive = google.drive({ version: "v3", auth: this.authClient });
        this.isConfigured = true;
        console.log("Google Sheets service initialized successfully with credentials.");
      } catch (err) {
        console.error("Failed to initialize Google Sheets service with credentials, falling back to local memory:", err);
        this.isConfigured = false;
      }
    } else if (this.sheetId && process.env.GOOGLE_USE_ADC === "true") {
      try {
        this.authClient = new google.auth.GoogleAuth({
          scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
        });
        this.sheets = google.sheets({ version: "v4", auth: this.authClient });
        this.drive = google.drive({ version: "v3", auth: this.authClient });
        this.isConfigured = true;
        console.log("Google Sheets service initialized successfully with Application Default Credentials.");
      } catch (err) {
        console.error("Failed to initialize Google Sheets service with ADC, falling back to local memory:", err);
        this.isConfigured = false;
      }
    } else {
      console.warn("Google Sheets credentials not fully configured in environment variables. Falling back to in-memory database.");
      this.isConfigured = false;
    }
  }

  public getConnectionStatus() {
    return {
      configured: this.isConfigured,
      hasClientEmail: !!this.clientEmail,
      hasPrivateKey: !!this.privateKey,
      hasSheetId: !!this.sheetId,
      usingAdc: process.env.GOOGLE_USE_ADC === "true",
      usingFallback: !this.isConfigured,
      usingSeedData: this.useSeedData,
      supportingDocumentsFolderConfigured: !!process.env.SUPPORTING_DOCUMENTS_FOLDER_ID
    };
  }

  private getSettingValue(key: string, fallback = "") {
    return String(this.settings.find(setting => setting.setting_key === key)?.setting_value ?? fallback);
  }

  private shouldUseSeedData(): boolean {
    if (process.env.USE_SEED_DATA === "true") return true;
    if (this.sheetId) return false;
    return process.env.NODE_ENV !== "production";
  }

  private loadSeedData() {
    this.claims = [...SEED_CLAIMS];
    this.payments = [...SEED_PAYMENTS];
    this.notes = [...SEED_NOTES];
    this.auditLogs = [...SEED_AUDIT_LOGS];
    this.providers = [...SEED_PROVIDERS];
    this.payers = [...SEED_PAYERS];
    this.users = [...SEED_USERS];
    this.settings = [...SEED_SETTINGS];
    this.feeSchedules = [...SEED_FEE_SCHEDULES];
    this.eligibilityCoverage = [...SEED_ELIGIBILITY_COVERAGE];
    this.reportFeeSchedules = [...SEED_REPORT_FEE_SCHEDULES];
  }

  /**
   * Helper to write a row to a sheet tab
   */
  private async appendRow(tabName: string, rowData: any[]) {
    if (!this.isConfigured) return;
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.sheetId,
        range: `${tabName}!A:A`,
        valueInputOption: "RAW",
        requestBody: {
          values: [rowData],
        },
      });
    } catch (err) {
      console.error(`Google Sheets: Failed to append row to ${tabName}`, err);
    }
  }

  private async appendRowsStrict(tabName: string, rows: any[][]) {
    if (!this.isConfigured || rows.length === 0) return;
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.sheetId,
      range: `${tabName}!A:A`,
      valueInputOption: "RAW",
      requestBody: {
        values: rows,
      },
    });
  }

  /**
   * Helper to rewrite all data in a sheet tab
   */
  private async overwriteTab(tabName: string, headers: string[], rows: any[][]) {
    if (!this.isConfigured) return;
    try {
      // Clear sheet
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.sheetId,
        range: `${tabName}!A:ZZ`,
      });

      // Write headers and data
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `${tabName}!A1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [headers, ...rows],
        },
      });
    } catch (err) {
      console.error(`Google Sheets: Failed to overwrite tab ${tabName}`, err);
    }
  }

  private async clearTab(tabName: string) {
    if (!this.isConfigured) return;
    try {
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.sheetId,
        range: `${tabName}!A:ZZ`,
      });
    } catch (err) {
      console.error(`Google Sheets: Failed to clear tab ${tabName}`, err);
      throw err;
    }
  }

  private async overwriteTabStrict(tabName: string, headers: string[], rows: any[][]) {
    if (!this.isConfigured) return;
    await this.sheets.spreadsheets.values.clear({
      spreadsheetId: this.sheetId,
      range: `${tabName}!A:ZZ`,
    });
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [headers, ...rows],
      },
    });
  }

  /**
   * Sync Google Sheets with Local Store (and vice versa)
   */
  public async syncWithGoogleSheets() {
    if (!this.isConfigured) {
      return { success: true, message: "Using in-memory mock storage (Google Sheets not configured)." };
    }

    try {
      // Try to load tables. If tabs don't exist, create the required schema.
      await this.bootstrapSheetsIfEmpty();
      await this.loadAllFromSheets();
      return { success: true, message: "Successfully synchronized with Google Sheets!" };
    } catch (err: any) {
      console.error("Failed to sync with Google Sheets, reverting to in-memory store:", err);
      return { success: false, error: err.message || String(err) };
    }
  }

  /**
   * Create missing tabs. In production, write headers only; seed data requires USE_SEED_DATA=true.
   */
  private async bootstrapSheetsIfEmpty() {
    if (!this.isConfigured) return;
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.sheetId,
      });
      const existingTabs = response.data.sheets?.map((s: any) => s.properties.title) || [];
      
      const requiredTabs = [
        { name: "Claims", headers: CLAIMS_HEADERS, seed: this.claims },
        { name: "Payments", headers: PAYMENTS_HEADERS, seed: this.payments },
        { name: "Notes", headers: NOTES_HEADERS, seed: this.notes },
        { name: "Audit_Log", headers: AUDIT_LOGS_HEADERS, seed: this.auditLogs },
        { name: "Providers", headers: PROVIDERS_HEADERS, seed: this.providers },
        { name: "Payers", headers: PAYERS_HEADERS, seed: this.payers },
        { name: "Users", headers: USERS_HEADERS, seed: this.users },
        { name: "Settings", headers: SETTINGS_HEADERS, seed: this.settings },
        { name: "FeeSchedules", headers: FEESCHEDULES_HEADERS, seed: this.feeSchedules },
        { name: "Fee_Schedule", headers: REPORT_FEESCHEDULE_HEADERS, seed: this.reportFeeSchedules },
        { name: "Eligibility_Coverage", headers: ELIGIBILITY_COVERAGE_HEADERS, seed: this.eligibilityCoverage },
        { name: "Backups_Index", headers: BACKUPS_INDEX_HEADERS, seed: [] }
      ];

      for (const tab of requiredTabs) {
        if (!existingTabs.includes(tab.name)) {
          console.log(`Creating tab "${tab.name}" in Google Sheet...`);
          // Note: Add tab request if missing
          await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.sheetId,
            requestBody: {
              requests: [
                {
                  addSheet: {
                    properties: { title: tab.name }
                  }
                }
              ]
            }
          });
          
          const rows = this.useSeedData ? tab.seed.map((item: any) => mapObjectToRow(tab.name, item)) : [];
          await this.overwriteTab(tab.name, tab.headers, rows);
        }
      }
    } catch (err) {
      console.error("Error bootstrapping Google Sheet tabs:", err);
      throw err;
    }
  }

  private async loadAllFromSheets() {
    if (!this.isConfigured) return;

    const tabs = ["Claims", "Payments", "Notes", "Audit_Log", "Providers", "Payers", "Users", "Settings", "FeeSchedules", "Fee_Schedule", "Eligibility_Coverage"];
    for (const tab of tabs) {
      try {
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.sheetId,
          range: `${tab}!A:ZZ`,
        });

        const rows = response.data.values || [];
        const headers = rows[0] || getHeadersForTab(tab);
        const dataRows = rows.length > 1 ? rows.slice(1).filter((row: unknown[]) => hasNonEmptySheetRow(row)) : [];
        const mappedObjects = dataRows.map((row: string[]) => mapRowToObject(tab, headers, row));

        // Save in memory even when the sheet is empty, so old seed/cache data cannot leak into production.
        if (tab === "Claims") this.claims = mappedObjects as Claim[];
        if (tab === "Payments") this.payments = mappedObjects as Payment[];
        if (tab === "Notes") this.notes = mappedObjects as Note[];
        if (tab === "Audit_Log") this.auditLogs = mappedObjects as AuditLog[];
        if (tab === "Providers") this.providers = mappedObjects as Provider[];
        if (tab === "Payers") this.payers = mappedObjects as Payer[];
        if (tab === "Users") this.users = mappedObjects as User[];
        if (tab === "Settings") this.settings = mappedObjects as Setting[];
        if (tab === "FeeSchedules") this.feeSchedules = mappedObjects as FeeSchedule[];
        if (tab === "Fee_Schedule") this.reportFeeSchedules = mappedObjects as ReportFeeSchedule[];
        if (tab === "Eligibility_Coverage") this.eligibilityCoverage = mappedObjects as EligibilityCoverage[];
      } catch (err) {
        console.error(`Failed to load tab ${tab} from Google Sheets:`, err);
      }
    }
  }

  // --- External API Integrations ---

  public async getClaims(includeDeleted = false): Promise<Claim[]> {
    return includeDeleted ? this.claims : this.claims.filter(claim => !claim.deleted_flag);
  }

  public async updateClaim(claimId: string, updatedClaim: Claim, operatorEmail: string): Promise<Claim> {
    const index = this.claims.findIndex(c => c.claim_id === claimId);
    if (index === -1) {
      throw new Error(`Claim with ID ${claimId} not found.`);
    }

    const previous = this.claims[index];
    this.claims[index] = {
      ...updatedClaim,
      updated_at: new Date().toISOString(),
      updated_by: operatorEmail
    };

    // Auto-generate audit logs for differences
    const diffs = getClaimDifferences(previous, this.claims[index]);
    for (const diff of diffs) {
      const auditRecord: AuditLog = {
        audit_id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        claim_id: claimId,
        action_type: "Update",
        field_name: diff.field,
        previous_value: String(diff.prev),
        new_value: String(diff.curr),
        reason: diff.reason || "Field manual modification",
        changed_by: operatorEmail,
        changed_at: new Date().toISOString()
      };
      this.auditLogs.unshift(auditRecord);
      if (this.isConfigured) {
        await this.appendRow("Audit_Log", mapObjectToRow("Audit_Log", auditRecord));
      }
    }

    // Push claim update to Google Sheets if configured
    if (this.isConfigured) {
      const rows = this.claims.map(c => mapObjectToRow("Claims", c));
      await this.overwriteTab("Claims", CLAIMS_HEADERS, rows);
    }

    return this.claims[index];
  }

  public async createClaim(newClaim: Claim, operatorEmail: string): Promise<Claim> {
    const exists = this.claims.some(c => c.claim_id === newClaim.claim_id);
    if (exists) {
      throw new Error(`Claim ID "${newClaim.claim_id}" is already used.`);
    }

    const claimToAdd = {
      ...newClaim,
      deleted_flag: false,
      deleted_at: "",
      deleted_by: "",
      delete_reason: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: operatorEmail
    };

    this.claims.unshift(claimToAdd);

    // Write audit log
    const auditRecord: AuditLog = {
      audit_id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      claim_id: newClaim.claim_id,
      action_type: "Create",
      field_name: "all",
      previous_value: "",
      new_value: "Claim Created",
      reason: "Claim manually imported/created.",
      changed_by: operatorEmail,
      changed_at: new Date().toISOString()
    };
    this.auditLogs.unshift(auditRecord);

    if (this.isConfigured) {
      await this.appendRow("Claims", mapObjectToRow("Claims", claimToAdd));
      await this.appendRow("Audit_Log", mapObjectToRow("Audit_Log", auditRecord));
    }

    return claimToAdd;
  }

  public async createClaimsBulk(newClaims: Claim[], operatorEmail: string): Promise<Claim[]> {
    if (newClaims.length === 0) return [];

    const existingIds = new Set(this.claims.map(claim => claim.claim_id));
    const batchIds = new Set<string>();
    for (const claim of newClaims) {
      if (existingIds.has(claim.claim_id) || batchIds.has(claim.claim_id)) {
        throw new Error(`Claim ID "${claim.claim_id}" is already used.`);
      }
      batchIds.add(claim.claim_id);
    }

    const now = new Date().toISOString();
    const claimsToAdd = newClaims.map(claim => ({
      ...claim,
      deleted_flag: false,
      deleted_at: "",
      deleted_by: "",
      delete_reason: "",
      created_at: now,
      updated_at: now,
      updated_by: operatorEmail
    }));

    const auditRecords: AuditLog[] = claimsToAdd.map((claim, index) => ({
      audit_id: `AUD-${Date.now()}-${index}-${Math.floor(Math.random() * 1000)}`,
      claim_id: claim.claim_id,
      action_type: "Import",
      field_name: "all",
      previous_value: "",
      new_value: "Claim Imported",
      reason: "Claim imported from CSV/XLSX batch.",
      changed_by: operatorEmail,
      changed_at: now
    }));

    if (this.isConfigured) {
      await this.appendRowsStrict("Claims", claimsToAdd.map(claim => mapObjectToRow("Claims", claim)));
      await this.appendRowsStrict("Audit_Log", auditRecords.map(record => mapObjectToRow("Audit_Log", record)));
    }

    this.claims.unshift(...claimsToAdd);
    this.auditLogs.unshift(...auditRecords);
    return claimsToAdd;
  }

  public async softDeleteClaim(claimId: string, operatorEmail: string, reason: string): Promise<Claim> {
    const index = this.claims.findIndex(c => c.claim_id === claimId);
    if (index === -1) {
      throw new Error(`Claim with ID ${claimId} not found.`);
    }

    const previous = this.claims[index];
    if (previous.deleted_flag) {
      throw new Error(`Claim ${claimId} is already deleted.`);
    }

    const deletedAt = new Date().toISOString();
    const updated = {
      ...previous,
      deleted_flag: true,
      deleted_at: deletedAt,
      deleted_by: operatorEmail,
      delete_reason: reason,
      updated_at: deletedAt,
      updated_by: operatorEmail
    } as Claim;

    this.claims[index] = updated;

    const auditRecord: AuditLog = {
      audit_id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      claim_id: claimId,
      action_type: "Delete",
      field_name: "deleted_flag",
      previous_value: "false",
      new_value: "true",
      reason: reason || "Soft delete requested by administrator",
      changed_by: operatorEmail,
      changed_at: deletedAt
    };
    this.auditLogs.unshift(auditRecord);

    if (this.isConfigured) {
      const rows = this.claims.map(c => mapObjectToRow("Claims", c));
      await this.overwriteTab("Claims", CLAIMS_HEADERS, rows);
      await this.appendRow("Audit_Log", mapObjectToRow("Audit_Log", auditRecord));
    }

    return updated;
  }

  public async bulkUpdateClaims(claimIds: string[], updates: Partial<Claim>, operatorEmail: string): Promise<number> {
    let updatedCount = 0;
    
    for (const id of claimIds) {
      const idx = this.claims.findIndex(c => c.claim_id === id);
      if (idx !== -1) {
        const previous = this.claims[idx];
        const merged = {
          ...previous,
          ...updates,
          updated_at: new Date().toISOString(),
          updated_by: operatorEmail
        } as Claim;
        
        this.claims[idx] = merged;
        updatedCount++;

        // Add bulk update audit record
        const auditRecord: AuditLog = {
          audit_id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          claim_id: id,
          action_type: "Bulk Update",
          field_name: Object.keys(updates).join(", "),
          previous_value: "Various",
          new_value: JSON.stringify(updates),
          reason: "Bulk modification through claims worklist",
          changed_by: operatorEmail,
          changed_at: new Date().toISOString()
        };
        this.auditLogs.unshift(auditRecord);
        if (this.isConfigured) {
          await this.appendRow("Audit_Log", mapObjectToRow("Audit_Log", auditRecord));
        }
      }
    }

    if (this.isConfigured && updatedCount > 0) {
      const rows = this.claims.map(c => mapObjectToRow("Claims", c));
      await this.overwriteTab("Claims", CLAIMS_HEADERS, rows);
    }

    return updatedCount;
  }

  public async getPayments(): Promise<Payment[]> {
    return this.payments;
  }

  public async createPayment(newPayment: Payment): Promise<Payment> {
    const paymentToAdd = {
      ...newPayment,
      payment_id: newPayment.payment_id || `PMT-${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.payments.unshift(paymentToAdd);

    if (this.isConfigured) {
      await this.appendRow("Payments", mapObjectToRow("Payments", paymentToAdd));
    }

    return paymentToAdd;
  }

  public async getNotes(): Promise<Note[]> {
    return this.notes;
  }

  public async createNote(newNote: Note, authorEmail: string): Promise<Note> {
    const noteToAdd = {
      ...newNote,
      note_id: `NTE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      created_by: authorEmail,
      created_at: new Date().toISOString()
    };

    this.notes.unshift(noteToAdd);

    if (this.isConfigured) {
      await this.appendRow("Notes", mapObjectToRow("Notes", noteToAdd));
    }

    return noteToAdd;
  }

  public async getAuditLogs(): Promise<AuditLog[]> {
    return this.auditLogs.filter(hasMeaningfulAuditLog);
  }

  public async getProviders(): Promise<Provider[]> {
    return this.providers;
  }

  public async createProvider(provider: Provider): Promise<Provider> {
    const providerToAdd = {
      ...provider,
      provider_id: provider.provider_id.trim(),
      provider_name: provider.provider_name.trim(),
      npi: provider.npi.trim(),
      practice_id: provider.practice_id?.trim() || "PRAC_01",
      practice_name: provider.practice_name?.trim() || "Default Practice",
      active: provider.active !== false
    };
    if (this.providers.some(item => item.provider_id === providerToAdd.provider_id)) {
      throw new Error("A provider with this ID already exists.");
    }
    if (this.providers.some(item => item.npi === providerToAdd.npi)) {
      throw new Error("A provider with this NPI already exists.");
    }
    this.providers.push(providerToAdd);
    if (this.isConfigured) {
      await this.overwriteTab("Providers", PROVIDERS_HEADERS, this.providers.map(item => mapObjectToRow("Providers", item)));
    }
    return providerToAdd;
  }

  public async updateProvider(providerId: string, updates: Partial<Provider>): Promise<Provider> {
    const index = this.providers.findIndex(item => item.provider_id === providerId);
    if (index === -1) throw new Error("Provider not found.");
    const nextNpi = updates.npi?.trim() || this.providers[index].npi;
    if (this.providers.some(item => item.provider_id !== providerId && item.npi === nextNpi)) {
      throw new Error("Another provider already uses this NPI.");
    }
    this.providers[index] = {
      ...this.providers[index],
      ...updates,
      provider_id: providerId,
      provider_name: updates.provider_name?.trim() || this.providers[index].provider_name,
      npi: nextNpi,
      practice_id: updates.practice_id?.trim() || this.providers[index].practice_id,
      practice_name: updates.practice_name?.trim() || this.providers[index].practice_name,
      active: updates.active !== undefined ? updates.active : this.providers[index].active
    };
    if (this.isConfigured) {
      await this.overwriteTab("Providers", PROVIDERS_HEADERS, this.providers.map(item => mapObjectToRow("Providers", item)));
    }
    return this.providers[index];
  }

  public async deleteProvider(providerId: string): Promise<void> {
    const index = this.providers.findIndex(item => item.provider_id === providerId);
    if (index === -1) throw new Error("Provider not found.");
    this.providers.splice(index, 1);
    if (this.isConfigured) {
      await this.overwriteTab("Providers", PROVIDERS_HEADERS, this.providers.map(item => mapObjectToRow("Providers", item)));
    }
  }

  public async getPayers(): Promise<Payer[]> {
    return this.payers;
  }

  public async createPayer(payer: Payer): Promise<Payer> {
    const payerToAdd = {
      ...payer,
      payer_id: payer.payer_id.trim(),
      payer_name: payer.payer_name.trim(),
      payer_type: payer.payer_type.trim()
    };
    if (this.payers.some(item => item.payer_id === payerToAdd.payer_id)) {
      throw new Error("A payer with this ID already exists.");
    }
    this.payers.push(payerToAdd);
    if (this.isConfigured) {
      await this.overwriteTab("Payers", PAYERS_HEADERS, this.payers.map(item => mapObjectToRow("Payers", item)));
    }
    return payerToAdd;
  }

  public async updatePayer(payerId: string, updates: Partial<Payer>): Promise<Payer> {
    const index = this.payers.findIndex(item => item.payer_id === payerId);
    if (index === -1) throw new Error("Payer not found.");
    this.payers[index] = {
      ...this.payers[index],
      ...updates,
      payer_id: payerId,
      payer_name: updates.payer_name?.trim() || this.payers[index].payer_name,
      payer_type: updates.payer_type?.trim() || this.payers[index].payer_type
    };
    if (this.isConfigured) {
      await this.overwriteTab("Payers", PAYERS_HEADERS, this.payers.map(item => mapObjectToRow("Payers", item)));
    }
    return this.payers[index];
  }

  public async importPverifyPayers(rows: Array<Record<string, unknown>>): Promise<{ created: number; updated: number; skipped: number; totalPayers: number }> {
    const byId = new Map(this.payers.map(item => [String(item.payer_id || "").trim(), item]));
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const payerCode = String(row["Payer Code"] ?? "").trim();
      const payerName = String(row["Payer Name"] ?? "").trim();
      if (!payerCode || !payerName) {
        skipped++;
        continue;
      }

      const next: Payer = {
        payer_id: payerCode,
        payer_name: payerName,
        payer_type: String(row.Type ?? "").trim() || "Other",
        pverify_payer_code: payerCode,
        eligibility_supported: /^yes$/i.test(String(row.Eligibility ?? "").trim()),
        claim_status_supported: /^yes$/i.test(String(row["Claim Status"] ?? "").trim()),
        dental_eligibility_supported: /^yes$/i.test(String(row["Dental Eligibility"] ?? "").trim()),
        active: true
      };

      if (byId.has(payerCode)) {
        byId.set(payerCode, { ...byId.get(payerCode)!, ...next });
        updated++;
      } else {
        byId.set(payerCode, next);
        created++;
      }
    }

    this.payers = Array.from(byId.values()).sort((a, b) => {
      const aPverify = String(a.pverify_payer_code || "").trim();
      const bPverify = String(b.pverify_payer_code || "").trim();
      if (!!aPverify !== !!bPverify) return aPverify ? 1 : -1;
      return a.payer_name.localeCompare(b.payer_name) || a.payer_id.localeCompare(b.payer_id);
    });

    if (this.isConfigured) {
      await this.overwriteTab("Payers", PAYERS_HEADERS, this.payers.map(item => mapObjectToRow("Payers", item)));
    }

    return { created, updated, skipped, totalPayers: this.payers.length };
  }

  public async deletePayer(payerId: string): Promise<void> {
    const index = this.payers.findIndex(item => item.payer_id === payerId);
    if (index === -1) throw new Error("Payer not found.");
    this.payers.splice(index, 1);
    if (this.isConfigured) {
      await this.overwriteTab("Payers", PAYERS_HEADERS, this.payers.map(item => mapObjectToRow("Payers", item)));
    }
  }

  public async getUsers(): Promise<User[]> {
    return this.users;
  }

  private generateUserId(): string {
    const maxExistingId = this.users.reduce((max, user) => {
      const match = /^USR_(\d+)$/i.exec(user.user_id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `USR_${String(maxExistingId + 1).padStart(3, "0")}`;
  }

  public async createUser(user: User): Promise<User> {
    const nextUserId = user.user_id?.trim() || this.generateUserId();
    const access = normalizeUserAccess(user);
    const userToAdd = {
      ...user,
      ...access,
      user_id: nextUserId,
      name: user.name.trim(),
      email: user.email.trim().toLowerCase(),
      active: user.active !== false
    };
    if (this.users.some(item => item.user_id === userToAdd.user_id)) {
      throw new Error("A user with this ID already exists.");
    }
    if (this.users.some(item => item.email.toLowerCase() === userToAdd.email)) {
      throw new Error("A user with this email already exists.");
    }
    this.users.push(userToAdd);
    if (this.isConfigured) {
      await this.overwriteTab("Users", USERS_HEADERS, this.users.map(item => mapObjectToRow("Users", item)));
    }
    return userToAdd;
  }

  public async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    const index = this.users.findIndex(item => item.user_id === userId);
    if (index === -1) throw new Error("User not found.");
    const nextEmail = updates.email?.trim().toLowerCase() || this.users[index].email;
    if (this.users.some(item => item.user_id !== userId && item.email.toLowerCase() === nextEmail)) {
      throw new Error("Another user already uses this email.");
    }
    const access = normalizeUserAccess({
      ...this.users[index],
      ...updates
    });
    this.users[index] = {
      ...this.users[index],
      ...updates,
      ...access,
      user_id: userId,
      name: updates.name?.trim() || this.users[index].name,
      email: nextEmail,
      role: updates.role || this.users[index].role,
      active: updates.active !== undefined ? updates.active : this.users[index].active
    };
    if (this.isConfigured) {
      await this.overwriteTab("Users", USERS_HEADERS, this.users.map(item => mapObjectToRow("Users", item)));
    }
    return this.users[index];
  }

  public async deleteUser(userId: string): Promise<void> {
    const index = this.users.findIndex(item => item.user_id === userId);
    if (index === -1) throw new Error("User not found.");
    this.users.splice(index, 1);
    if (this.isConfigured) {
      await this.overwriteTab("Users", USERS_HEADERS, this.users.map(item => mapObjectToRow("Users", item)));
    }
  }

  public async getSettings(): Promise<Setting[]> {
    return this.settings;
  }

  public async getFeeSchedules(): Promise<FeeSchedule[]> {
    return this.feeSchedules;
  }

  public async getEligibilityCoverage(): Promise<EligibilityCoverage[]> {
    return this.eligibilityCoverage;
  }

  public async getReportFeeSchedules(): Promise<ReportFeeSchedule[]> {
    return this.reportFeeSchedules;
  }

  public async createFeeSchedule(fs: FeeSchedule): Promise<FeeSchedule> {
    const cptCode = String(fs.cpt_code ?? "").trim();
    const year = Number(fs.year);
    const duplicate = this.feeSchedules.find(item =>
      String(item.cpt_code ?? "").trim() === cptCode &&
      Number(item.year) === year
    );
    if (duplicate) {
      throw new Error(`Fee schedule already exists for CPT ${cptCode} year ${year}.`);
    }
    const fsToAdd = {
      ...fs,
      cpt_code: cptCode,
      year,
      id: fs.id || `FSCH-${Date.now()}`,
      max_per_dos: Math.max(1, Math.floor(Number(fs.max_per_dos) || 1))
    };
    this.feeSchedules.push(fsToAdd);
    if (this.isConfigured) {
      const rows = this.feeSchedules.map(f => mapObjectToRow("FeeSchedules", f));
      await this.overwriteTab("FeeSchedules", FEESCHEDULES_HEADERS, rows);
    }
    return fsToAdd;
  }

  public async updateFeeSchedule(id: string, updated: FeeSchedule): Promise<FeeSchedule> {
    const index = this.feeSchedules.findIndex(f => f.id === id);
    if (index === -1) {
      throw new Error(`Fee schedule with ID ${id} not found.`);
    }
    const cptCode = String(updated.cpt_code ?? "").trim();
    const year = Number(updated.year);
    const duplicate = this.feeSchedules.find(item =>
      item.id !== id &&
      String(item.cpt_code ?? "").trim() === cptCode &&
      Number(item.year) === year
    );
    if (duplicate) {
      throw new Error(`Fee schedule already exists for CPT ${cptCode} year ${year}.`);
    }
    this.feeSchedules[index] = {
      ...updated,
      cpt_code: cptCode,
      year,
      id,
      max_per_dos: Math.max(1, Math.floor(Number(updated.max_per_dos) || 1))
    };
    if (this.isConfigured) {
      const rows = this.feeSchedules.map(f => mapObjectToRow("FeeSchedules", f));
      await this.overwriteTab("FeeSchedules", FEESCHEDULES_HEADERS, rows);
    }
    return this.feeSchedules[index];
  }

  public async deleteFeeSchedule(id: string): Promise<boolean> {
    const index = this.feeSchedules.findIndex(f => f.id === id);
    if (index === -1) {
      return false;
    }
    this.feeSchedules.splice(index, 1);
    if (this.isConfigured) {
      const rows = this.feeSchedules.map(f => mapObjectToRow("FeeSchedules", f));
      await this.overwriteTab("FeeSchedules", FEESCHEDULES_HEADERS, rows);
    }
    return true;
  }

  public async updateSettings(key: string, value: string): Promise<Setting> {
    const index = this.settings.findIndex(s => s.setting_key === key);
    if (index !== -1) {
      this.settings[index].setting_value = value;
      if (this.isConfigured) {
        const rows = this.settings.map(s => mapObjectToRow("Settings", s));
        await this.overwriteTab("Settings", SETTINGS_HEADERS, rows);
      }
      return this.settings[index];
    }
    const created: Setting = {
      setting_key: key,
      setting_value: value,
      description: `Created by System Settings on ${new Date().toISOString()}.`
    };
    this.settings.push(created);
    if (this.isConfigured) {
      const rows = this.settings.map(s => mapObjectToRow("Settings", s));
      await this.overwriteTab("Settings", SETTINGS_HEADERS, rows);
    }
    return created;
  }

  public async addAuditLog(auditRecord: AuditLog): Promise<void> {
    this.auditLogs.unshift(auditRecord);
    if (this.isConfigured) {
      await this.appendRow("Audit_Log", mapObjectToRow("Audit_Log", auditRecord));
    }
  }

  public async uploadSupportingDocument({
    claimId,
    fileName,
    mimeType,
    buffer,
    uploadedBy
  }: {
    claimId: string;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    uploadedBy: string;
  }): Promise<{ fileId: string; name: string; mimeType: string; size: number; webViewLink: string; webContentLink: string }> {
    const folderId = process.env.SUPPORTING_DOCUMENTS_FOLDER_ID;
    if (!folderId) {
      throw new Error("SUPPORTING_DOCUMENTS_FOLDER_ID is not configured.");
    }
    if (!this.isConfigured || !this.drive) {
      throw new Error("Google Drive is not configured.");
    }

    const safeName = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 140) || "supporting-document";
    const driveFileName = `${claimId}_${new Date().toISOString().replace(/[:.]/g, "-")}_${safeName}`;
    const response = await this.drive.files.create({
      requestBody: {
        name: driveFileName,
        parents: [folderId],
        description: `Supporting document for claim ${claimId}. Uploaded by ${uploadedBy}.`
      },
      media: {
        mimeType,
        body: Readable.from(buffer)
      },
      fields: "id,name,mimeType,size,webViewLink,webContentLink",
      supportsAllDrives: true
    });

    return {
      fileId: response.data.id || "",
      name: response.data.name || driveFileName,
      mimeType: response.data.mimeType || mimeType,
      size: Number(response.data.size || buffer.length),
      webViewLink: response.data.webViewLink || "",
      webContentLink: response.data.webContentLink || ""
    };
  }

  private async ensureBackupsIndexTab(): Promise<void> {
    if (!this.isConfigured || !this.sheets) return;
    const workbook = await this.sheets.spreadsheets.get({
      spreadsheetId: this.sheetId,
      fields: "sheets.properties.title"
    });
    const titles = (workbook.data.sheets || []).map((sheet: any) => sheet.properties?.title).filter(Boolean);
    if (!titles.includes("Backups_Index")) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: "Backups_Index" } } }]
        }
      });
    }
    const current = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: "Backups_Index!A1:I1"
    });
    const headerRow = current.data.values?.[0] || [];
    if (headerRow.length === 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: "Backups_Index!A1",
        valueInputOption: "RAW",
        requestBody: { values: [BACKUPS_INDEX_HEADERS] }
      });
    }
  }

  private async appendBackupIndex(record: BackupRecord): Promise<void> {
    await this.ensureBackupsIndexTab();
    await this.appendRow("Backups_Index", mapObjectToRow("Backups_Index", record));
  }

  private getBackupFolderId() {
    return this.getSettingValue("BACKUP_DRIVE_FOLDER_ID", process.env.BACKUP_DRIVE_FOLDER_ID || "").trim();
  }

  private async getSourceSpreadsheetParentIds(): Promise<string[]> {
    if (!this.drive || !this.sheetId) return [];
    const response = await this.drive.files.get({
      fileId: this.sheetId,
      fields: "parents",
      supportsAllDrives: true
    });
    return Array.isArray(response.data.parents) ? response.data.parents.slice(0, 1) : [];
  }

  public getBackupConfiguration() {
    const enabled = this.getSettingValue("BACKUP_ENABLED", "true") !== "false";
    const frequencyHours = Number(this.getSettingValue("BACKUP_FREQUENCY_HOURS", "24"));
    const lastBackupAt = this.getSettingValue("LAST_BACKUP_AT", "");
    const nextBackupAt = lastBackupAt && Number.isFinite(frequencyHours) && frequencyHours > 0
      ? new Date(new Date(lastBackupAt).getTime() + frequencyHours * 60 * 60 * 1000).toISOString()
      : "";
    return {
      enabled,
      frequencyHours: Number.isFinite(frequencyHours) && frequencyHours > 0 ? frequencyHours : 24,
      backupDriveFolderId: this.getBackupFolderId(),
      lastBackupAt,
      nextBackupAt,
      googleDriveConfigured: Boolean(this.isConfigured && this.drive),
      sourceSpreadsheetId: this.sheetId || ""
    };
  }

  public async updateBackupConfiguration({
    enabled,
    frequencyHours,
    backupDriveFolderId
  }: {
    enabled: boolean;
    frequencyHours: number;
    backupDriveFolderId: string;
  }) {
    await this.updateSettings("BACKUP_ENABLED", enabled ? "true" : "false");
    await this.updateSettings("BACKUP_FREQUENCY_HOURS", String(Math.max(1, Math.floor(Number(frequencyHours) || 24))));
    await this.updateSettings("BACKUP_DRIVE_FOLDER_ID", backupDriveFolderId.trim());
    return this.getBackupConfiguration();
  }

  public async createSpreadsheetBackup(createdBy: string, notes = "Manual backup from System Settings."): Promise<BackupRecord> {
    if (!this.isConfigured || !this.drive || !this.sheetId) {
      throw new Error("Google Drive backup is not configured.");
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const backupId = `BKP-${timestamp}`;
    const backupName = `itera-claim-reconciliation-backup-${timestamp}`;
    const configuredFolderId = this.getBackupFolderId();
    const parentIds = configuredFolderId ? [configuredFolderId] : await this.getSourceSpreadsheetParentIds();
    const response = await this.drive.files.copy({
      fileId: this.sheetId,
      requestBody: {
        name: backupName,
        parents: parentIds.length > 0 ? parentIds : undefined,
        description: `ITERA Claim Reconciliation backup ${backupId}. Created by ${createdBy}. ${notes}`,
        appProperties: {
          iteraBackup: "true",
          sourceSpreadsheetId: this.sheetId,
          backupId
        }
      },
      fields: "id,name,webViewLink,createdTime",
      supportsAllDrives: true
    });

    const record: BackupRecord = {
      backup_id: backupId,
      backup_file_id: response.data.id || "",
      backup_file_name: response.data.name || backupName,
      backup_drive_url: response.data.webViewLink || "",
      created_by: createdBy,
      created_at: response.data.createdTime || now.toISOString(),
      source_spreadsheet_id: this.sheetId,
      status: "Created",
      notes
    };

    await this.appendBackupIndex(record);
    await this.updateSettings("LAST_BACKUP_AT", record.created_at);
    return record;
  }

  public async listSpreadsheetBackups(): Promise<BackupRecord[]> {
    if (!this.isConfigured || !this.drive || !this.sheetId) return [];
    const folderId = this.getBackupFolderId();
    const queryParts = [
      "trashed = false",
      "(appProperties has { key='iteraBackup' and value='true' } or name contains 'itera-claim-reconciliation-backup-')"
    ];
    if (folderId) queryParts.push(`'${folderId.replace(/'/g, "\\'")}' in parents`);

    const response = await this.drive.files.list({
      q: queryParts.join(" and "),
      fields: "files(id,name,webViewLink,createdTime,appProperties)",
      orderBy: "createdTime desc",
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    return (response.data.files || []).map((file: any): BackupRecord => ({
      backup_id: file.appProperties?.backupId || `BKP-${String(file.createdTime || "").replace(/[:.]/g, "-")}`,
      backup_file_id: file.id || "",
      backup_file_name: file.name || "",
      backup_drive_url: file.webViewLink || "",
      created_by: "Drive",
      created_at: file.createdTime || "",
      source_spreadsheet_id: file.appProperties?.sourceSpreadsheetId || this.sheetId || "",
      status: "Available",
      notes: "Google Drive spreadsheet backup."
    }));
  }

  public async maybeCreateScheduledBackup(createdBy = "system@itera.health"): Promise<BackupRecord | null> {
    const config = this.getBackupConfiguration();
    if (!config.enabled || !config.googleDriveConfigured || this.scheduledBackupInFlight) return null;
    const last = config.lastBackupAt ? new Date(config.lastBackupAt).getTime() : 0;
    const dueAt = last + config.frequencyHours * 60 * 60 * 1000;
    if (last > 0 && Date.now() < dueAt) return null;

    this.scheduledBackupInFlight = true;
    try {
      return await this.createSpreadsheetBackup(createdBy, `Scheduled backup every ${config.frequencyHours} hour(s).`);
    } finally {
      this.scheduledBackupInFlight = false;
    }
  }

  public async restoreSpreadsheetBackup(backupFileId: string, restoredBy: string): Promise<{ restoredTabs: string[]; preRestoreBackup: BackupRecord }> {
    if (!this.isConfigured || !this.sheets || !this.sheetId) {
      throw new Error("Google Sheets restore is not configured.");
    }
    if (!backupFileId.trim()) {
      throw new Error("backupFileId is required.");
    }

    const preRestoreBackup = await this.createSpreadsheetBackup(restoredBy, `Automatic safety backup before restoring from ${backupFileId}.`);
    const restoredTabs: string[] = [];

    for (const tabName of BACKUP_RESTORE_TABS) {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: backupFileId,
        range: `${tabName}!A:ZZ`
      }).catch(() => null);
      const values = response?.data?.values || [];
      const backupHeaders = values[0] || getHeadersForTab(tabName);
      const dataRows = values.slice(1).filter((row: unknown[]) => hasNonEmptySheetRow(row));
      const mappedRows = dataRows
        .map((row: string[]) => mapRowToObject(tabName, backupHeaders, row))
        .map((record: any) => mapObjectToRow(tabName, record));
      await this.overwriteTabStrict(tabName, getHeadersForTab(tabName), mappedRows);
      restoredTabs.push(tabName);
    }

    await this.syncWithGoogleSheets();
    await this.addAuditLog({
      audit_id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      claim_id: "SYSTEM",
      action_type: "Update",
      field_name: "spreadsheet_restore",
      previous_value: this.sheetId || "",
      new_value: backupFileId,
      reason: `Spreadsheet restored from backup by ${restoredBy}. Pre-restore backup: ${preRestoreBackup.backup_file_id}.`,
      changed_by: restoredBy,
      changed_at: new Date().toISOString()
    });

    return { restoredTabs, preRestoreBackup };
  }

  public async clearOperationalData(): Promise<{ clearedSheets: string[]; counts: Record<string, number> }> {
    const counts = {
      Claims: this.claims.length,
      Payments: this.payments.length,
      Notes: this.notes.length,
      Audit_Log: this.auditLogs.length
    };

    this.claims = [];
    this.payments = [];
    this.notes = [];
    this.auditLogs = [];

    if (this.isConfigured) {
      await this.overwriteTabStrict("Claims", CLAIMS_HEADERS, []);
      await this.overwriteTabStrict("Payments", PAYMENTS_HEADERS, []);
      await this.overwriteTabStrict("Notes", NOTES_HEADERS, []);
      await this.clearTab("Audit_Log");
    }

    return {
      clearedSheets: ["Claims", "Payments", "Notes", "Audit_Log"],
      counts
    };
  }

  public async resetClaimsToSeeds(): Promise<void> {
    if (!this.useSeedData) {
      throw new Error("Seed reset is disabled. Set USE_SEED_DATA=true to enable demo data.");
    }
    this.claims = [...SEED_CLAIMS];
    if (this.isConfigured) {
      const rows = this.claims.map(c => mapObjectToRow("Claims", c));
      await this.overwriteTab("Claims", CLAIMS_HEADERS, rows);
      console.log("Google Sheets Claims tab successfully reset to seeds!");
    }
  }
}

function normalizeAuditComparableValue(field: keyof Claim, value: unknown) {
  if (value === undefined || value === null) return "";
  if (field !== "service_lines_json") return value;

  try {
    const lines = typeof value === "string" && value.trim() ? JSON.parse(value) : [];
    if (!Array.isArray(lines)) return "";
    return JSON.stringify(lines.map(line => ({
      cpt: String(line?.cpt ?? ""),
      charged: Number(line?.charged || 0),
      allowed: Number(line?.allowed || 0),
      adj: Number(line?.adj || 0),
      patResp: Number(line?.patResp || 0),
      paid: Number(line?.paid || 0),
      secondaryPaid: Number(line?.secondaryPaid || 0),
      secondaryPayerId: String(line?.secondaryPayerId ?? ""),
      hasSecondaryPayment: Boolean(line?.hasSecondaryPayment),
      balance: Number(line?.balance || 0),
      codes: Array.isArray(line?.codes) ? line.codes.map(String).sort() : [],
      status: String(line?.status ?? ""),
      notes: Array.isArray(line?.notes)
        ? line.notes.map((note: any) => ({
            id: String(note?.id ?? ""),
            text: String(note?.text ?? "")
          }))
        : [],
      nextAction: String(line?.nextAction ?? ""),
      eftNumber: String(line?.eftNumber ?? ""),
      paymentDate: String(line?.paymentDate ?? "")
    })));
  } catch {
    return String(value);
  }
}

function auditValuesDiffer(field: keyof Claim, prev: unknown, curr: unknown) {
  return normalizeAuditComparableValue(field, prev) !== normalizeAuditComparableValue(field, curr);
}

// --- Diff Helper ---
export function getClaimDifferences(prev: Claim, curr: Claim): { field: string, prev: any, curr: any, reason?: string }[] {
  const diffs: { field: string, prev: any, curr: any, reason?: string }[] = [];
  const fieldsToCheck: Array<keyof Claim> = [
    "claim_status",
    "claim_classification",
    "billed_by",
    "payment_received_by",
    "billed_charge",
    "allowed_amount",
    "paid_amount",
    "insurance_adjustment",
    "denied_amount",
    "write_off_amount",
    "uncollectible_amount",
    "itera_direct_collection",
    "provider_direct_collection",
    "payment_to_physician",
    "locked",
    "lock_reason",
    "error_flag",
    "error_category",
    "correction_status",
    "resubmission_date",
    "corrected_claim_reference",
    "service_lines_json"
  ];

  fieldsToCheck.forEach(field => {
    if (auditValuesDiffer(field, prev[field], curr[field])) {
      let reason = "";
      if (field === "locked" && curr.locked) reason = curr.lock_reason || "Locked claim due to error";
      else if (field === "locked" && !curr.locked) reason = "Unlocked claim";
      else if (field === "error_flag" && curr.error_flag) reason = `Marked error: ${curr.error_category}`;
      else if (field === "error_flag" && !curr.error_flag) reason = "Cleared error status";
      else if (field === "claim_status") reason = `Status transitioned from ${prev.claim_status} to ${curr.claim_status}`;
      else if (field === "claim_classification") reason = `Classification transitioned from ${prev.claim_classification} to ${curr.claim_classification}`;
      else if (field === "service_lines_json") {
        try {
          const prevLines = prev.service_lines_json ? JSON.parse(prev.service_lines_json) : [];
          const currLines = curr.service_lines_json ? JSON.parse(curr.service_lines_json) : [];
          
          // Let's compare notes to generate a highly detailed and friendly reason
          let detail = "Service lines updated";
          const changes: string[] = [];
          
          // Find difference in notes
          for (let i = 0; i < Math.max(prevLines.length, currLines.length); i++) {
            const pLine = prevLines[i];
            const cLine = currLines[i];
            
            if (pLine && cLine && pLine.cpt === cLine.cpt) {
              const pNotes = pLine.notes || [];
              const cNotes = cLine.notes || [];
              
              if (pNotes.length < cNotes.length) {
                // Note was added
                const addedNote = cNotes[cNotes.length - 1];
                detail = `CPT ${cLine.cpt} Note added: "${addedNote.text}"`;
                break;
              } else if (pNotes.length > cNotes.length) {
                // Note was deleted
                const deletedNote = pNotes.find((pn: any) => !cNotes.some((cn: any) => cn.id === pn.id));
                detail = `CPT ${cLine.cpt} Note deleted: "${deletedNote?.text || ""}"`;
                break;
              } else {
                // Note might have been edited
                for (let j = 0; j < pNotes.length; j++) {
                  if (pNotes[j].text !== cNotes[j].text) {
                    detail = `CPT ${cLine.cpt} Note edited from "${pNotes[j].text}" to "${cNotes[j].text}"`;
                    break;
                  }
                }
              }
            }
          }

          if (detail === "Service lines updated") {
            currLines.forEach((cLine: any, index: number) => {
              const pLine = prevLines.find((line: any) => line?.cpt === cLine?.cpt) || prevLines[index];
              if (!pLine) {
                changes.push(`CPT ${cLine.cpt} added`);
                return;
              }

              ([
                ["status", "status"],
                ["paid", "primary paid"],
                ["secondaryPaid", "secondary paid"],
                ["secondaryPayerId", "secondary payer"],
                ["allowed", "allowed"],
                ["patResp", "patient resp."],
                ["balance", "balance"],
                ["nextAction", "next action"],
                ["eftNumber", "EFT"],
                ["paymentDate", "payment date"]
              ] as const).forEach(([key, label]) => {
                if (String(pLine[key] ?? "") !== String(cLine[key] ?? "")) {
                  changes.push(`CPT ${cLine.cpt} ${label} changed`);
                }
              });

              if (JSON.stringify(pLine.codes || []) !== JSON.stringify(cLine.codes || [])) {
                changes.push(`CPT ${cLine.cpt} ERA codes changed`);
              }
            });

            prevLines.forEach((pLine: any) => {
              if (!currLines.some((line: any) => line?.cpt === pLine?.cpt)) {
                changes.push(`CPT ${pLine.cpt} removed`);
              }
            });

            if (changes.length > 0) {
              detail = changes.length > 3 ? `${changes.slice(0, 3).join("; ")}; +${changes.length - 3} more` : changes.join("; ");
            }
          }
          reason = detail;
        } catch (e) {
          reason = "Service lines or CPT notes modified";
        }
      }
      
      diffs.push({
        field,
        prev: prev[field],
        curr: curr[field],
        reason
      });
    }
  });

  return diffs;
}

// --- Google Sheets Header Columns & Schema Mappers ---

const CLAIMS_HEADERS = [
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
  "last_note", "service_lines_json", "created_at", "updated_at", "updated_by"
  ,"cpt_description", "submission_date", "itera_billed_fee", "billable_flag", "voided_flag", "corrected_claim_flag",
  "deleted_flag", "deleted_at", "deleted_by", "delete_reason"
];

const PAYMENTS_HEADERS = [
  "payment_id", "claim_id", "payment_date", "payment_received_by", "payer_name", "amount",
  "check_or_eft_number", "era_id", "eob_id", "payment_source", "notes", "created_at", "updated_at"
];

const NOTES_HEADERS = [
  "note_id", "claim_id", "note_type", "note_text", "created_by", "created_at"
];

const AUDIT_LOGS_HEADERS = [
  "audit_id", "claim_id", "action_type", "field_name", "previous_value", "new_value", "reason", "changed_by", "changed_at"
];

const PROVIDERS_HEADERS = [
  "provider_id", "provider_name", "npi", "practice_id", "practice_name", "active"
];

const PAYERS_HEADERS = [
  "payer_id", "payer_name", "payer_type", "pverify_payer_code",
  "eligibility_supported", "claim_status_supported", "dental_eligibility_supported", "active"
];

const USERS_HEADERS = [
  "user_id", "name", "email", "role", "menu_access", "provider_access", "active"
];

const SETTINGS_HEADERS = [
  "setting_key", "setting_value", "description"
];

const FEESCHEDULES_HEADERS = [
  "id", "cpt_code", "year", "semester1_rate", "semester2_rate", "max_per_dos", "description"
];

const REPORT_FEESCHEDULE_HEADERS = [
  "fee_schedule_id", "cpt_hcpcs", "cpt_description", "service_type",
  "unit_price", "itera_fee", "effective_date", "active"
];

const ELIGIBILITY_COVERAGE_HEADERS = [
  "coverage_id", "practice_id", "practice_name", "service_type", "period",
  "total_eligible_patients", "notes", "created_at", "updated_at"
];

const BACKUPS_INDEX_HEADERS = [
  "backup_id", "backup_file_id", "backup_file_name", "backup_drive_url",
  "created_by", "created_at", "source_spreadsheet_id", "status", "notes"
];

const BACKUP_RESTORE_TABS = [
  "Claims",
  "Payments",
  "Notes",
  "Audit_Log",
  "Providers",
  "Payers",
  "Users",
  "Settings",
  "FeeSchedules",
  "Fee_Schedule",
  "Eligibility_Coverage"
];

function getHeadersForTab(tabName: string): string[] {
  if (tabName === "Claims") return CLAIMS_HEADERS;
  if (tabName === "Payments") return PAYMENTS_HEADERS;
  if (tabName === "Notes") return NOTES_HEADERS;
  if (tabName === "Audit_Log") return AUDIT_LOGS_HEADERS;
  if (tabName === "Providers") return PROVIDERS_HEADERS;
  if (tabName === "Payers") return PAYERS_HEADERS;
  if (tabName === "Users") return USERS_HEADERS;
  if (tabName === "Settings") return SETTINGS_HEADERS;
  if (tabName === "FeeSchedules") return FEESCHEDULES_HEADERS;
  if (tabName === "Fee_Schedule") return REPORT_FEESCHEDULE_HEADERS;
  if (tabName === "Eligibility_Coverage") return ELIGIBILITY_COVERAGE_HEADERS;
  if (tabName === "Backups_Index") return BACKUPS_INDEX_HEADERS;
  return [];
}

/**
 * Maps a row array from sheets to a TypeScript object record
 */
function mapRowToObject(tabName: string, headers: string[], row: string[]): any {
  const obj: any = {};
  headers.forEach((header, index) => {
    const rawVal = row[index] !== undefined ? row[index] : "";
    
    // Parse boolean, numbers and strings correctly
    if (String(rawVal).toLowerCase() === "true") {
      obj[header] = true;
    } else if (String(rawVal).toLowerCase() === "false") {
      obj[header] = false;
    } else if (rawVal === "") {
      obj[header] = "";
    } else if (/^\d+(\.\d+)?$/.test(rawVal) && !["claim_id", "patient_id", "provider_npi", "npi", "check_or_eft_number", "carc_code", "rarc_code", "corrected_claim_reference", "payer_id", "pverify_payer_code"].includes(header)) {
      obj[header] = Number(rawVal);
    } else {
      obj[header] = rawVal;
    }
  });

  return obj;
}

/**
 * Maps a TypeScript object record to a flat row array for sheets
 */
function mapObjectToRow(tabName: string, obj: any): any[] {
  const headers = getHeadersForTab(tabName);

  return headers.map(h => {
    const val = obj[h];
    if (val === undefined || val === null) return "";
    return String(val);
  });
}
