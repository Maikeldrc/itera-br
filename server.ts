/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import zlib from "zlib";
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
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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
  if (reportTestFailures.length === 0) {
    testResults.push({ name: "Reports Engine aggregation, coverage and aging", success: true });
  } else {
    reportTestFailures.forEach(error => testResults.push({ name: "Reports Engine", success: false, error }));
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
  app.post("/api/sync", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
    const result = await sheetsService.syncWithGoogleSheets();
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  });

  // GET Claims (with filter, search, sorting)
  app.get("/api/claims", async (req, res) => {
    try {
      const claims = await sheetsService.getClaims();
      res.json(claims);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to retrieve claims" });
    }
  });

  // GET Single Claim Detail
  app.get("/api/claims/:id", async (req, res) => {
    try {
      const claims = await sheetsService.getClaims();
      const claim = claims.find(c => c.claim_id === req.params.id);
      if (!claim) {
        return res.status(404).json({ error: "Claim not found" });
      }
      res.json(claim);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to retrieve claim" });
    }
  });

  // POST Create New Claim
  app.post("/api/claims", requireRoles(UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist), async (req: AppRequest, res) => {
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
      const pPercent = Number(settings.find(s => s.setting_key === "PROVIDER_SHARE_PERCENT")?.setting_value || 70);
      const iPercent = Number(settings.find(s => s.setting_key === "ITERA_SHARE_PERCENT")?.setting_value || 30);
      
      const calculated = calculateClaimFinancials(rawClaim, {
        providerSharePercent: pPercent,
        iteraSharePercent: iPercent
      });

      // Validate
      const validationErrors = validateClaim(calculated);
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
  app.put("/api/claims/:id", requireRoles(UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist), async (req: AppRequest, res) => {
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

      // Capture payer state BEFORE merge so we can detect changes explicitly
      const prevPayerId   = existing.payer_id;
      const prevPayerName = existing.payer_name;

      // Merge and calculate financials
      const merged = { ...existing, ...rawClaimUpdates };
      
      const settings = await sheetsService.getSettings();
      const pPercent = Number(settings.find(s => s.setting_key === "PROVIDER_SHARE_PERCENT")?.setting_value || 70);
      const iPercent = Number(settings.find(s => s.setting_key === "ITERA_SHARE_PERCENT")?.setting_value || 30);

      const calculated = calculateClaimFinancials(merged, {
        providerSharePercent: pPercent,
        iteraSharePercent: iPercent
      });

      // Validate
      const validationErrors = validateClaim(calculated);
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

      console.log("[DEBUG Payer Change] prevPayerId:", prevPayerId);
      console.log("[DEBUG Payer Change] updated.payer_id:", updated.payer_id);
      console.log("[DEBUG Payer Change] rawClaimUpdates:", rawClaimUpdates);

      // Explicit insurance change audit log — bypass diff mechanism for reliability
      if (prevPayerId !== updated.payer_id) {
        console.log("[DEBUG Payer Change] Payer change detected! Creating audit log...");
        const changeReason = (rawClaimUpdates.insurance_change_reason as string) || "Cambio reportado al procesar ERA";
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
  app.delete("/api/claims/:id", requireRoles(UserRole.Admin), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const reason = String(req.body?.reason || "").trim() || "Claim entered in error";
      const deleted = await sheetsService.softDeleteClaim(req.params.id, operatorEmail, reason);
      res.json({ success: true, claim: deleted });
    } catch (err: any) {
      const status = /not found/i.test(err.message || "") ? 404 : 500;
      res.status(status).json({ error: err.message || "Failed to delete claim" });
    }
  });

  // POST Bulk Update Claims
  app.post("/api/claims/bulk-update", requireRoles(UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const { claimIds, updates } = req.body;

      if (!claimIds || !Array.isArray(claimIds) || claimIds.length === 0) {
        return res.status(400).json({ error: "No claim IDs provided." });
      }

      // To handle bulk financial updates properly, we fetch, merge, recompute financials, then save each
      const settings = await sheetsService.getSettings();
      const pPercent = Number(settings.find(s => s.setting_key === "PROVIDER_SHARE_PERCENT")?.setting_value || 70);
      const iPercent = Number(settings.find(s => s.setting_key === "ITERA_SHARE_PERCENT")?.setting_value || 30);

      let successCount = 0;
      for (const id of claimIds) {
        const claim = sheetsService.claims.find(c => c.claim_id === id);
        if (claim && !claim.deleted_flag) {
          const merged = { ...claim, ...updates };
          const recomputed = calculateClaimFinancials(merged, {
            providerSharePercent: pPercent,
            iteraSharePercent: iPercent
          });

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
  app.get("/api/payments", async (req, res) => {
    try {
      const payments = await sheetsService.getPayments();
      res.json(payments);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load payments" });
    }
  });

  // POST Create Payment and link to Claim
  app.post("/api/payments", requireRoles(UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const paymentData = req.body as Payment;

      if (!paymentData.claim_id) {
        return res.status(400).json({ error: "Claim ID is required for a payment." });
      }
      if (!Number.isFinite(Number(paymentData.amount)) || Number(paymentData.amount) <= 0) {
        return res.status(400).json({ error: "Payment amount must be greater than zero." });
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
        const pPercent = Number(settings.find(s => s.setting_key === "PROVIDER_SHARE_PERCENT")?.setting_value || 70);
        const iPercent = Number(settings.find(s => s.setting_key === "ITERA_SHARE_PERCENT")?.setting_value || 30);

        const calculated = calculateClaimFinancials(claim, {
          providerSharePercent: pPercent,
          iteraSharePercent: iPercent
        });

        // Save
        await sheetsService.updateClaim(claim.claim_id, calculated, operatorEmail);
      }

      res.status(211).json(payment);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to log payment" });
    }
  });

  // GET Notes
  app.get("/api/notes", async (req, res) => {
    try {
      const notes = await sheetsService.getNotes();
      res.json(notes);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load notes" });
    }
  });

  // POST Create Note for Claim
  app.post("/api/notes", requireRoles(UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist), async (req: AppRequest, res) => {
    try {
      const authorEmail = getOperatorEmail(req);
      const noteData = req.body as Note;

      if (!noteData.claim_id) {
        return res.status(400).json({ error: "Claim ID is required for a note." });
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
  app.get("/api/audit-logs", requireRoles(UserRole.Admin, UserRole.BillingManager, UserRole.Auditor), async (req, res) => {
    try {
      const logs = await sheetsService.getAuditLogs();
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load audit logs" });
    }
  });

  // GET Providers
  app.get("/api/providers", async (req, res) => {
    res.json(await sheetsService.getProviders());
  });

  app.post("/api/providers", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
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

  app.put("/api/providers/:id", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
    try {
      res.json(await sheetsService.updateProvider(req.params.id, req.body));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update provider" });
    }
  });

  app.delete("/api/providers/:id", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
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

  app.post("/api/payers", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
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

  app.put("/api/payers/:id", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
    try {
      res.json(await sheetsService.updatePayer(req.params.id, req.body));
    } catch (err: any) {
      res.status(404).json({ error: err.message || "Failed to update payer." });
    }
  });

  app.delete("/api/payers/:id", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
    try {
      await sheetsService.deletePayer(req.params.id);
      res.status(204).send();
    } catch (err: any) {
      res.status(404).json({ error: err.message || "Failed to delete payer." });
    }
  });

  // GET Users
  app.get("/api/users", async (req, res) => {
    res.json(await sheetsService.getUsers());
  });

  app.post("/api/users", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
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

  app.put("/api/users/:id", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
    try {
      if (req.body.role && !Object.values(UserRole).includes(req.body.role)) {
        return res.status(400).json({ error: "Invalid user role." });
      }
      res.json(await sheetsService.updateUser(req.params.id, req.body));
    } catch (err: any) {
      res.status(404).json({ error: err.message || "Failed to update user." });
    }
  });

  app.delete("/api/users/:id", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
    try {
      await sheetsService.deleteUser(req.params.id);
      res.status(204).send();
    } catch (err: any) {
      res.status(404).json({ error: err.message || "Failed to delete user." });
    }
  });

  // GET Settings
  app.get("/api/settings", async (req, res) => {
    res.json(await sheetsService.getSettings());
  });

  // PUT Settings
  app.put("/api/settings", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
    try {
      const { key, value } = req.body;
      const updated = await sheetsService.updateSettings(key, value);
      res.json(updated);
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
  app.post("/api/fee-schedules", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
    try {
      const created = await sheetsService.createFeeSchedule(req.body);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create fee schedule" });
    }
  });

  // PUT Update Fee Schedule
  app.put("/api/fee-schedules/:id", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
    try {
      const updated = await sheetsService.updateFeeSchedule(req.params.id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update fee schedule" });
    }
  });

  // DELETE Fee Schedule
  app.delete("/api/fee-schedules/:id", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req, res) => {
    try {
      const success = await sheetsService.deleteFeeSchedule(req.params.id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete fee schedule" });
    }
  });

  // POST Import Claims CSV
  app.post("/api/import-csv", requireRoles(UserRole.Admin, UserRole.BillingManager), async (req: AppRequest, res) => {
    try {
      const operatorEmail = getOperatorEmail(req);
      const { rows, fileBase64 } = req.body;
      const importRows = fileBase64 ? parseXlsxRows(fileBase64) : rows;

      if (!importRows || !Array.isArray(importRows)) {
        return res.status(400).json({ error: "Rows or XLSX file content are required for import." });
      }

      const settings = await sheetsService.getSettings();
      const pPercent = Number(settings.find(s => s.setting_key === "PROVIDER_SHARE_PERCENT")?.setting_value || 70);
      const iPercent = Number(settings.find(s => s.setting_key === "ITERA_SHARE_PERCENT")?.setting_value || 30);
      const providers = await sheetsService.getProviders();
      const payers = await sheetsService.getPayers();
      const feeSchedules = await sheetsService.getFeeSchedules();
      const existingClaims = await sheetsService.getClaims();

      const importedClaims: Claim[] = [];
      const errors: { row: number; claimId?: string; errors: string[] }[] = [];

      for (let i = 0; i < importRows.length; i++) {
        const row = importRows[i];
        const rowErrors: string[] = [];
        const isBillingWorklist = !!(row.MRN || row["Provider NPI"] || row.Code1 || row["Month Of"]);

        if (isBillingWorklist) {
          const mrn = String(row.MRN || "").trim();
          const providerNpi = String(row["Provider NPI"] || "").trim();
          const payerId = String(row["Payer ID"] || "").trim();
          const monthDate = excelSerialToIsoDate(String(row["Month Of"] || ""));
          const serviceFrom = firstDayOfMonth(monthDate);
          const serviceTo = monthDate || serviceFrom;
          const year = Number((serviceTo || serviceFrom).slice(0, 4));
          const month = Number((serviceTo || serviceFrom).slice(5, 7));
          const isSemester2 = month >= 7;
          const provider = providers.find(item => item.npi === providerNpi && item.active !== false);
          const payer = payers.find(item => item.payer_id === payerId && item.active !== false);
          const codes = ["Code1", "Code2", "Code3", "Code4", "Code5"]
            .map(key => String(row[key] || "").trim())
            .filter(Boolean);

          if (!mrn) rowErrors.push("MRN is required.");
          if (!providerNpi) rowErrors.push("Provider NPI is required.");
          if (!provider) rowErrors.push(`Provider NPI ${providerNpi || "(blank)"} is not registered in Settings.`);
          if (!payerId) rowErrors.push("Payer ID is required.");
          if (!payer) rowErrors.push(`Payer ID ${payerId || "(blank)"} is not registered in Settings.`);
          if (!serviceTo) rowErrors.push("Month Of is required.");
          if (codes.length === 0) rowErrors.push("At least one CPT code is required.");

          const unitsByCode = codes.reduce<Record<string, number>>((acc, code) => {
            acc[code] = (acc[code] || 0) + 1;
            return acc;
          }, {});
          const uniqueCodes = Object.keys(unitsByCode);
          const serviceLines = uniqueCodes.map(code => {
            const fee = feeSchedules.find(item => textValue(item.cpt_code) === code && Number(item.year) === year);
            if (!fee) {
              rowErrors.push(`Fee Schedule missing for CPT ${code} year ${year}.`);
              return null;
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
            [...existingClaims, ...importedClaims].map(claim => claim.claim_id),
            mrn,
            serviceTo
          );
          const claimObj: Partial<Claim> = {
            claim_id: claimId,
            patient_id: mrn,
            patient_display_name_masked: String(row.Patient || `${row["First Name"] || ""} ${row["Last Name"] || ""}`).trim() || `MRN ${mrn}`,
            practice_id: provider!.practice_id,
            practice_name: provider!.practice_name,
            provider_id: provider!.provider_id,
            provider_name: provider!.provider_name,
            provider_npi: provider!.npi,
            payer_id: payer!.payer_id,
            payer_name: String(row["Primary Insurance Name"] || payer!.payer_name).trim() || payer!.payer_name,
            service_type: String(row.Service || "").trim() || "CCM",
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
            last_note: `Imported as Draft from billing worklist. Policy: ${row["Primary Policy Number"] || "N/A"}. Eligibility: ${row.Eligibility || "N/A"}.`,
            service_lines_json: JSON.stringify(serviceLines)
          };

          const calculated = calculateClaimFinancials(claimObj, {
            providerSharePercent: pPercent,
            iteraSharePercent: iPercent
          });
          const validationErrors = validateClaim(calculated);
          validationErrors.push(...validateClaimCptRepeatLimits(calculated, feeSchedules));
          validationErrors.push(...validateClaimCptRepeatLimitsAgainstExisting(
            calculated,
            feeSchedules,
            [...existingClaims, ...importedClaims]
          ));
          if (validationErrors.length > 0) {
            errors.push({ row: i + 1, claimId: calculated.claim_id, errors: validationErrors });
          } else {
            try {
              const added = await sheetsService.createClaim(calculated, operatorEmail);
              importedClaims.push(added);
            } catch (err: any) {
              errors.push({ row: i + 1, claimId: calculated.claim_id, errors: [err.message || "Failed to write claim"] });
            }
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
        const calculated = calculateClaimFinancials(claimObj, {
          providerSharePercent: pPercent,
          iteraSharePercent: iPercent
        });

        // Validate
        const validationErrors = validateClaim(calculated);
        validationErrors.push(...validateClaimCptRepeatLimits(calculated, feeSchedules));
        validationErrors.push(...validateClaimCptRepeatLimitsAgainstExisting(
          calculated,
          feeSchedules,
          [...existingClaims, ...importedClaims]
        ));
        if (validationErrors.length > 0) {
          errors.push({ row: i + 1, claimId: calculated.claim_id, errors: validationErrors });
        } else {
          try {
            const added = await sheetsService.createClaim(calculated, operatorEmail);
            importedClaims.push(added);
          } catch (err: any) {
            errors.push({ row: i + 1, claimId: calculated.claim_id, errors: [err.message || "Failed to write claim"] });
          }
        }
      }

      res.json({
        success: errors.length === 0,
        importedCount: importedClaims.length,
        errorCount: errors.length,
        errors: errors
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Import process failed" });
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
