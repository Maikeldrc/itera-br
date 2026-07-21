/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  Coins,
  FileWarning,
  Hospital,
  History,
  Sliders,
  Plus,
  RefreshCw,
  FileDown,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Search,
  Upload,
  X,
  Trash2,
  Edit2,
  Mail,
  Calendar,
  DollarSign,
  Languages,
  UserRound,
  KeyRound
} from "lucide-react";

import { Claim, ClaimStatus, ClaimClassification, ErrorCategory, Payment, Note, AuditLog, Provider, Payer, User, Setting, UserRole, FeeSchedule, EligibilityCoverage, ReportFeeSchedule } from "./types";
import { ViewType, Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { ClaimFilters, FilterState } from "./components/ClaimFilters";
import { ClaimsTable } from "./components/ClaimsTable";
import { BulkActionToolbar } from "./components/BulkActionToolbar";
import { ClaimDetailPanel } from "./components/ClaimDetailPanel";
import { ImportModal } from "./components/ImportModal";
import { PremiumDashboard } from "./components/PremiumDashboard";
import { ReportsPage } from "./components/reports/ReportsPage";
import { RcmWorkQueue } from "./components/RcmWorkQueue";
import { PaymentReconciliationImport } from "./components/PaymentReconciliationImport";
import { PayerCombobox } from "./components/PayerCombobox";
import { useFeedback } from "./components/FeedbackProvider";
import { AppLanguage, useLanguage } from "./components/LanguageProvider";
import { useAuth } from "./auth";
import { apiFetch, setApiTokenProvider } from "./apiClient";
import { validateClaimCptRepeatLimitsAgainstExisting, validateCptRepeatLimits } from "./cptRepeatLimits";
import { validateUniquePatientProvider } from "./patientRegistrationValidation";
import {
  canUserAccessMenu,
  canUserPerformAction,
  filterClaimsForUser,
  filterProvidersForUser,
  getUserActionAccess,
  getUserMenuAccess,
  MENU_ACCESS_IDS,
  MenuAccessId,
  ACTION_ACCESS_IDS,
  ActionAccessId,
  ROLE_DEFAULT_MENU_ACCESS,
  ROLE_DEFAULT_ACTION_ACCESS,
  serializeMenuAccess,
  serializeProviderAccess,
  userHasAllProviderAccess,
  parseProviderAccess
} from "./accessControl";

const INITIAL_FILTERS: FilterState = {
  search: "",
  startDate: "",
  endDate: "",
  providerId: "",
  payerId: "",
  serviceType: "",
  billedBy: "",
  paymentReceivedBy: "",
  status: "",
  classification: "",
  monthOfService: "",
  errorFlag: ""
};

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

type NewClaimServiceLine = {
  id: string;
  serviceType: string;
  cpt: string;
  dos: string;
  useClaimDos: boolean;
  charge?: number;
};

type BackupRecord = {
  backup_id: string;
  backup_file_id: string;
  backup_file_name: string;
  backup_drive_url: string;
  created_by: string;
  created_at: string;
  source_spreadsheet_id: string;
  status: string;
  notes: string;
  last_restored_at?: string;
  last_restored_by?: string;
};

type BackupConfig = {
  enabled: boolean;
  frequencyHours: number;
  backupDriveFolderId: string;
  lastBackupAt: string;
  nextBackupAt: string;
  googleDriveConfigured: boolean;
  sourceSpreadsheetId: string;
};

const DIGITAL_CARE_SERVICE_TYPES = ["RPM", "CCM", "APCM", "TCM", "BHI"];

const DEFAULT_SERVICE_TYPE_BY_CPT: Record<string, string> = {
  "99490": "CCM",
  "99439": "CCM",
  "99487": "CCM",
  "99489": "CCM",
  "99453": "RPM",
  "99454": "RPM",
  "99457": "RPM",
  "99458": "RPM",
  "99484": "BHI",
  "99495": "TCM",
  "99496": "TCM",
  "G0556": "APCM",
  "G0557": "APCM",
  "G0558": "APCM"
};

const createNewClaimServiceLine = (overrides: Partial<NewClaimServiceLine> = {}): NewClaimServiceLine => ({
  id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  serviceType: "",
  cpt: "",
  dos: "",
  useClaimDos: true,
  ...overrides
});

const createBlankClaimServiceLine = (): NewClaimServiceLine => createNewClaimServiceLine({
  serviceType: "",
  cpt: ""
});

type ServiceCptOption = {
  cpt: string;
  serviceType: string;
  description: string;
};

const toText = (value: unknown) => String(value ?? "").trim();

const normalizeServiceType = (value: unknown) => toText(value).toUpperCase();

const serviceTypeFromDescription = (description: unknown) => normalizeServiceType(toText(description).split(" - ")[0] || "");

const isSupportedServiceType = (serviceType: string) =>
  DIGITAL_CARE_SERVICE_TYPES.includes(serviceType) || /^[A-Z0-9]{2,8}$/.test(serviceType);

const VIEW_PATHS: Record<ViewType, string> = {
  dashboard: "/",
  claims: "/claims",
  payments: "/payments",
  "payment-reconciliation-import": "/payment-reconciliation-import",
  "import-exceptions": "/import-exceptions",
  "rcm-work-queue": "/rcm-work-queue",
  "rcm-productivity": "/rcm-productivity",
  denials: "/denials",
  errors: "/claims-with-errors",
  providers: "/physician-balances",
  reports: "/reports/billing-summary",
  settings: "/settings",
  "audit-log": "/audit-log"
};

function viewFromPath(pathname: string): ViewType {
  if (pathname.startsWith("/reports")) return "reports";
  const found = (Object.entries(VIEW_PATHS) as Array<[ViewType, string]>)
    .find(([view, path]) => view !== "reports" && path !== "/" && (pathname === path || pathname.startsWith(`${path}/`)));
  return found?.[0] || "dashboard";
}

function LoginScreen({ onSignIn }: { onSignIn: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await onSignIn(email.trim(), password);
    } catch {
      setError("Invalid credentials or account not authorized.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#e8f1f2] p-4 font-sans">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary-blue">ITERA Billing</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">Secure Sign In</h1>
          <p className="mt-1 text-xs text-slate-500">Access requires an authorized application user.</p>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-primary-blue focus:bg-white"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-primary-blue focus:bg-white"
            />
          </label>
        </div>
        {error && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-5 w-full rounded-xl bg-primary-blue px-4 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-dark-blue disabled:opacity-60"
        >
          {isSubmitting ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const { notify, confirmAction, promptAction } = useFeedback();
  const { language, setLanguage } = useLanguage();
  const auth = useAuth();
  const isEnglish = language === "en";
  // Views and Navigation
  const [currentView, setCurrentView] = useState<ViewType>(() => viewFromPath(window.location.pathname));
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isClearingOperationalData, setIsClearingOperationalData] = useState(false);
  const [statusData, setStatusData] = useState<any>(null);

  // Master Data States
  const [claims, setClaims] = useState<Claim[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [feeSchedules, setFeeSchedules] = useState<FeeSchedule[]>([]);
  const [eligibilityCoverage, setEligibilityCoverage] = useState<EligibilityCoverage[]>([]);
  const [reportFeeSchedules, setReportFeeSchedules] = useState<ReportFeeSchedule[]>([]);
  
  // Simulated Authentication & Role Setup
  const [currentUser, setCurrentUser] = useState<User>({
    user_id: "USR_02",
    name: "Elena Gomez",
    email: "egomez@itera.health",
    role: UserRole.BillingManager,
    menu_access: serializeMenuAccess(ROLE_DEFAULT_MENU_ACCESS[UserRole.BillingManager]),
    action_access: ROLE_DEFAULT_ACTION_ACCESS[UserRole.BillingManager].join(","),
    provider_access: serializeProviderAccess([], true),
    active: true
  });

  // UI Interactive States
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [selectedClaimIds, setSelectedClaimIds] = useState<string[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingClaim, setEditingClaim] = useState<Claim | null>(null);
  const [isSavingClaim, setIsSavingClaim] = useState(false);
  const [claimSaveProgress, setClaimSaveProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorState, setErrorState] = useState<string | null>(null);

  // Quick manually created claim state
  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientId, setNewPatientId] = useState("");
  const [newDos, setNewDos] = useState("");
  const [newBilledBy, setNewBilledBy] = useState<"" | "ITERA" | "Provider">("");
  const [newProviderId, setNewProviderId] = useState("");
  const [newPayerId, setNewPayerId] = useState("");
  const [newClaimLines, setNewClaimLines] = useState<NewClaimServiceLine[]>(() => [createBlankClaimServiceLine()]);

  // Fee Schedule management UI states
  const [settingsTab, setSettingsTab] = useState<"language" | "users" | "providers" | "payers" | "fee-schedules" | "contract-rules" | "operations" | "import-templates" | "backups" | "data-cleanup">("language");
  const [backupConfig, setBackupConfig] = useState<BackupConfig | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [operationsData, setOperationsData] = useState<any | null>(null);
  const [isLoadingOperations, setIsLoadingOperations] = useState(false);
  const [closingMonth, setClosingMonth] = useState(false);
  const [closeMonthPeriod, setCloseMonthPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [isImportingBankDeposits, setIsImportingBankDeposits] = useState(false);
  const [bankDepositImportSummary, setBankDepositImportSummary] = useState<any | null>(null);
  const [savingReviewTaskId, setSavingReviewTaskId] = useState("");
  const [savingTemplateId, setSavingTemplateId] = useState("");
  const [editingTemplateDrafts, setEditingTemplateDrafts] = useState<Record<string, { template_name: string; provider_name: string; system_name: string }>>({});
  const bankDepositInputRef = useRef<HTMLInputElement | null>(null);
  const [backupFrequencyHours, setBackupFrequencyHours] = useState(24);
  const [backupEnabled, setBackupEnabled] = useState(true);
  const [backupFolderId, setBackupFolderId] = useState("");
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isSavingBackupSettings, setIsSavingBackupSettings] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [restoringBackupId, setRestoringBackupId] = useState("");
  const [backupToRestore, setBackupToRestore] = useState<BackupRecord | null>(null);
  const [restoreConfirmationText, setRestoreConfirmationText] = useState("");
  const [showClearOperationalDataConfirm, setShowClearOperationalDataConfirm] = useState(false);
  const [clearOperationalDataText, setClearOperationalDataText] = useState("");
  const [clearOperationalDataProgress, setClearOperationalDataProgress] = useState(0);
  const [clearOperationalDataProgressLabel, setClearOperationalDataProgressLabel] = useState("");
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreProgressLabel, setRestoreProgressLabel] = useState("");
  const [editingFs, setEditingFs] = useState<FeeSchedule | null>(null);
  const [isFsModalOpen, setIsFsModalOpen] = useState(false);
  const [fsSearchTerm, setFsSearchTerm] = useState("");
  const [fsCptCode, setFsCptCode] = useState("");
  const [fsYear, setFsYear] = useState(2026);
  const [fsSemester1Rate, setFsSemester1Rate] = useState(0);
  const [fsSemester2Rate, setFsSemester2Rate] = useState(0);
  const [fsMaxPerDos, setFsMaxPerDos] = useState(1);
  const [fsDescription, setFsDescription] = useState("");
  const [editingPayer, setEditingPayer] = useState<Payer | null>(null);
  const [payerSearchTerm, setPayerSearchTerm] = useState("");
  const [payerIdInput, setPayerIdInput] = useState("");
  const [payerNameInput, setPayerNameInput] = useState("");
  const [payerTypeInput, setPayerTypeInput] = useState("Commercial");
  const [payerPverifyCodeInput, setPayerPverifyCodeInput] = useState("");
  const [payerEligibilityInput, setPayerEligibilityInput] = useState(false);
  const [payerClaimStatusInput, setPayerClaimStatusInput] = useState(false);
  const [payerDentalEligibilityInput, setPayerDentalEligibilityInput] = useState(false);
  const [payerActiveInput, setPayerActiveInput] = useState(true);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [providerSearchTerm, setProviderSearchTerm] = useState("");
  const [providerIdInput, setProviderIdInput] = useState("");
  const [providerNameInput, setProviderNameInput] = useState("");
  const [providerNpiInput, setProviderNpiInput] = useState("");
  const [providerPracticeIdInput, setProviderPracticeIdInput] = useState("PRAC_01");
  const [providerPracticeNameInput, setProviderPracticeNameInput] = useState("Metropolitan Care Group");
  const [providerActiveInput, setProviderActiveInput] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const [userNameInput, setUserNameInput] = useState("");
  const [userEmailInput, setUserEmailInput] = useState("");
  const [userRoleInput, setUserRoleInput] = useState<UserRole>(UserRole.ReconciliationSpecialist);
  const [userMenuAccessInput, setUserMenuAccessInput] = useState<MenuAccessId[]>(ROLE_DEFAULT_MENU_ACCESS[UserRole.ReconciliationSpecialist]);
  const [userActionAccessInput, setUserActionAccessInput] = useState<ActionAccessId[]>(ROLE_DEFAULT_ACTION_ACCESS[UserRole.ReconciliationSpecialist]);
  const [userProviderAccessAllInput, setUserProviderAccessAllInput] = useState(true);
  const [userProviderAccessIdsInput, setUserProviderAccessIdsInput] = useState<string[]>([]);
  const [userActiveInput, setUserActiveInput] = useState(true);
  const [passwordTargetUser, setPasswordTargetUser] = useState<User | null>(null);
  const [adminNewPassword, setAdminNewPassword] = useState("");
  const [adminConfirmPassword, setAdminConfirmPassword] = useState("");
  const [isChangingUserPassword, setIsChangingUserPassword] = useState(false);

  const visibleClaims = filterClaimsForUser(claims, currentUser);
  const visibleProviders = filterProvidersForUser(providers, currentUser);
  const selectedNewPayer = payers.find(payer => payer.payer_id === newPayerId);

  useEffect(() => {
    setApiTokenProvider(auth.getIdToken);
    return () => setApiTokenProvider(null);
  }, [auth.getIdToken]);

  // Fetch all initial server values once authentication state is settled
  useEffect(() => {
    if (!auth.isReady) return;
    if (auth.isAuthEnabled && !auth.user) {
      setIsLoading(false);
      return;
    }
    fetchAllData();
  }, [auth.isReady, auth.isAuthEnabled, auth.user?.uid]);

  useEffect(() => {
    const handlePopState = () => setCurrentView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (canUserAccessMenu(currentUser, currentView as MenuAccessId)) return;
    const fallbackView = getUserMenuAccess(currentUser)[0] || "dashboard";
    setCurrentView(fallbackView);
    const nextPath = VIEW_PATHS[fallbackView];
    if (window.location.pathname !== nextPath) window.history.replaceState({}, "", nextPath);
    setSelectedClaimIds([]);
  }, [currentUser, currentView]);

  useEffect(() => {
    const allowedProviderIds = new Set(visibleProviders.map(provider => provider.provider_id));
    if (newProviderId && allowedProviderIds.size > 0 && !allowedProviderIds.has(newProviderId)) {
      setNewProviderId(visibleProviders[0].provider_id);
    }
  }, [visibleProviders, newProviderId]);

  const fetchAllData = async (options: { showInitialLoading?: boolean } = {}) => {
    const showInitialLoading = options.showInitialLoading !== false;
    if (showInitialLoading && claims.length === 0) {
      setIsLoading(true);
    }
    setErrorState(null);
    try {
      // Parallel fetches for responsiveness
      const [
        claimsRes,
        paymentsRes,
        notesRes,
        auditsRes,
        provRes,
        payRes,
        settRes,
        usrRes,
        statusRes,
        feesRes,
        eligibilityRes,
        reportFeesRes,
        meRes
      ] = await Promise.all([
        apiFetch("/api/claims"),
        apiFetch("/api/payments"),
        apiFetch("/api/notes"),
        apiFetch("/api/audit-logs"),
        apiFetch("/api/providers"),
        apiFetch("/api/payers"),
        apiFetch("/api/settings"),
        apiFetch("/api/users"),
        apiFetch("/api/status"),
        apiFetch("/api/fee-schedules"),
        apiFetch("/api/eligibility-coverage"),
        apiFetch("/api/report-fee-schedules"),
        auth.isAuthEnabled ? apiFetch("/api/auth/me") : Promise.resolve(null)
      ]);

      if (!claimsRes.ok || !paymentsRes.ok || !notesRes.ok) {
        throw new Error(isEnglish ? "Unable to connect to the Express server." : "No se pudo conectar con el servidor Express.");
      }

      const claimsData = await claimsRes.json();
      const paymentsData = await paymentsRes.json();
      const notesData = await notesRes.json();
      const auditsData = auditsRes.ok ? await auditsRes.json() : [];
      const provData = provRes.ok ? await provRes.json() : [];
      const payData = payRes.ok ? await payRes.json() : [];
      const settData = settRes.ok ? await settRes.json() : [];
      const usrData = usrRes.ok ? await usrRes.json() : [];
      const diagnosticData = await statusRes.json();
      const feesData = feesRes.ok ? await feesRes.json() : [];
      const eligibilityData = eligibilityRes.ok ? await eligibilityRes.json() : [];
      const reportFeesData = reportFeesRes.ok ? await reportFeesRes.json() : [];
      const meData = meRes && meRes.ok ? await meRes.json() : null;

      setClaims(claimsData);
      setPayments(paymentsData);
      setNotes(notesData);
      setAuditLogs(auditsData);
      setProviders(provData);
      setPayers(payData);
      setSettings(settData);
      setUsers(usrData);
      setStatusData(diagnosticData);
      setFeeSchedules(feesData);
      setEligibilityCoverage(eligibilityData);
      setReportFeeSchedules(reportFeesData);

      // Match currentUser in fetched list if available to sync role changes
      const matched = meData?.user || usrData.find((u: User) => u.user_id === currentUser.user_id);
      if (matched) {
        setCurrentUser(matched);
      }
    } catch (err: any) {
      console.error(err);
      setErrorState(err.message || (isEnglish ? "Unable to load reconciliation data." : "Error al cargar información de conciliación."));
    } finally {
      setIsLoading(false);
    }
  };

  // Manual data refresh handler
  const handleSyncWithGoogleSheets = async () => {
    setIsSyncing(true);
    try {
      const res = await apiFetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        notify("System data refreshed successfully.", "success");
        await fetchAllData();
      } else {
        notify(`Data refresh failed: ${data.error}`, "error");
      }
    } catch (err: any) {
      notify(`Data refresh network error: ${err.message}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearOperationalData = async () => {
    if (clearOperationalDataText !== "CLEAR OPERATIONAL DATA") {
      notify(
        isEnglish
          ? "Type CLEAR OPERATIONAL DATA to confirm this cleanup."
          : "Escriba CLEAR OPERATIONAL DATA para confirmar esta limpieza.",
        "warning"
      );
      return;
    }

    setIsClearingOperationalData(true);
    setClearOperationalDataProgress(8);
    setClearOperationalDataProgressLabel(isEnglish ? "Validating confirmation phrase..." : "Validando frase de confirmación...");
    try {
      await wait(200);
      setClearOperationalDataProgress(18);
      setClearOperationalDataProgressLabel(isEnglish ? "Requesting operational data cleanup..." : "Solicitando limpieza de datos operativos...");
      const res = await apiFetch("/api/admin/clear-operational-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": currentUser.email
        },
        body: JSON.stringify({ confirmationPhrase: clearOperationalDataText })
      });
      setClearOperationalDataProgress(62);
      setClearOperationalDataProgressLabel(isEnglish ? "Clearing Claims, Payments, Notes and Audit_Log..." : "Limpiando Claims, Payments, Notes y Audit_Log...");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to clear operational data.");
      }

      setClearOperationalDataProgress(82);
      setClearOperationalDataProgressLabel(isEnglish ? "Updating local workspace..." : "Actualizando área de trabajo local...");
      setClaims([]);
      setPayments([]);
      setNotes([]);
      setAuditLogs([]);
      setSelectedClaim(null);
      setSelectedClaimIds([]);
      setClearOperationalDataProgress(94);
      setClearOperationalDataProgressLabel(isEnglish ? "Refreshing clean production data..." : "Refrescando datos limpios de producción...");
      await fetchAllData({ showInitialLoading: false });
      setClearOperationalDataProgress(100);
      setClearOperationalDataProgressLabel(isEnglish ? "Cleanup completed." : "Limpieza completada.");
      notify(
        isEnglish
          ? "Operational sheets cleared: Claims, Payments, Notes and Audit_Log."
          : "Hojas operativas limpiadas: Claims, Payments, Notes y Audit_Log.",
        "success"
      );
      await wait(500);
      setShowClearOperationalDataConfirm(false);
      setClearOperationalDataText("");
    } catch (err: any) {
      setClearOperationalDataProgress(100);
      setClearOperationalDataProgressLabel(isEnglish ? "Cleanup failed." : "Error en la limpieza.");
      notify(`${isEnglish ? "Cleanup error" : "Error al limpiar"}: ${err.message}`, "error");
      await wait(700);
    } finally {
      setIsClearingOperationalData(false);
      setClearOperationalDataProgress(0);
      setClearOperationalDataProgressLabel("");
    }
  };

  const getConfiguredCptOptions = (): ServiceCptOption[] => {
    const options = new Map<string, ServiceCptOption>();

    reportFeeSchedules
      .filter(item => item.active !== false && item.cpt_hcpcs && item.service_type)
      .forEach(item => {
        const serviceType = normalizeServiceType(item.service_type);
        if (!isSupportedServiceType(serviceType)) return;
        const cpt = toText(item.cpt_hcpcs);
        const description = toText(item.cpt_description) || `${serviceType} - ${cpt}`;
        options.set(`${serviceType}:${cpt}`, {
          cpt,
          serviceType,
          description
        });
      });

    feeSchedules
      .filter(item => item.cpt_code && item.description)
      .forEach(item => {
        const serviceType = serviceTypeFromDescription(item.description);
        if (!serviceType || !isSupportedServiceType(serviceType)) return;
        const cpt = toText(item.cpt_code);
        const key = `${serviceType}:${cpt}`;
        if (!options.has(key)) {
          options.set(key, {
            cpt,
            serviceType,
            description: toText(item.description)
          });
        }
      });

    return Array.from(options.values()).sort((a, b) => a.serviceType.localeCompare(b.serviceType) || a.cpt.localeCompare(b.cpt));
  };

  const getCptOptionsForService = (serviceType: string) => {
    const normalizedService = normalizeServiceType(serviceType);
    return getConfiguredCptOptions().filter(option => option.serviceType === normalizedService);
  };

  const getServiceTypeOptions = () => {
    const configuredServices = getConfiguredCptOptions().map(option => option.serviceType);
    return Array.from(new Set([...DIGITAL_CARE_SERVICE_TYPES, ...configuredServices])).sort();
  };

  const inferServiceTypeForCpt = (cpt: string, preferredService?: unknown) => {
    const normalizedPreferred = normalizeServiceType(preferredService);
    const normalizedCpt = toText(cpt);
    if (normalizedPreferred && getCptOptionsForService(normalizedPreferred).some(option => option.cpt === normalizedCpt)) {
      return normalizedPreferred;
    }
    const matched = getConfiguredCptOptions().find(option => option.cpt === normalizedCpt);
    return matched?.serviceType || DEFAULT_SERVICE_TYPE_BY_CPT[normalizedCpt] || normalizedPreferred || "";
  };

  const isCptAllowedForService = (serviceType: string, cpt: string) => {
    const normalizedCpt = toText(cpt);
    const normalizedService = normalizeServiceType(serviceType);
    return getCptOptionsForService(normalizedService).some(option => option.cpt === normalizedCpt)
      || DEFAULT_SERVICE_TYPE_BY_CPT[normalizedCpt] === normalizedService;
  };

  const getFirstAvailableCptForService = (serviceType: string, excludedCpts: string[] = []) => {
    const excluded = new Set(excludedCpts.map(cpt => toText(cpt)).filter(Boolean));
    return getCptOptionsForService(serviceType).find(option => !excluded.has(option.cpt))?.cpt
      || getCptOptionsForService(serviceType)[0]?.cpt
      || "";
  };

  const getManualClaimLineCharge = (line: NewClaimServiceLine) => {
    const cpt = toText(line.cpt);
    const serviceType = normalizeServiceType(line.serviceType);
    const lineDos = toText(line.useClaimDos ? newDos : line.dos) || newDos;
    const year = Number(lineDos.slice(0, 4)) || new Date().getFullYear();
    const month = Number(lineDos.slice(5, 7)) || 1;

    const reportSchedule = reportFeeSchedules
      .filter(item =>
        item.active !== false
        && toText(item.cpt_hcpcs) === cpt
        && normalizeServiceType(item.service_type) === serviceType
      )
      .sort((a, b) => toText(b.effective_date).localeCompare(toText(a.effective_date)))
      .find(item => !item.effective_date || toText(item.effective_date) <= lineDos);
    if (reportSchedule) return Number(reportSchedule.unit_price || 0);

    const schedule = feeSchedules.find(item =>
      toText(item.cpt_code) === cpt
      && Number(item.year) === year
      && serviceTypeFromDescription(item.description) === serviceType
    );
    if (schedule) {
      return Number(Number(month >= 7 ? schedule.semester2_rate : schedule.semester1_rate).toFixed(2));
    }
    return Number(line.charge || 0);
  };

  const getNormalizedNewClaimLines = () => newClaimLines
    .map(line => ({
      ...line,
      cpt: line.cpt.trim(),
      dos: toText(line.useClaimDos ? newDos : line.dos) || newDos
    }))
    .filter(line => line.cpt);

  const newClaimLineCharges = getNormalizedNewClaimLines().map(line => ({
    ...line,
    charge: getManualClaimLineCharge(line)
  }));
  const newClaimTotalCharge = Number(newClaimLineCharges.reduce((sum, line) => sum + line.charge, 0).toFixed(2));

  const handleOpenCreateClaim = () => {
    setEditingClaim(null);
    setNewPatientName("");
    setNewPatientId("");
    setNewDos("");
    setNewBilledBy("");
    setNewProviderId("");
    setNewPayerId("");
    setNewClaimLines([createBlankClaimServiceLine()]);
    setIsCreateOpen(true);
  };

  const handleCloseClaimEditor = () => {
    if (isSavingClaim) return;
    setIsCreateOpen(false);
    setEditingClaim(null);
    setClaimSaveProgress(0);
  };

  const handleOpenEditClaim = (claim: Claim) => {
    setEditingClaim(claim);
    setNewPatientName(toText(claim.patient_display_name_masked));
    setNewPatientId(toText(claim.patient_id));
    setNewDos(toText(claim.date_of_service_from).slice(0, 10));
    setNewBilledBy((claim.billed_by === "ITERA" || claim.billed_by === "Provider") ? claim.billed_by : "");
    setNewProviderId(toText(claim.provider_id));
    setNewPayerId(toText(claim.payer_id));

    let parsedLines: any[] = [];
    if (claim.service_lines_json) {
      try {
        const parsed = JSON.parse(claim.service_lines_json);
        if (Array.isArray(parsed)) parsedLines = parsed;
      } catch (err) {
        console.warn("Failed to parse service_lines_json for edit", err);
      }
    }
    const cptFallback = toText(claim.cpt_hcpcs).split(/[\s,]+/).filter(Boolean);
    const lines = parsedLines.length > 0
      ? parsedLines.map(line => {
          const cpt = toText(line?.cpt || line?.cptCode || line?.cpt_code || line?.code);
          const importedService = line?.serviceType || line?.service_type || line?.service || line?.program || serviceTypeFromDescription(line?.description);
          const lineDos = toText(line?.dos).slice(0, 10);
          const claimDos = toText(claim.date_of_service_from).slice(0, 10);
          return createNewClaimServiceLine({
            serviceType: inferServiceTypeForCpt(cpt, importedService || claim.service_type),
            cpt,
            dos: lineDos || claimDos,
            useClaimDos: !lineDos || lineDos === claimDos,
            charge: Number(line?.charged ?? line?.charge ?? line?.billed ?? line?.amount ?? 0) || undefined
          });
        }).filter(line => line.cpt)
      : cptFallback.map(cpt => createNewClaimServiceLine({
          serviceType: inferServiceTypeForCpt(cpt, claim.service_type),
          cpt,
          dos: toText(claim.date_of_service_from).slice(0, 10),
          useClaimDos: true
        }));
    setNewClaimLines(lines.length > 0 ? lines : [createBlankClaimServiceLine()]);
    setIsCreateOpen(true);
  };

  // Create claim manually with one or more CPT service lines
  const handleCreateClaimManually = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingClaim) return;

    setIsSavingClaim(true);
    setClaimSaveProgress(8);
    const progressTimer = window.setInterval(() => {
      setClaimSaveProgress(previous => Math.min(previous + (previous < 70 ? 7 : 3), 88));
    }, 450);
    const finishProgress = async () => {
      window.clearInterval(progressTimer);
      setClaimSaveProgress(100);
      await new Promise(resolve => window.setTimeout(resolve, 300));
    };
    const stopWithMessage = async (message: string, tone: "success" | "error" | "warning") => {
      await finishProgress();
      setIsSavingClaim(false);
      setClaimSaveProgress(0);
      notify(message, tone);
    };

    const claimBeingEdited = editingClaim;
    const providerObj = providers.find(p => p.provider_id === newProviderId);
    const payerObj = payers.find(p => p.payer_id === newPayerId);
    const normalizedLines = getNormalizedNewClaimLines();
    const lineCharges = normalizedLines.map(line => ({
      ...line,
      charge: getManualClaimLineCharge(line)
    }));

    if (!newPatientName.trim() || !newPatientId.trim() || !newProviderId || !newPayerId || !newDos || !newBilledBy) {
      await stopWithMessage(isEnglish ? "Complete all claim header fields before saving." : "Complete todos los campos principales del claim antes de guardar.", "warning");
      return;
    }
    if (normalizedLines.length === 0) {
      await stopWithMessage(isEnglish ? "Add at least one CPT code to create the claim." : "Añade al menos un CPT code para crear el claim.", "warning");
      return;
    }
    const missingLineDos = normalizedLines.filter(line => !line.dos);
    if (missingLineDos.length > 0) {
      await stopWithMessage(
        isEnglish
          ? "Every CPT service line must have a DOS. Use the claim DOS or set a custom line DOS."
          : "Cada línea CPT debe tener un DOS. Use el DOS general del claim o defina un DOS específico.",
        "warning"
      );
      return;
    }
    const duplicatePatientProviderErrors = validateUniquePatientProvider(
      {
        patient_id: newPatientId,
        provider_id: newProviderId,
        provider_npi: providerObj?.npi
      },
      claims,
      claimBeingEdited?.claim_id
    );
    if (duplicatePatientProviderErrors.length > 0) {
      await stopWithMessage(isEnglish ? "This MRN (Patient ID) is already registered for the same Provider." : "Este MRN (Patient ID) ya está registrado para el mismo Provider.", "warning");
      return;
    }
    const invalidServiceCpts = normalizedLines.filter(line => !isCptAllowedForService(line.serviceType, line.cpt));
    if (invalidServiceCpts.length > 0) {
      await stopWithMessage(
        isEnglish
          ? `CPT not allowed for the selected service: ${invalidServiceCpts.map(line => `${line.serviceType}/${line.cpt}`).join(", ")}.`
          : `CPT no permitido para el servicio seleccionado: ${invalidServiceCpts.map(line => `${line.serviceType}/${line.cpt}`).join(", ")}.`,
        "warning"
      );
      return;
    }
    const cptRepeatErrors = validateCptRepeatLimits(normalizedLines, feeSchedules, newDos);
    if (cptRepeatErrors.length > 0) {
      await stopWithMessage(cptRepeatErrors[0], "warning");
      return;
    }
    const existingRepeatErrors = validateClaimCptRepeatLimitsAgainstExisting(
      {
        patient_id: newPatientId.trim(),
        date_of_service_from: newDos,
        service_lines_json: JSON.stringify(normalizedLines.map(line => ({ cpt: line.cpt, dos: line.dos, units: 1 })))
      },
      feeSchedules,
      claims,
      claimBeingEdited?.claim_id
    );
    if (existingRepeatErrors.length > 0) {
      await stopWithMessage(existingRepeatErrors[0], "warning");
      return;
    }
    const missingRates = lineCharges.filter(line => line.charge <= 0);
    if (missingRates.length > 0) {
      await stopWithMessage(
        isEnglish
          ? `Configure the rate in Settings for: ${missingRates.map(line => line.cpt).join(", ")}.`
          : `Configura la tarifa en Settings para: ${missingRates.map(line => line.cpt).join(", ")}.`,
        "warning"
      );
      return;
    }
    setClaimSaveProgress(35);

    let existingServiceLines: any[] = [];
    if (claimBeingEdited?.service_lines_json) {
      try {
        const parsed = JSON.parse(claimBeingEdited.service_lines_json);
        if (Array.isArray(parsed)) existingServiceLines = parsed;
      } catch (err) {
        console.warn("Failed to parse existing claim service lines", err);
      }
    }
    const usedExistingLineIndexes = new Set<number>();
    const findReusableExistingLine = (line: NewClaimServiceLine) => {
      const exactIndex = existingServiceLines.findIndex((existing, index) =>
        !usedExistingLineIndexes.has(index)
        && toText(existing?.cpt) === line.cpt
        && normalizeServiceType(existing?.serviceType || existing?.service_type) === normalizeServiceType(line.serviceType)
        && toText(existing?.dos || newDos).slice(0, 10) === line.dos
      );
      const fallbackIndex = exactIndex >= 0 ? exactIndex : existingServiceLines.findIndex((existing, index) =>
        !usedExistingLineIndexes.has(index)
        && toText(existing?.cpt) === line.cpt
        && toText(existing?.dos || newDos).slice(0, 10) === line.dos
      );
      if (fallbackIndex >= 0) usedExistingLineIndexes.add(fallbackIndex);
      return fallbackIndex >= 0 ? existingServiceLines[fallbackIndex] : null;
    };

    const serviceLines = lineCharges.map(line => {
      const existingLine = findReusableExistingLine(line);
      const paid = Number(existingLine?.paid || 0);
      const secondaryPaid = Number(existingLine?.secondaryPaid || 0);
      const adj = Number(existingLine?.adj || 0);
      const patResp = Number(existingLine?.patResp || 0);
      const allowed = Number(Math.max(0, line.charge - adj).toFixed(2));
      return {
        ...(existingLine || {}),
        cpt: line.cpt,
        dos: line.dos,
        serviceType: line.serviceType,
        charged: line.charge,
        allowed,
        adj,
        patResp,
        paid,
        secondaryPaid,
        secondaryPayerId: existingLine?.secondaryPayerId || "",
        hasSecondaryPayment: existingLine?.hasSecondaryPayment || secondaryPaid > 0,
        balance: Number(Math.max(0, allowed - paid - secondaryPaid - patResp).toFixed(2)),
        codes: Array.isArray(existingLine?.codes) ? existingLine.codes : [],
        status: existingLine?.status || "Not Billed",
        notes: Array.isArray(existingLine?.notes) ? existingLine.notes : [],
        nextAction: existingLine?.nextAction || "No action",
        eftNumber: existingLine?.eftNumber || "",
        paymentDate: existingLine?.paymentDate || ""
      };
    });
    const totalCharge = Number(lineCharges.reduce((sum, line) => sum + line.charge, 0).toFixed(2));
    const serviceTypes = Array.from(new Set(lineCharges.map(line => line.serviceType)));

    const rawClaim: Partial<Claim> = {
      ...(claimBeingEdited || {}),
      claim_id: claimBeingEdited?.claim_id || "AUTO_GENERATE",
      patient_id: newPatientId.trim(),
      patient_display_name_masked: newPatientName.trim(),
      practice_id: providerObj?.practice_id || "",
      practice_name: providerObj?.practice_name || "",
      provider_id: newProviderId,
      provider_name: providerObj?.provider_name || "",
      provider_npi: providerObj?.npi || "",
      payer_id: newPayerId,
      payer_name: payerObj?.payer_name || "",
      service_type: serviceTypes.join(", "),
      cpt_hcpcs: lineCharges.map(line => line.cpt).join(", "),
      units: lineCharges.length,
      date_of_service_from: newDos,
      date_of_service_to: newDos,
      month_of_service: newDos ? newDos.slice(0, 7) : "",
      billed_by: newBilledBy,
      payment_received_by: claimBeingEdited?.payment_received_by || "Unknown",
      claim_status: claimBeingEdited?.claim_status || ClaimStatus.Draft,
      claim_classification: claimBeingEdited?.claim_classification || ClaimClassification.CleanClaim,
      claim_label: claimBeingEdited?.claim_label || "",
      billed_charge: totalCharge,
      allowed_amount: Number(serviceLines.reduce((sum, line) => sum + Number(line.allowed || 0), 0).toFixed(2)),
      paid_amount: Number(serviceLines.reduce((sum, line) => sum + Number(line.paid || 0) + Number(line.secondaryPaid || 0), 0).toFixed(2)),
      insurance_adjustment: Number(serviceLines.reduce((sum, line) => sum + Number(line.adj || 0), 0).toFixed(2)),
      denied_amount: claimBeingEdited?.denied_amount || 0,
      write_off_amount: claimBeingEdited?.write_off_amount || 0,
      uncollectible_amount: claimBeingEdited?.uncollectible_amount || 0,
      itera_direct_collection: claimBeingEdited?.itera_direct_collection || 0,
      provider_direct_collection: claimBeingEdited?.provider_direct_collection || 0,
      payment_to_physician: claimBeingEdited?.payment_to_physician || 0,
      service_lines_json: JSON.stringify(serviceLines)
    };

    try {
      setClaimSaveProgress(55);
      const res = await apiFetch(claimBeingEdited ? `/api/claims/${claimBeingEdited.claim_id}` : "/api/claims", {
        method: claimBeingEdited ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": currentUser.email
        },
        body: JSON.stringify(rawClaim)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || errData.details?.join("; ") || (claimBeingEdited ? "Failed to update claim" : "Failed to create claim"));
      }

      setClaimSaveProgress(78);
      await fetchAllData({ showInitialLoading: false });
      await finishProgress();
      notify(
        claimBeingEdited
          ? (isEnglish ? "Claim updated successfully." : "Claim actualizado exitosamente.")
          : (isEnglish ? "Claim created and recalculated successfully." : "Claim creado y recalculado exitosamente."),
        "success"
      );
      setIsCreateOpen(false);
      setEditingClaim(null);
      setNewPatientName("");
      setNewPatientId("");
      setNewDos("");
      setNewBilledBy("");
      setNewProviderId("");
      setNewPayerId("");
      setNewClaimLines([createBlankClaimServiceLine()]);
      setIsSavingClaim(false);
      setClaimSaveProgress(0);
    } catch (err: any) {
      await stopWithMessage(`${isEnglish ? "Save error" : "Error al guardar"}: ${err.message}`, "error");
    }
  };

  // Save detailed claim modifications
  // Save detailed claim modifications
  const handleUpdateClaim = async (updates: Partial<Claim>, targetClaimId?: string) => {
    const claimId = targetClaimId || selectedClaim?.claim_id;
    if (!claimId) return;
    const res = await apiFetch(`/api/claims/${claimId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUser.email
      },
      body: JSON.stringify(updates)
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.details?.join("; ") || errData.error || "Failed to update claim");
    }

    const updatedClaim = await res.json();
    if (selectedClaim && selectedClaim.claim_id === updatedClaim.claim_id) {
      setSelectedClaim(updatedClaim);
    }
    await fetchAllData();
  };

  const handleSaveServiceLineNotes = async (serviceLinesJson: string, targetClaimId?: string) => {
    const claimId = targetClaimId || selectedClaim?.claim_id;
    if (!claimId) return;
    const res = await apiFetch(`/api/claims/${claimId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUser.email
      },
      body: JSON.stringify({ service_lines_json: serviceLinesJson })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.details?.join("; ") || errData.error || "No se pudieron guardar las notas del CPT.");
    }

    const updatedClaim = await res.json();
    setClaims(previous => previous.map(item => item.claim_id === updatedClaim.claim_id ? updatedClaim : item));
    const auditsRes = await apiFetch("/api/audit-logs");
    if (auditsRes.ok) {
      setAuditLogs(await auditsRes.json());
    }
  };

  const handleSoftDeleteClaim = async (claim: Claim, reason: string) => {
    const res = await apiFetch(`/api/claims/${claim.claim_id}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUser.email
      },
      body: JSON.stringify({ reason })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to delete claim");
    }

    setSelectedClaimIds(prev => prev.filter(id => id !== claim.claim_id));
    if (selectedClaim?.claim_id === claim.claim_id) {
      setSelectedClaim(null);
    }
    await fetchAllData();
  };

  // Add notes to a claim
  const handleAddClaimNote = async (noteType: Note["note_type"], text: string, claimId = selectedClaim?.claim_id || "") => {
    if (!claimId) {
      throw new Error("No claim is selected for this note.");
    }
    const res = await apiFetch("/api/notes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUser.email
      },
      body: JSON.stringify({
        claim_id: claimId,
        note_type: noteType,
        note_text: text
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to post note.");
    }

    const savedNote = await res.json();
    setNotes(prev => [savedNote, ...prev.filter(note => note.note_id !== savedNote.note_id)]);
    setClaims(prev => prev.map(claim => claim.claim_id === claimId ? { ...claim, last_note: text } : claim));
    setSelectedClaim(prev => prev?.claim_id === claimId ? { ...prev, last_note: text } : prev);
    await fetchAllData({ showInitialLoading: false });
  };

  // Add payments to a claim
  const handleAddClaimPayment = async (paymentData: Partial<Payment>) => {
    const res = await apiFetch("/api/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUser.email
      },
      body: JSON.stringify(paymentData)
    });

    if (!res.ok) {
      throw new Error("Failed to post payment.");
    }

    await fetchAllData();
  };

  // Bulk action applier
  const handleApplyBulkAction = async (actionType: string, value: any) => {
    let updates: Partial<Claim> = {};
    if (actionType === "status") {
      updates.claim_status = value;
      if (value === ClaimStatus.Paid) updates.claim_classification = ClaimClassification.Closed;
    } else if (actionType === "classification") {
      updates.claim_classification = value;
    } else if (actionType === "billed_by") {
      updates.billed_by = value;
    } else if (actionType === "payment_received_by") {
      updates.payment_received_by = value;
    } else if (actionType === "note") {
      // Bulk notes require specialized API handling. Since our backend bulk updates financials, 
      // let's iterate and write notes for each claim.
      for (const id of selectedClaimIds) {
        await apiFetch("/api/notes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-email": currentUser.email
          },
          body: JSON.stringify({
            claim_id: id,
            note_type: "General",
            note_text: value
          })
        });
      }
      notify(isEnglish ? "Bulk note added." : "Nota agregada de forma masiva.", "success");
      setSelectedClaimIds([]);
      await fetchAllData();
      return;
    }

    try {
      const res = await apiFetch("/api/claims/bulk-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": currentUser.email
        },
        body: JSON.stringify({
          claimIds: selectedClaimIds,
          updates
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to bulk update claims");
      }

      notify(isEnglish ? "Bulk action completed successfully." : "Acción masiva completada con éxito.", "success");
      setSelectedClaimIds([]);
      await fetchAllData();
    } catch (err: any) {
      notify(`${isEnglish ? "Bulk error" : "Error en lote"}: ${err.message}`, "error");
    }
  };

  // Import claims CSV handler
  const handleImportCSV = async (payload: any[] | { rows?: any[]; fileName?: string; fileBase64?: string; retryRows?: number[] }) => {
    const res = await apiFetch("/api/import-csv", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUser.email
      },
      body: JSON.stringify(Array.isArray(payload) ? { rows: payload } : payload)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Import process failed");
    }
    fetchAllData({ showInitialLoading: false }).catch(err => {
      console.error("Post-import data refresh failed", err);
      notify(isEnglish ? "Import completed, but refreshing the worklist failed." : "La importación terminó, pero falló la actualización del worklist.", "warning");
    });
    return data;
  };

  const handleRollbackClaimImport = async (claimIds: string[], fileName?: string) => {
    const res = await apiFetch("/api/import-csv/rollback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUser.email
      },
      body: JSON.stringify({ claimIds, fileName })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Import rollback failed");
    }
    await fetchAllData({ showInitialLoading: false });
    return data;
  };

  // Update Settings values
  const handleUpdateSetting = async (key: string, value: string) => {
    const res = await apiFetch("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ key, value })
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const recalculated = Number(data.recalculatedClaims || 0);
      notify(
        recalculated > 0
          ? (isEnglish ? `Contract setting updated. ${recalculated} open claim(s) recalculated.` : `Ajuste contractual actualizado. ${recalculated} claim(s) abiertos recalculados.`)
          : (isEnglish ? "Contract setting updated." : "Ajuste contractual actualizado."),
        "success"
      );
      await fetchAllData();
    } else {
      notify(isEnglish ? "Unable to update setting." : "Error al actualizar ajuste.", "error");
    }
  };

  const loadBackups = async () => {
    if (currentUser.role !== UserRole.Admin) return;
    setIsLoadingBackups(true);
    try {
      const res = await apiFetch("/api/admin/backups");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load backups.");
      setBackupConfig(data.config);
      setBackups(Array.isArray(data.backups) ? data.backups : []);
      setBackupEnabled(data.config?.enabled !== false);
      setBackupFrequencyHours(Number(data.config?.frequencyHours || 24));
      setBackupFolderId(String(data.config?.backupDriveFolderId || ""));
      if (data.scheduledCreated) {
        notify(isEnglish ? "Scheduled backup created automatically." : "Salva programada creada automáticamente.", "success");
      }
    } catch (err: any) {
      notify(`${isEnglish ? "Unable to load backups" : "No se pudieron cargar las salvas"}: ${err.message}`, "error");
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const loadOperationsCenter = async () => {
    if (![UserRole.Admin, UserRole.BillingManager].includes(currentUser.role)) return;
    setIsLoadingOperations(true);
    try {
      const res = await apiFetch("/api/admin/operations");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load operations center.");
      setOperationsData(data);
    } catch (err: any) {
      notify(`${isEnglish ? "Operations Center error" : "Error del centro operativo"}: ${err.message}`, "error");
    } finally {
      setIsLoadingOperations(false);
    }
  };

  const handleCloseMonth = async () => {
    if (currentUser.role !== UserRole.Admin) return;
    setClosingMonth(true);
    try {
      const res = await apiFetch("/api/admin/monthly-closures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: closeMonthPeriod, notes: "Closed from Operations Center." })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to close month.");
      notify(isEnglish ? `Month ${closeMonthPeriod} closed.` : `Mes ${closeMonthPeriod} cerrado.`, "success");
      await loadOperationsCenter();
    } catch (err: any) {
      notify(`${isEnglish ? "Monthly close error" : "Error de cierre mensual"}: ${err.message}`, "error");
    } finally {
      setClosingMonth(false);
    }
  };

  const handleImportBankDeposits = async (file: File | null | undefined) => {
    if (!file) return;
    setIsImportingBankDeposits(true);
    setBankDepositImportSummary(null);
    try {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(String(event.target?.result || ""));
        reader.onerror = () => reject(new Error("Unable to read selected file."));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch("/api/admin/bank-deposits/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileBase64 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to import bank deposits.");
      setBankDepositImportSummary(data.summary);
      notify(
        isEnglish
          ? `Imported ${data.summary.depositGroups} deposit group(s). ${data.summary.mismatchDeposits} require review.`
          : `Importados ${data.summary.depositGroups} grupo(s) de depósito. ${data.summary.mismatchDeposits} requieren revisión.`,
        data.summary.mismatchDeposits > 0 ? "warning" : "success"
      );
      await loadOperationsCenter();
    } catch (err: any) {
      notify(`${isEnglish ? "Bank deposit import error" : "Error importando depósitos"}: ${err.message}`, "error");
    } finally {
      setIsImportingBankDeposits(false);
      if (bankDepositInputRef.current) bankDepositInputRef.current.value = "";
    }
  };

  const handleUpdateReviewTask = async (task: any, updates: Record<string, string>) => {
    if (!task?.task_id) return;
    setSavingReviewTaskId(task.task_id);
    try {
      const res = await apiFetch(`/api/review-tasks/${encodeURIComponent(task.task_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...task, ...updates })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update review task.");
      setOperationsData((current: any) => ({
        ...current,
        reviewTasks: (current?.reviewTasks || []).map((item: any) => item.task_id === task.task_id ? data.task : item)
      }));
      notify(isEnglish ? "Review task updated." : "Tarea de revisión actualizada.", "success");
    } catch (err: any) {
      notify(`${isEnglish ? "Task update error" : "Error actualizando tarea"}: ${err.message}`, "error");
    } finally {
      setSavingReviewTaskId("");
    }
  };

  const handleUpdateImportTemplate = async (template: any, updates: Record<string, unknown>) => {
    if (!template?.template_id) return;
    setSavingTemplateId(template.template_id);
    try {
      const res = await apiFetch(`/api/payment-reconciliation-import/templates/${encodeURIComponent(template.template_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update payment import template.");
      setOperationsData((current: any) => ({
        ...current,
        importMappingTemplates: (current?.importMappingTemplates || []).map((item: any) => item.template_id === template.template_id ? data.template : item)
      }));
      notify(isEnglish ? "Payment import template updated." : "Template de importación actualizado.", "success");
    } catch (err: any) {
      notify(`${isEnglish ? "Template update error" : "Error actualizando template"}: ${err.message}`, "error");
    } finally {
      setSavingTemplateId("");
    }
  };

  const handleSaveBackupSettings = async () => {
    setIsSavingBackupSettings(true);
    try {
      const res = await apiFetch("/api/admin/backups/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: backupEnabled,
          frequencyHours: backupFrequencyHours,
          backupDriveFolderId: backupFolderId
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save backup settings.");
      setBackupConfig(data.config);
      notify(isEnglish ? "Backup schedule updated." : "Programación de salvas actualizada.", "success");
      await loadBackups();
    } catch (err: any) {
      notify(`${isEnglish ? "Backup settings error" : "Error en configuración de salvas"}: ${err.message}`, "error");
    } finally {
      setIsSavingBackupSettings(false);
    }
  };

  const handleCreateBackupNow = async () => {
    setIsCreatingBackup(true);
    try {
      const res = await apiFetch("/api/admin/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "Manual backup from System Settings." })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create backup.");
      notify(isEnglish ? "Backup created in Google Drive." : "Salva creada en Google Drive.", "success");
      await loadBackups();
    } catch (err: any) {
      notify(`${isEnglish ? "Backup error" : "Error creando salva"}: ${err.message}`, "error");
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleOpenRestoreBackup = (backup: BackupRecord) => {
    setBackupToRestore(backup);
    setRestoreConfirmationText("");
    setRestoreProgress(0);
    setRestoreProgressLabel("");
  };

  const handleCloseRestoreBackup = () => {
    if (restoringBackupId) return;
    setBackupToRestore(null);
    setRestoreConfirmationText("");
    setRestoreProgress(0);
    setRestoreProgressLabel("");
  };

  const handleRestoreBackup = async () => {
    if (!backupToRestore) return;
    if (restoreConfirmationText !== "RESTORE") {
      notify(isEnglish ? "Type RESTORE to confirm the restore." : "Escriba RESTORE para confirmar la restauración.", "warning");
      return;
    }
    const backup = backupToRestore;
    setRestoringBackupId(backup.backup_file_id);
    setRestoreProgress(10);
    setRestoreProgressLabel(isEnglish ? "Submitting restore request..." : "Enviando solicitud de restauración...");
    try {
      const res = await apiFetch(`/api/admin/backups/${encodeURIComponent(backup.backup_file_id)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESTORE" })
      });
      setRestoreProgress(55);
      setRestoreProgressLabel(isEnglish ? "Restoring workbook tabs..." : "Restaurando hojas del workbook...");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to restore backup.");
      setRestoreProgress(78);
      setRestoreProgressLabel(isEnglish ? "Refreshing application data..." : "Actualizando datos de la aplicación...");
      notify(isEnglish ? "Backup restored. Data refreshed." : "Salva restaurada. Datos actualizados.", "success");
      await fetchAllData({ showInitialLoading: false });
      setRestoreProgress(92);
      setRestoreProgressLabel(isEnglish ? "Updating backup history..." : "Actualizando historial de salvas...");
      await loadBackups();
      setRestoreProgress(100);
      setRestoreProgressLabel(isEnglish ? "Restore completed." : "Restauración completada.");
      setBackupToRestore(null);
      setRestoreConfirmationText("");
    } catch (err: any) {
      notify(`${isEnglish ? "Restore error" : "Error restaurando salva"}: ${err.message}`, "error");
    } finally {
      setRestoringBackupId("");
      window.setTimeout(() => {
        setRestoreProgress(0);
        setRestoreProgressLabel("");
      }, 600);
    }
  };

  useEffect(() => {
    if (currentView === "settings" && settingsTab === "backups" && currentUser.role === UserRole.Admin) {
      loadBackups();
    }
  }, [currentView, settingsTab, currentUser.role]);

  useEffect(() => {
    if (
      (currentView === "settings" && ["operations", "import-templates"].includes(settingsTab)) ||
      currentView === "import-exceptions" ||
      currentView === "rcm-productivity"
    ) {
      loadOperationsCenter();
    }
  }, [currentView, settingsTab, currentUser.role]);

  const handleOpenAddFeeSchedule = () => {
    setEditingFs(null);
    setFsCptCode("");
    setFsYear(new Date().getFullYear());
    setFsSemester1Rate(0);
    setFsSemester2Rate(0);
    setFsMaxPerDos(1);
    setFsDescription("");
    setIsFsModalOpen(true);
  };

  const nextAvailableFeeScheduleYear = (cptCode: string, startYear?: number) => {
    const usedYears = new Set(
      feeSchedules
        .filter(item => String(item.cpt_code ?? "").trim() === cptCode)
        .map(item => Number(item.year))
        .filter(year => Number.isFinite(year))
    );
    let year = startYear || new Date().getFullYear();
    while (usedYears.has(year)) year += 1;
    return year;
  };

  const handleOpenAddFeeScheduleYear = (fs: FeeSchedule) => {
    const cptCode = String(fs.cpt_code ?? "").trim();
    setEditingFs(null);
    setFsCptCode(cptCode);
    setFsYear(nextAvailableFeeScheduleYear(cptCode, Number(fs.year) + 1));
    setFsSemester1Rate(Number(fs.semester1_rate) || 0);
    setFsSemester2Rate(Number(fs.semester2_rate) || 0);
    setFsMaxPerDos(Math.max(1, Math.floor(Number(fs.max_per_dos) || 1)));
    setFsDescription(String(fs.description ?? ""));
    setIsFsModalOpen(true);
  };

  const handleOpenEditFeeSchedule = (fs: FeeSchedule) => {
    setEditingFs(fs);
    setFsCptCode(String(fs.cpt_code ?? ""));
    setFsYear(Number(fs.year) || new Date().getFullYear());
    setFsSemester1Rate(Number(fs.semester1_rate) || 0);
    setFsSemester2Rate(Number(fs.semester2_rate) || 0);
    setFsMaxPerDos(Math.max(1, Math.floor(Number(fs.max_per_dos) || 1)));
    setFsDescription(String(fs.description ?? ""));
    setIsFsModalOpen(true);
  };

  const handleSaveFeeSchedule = async () => {
    if (!fsCptCode.trim()) {
      notify(isEnglish ? "Please enter a CPT code." : "Por favor ingresa un código CPT.", "warning");
      return;
    }
    const normalizedCptCode = fsCptCode.trim();
    const normalizedYear = Number(fsYear);
    const duplicate = feeSchedules.find(item =>
      String(item.cpt_code ?? "").trim() === normalizedCptCode &&
      Number(item.year) === normalizedYear &&
      (!editingFs || item.id !== editingFs.id)
    );
    if (duplicate) {
      notify(
        isEnglish
          ? `CPT ${normalizedCptCode} already has a fee schedule for ${normalizedYear}. Edit that year instead.`
          : `El CPT ${normalizedCptCode} ya tiene una tarifa para ${normalizedYear}. Edita ese año existente.`,
        "warning"
      );
      return;
    }
    const payload = {
      cpt_code: normalizedCptCode,
      year: normalizedYear,
      semester1_rate: Number(fsSemester1Rate),
      semester2_rate: Number(fsSemester2Rate),
      max_per_dos: Math.max(1, Math.floor(Number(fsMaxPerDos) || 1)),
      description: fsDescription
    };

    try {
      let res;
      if (editingFs) {
        res = await apiFetch(`/api/fee-schedules/${editingFs.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        res = await apiFetch("/api/fee-schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }

      if (res.ok) {
        setIsFsModalOpen(false);
        await fetchAllData();
      } else {
        const errData = await res.json();
        notify(`Error: ${errData.error || (isEnglish ? "Unable to save the fee schedule" : "No se pudo guardar la tarifa")}`, "error");
      }
    } catch (err: any) {
      notify(`${isEnglish ? "Network error" : "Error de red"}: ${err.message}`, "error");
    }
  };

  const handleDeleteFeeSchedule = async (id: string) => {
    const confirmed = await confirmAction({
      title: isEnglish ? "Delete fee schedule" : "Eliminar tarifa",
      message: isEnglish ? "Are you sure you want to delete this fee from the Fee Schedule?" : "¿Está seguro de que desea eliminar esta tarifa del Fee Schedule?",
      confirmLabel: isEnglish ? "Delete" : "Eliminar",
      tone: "danger"
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch(`/api/fee-schedules/${id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        await fetchAllData();
      } else {
        notify(isEnglish ? "Unable to delete fee schedule." : "Error al eliminar la tarifa.", "error");
      }
    } catch (err: any) {
      notify(`${isEnglish ? "Network error" : "Error de red"}: ${err.message}`, "error");
    }
  };

  const resetPayerForm = () => {
    setEditingPayer(null);
    setPayerIdInput("");
    setPayerNameInput("");
    setPayerTypeInput("Commercial");
    setPayerPverifyCodeInput("");
    setPayerEligibilityInput(false);
    setPayerClaimStatusInput(false);
    setPayerDentalEligibilityInput(false);
    setPayerActiveInput(true);
  };

  const toBooleanFlag = (value: unknown) => value === true || String(value ?? "").toLowerCase() === "true" || String(value ?? "").toLowerCase() === "yes";

  const handleEditPayer = (payer: Payer) => {
    setEditingPayer(payer);
    setPayerIdInput(payer.payer_id);
    setPayerNameInput(payer.payer_name);
    setPayerTypeInput(payer.payer_type);
    setPayerPverifyCodeInput(toText(payer.pverify_payer_code));
    setPayerEligibilityInput(toBooleanFlag(payer.eligibility_supported));
    setPayerClaimStatusInput(toBooleanFlag(payer.claim_status_supported));
    setPayerDentalEligibilityInput(toBooleanFlag(payer.dental_eligibility_supported));
    setPayerActiveInput(payer.active);
  };

  const handleSavePayer = async () => {
    if (!payerIdInput.trim() || !payerNameInput.trim() || !payerTypeInput.trim()) {
      notify("Payer ID, name and type are required.", "warning");
      return;
    }

    const payload: Payer = {
      payer_id: payerIdInput.trim().toUpperCase(),
      payer_name: payerNameInput.trim(),
      payer_type: payerTypeInput.trim(),
      pverify_payer_code: payerPverifyCodeInput.trim(),
      eligibility_supported: payerEligibilityInput,
      claim_status_supported: payerClaimStatusInput,
      dental_eligibility_supported: payerDentalEligibilityInput,
      active: payerActiveInput
    };

    try {
      const res = await apiFetch(editingPayer ? `/api/payers/${editingPayer.payer_id}` : "/api/payers", {
        method: editingPayer ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Unable to save payer.");
      }
      notify(editingPayer ? "Payer updated successfully." : "Payer registered successfully.", "success");
      resetPayerForm();
      await fetchAllData();
    } catch (err: any) {
      notify(`Payer save failed: ${err.message}`, "error");
    }
  };

  const handleDeletePayer = async (payer: Payer) => {
    const usedByClaims = claims.some(claim => claim.payer_id === payer.payer_id);
    const confirmed = await confirmAction({
      title: usedByClaims ? "Deactivate payer" : "Delete payer",
      message: usedByClaims
        ? `${payer.payer_name} is linked to existing claims. It will be marked inactive instead of deleted.`
        : `Delete ${payer.payer_name} from the payer registry?`,
      confirmLabel: usedByClaims ? "Deactivate" : "Delete",
      tone: "danger"
    });
    if (!confirmed) return;

    try {
      const res = await apiFetch(`/api/payers/${payer.payer_id}`, {
        method: usedByClaims ? "PUT" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: usedByClaims ? JSON.stringify({ active: false }) : undefined
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Unable to update payer.");
      }
      notify(usedByClaims ? "Payer deactivated successfully." : "Payer deleted successfully.", "success");
      resetPayerForm();
      await fetchAllData();
    } catch (err: any) {
      notify(`Payer update failed: ${err.message}`, "error");
    }
  };

  const resetProviderForm = () => {
    setEditingProvider(null);
    setProviderIdInput("");
    setProviderNameInput("");
    setProviderNpiInput("");
    setProviderPracticeIdInput("PRAC_01");
    setProviderPracticeNameInput("Metropolitan Care Group");
    setProviderActiveInput(true);
  };

  const handleEditProvider = (provider: Provider) => {
    setEditingProvider(provider);
    setProviderIdInput(provider.provider_id);
    setProviderNameInput(provider.provider_name);
    setProviderNpiInput(provider.npi);
    setProviderPracticeIdInput(provider.practice_id);
    setProviderPracticeNameInput(provider.practice_name);
    setProviderActiveInput(provider.active);
  };

  const handleSaveProvider = async () => {
    if (!providerIdInput.trim() || !providerNameInput.trim() || !providerNpiInput.trim()) {
      notify("Provider ID, name and NPI are required.", "warning");
      return;
    }

    const payload: Provider = {
      provider_id: providerIdInput.trim().toUpperCase(),
      provider_name: providerNameInput.trim(),
      npi: providerNpiInput.trim(),
      practice_id: providerPracticeIdInput.trim() || "PRAC_01",
      practice_name: providerPracticeNameInput.trim() || "Default Practice",
      active: providerActiveInput
    };

    try {
      const res = await apiFetch(editingProvider ? `/api/providers/${editingProvider.provider_id}` : "/api/providers", {
        method: editingProvider ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Unable to save provider.");
      }
      notify(editingProvider ? "Provider updated successfully." : "Provider registered successfully.", "success");
      resetProviderForm();
      await fetchAllData();
    } catch (err: any) {
      notify(`Provider save failed: ${err.message}`, "error");
    }
  };

  const handleDeleteProvider = async (provider: Provider) => {
    const usedByClaims = claims.some(claim => claim.provider_id === provider.provider_id || claim.provider_npi === provider.npi);
    const confirmed = await confirmAction({
      title: usedByClaims ? "Deactivate provider" : "Delete provider",
      message: usedByClaims
        ? `${provider.provider_name} is linked to existing claims. It will be marked inactive instead of deleted.`
        : `Delete ${provider.provider_name} from the provider registry?`,
      confirmLabel: usedByClaims ? "Deactivate" : "Delete",
      tone: "danger"
    });
    if (!confirmed) return;

    try {
      const res = await apiFetch(`/api/providers/${provider.provider_id}`, {
        method: usedByClaims ? "PUT" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: usedByClaims ? JSON.stringify({ active: false }) : undefined
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Unable to update provider.");
      }
      notify(usedByClaims ? "Provider deactivated successfully." : "Provider deleted successfully.", "success");
      resetProviderForm();
      await fetchAllData();
    } catch (err: any) {
      notify(`Provider update failed: ${err.message}`, "error");
    }
  };

  const resetUserForm = () => {
    setEditingUser(null);
    setUserNameInput("");
    setUserEmailInput("");
    setUserRoleInput(UserRole.ReconciliationSpecialist);
    setUserMenuAccessInput(ROLE_DEFAULT_MENU_ACCESS[UserRole.ReconciliationSpecialist]);
    setUserActionAccessInput(ROLE_DEFAULT_ACTION_ACCESS[UserRole.ReconciliationSpecialist]);
    setUserProviderAccessAllInput(true);
    setUserProviderAccessIdsInput([]);
    setUserActiveInput(true);
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setUserNameInput(user.name);
    setUserEmailInput(user.email);
    setUserRoleInput(user.role);
    setUserMenuAccessInput(getUserMenuAccess(user));
    setUserActionAccessInput(getUserActionAccess(user));
    setUserProviderAccessAllInput(userHasAllProviderAccess(user));
    setUserProviderAccessIdsInput(parseProviderAccess(user.provider_access).filter(item => item !== "ALL"));
    setUserActiveInput(user.active);
  };

  const handleUserRoleChange = (role: UserRole) => {
    setUserRoleInput(role);
    setUserMenuAccessInput(ROLE_DEFAULT_MENU_ACCESS[role]);
    setUserActionAccessInput(ROLE_DEFAULT_ACTION_ACCESS[role]);
  };

  const toggleUserMenuAccess = (menuId: MenuAccessId) => {
    setUserMenuAccessInput(prev =>
      prev.includes(menuId)
        ? prev.filter(item => item !== menuId)
        : [...prev, menuId]
    );
  };

  const toggleUserActionAccess = (actionId: ActionAccessId) => {
    setUserActionAccessInput(prev =>
      prev.includes(actionId)
        ? prev.filter(item => item !== actionId)
        : [...prev, actionId]
    );
  };

  const toggleUserProviderAccess = (providerId: string) => {
    setUserProviderAccessIdsInput(prev =>
      prev.includes(providerId)
        ? prev.filter(item => item !== providerId)
        : [...prev, providerId]
    );
  };

  const handleSaveUser = async () => {
    if (!userNameInput.trim() || !userEmailInput.trim() || !userRoleInput) {
      notify("Name, email and role are required.", "warning");
      return;
    }
    if (userMenuAccessInput.length === 0) {
      notify(isEnglish ? "Select at least one menu option for this user." : "Selecciona al menos una opción de menú para este usuario.", "warning");
      return;
    }
    if (!userProviderAccessAllInput && userProviderAccessIdsInput.length === 0) {
      notify(isEnglish ? "Select at least one provider or allow all providers." : "Selecciona al menos un provider o permite todos los providers.", "warning");
      return;
    }

    const payload: User = {
      user_id: editingUser?.user_id || "",
      name: userNameInput.trim(),
      email: userEmailInput.trim().toLowerCase(),
      role: userRoleInput,
      menu_access: serializeMenuAccess(userMenuAccessInput),
      action_access: Array.from(new Set(userActionAccessInput)).join(","),
      provider_access: serializeProviderAccess(userProviderAccessIdsInput, userProviderAccessAllInput),
      active: userActiveInput
    };

    try {
      const res = await apiFetch(editingUser ? `/api/users/${editingUser.user_id}` : "/api/users", {
        method: editingUser ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Unable to save user.");
      }
      const saved = await res.json();
      notify(editingUser ? "User updated successfully." : "User registered successfully.", "success");
      resetUserForm();
      await fetchAllData();
      if (saved.user_id === currentUser.user_id) {
        setCurrentUser(saved);
      }
    } catch (err: any) {
      notify(`User save failed: ${err.message}`, "error");
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (user.user_id === currentUser.user_id) {
      notify("You cannot delete or deactivate the active user from the current session.", "warning");
      return;
    }

    const confirmed = await confirmAction({
      title: "Delete user",
      message: `Delete ${user.name} from the application access registry?`,
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!confirmed) return;

    try {
      const res = await apiFetch(`/api/users/${user.user_id}`, { method: "DELETE" });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Unable to delete user.");
      }
      notify("User deleted successfully.", "success");
      resetUserForm();
      await fetchAllData();
    } catch (err: any) {
      notify(`User delete failed: ${err.message}`, "error");
    }
  };

  const handleSendPasswordReset = async (user: User) => {
    if (!auth.isAuthEnabled) {
      notify("Firebase Auth is not configured. Password reset emails cannot be sent.", "warning");
      return;
    }

    const email = user.email?.trim().toLowerCase();
    if (!email) {
      notify("This user has no valid email address.", "warning");
      return;
    }

    const confirmed = await confirmAction({
      title: "Send password reset",
      message: `Send a Firebase password reset email to ${email}?`,
      confirmLabel: "Send email",
      tone: "primary"
    });
    if (!confirmed) return;

    try {
      await auth.sendPasswordReset(email);
      notify(`Password reset email sent to ${email}.`, "success");
    } catch (err: any) {
      notify(`Unable to send password reset email: ${err.message}`, "error");
    }
  };

  const openAdminPasswordModal = (user: User) => {
    setPasswordTargetUser(user);
    setAdminNewPassword("");
    setAdminConfirmPassword("");
  };

  const closeAdminPasswordModal = () => {
    if (isChangingUserPassword) return;
    setPasswordTargetUser(null);
    setAdminNewPassword("");
    setAdminConfirmPassword("");
  };

  const handleAdminChangeUserPassword = async () => {
    if (!passwordTargetUser) return;
    if (currentUser.role !== UserRole.Admin) {
      notify(isEnglish ? "Only admins can change user passwords." : "Solo el admin puede cambiar passwords de usuarios.", "warning");
      return;
    }
    if (adminNewPassword.length < 8) {
      notify(isEnglish ? "New password must be at least 8 characters." : "El nuevo password debe tener al menos 8 caracteres.", "warning");
      return;
    }
    if (adminNewPassword !== adminConfirmPassword) {
      notify(isEnglish ? "Password confirmation does not match." : "La confirmación del password no coincide.", "warning");
      return;
    }

    setIsChangingUserPassword(true);
    try {
      const res = await apiFetch(`/api/users/${encodeURIComponent(passwordTargetUser.user_id)}/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": currentUser.email
        },
        body: JSON.stringify({ newPassword: adminNewPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Unable to change user password.");
      }
      notify(
        isEnglish
          ? `Password changed for ${passwordTargetUser.email}.`
          : `Password cambiado para ${passwordTargetUser.email}.`,
        "success"
      );
      setPasswordTargetUser(null);
      setAdminNewPassword("");
      setAdminConfirmPassword("");
    } catch (err: any) {
      notify(`${isEnglish ? "Password change failed" : "Error al cambiar password"}: ${err.message}`, "error");
    } finally {
      setIsChangingUserPassword(false);
    }
  };

  const handleChangeOwnPassword = async (currentPassword: string, newPassword: string) => {
    if (!auth.isAuthEnabled) {
      throw new Error("Firebase Auth is not configured.");
    }
    await auth.changePassword(currentPassword, newPassword);
    notify(isEnglish ? "Password changed successfully." : "Password cambiado correctamente.", "success");
  };

  // Trigger quick physician payout recording from Balances view
  const handleRecordPhysicianPayout = async (providerId: string, amount: number) => {
    if (amount <= 0) {
      notify(isEnglish ? "Enter a valid amount." : "Ingresa un monto válido.", "warning");
      return;
    }
    // Find all paid/partially paid claims for this provider that have ENDING AP > 0,
    // and apply payouts to them.
    const providerClaims = visibleClaims.filter(c => c.provider_id === providerId && c.ending_ap_to_physician > 0);
    if (providerClaims.length === 0) {
      notify(isEnglish ? "There are no pending Ending A/P balances to pay this provider." : "No hay saldos pendientes (Ending A/P) por pagar a este médico.", "warning");
      return;
    }

    let remainingPayout = amount;
    for (const claim of providerClaims) {
      if (remainingPayout <= 0) break;
      const toPay = Math.min(remainingPayout, claim.ending_ap_to_physician);
      await apiFetch(`/api/claims/${claim.claim_id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": currentUser.email
        },
        body: JSON.stringify({
          payment_to_physician: Number((claim.payment_to_physician + toPay).toFixed(2))
        })
      });
      remainingPayout -= toPay;
    }

    notify(
      isEnglish
        ? `Recorded payout distributions totaling $${amount} across this provider's claims.`
        : `Se registraron distribuciones de pago por un total de $${amount} entre los claims del médico.`,
      "success"
    );
    await fetchAllData();
  };

  // Filtering claims based on current FilterState
  const filteredClaims = visibleClaims.filter((claim) => {
    // Search
    if (filters.search) {
      const searchLower = toText(filters.search).toLowerCase();
      const matchId = toText(claim.claim_id).toLowerCase().includes(searchLower);
      const matchPatient = toText(claim.patient_display_name_masked).toLowerCase().includes(searchLower) || toText(claim.patient_id).toLowerCase().includes(searchLower);
      const matchProvider = toText(claim.provider_name).toLowerCase().includes(searchLower);
      const matchLabel = toText(claim.claim_label).toLowerCase().includes(searchLower);
      if (!matchId && !matchPatient && !matchProvider && !matchLabel) return false;
    }

    // Dates
    if (filters.startDate && toText(claim.date_of_service_from) < filters.startDate) return false;
    if (filters.endDate && toText(claim.date_of_service_from) > filters.endDate) return false;
    
    // Select dropdowns
    if (filters.providerId && toText(claim.provider_id) !== filters.providerId) return false;
    if (filters.payerId && toText(claim.payer_id) !== filters.payerId) return false;
    if (filters.serviceType && toText(claim.service_type) !== filters.serviceType) return false;
    if (filters.billedBy && toText(claim.billed_by) !== filters.billedBy) return false;
    if (filters.paymentReceivedBy && toText(claim.payment_received_by) !== filters.paymentReceivedBy) return false;
    if (filters.status && toText(claim.claim_status) !== filters.status) return false;
    if (filters.classification && toText(claim.claim_classification) !== filters.classification) return false;
    if (filters.monthOfService && toText(claim.month_of_service) !== filters.monthOfService) return false;
    
    // Error Flag
    if (filters.errorFlag) {
      const targetFlag = filters.errorFlag === "true";
      if (claim.error_flag !== targetFlag) return false;
    }

    return true;
  });

  // List of unique service types from claims for filters
  const availableServiceTypes = Array.from(new Set(visibleClaims.map((c) => toText(c.service_type)).filter(Boolean))) as string[];

  // Clickable KPI card trigger helper
  const handleKPICardClick = (field: keyof FilterState, value: string) => {
    setFilters({
      ...INITIAL_FILTERS,
      [field]: value
    });
    setCurrentView("claims");
    if (window.location.pathname !== VIEW_PATHS.claims) window.history.pushState({}, "", VIEW_PATHS.claims);
  };

  const formatUSD = (val: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
  };

  // Export claims helper
  const handleExportClaimsCSV = () => {
    if (filteredClaims.length === 0) {
      notify(isEnglish ? "There are no filtered records to export." : "No hay registros filtrados para exportar.", "warning");
      return;
    }
    const headers = Object.keys(filteredClaims[0]).join(",");
    const rows = filteredClaims.map(c => 
      Object.values(c).map(val => {
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      }).join(",")
    );
    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const encodedUri = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ITERA_Claims_Export_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(encodedUri), 1000);
  };

  if (!auth.isReady) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 font-sans gap-3">
        <RefreshCw className="w-8 h-8 text-primary-blue animate-spin" />
        <h4 className="font-semibold text-slate-800">Initializing secure session...</h4>
      </div>
    );
  }

  if (auth.isAuthEnabled && !auth.user) {
    return <LoginScreen onSignIn={auth.signIn} />;
  }

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 font-sans gap-3">
        <RefreshCw className="w-8 h-8 text-primary-blue animate-spin" />
        <h4 className="font-semibold text-slate-800">
          {isEnglish ? "Loading ITERA HEALTH Reconciliation Portal..." : "Cargando Portal de Conciliación de ITERA HEALTH..."}
        </h4>
        <p className="text-xs text-slate-500 font-mono">Connecting secure data service</p>
      </div>
    );
  }

  if (errorState) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 font-sans p-6">
        <div className="bg-white border border-red-200 p-8 rounded-2xl max-w-md w-full shadow-2xl text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-rose-600 mx-auto animate-bounce" />
          <h3 className="font-bold text-slate-800 text-lg">
            {isEnglish ? "Full-Stack Initialization Error" : "Error de Inicialización Full-Stack"}
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed">{errorState}</p>
          <button
            onClick={fetchAllData}
            className="w-full bg-dark-blue text-white p-2.5 rounded-xl font-bold hover:bg-primary-blue transition-colors text-xs uppercase"
          >
            {isEnglish ? "Retry Connection" : "Reintentar Conexión"}
          </button>
        </div>
      </div>
    );
  }

  const feeScheduleSearch = fsSearchTerm.trim().toLowerCase();
  const visibleFeeSchedules = feeSchedules
    .map((fs, index) => {
      const cptCode = String(fs.cpt_code ?? "").trim();
      const description = String(fs.description ?? "").trim();
      const semester1Rate = Number(fs.semester1_rate);
      const semester2Rate = Number(fs.semester2_rate);
      const maxPerDos = Number(fs.max_per_dos);
      return {
        source: fs,
        key: String(fs.id || `${cptCode || "fee"}-${fs.year || "year"}-${index}`),
        id: String(fs.id ?? ""),
        cptCode,
        description,
        year: Number(fs.year) || new Date().getFullYear(),
        semester1Rate: Number.isFinite(semester1Rate) ? semester1Rate : 0,
        semester2Rate: Number.isFinite(semester2Rate) ? semester2Rate : 0,
        maxPerDos: Number.isFinite(maxPerDos) && maxPerDos > 0 ? Math.floor(maxPerDos) : 1
      };
    })
    .filter(fs => fs.cptCode || fs.description)
    .filter(fs =>
      !feeScheduleSearch ||
      fs.cptCode.toLowerCase().includes(feeScheduleSearch) ||
      fs.description.toLowerCase().includes(feeScheduleSearch)
    )
    .sort((a, b) => a.cptCode.localeCompare(b.cptCode) || b.year - a.year);

  return (
    <div className="h-screen w-screen flex bg-[#e8f1f2] overflow-hidden font-sans text-slate-800">
      
      {/* Sidebar Section */}
      <Sidebar
        currentView={currentView}
        onViewChange={(view) => {
          setCurrentView(view);
          setSelectedClaimIds([]);
          const nextPath = VIEW_PATHS[view];
          if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
        }}
        currentUser={currentUser}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden h-full">
        
        {/* Header Section */}
        <Header
          sheetStatus={statusData?.googleSheets}
          currentUser={currentUser}
          allUsers={users}
          onUserChange={(u) => {
            setCurrentUser(u);
            setSelectedClaimIds([]);
          }}
          onSync={handleSyncWithGoogleSheets}
          isSyncing={isSyncing}
          isAuthEnabled={auth.isAuthEnabled}
          onSignOut={auth.signOut}
          onChangePassword={handleChangeOwnPassword}
        />

        {/* Scrollable View Content */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 pb-32">
          
          {/* VIEW: DASHBOARD MODULE */}
          {currentView === "dashboard" && (
            <PremiumDashboard
              claims={filteredClaims}
              isEnglish={isEnglish}
              formatUSD={formatUSD}
              onImport={() => setIsImportOpen(true)}
              onCreate={handleOpenCreateClaim}
              onFilterStatus={(status) => handleKPICardClick("status", status)}
              onFilterErrors={() => handleKPICardClick("errorFlag", "true")}
            />
          )}

          {/* VIEW: CLAIMS WORKLIST MODULE */}
          {currentView === "claims" && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-slate-900 font-display tracking-tight">
                    {isEnglish ? "Claims Worklist" : "Worklist de Reclamaciones (Claims)"}
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    {isEnglish ? "Audit, classify, and manage the financial cycles of each Digital Care Management claim" : "Audita, clasifica y gestiona los ciclos financieros de cada claim de Digital Care Management"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportClaimsCSV}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-600 transition-colors"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    {isEnglish ? "Export List" : "Exportar Lista"}
                  </button>
                  <button
                    onClick={() => setIsImportOpen(true)}
                    disabled={!canUserPerformAction(currentUser, "claims.import")}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-600 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5 text-secondary-blue" />
                    {isEnglish ? "Import CSV" : "Importar CSV"}
                  </button>
                  <button
                    onClick={handleOpenCreateClaim}
                    disabled={!canUserPerformAction(currentUser, "claims.create")}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-blue hover:bg-secondary-blue text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-500/10"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {isEnglish ? "New Claim" : "Nuevo Claim"}
                  </button>
                </div>
              </div>

              {/* Filters */}
              <ClaimFilters
                filters={filters}
                onChange={(updates) => setFilters({ ...filters, ...updates })}
                onReset={() => setFilters(INITIAL_FILTERS)}
                providers={visibleProviders}
                payers={payers}
                availableServiceTypes={availableServiceTypes}
              />

              {/* Worklist Table */}
              <ClaimsTable
                claims={filteredClaims}
                selectedClaimIds={selectedClaimIds}
                onSelectClaim={(claimId, isSelected) => {
                  if (isSelected) {
                    setSelectedClaimIds([...selectedClaimIds, claimId]);
                  } else {
                    setSelectedClaimIds(selectedClaimIds.filter(id => id !== claimId));
                  }
                }}
                onSelectAllClaims={(ids) => setSelectedClaimIds(ids)}
                onViewDetails={(claim) => setSelectedClaim(claim)}
                onEditClaim={canUserPerformAction(currentUser, "claims.edit") ? handleOpenEditClaim : undefined}
                onUpdateClaim={async (updates, targetClaimId) => {
                  await handleUpdateClaim(updates, targetClaimId);
                }}
                onSaveServiceLineNotes={async (json, targetClaimId) => {
                  await handleSaveServiceLineNotes(json, targetClaimId);
                }}
                onDeleteClaim={canUserPerformAction(currentUser, "claims.delete") ? handleSoftDeleteClaim : undefined}
                userRole={currentUser.role}
                allUsers={users}
                notes={notes}
              />

              {/* Bulk action toolbar */}
              <BulkActionToolbar
                selectedCount={selectedClaimIds.length}
                onApplyAction={handleApplyBulkAction}
                onExportSelected={handleExportClaimsCSV}
                onClearSelection={() => setSelectedClaimIds([])}
              />
            </div>
          )}

          {/* VIEW: RCM WORK QUEUE */}
          {currentView === "rcm-work-queue" && (
            <RcmWorkQueue
              claims={visibleClaims}
              users={users}
              onOpenClaim={(claim) => setSelectedClaim(claim)}
              onUpdateClaim={handleUpdateClaim}
              isEnglish={isEnglish}
            />
          )}

          {/* VIEW: IMPORT EXCEPTIONS CENTER */}
          {currentView === "import-exceptions" && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">{isEnglish ? "Import Exceptions" : "Excepciones de Importación"}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {isEnglish ? "Centralized queue for rejected imports, rows requiring review and failed background jobs." : "Cola centralizada para imports rechazados, filas en revisión y procesos fallidos."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadOperationsCenter()}
                  disabled={isLoadingOperations}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoadingOperations ? "animate-spin" : ""}`} />
                  {isEnglish ? "Refresh" : "Actualizar"}
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  [isEnglish ? "Open exceptions" : "Excepciones abiertas", operationsData?.importExceptions?.length || 0],
                  [isEnglish ? "Review tasks" : "Tareas revisión", operationsData?.reviewTasks?.filter((task: any) => !["Resolved", "Dismissed"].includes(task.status)).length || 0],
                  [isEnglish ? "Rejected rows" : "Filas rechazadas", (operationsData?.importHistory || []).reduce((sum: number, item: any) => sum + Number(item.rejected_rows || 0), 0)],
                  [isEnglish ? "Failed jobs" : "Procesos fallidos", operationsData?.jobs?.filter((job: any) => job.status === "failed").length || 0]
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3 className="text-sm font-bold text-slate-900">{isEnglish ? "Exception Queue" : "Cola de Excepciones"}</h3>
                  <p className="mt-0.5 text-[10px] text-slate-500">{isEnglish ? "Review tasks can be assigned and resolved directly here." : "Las tareas de revisión se pueden asignar y resolver directamente aquí."}</p>
                </div>
                <div className="overflow-auto">
                  <table className="w-full min-w-[1180px] text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2">Claim / CPT</th>
                        <th className="px-3 py-2">Reason</th>
                        <th className="px-3 py-2">Severity</th>
                        <th className="px-3 py-2">Assigned</th>
                        <th className="px-3 py-2">Due</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(operationsData?.importExceptions || []).slice(0, 100).map((item: any) => {
                        const task = (operationsData?.reviewTasks || []).find((candidate: any) => candidate.task_id === item.exception_id);
                        return (
                          <tr key={item.exception_id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-semibold text-slate-800">{item.type}</td>
                            <td className="px-3 py-2 text-slate-600">{item.source || "-"}</td>
                            <td className="px-3 py-2">
                              <p className="font-mono font-bold text-dark-blue">{item.claim_id || "-"}</p>
                              <p className="font-mono text-[10px] text-slate-400">{item.cpt_code || "-"}</p>
                            </td>
                            <td className="max-w-md px-3 py-2 text-slate-600">{item.reason || "-"}</td>
                            <td className="px-3 py-2">
                              <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${item.severity === "High" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{item.severity || "-"}</span>
                            </td>
                            <td className="px-3 py-2">
                              {task ? (
                                <select value={task.assigned_to || ""} disabled={savingReviewTaskId === task.task_id} onChange={event => void handleUpdateReviewTask(task, { assigned_to: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold">
                                  <option value="">{isEnglish ? "Unassigned" : "Sin asignar"}</option>
                                  {users.filter(user => user.active).map(user => <option key={user.user_id} value={user.user_id}>{user.name || user.email}</option>)}
                                </select>
                              ) : item.assigned_to || "-"}
                            </td>
                            <td className="px-3 py-2">
                              {task ? <input type="date" value={task.due_date || ""} disabled={savingReviewTaskId === task.task_id} onChange={event => void handleUpdateReviewTask(task, { due_date: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold" /> : "-"}
                            </td>
                            <td className="px-3 py-2">
                              {task ? (
                                <select value={task.status || "Open"} disabled={savingReviewTaskId === task.task_id} onChange={event => void handleUpdateReviewTask(task, { status: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold">
                                  {["Open", "In Progress", "Resolved", "Dismissed"].map(value => <option key={value} value={value}>{value}</option>)}
                                </select>
                              ) : (
                                <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{item.status}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {(!operationsData?.importExceptions || operationsData.importExceptions.length === 0) && (
                        <tr><td colSpan={8} className="px-3 py-10 text-center text-xs font-semibold text-slate-400">{isLoadingOperations ? (isEnglish ? "Loading..." : "Cargando...") : (isEnglish ? "No import exceptions." : "No hay excepciones de importación.")}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: RCM PRODUCTIVITY */}
          {currentView === "rcm-productivity" && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">{isEnglish ? "RCM Productivity" : "Productividad RCM"}</h2>
                  <p className="mt-1 text-xs text-slate-500">{isEnglish ? "Operational workload, task assignment and payment throughput indicators." : "Indicadores de carga operativa, asignación y pagos."}</p>
                </div>
                <button type="button" onClick={() => void loadOperationsCenter()} disabled={isLoadingOperations} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
                  <RefreshCw className={`h-4 w-4 ${isLoadingOperations ? "animate-spin" : ""}`} />
                  {isEnglish ? "Refresh" : "Actualizar"}
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  [isEnglish ? "Total paid" : "Total pagado", `$${Number(operationsData?.metrics?.totalPaid || 0).toFixed(2)}`],
                  [isEnglish ? "Open balance" : "Balance abierto", `$${Number(operationsData?.metrics?.totalBalance || 0).toFixed(2)}`],
                  [isEnglish ? "Imported rows 30d" : "Filas importadas 30d", operationsData?.metrics?.importedRows30Days || 0],
                  [isEnglish ? "Open review tasks" : "Tareas abiertas", operationsData?.health?.totals?.openReviewTasks || 0]
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-2 text-xl font-bold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-5 xl:grid-cols-3">
                {[
                  { title: isEnglish ? "Tasks by owner" : "Tareas por responsable", rows: Object.entries(operationsData?.metrics?.taskCounts || {}) },
                  { title: isEnglish ? "Claims by status" : "Claims por estado", rows: Object.entries(operationsData?.metrics?.statusCounts || {}) },
                  { title: isEnglish ? "Next actions" : "Próximas acciones", rows: Object.entries(operationsData?.metrics?.nextActionCounts || {}) }
                ].map(section => (
                  <div key={section.title} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                    <div className="border-b border-slate-100 px-5 py-4">
                      <h3 className="text-sm font-bold text-slate-900">{section.title}</h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {section.rows.slice(0, 12).map(([label, value]) => (
                        <div key={String(label)} className="flex items-center justify-between gap-3 px-5 py-3 text-xs">
                          <span className="truncate font-semibold text-slate-700">{String(label)}</span>
                          <span className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-bold text-dark-blue">{String(value)}</span>
                        </div>
                      ))}
                      {section.rows.length === 0 && <div className="px-5 py-8 text-center text-xs font-semibold text-slate-400">-</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* VIEW: PAYMENT RECONCILIATION IMPORT */}
          {currentView === "payment-reconciliation-import" && (
            <PaymentReconciliationImport
              canApply={canUserPerformAction(currentUser, "payments.apply")}
              onImported={() => fetchAllData({ showInitialLoading: false })}
            />
          )}

          {/* VIEW: PAYMENTS CONTROL MODULE */}
          {currentView === "payments" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900 font-display tracking-tight">
                  {isEnglish ? "Payment Control (Payments Log)" : "Control de Cobros (Payments Log)"}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {isEnglish ? "History of insurance deposits and collections applied to claims" : "Historial de depósitos de aseguradoras y cobros aplicados a los claims"}
                </p>
              </div>

              {/* Alerts about missing information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-xs text-amber-800">
                  <AlertTriangle className="w-4.5 h-4.5 text-accent-orange shrink-0 mt-0.5 animate-bounce-subtle" />
                  <div>
                    <h5 className="font-bold">{isEnglish ? "Paid Claims Missing Electronic ERA" : "Claims Pagados sin ERA Electrónico"}</h5>
                    <p className="mt-0.5 leading-relaxed font-semibold">
                      {isEnglish ? "Some claims have bank payments but no validating ERA file. Review claims classified as \"Missing ERA\"." : "Hay claims que registran pago por banco pero carecen del archivo ERA de validación. Revise claims con clasificación \"Missing ERA\"."}
                    </p>
                  </div>
                </div>
                <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl flex gap-3 text-xs text-rose-800">
                  <AlertTriangle className="w-4.5 h-4.5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold">{isEnglish ? "Amount Mismatches (Payment Mismatch)" : "Discordancias de Montos (Payment Mismatch)"}</h5>
                    <p className="mt-0.5 leading-relaxed font-semibold">
                      {isEnglish ? "Some deposits differ from the contractual allowed amount. Review claims classified as \"Payment Mismatch\"." : "Existen 2 depósitos donde el valor pagado discrepa del monto permitido contractualmente. Revise claims clasificados con \"Payment Mismatch\"."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Payments History Table */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                  <h4 className="font-bold text-slate-800 text-sm">{isEnglish ? "Recorded Payment History" : "Cobros Históricos Registrados"}</h4>
                  <span className="text-xs text-slate-500 font-mono">{isEnglish ? "Total collected" : "Total cobrado"}: {formatUSD(payments.reduce((acc, p) => acc + p.amount, 0))}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase tracking-wider">
                        <th className="p-3.5">{isEnglish ? "Deposit ID" : "ID Depósito"}</th>
                        <th className="p-3.5">ID Claim</th>
                        <th className="p-3.5">{isEnglish ? "Date" : "Fecha"}</th>
                        <th className="p-3.5">{isEnglish ? "Channel / Received By" : "Canal / Recibido por"}</th>
                        <th className="p-3.5">{isEnglish ? "Insurance" : "Aseguradora"}</th>
                        <th className="p-3.5 text-right">{isEnglish ? "Amount Collected" : "Monto Cobrado"}</th>
                        <th className="p-3.5">Cheque / EFT #</th>
                        <th className="p-3.5">ERA ID</th>
                        <th className="p-3.5">EOB ID</th>
                        <th className="p-3.5">{isEnglish ? "Comments" : "Comentarios"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-sans text-slate-700">
                      {payments.map((p) => (
                        <tr key={p.payment_id} className="hover:bg-slate-50">
                          <td className="p-3.5 font-bold text-slate-900 font-mono">{p.payment_id}</td>
                          <td className="p-3.5 font-bold text-primary-blue font-mono">{p.claim_id}</td>
                          <td className="p-3.5 font-mono text-slate-500">{p.payment_date}</td>
                          <td className="p-3.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.payment_received_by === "ITERA" ? "bg-blue-100 text-blue-800" : "bg-sky-100 text-sky-800"}`}>
                              {p.payment_received_by}
                            </span>
                          </td>
                          <td className="p-3.5 font-semibold text-slate-600">{p.payer_name}</td>
                          <td className="p-3.5 text-right font-bold text-emerald-700 font-mono">{formatUSD(p.amount)}</td>
                          <td className="p-3.5 font-mono text-slate-500">{p.check_or_eft_number}</td>
                          <td className="p-3.5 font-mono text-slate-400">{p.era_id || "-"}</td>
                          <td className="p-3.5 font-mono text-slate-400">{p.eob_id || "-"}</td>
                          <td className="p-3.5 text-slate-500 max-w-xs truncate" title={p.notes}>{p.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: DENIALS REPORT MODULE */}
          {currentView === "denials" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900 font-display tracking-tight">
                  {isEnglish ? "Denials Report (Denial Audits)" : "Reporte de Denegaciones (Denial Audits)"}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {isEnglish ? "Analysis and correction of rejected or denied claims from insurance payers" : "Análisis y corrección de reclamaciones rechazadas o denegadas por las aseguradoras"}
                </p>
              </div>

              {/* Metrics blocks */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-5 border border-slate-200 rounded-xl">
                  <span className="text-xs font-semibold text-slate-500 block">{isEnglish ? "Total Denied Claims" : "Total Claims Denegados"}</span>
                  <span className="text-2xl font-bold text-rose-600 block mt-2 font-display">
                    {visibleClaims.filter(c => c.claim_status === ClaimStatus.Denied).length}
                  </span>
                </div>
                <div className="bg-white p-5 border border-slate-200 rounded-xl">
                  <span className="text-xs font-semibold text-slate-500 block">{isEnglish ? "Total Denied Amount" : "Monto Total Denegado"}</span>
                  <span className="text-2xl font-bold text-rose-600 block mt-2 font-mono">
                    {formatUSD(visibleClaims.reduce((acc, c) => acc + c.denied_amount, 0))}
                  </span>
                </div>
                <div className="bg-white p-5 border border-slate-200 rounded-xl">
                  <span className="text-xs font-semibold text-slate-500 block">{isEnglish ? "Pending Correction" : "Pendiente de Corrección"}</span>
                  <span className="text-2xl font-bold text-amber-600 block mt-2 font-display">
                    {visibleClaims.filter(c => c.claim_status === ClaimStatus.Denied && c.correction_status === "Pending").length}
                  </span>
                </div>
                <div className="bg-white p-5 border border-slate-200 rounded-xl">
                  <span className="text-xs font-semibold text-slate-500 block">{isEnglish ? "Denial Write-offs" : "Castigos de Denegación (Write-offs)"}</span>
                  <span className="text-2xl font-bold text-slate-700 block mt-2 font-mono">
                    {formatUSD(visibleClaims.reduce((acc, c) => acc + c.write_off_amount, 0))}
                  </span>
                </div>
              </div>

              {/* Denials Breakdown table */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h4 className="font-bold text-slate-800 text-sm">{isEnglish ? "Denied / Rejected Claims List" : "Listado de Claims Denegados / Rechazados"}</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase tracking-wider">
                        <th className="p-3.5">{isEnglish ? "Patient" : "Paciente"}</th>
                        <th className="p-3.5">{isEnglish ? "Provider" : "Médico"}</th>
                        <th className="p-3.5">{isEnglish ? "Insurance" : "Aseguradora"}</th>
                        <th className="p-3.5">CPT</th>
                        <th className="p-3.5 text-right font-mono">{isEnglish ? "Billed Charge" : "Monto Cargo"}</th>
                        <th className="p-3.5 font-mono">CARC</th>
                        <th className="p-3.5 font-mono">RARC</th>
                        <th className="p-3.5">{isEnglish ? "Payer Reason / Cause" : "Motivo / Causa del Payer"}</th>
                        <th className="p-3.5">{isEnglish ? "Correction Phase" : "Fase Corrección"}</th>
                        <th className="p-3.5 text-center">{isEnglish ? "Action" : "Acción"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-sans">
                      {visibleClaims.filter(c => c.claim_status === ClaimStatus.Denied || c.claim_status === ClaimStatus.Rejected).map((c) => (
                        <tr key={c.claim_id} className="hover:bg-slate-50">
                          <td className="p-3.5 font-bold text-slate-800">{c.patient_display_name_masked || (isEnglish ? "Unknown patient" : "Paciente desconocido")}</td>
                          <td className="p-3.5 font-semibold">{c.provider_name}</td>
                          <td className="p-3.5 text-slate-600">{c.payer_name}</td>
                          <td className="p-3.5 font-mono">{c.cpt_hcpcs}</td>
                          <td className="p-3.5 text-right font-bold font-mono text-slate-900">{formatUSD(c.billed_charge)}</td>
                          <td className="p-3.5 font-mono text-slate-800 font-semibold">{c.carc_code || "-"}</td>
                          <td className="p-3.5 font-mono text-slate-800 font-semibold">{c.rarc_code || "-"}</td>
                          <td className="p-3.5 text-slate-500 font-medium max-w-xs truncate" title={c.denial_reason}>{c.denial_reason || (isEnglish ? "Not specified" : "No especificado")}</td>
                          <td className="p-3.5">
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold text-[10px]">
                              {c.correction_status || (isEnglish ? "Unclassified" : "Sin clasificar")}
                            </span>
                          </td>
                          <td className="p-3.5 text-center">
                            <button
                              onClick={() => setSelectedClaim(c)}
                              className="px-2.5 py-1 border border-slate-200 rounded-lg bg-slate-50 text-[10px] hover:bg-slate-200 font-bold text-slate-700"
                            >
                              {isEnglish ? "Correct" : "Corregir"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: CLAIMS WITH ERRORS / BLOCKED MODULE */}
          {currentView === "errors" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900 font-display tracking-tight">
                  {isEnglish ? "Claims Blocked by Errors (Claims in Hold)" : "Claims Bloqueados por Errores (Claims in Hold)"}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {isEnglish ? "Records held by billing validations that prevent submission or collection" : "Expedientes retenidos por validaciones de facturación que impiden su presentación o cobro"}
                </p>
              </div>

              {/* Errors list */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h4 className="font-bold text-slate-800 text-sm">{isEnglish ? "Active Errors Queue" : "Bandeja de Errores Activos"}</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase tracking-wider">
                        <th className="p-3.5">ID Claim</th>
                        <th className="p-3.5">{isEnglish ? "Patient" : "Paciente"}</th>
                        <th className="p-3.5">{isEnglish ? "Provider / Clinic" : "Médico / Clínica"}</th>
                        <th className="p-3.5">CPT</th>
                        <th className="p-3.5 font-mono text-right">{isEnglish ? "Charge" : "Cargo"}</th>
                        <th className="p-3.5">{isEnglish ? "Error Category" : "Categoría de Error"}</th>
                        <th className="p-3.5">{isEnglish ? "Block Detail / Lock Reason" : "Detalle del Bloqueo / Lock Reason"}</th>
                        <th className="p-3.5">{isEnglish ? "Correction Phase" : "Fase de Corrección"}</th>
                        <th className="p-3.5 text-center">{isEnglish ? "Action" : "Acción"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-sans">
                      {visibleClaims.filter(c => c.error_flag || c.locked).map((c) => (
                        <tr key={c.claim_id} className="hover:bg-slate-50 bg-rose-50/10">
                          <td className="p-3.5 font-bold text-slate-900 font-mono">
                            <div className="flex items-center gap-1">
                              <span>{c.claim_id}</span>
                              {c.locked && <Lock className="w-3.5 h-3.5 text-rose-600" />}
                            </div>
                          </td>
                          <td className="p-3.5 font-semibold">{c.patient_display_name_masked}</td>
                          <td className="p-3.5">{c.provider_name}</td>
                          <td className="p-3.5 font-mono">{c.cpt_hcpcs}</td>
                          <td className="p-3.5 text-right font-bold font-mono text-slate-900">{formatUSD(c.billed_charge)}</td>
                          <td className="p-3.5 font-bold text-rose-700 font-sans">{c.error_category || (isEnglish ? "General Error" : "Error General")}</td>
                          <td className="p-3.5 text-slate-500 max-w-xs truncate" title={c.lock_reason}>{c.lock_reason || "Blocked in claim scrubbing."}</td>
                          <td className="p-3.5">
                            <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded font-semibold text-[10px]">
                              {c.correction_status || (isEnglish ? "Needs review" : "Por revisar")}
                            </span>
                          </td>
                          <td className="p-3.5 text-center">
                            <button
                              onClick={() => setSelectedClaim(c)}
                              className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700"
                            >
                              {isEnglish ? "Resolve" : "Resolver"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: PROVIDERS BALANCES MODULE */}
          {currentView === "providers" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900 font-display tracking-tight">
                  {isEnglish ? "Physician Balances and Settlements (Providers Report)" : "Balances y Liquidaciones de Médicos (Providers Report)"}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {isEnglish ? "Reconciliation report for physician earnings and payables under Digital Care service contracts" : "Reporte de conciliación de haberes y cuentas por pagar a los médicos según contratos de servicios de Digital Care"}
                </p>
              </div>

              {/* Provider calculations table */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h4 className="font-bold text-slate-800 text-sm">{isEnglish ? "Physician Account Summary (70/30 Share)" : "Resumen de Cuentas por Médico (70/30 Share)"}</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase tracking-wider">
                        <th className="p-3.5">{isEnglish ? "Provider / Clinic" : "Médico / Clinic"}</th>
                        <th className="p-3.5">NPI</th>
                        <th className="p-3.5 text-right font-mono">Total Claims</th>
                        <th className="p-3.5 text-right font-mono">Total Billed</th>
                        <th className="p-3.5 text-right font-mono">{isEnglish ? "ITERA Collections" : "Cobros ITERA"}</th>
                        <th className="p-3.5 text-right font-mono">{isEnglish ? "Provider Collections" : "Cobros Provider"}</th>
                        <th className="p-3.5 text-right font-mono">{isEnglish ? "A/R Balances" : "Saldos A/R"}</th>
                        <th className="p-3.5 text-right font-mono">{isEnglish ? "AP Payable (Provider Share)" : "AP Payable (Médico Share)"}</th>
                        <th className="p-3.5 text-right font-mono">{isEnglish ? "Distributed Payments" : "Pagos Distribuidos"}</th>
                        <th className="p-3.5 text-right font-mono">{isEnglish ? "Ending AP / Balance" : "Ending AP / Saldo"}</th>
                        <th className="p-3.5 text-center">{isEnglish ? "Actions" : "Acciones"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-sans">
                      {visibleProviders.map((p) => {
                        // Calculate provider specific aggregates
                        const pClaims = visibleClaims.filter(c => c.provider_id === p.provider_id);
                        const cCount = pClaims.length;
                        const billed = pClaims.reduce((acc, c) => acc + c.billed_charge, 0);
                        const itColl = pClaims.reduce((acc, c) => acc + c.itera_direct_collection, 0);
                        const prColl = pClaims.reduce((acc, c) => acc + c.provider_direct_collection, 0);
                        const arBal = pClaims.reduce((acc, c) => acc + c.ar_balance, 0);
                        const payable = pClaims.reduce((acc, c) => acc + c.account_payable_to_physician, 0);
                        const distributed = pClaims.reduce((acc, c) => acc + c.payment_to_physician, 0);
                        const ending = pClaims.reduce((acc, c) => acc + c.ending_ap_to_physician, 0);

                        return (
                          <tr key={p.provider_id} className="hover:bg-slate-50 font-medium">
                            <td className="p-3.5 font-bold text-slate-900">{p.provider_name}</td>
                            <td className="p-3.5 font-mono text-slate-500">{p.npi}</td>
                            <td className="p-3.5 text-right font-mono">{cCount} claims</td>
                            <td className="p-3.5 text-right font-mono font-bold text-slate-900">{formatUSD(billed)}</td>
                            <td className="p-3.5 text-right font-mono text-blue-600">{formatUSD(itColl)}</td>
                            <td className="p-3.5 text-right font-mono text-sky-600">{formatUSD(prColl)}</td>
                            <td className="p-3.5 text-right font-mono text-amber-600">{formatUSD(arBal)}</td>
                            <td className="p-3.5 text-right font-mono text-indigo-700 font-bold">{formatUSD(payable)}</td>
                            <td className="p-3.5 text-right font-mono text-emerald-700 font-bold">{formatUSD(distributed)}</td>
                            <td className={`p-3.5 text-right font-mono font-bold text-xs ${ending < 0 ? "text-rose-600" : "text-indigo-600"}`}>
                              {formatUSD(ending)}
                            </td>
                            <td className="p-3.5 text-center">
                              <button
                                onClick={async () => {
                                  const amtStr = await promptAction({
                                    title: isEnglish ? "Record physician payout" : "Registrar pago al médico",
                                    message: isEnglish ? `${p.provider_name} has a pending balance of ${formatUSD(ending)}.` : `${p.provider_name} tiene un saldo pendiente de ${formatUSD(ending)}.`,
                                    inputLabel: isEnglish ? "Amount to distribute" : "Monto a distribuir",
                                    placeholder: "0.00",
                                    inputType: "number",
                                    confirmLabel: isEnglish ? "Record payout" : "Registrar pago"
                                  });
                                  if (amtStr) {
                                    handleRecordPhysicianPayout(p.provider_id, Number(amtStr));
                                  }
                                }}
                                className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 rounded text-[10px] hover:bg-indigo-600 hover:text-white font-bold text-indigo-700 transition-colors"
                              >
                                {isEnglish ? "Record Payment" : "Registrar Pago"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: AUDIT LOG VIEW MODULE */}
          {currentView === "audit-log" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900 font-display tracking-tight">
                  {isEnglish ? "HIPAA Security Audit Log" : "Log de Auditoría de Seguridad HIPAA"}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {isEnglish ? "Immutable access and claim modification log required for medical data compliance" : "Bitácora inalterable de acceso y modificaciones de claims requerida para el cumplimiento normativo de datos médicos"}
                </p>
              </div>

              {/* Audit history */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                  <h4 className="font-bold text-slate-800 text-sm">{isEnglish ? "Recorded Security Events" : "Registros de Seguridad Registrados"}</h4>
                  <span className="text-xs text-slate-400 font-mono">{auditLogs.length} {isEnglish ? "saved actions" : "acciones guardadas"}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase tracking-wider">
                        <th className="p-3.5">ID Log</th>
                        <th className="p-3.5">{isEnglish ? "Date and Time" : "Fecha y Hora"}</th>
                        <th className="p-3.5">{isEnglish ? "Audit User" : "Usuario Auditor"}</th>
                        <th className="p-3.5">ID Claim</th>
                        <th className="p-3.5 font-mono">{isEnglish ? "Action Type" : "Tipo Acción"}</th>
                        <th className="p-3.5">{isEnglish ? "Changed Field" : "Campo Alterado"}</th>
                        <th className="p-3.5">{isEnglish ? "Previous Value" : "Valor Previo"}</th>
                        <th className="p-3.5">{isEnglish ? "New Value" : "Valor Nuevo"}</th>
                        <th className="p-3.5">{isEnglish ? "Reason / Justification" : "Motivo / Justificación"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-sans text-slate-700">
                      {auditLogs.map((log) => (
                        <tr key={log.audit_id} className="hover:bg-slate-50">
                          <td className="p-3.5 font-mono font-bold text-slate-400">{log.audit_id}</td>
                          <td className="p-3.5 font-mono text-slate-500">{new Date(log.changed_at).toLocaleString()}</td>
                          <td className="p-3.5 font-bold text-slate-800">{log.changed_by}</td>
                          <td className="p-3.5 font-bold text-primary-blue font-mono">{log.claim_id}</td>
                          <td className="p-3.5 font-mono">
                            <span className={`whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-bold ${
                              log.action_type === "Lock" ? "bg-red-100 text-red-800" :
                              log.action_type === "Unlock" ? "bg-emerald-100 text-emerald-800" :
                              log.action_type === "Create" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-700"
                            }`}>
                              {log.action_type}
                            </span>
                          </td>
                          <td className="p-3.5 font-mono font-semibold text-slate-600">{log.field_name}</td>
                          <td className="p-3.5 font-mono text-slate-400 line-through max-w-xs truncate" title={log.previous_value}>{log.previous_value || "-"}</td>
                          <td className="p-3.5 font-mono text-slate-800 font-semibold max-w-xs truncate" title={log.new_value}>{log.new_value}</td>
                          <td className="p-3.5 text-slate-500 max-w-sm truncate" title={log.reason}>{log.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: REPORTS MODULE */}
          {currentView === "reports" && (
            <ReportsPage
              claims={visibleClaims}
              providers={visibleProviders}
              payers={payers}
              feeSchedules={feeSchedules}
              eligibilityCoverage={eligibilityCoverage}
              reportFeeSchedules={reportFeeSchedules}
            />
          )}

          {/* VIEW: SETTINGS MODULE */}
          {currentView === "settings" && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-slate-900 font-display tracking-tight">
                    {isEnglish ? "System Settings" : "Panel de Configuración del Sistema"}
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    {isEnglish ? "Manage language, access, providers, payers, contract rules and FCSO fees." : "Administra idioma, accesos, providers, aseguradoras, reglas contractuales y honorarios FCSO."}
                  </p>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex border-b border-slate-200 gap-1 overflow-x-auto pb-px">
                <button
                  onClick={() => setSettingsTab("language")}
                  className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                    settingsTab === "language"
                      ? "border-primary-blue text-primary-blue bg-blue-50/40 rounded-t-lg"
                      : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg"
                  }`}
                >
                  <Languages className="w-4 h-4" />
                  <span>{isEnglish ? "Language" : "Idioma"}</span>
                </button>
                <button
                  onClick={() => setSettingsTab("users")}
                  className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                    settingsTab === "users"
                      ? "border-primary-blue text-primary-blue bg-blue-50/40 rounded-t-lg"
                      : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg"
                  }`}
                >
                  <UserRound className="w-4 h-4" />
                  <span>{isEnglish ? "Users & Roles" : "Usuarios y Roles"}</span>
                </button>
                <button
                  onClick={() => setSettingsTab("fee-schedules")}
                  className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                    settingsTab === "fee-schedules"
                      ? "border-primary-blue text-primary-blue bg-blue-50/40 rounded-t-lg"
                      : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg"
                  }`}
                >
                  <Coins className="w-4 h-4" />
                  <span>FCSO-style CPT Fee Schedules</span>
                </button>
                <button
                  onClick={() => setSettingsTab("providers")}
                  className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                    settingsTab === "providers"
                      ? "border-primary-blue text-primary-blue bg-blue-50/40 rounded-t-lg"
                      : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg"
                  }`}
                >
                  <UserRound className="w-4 h-4" />
                  <span>{isEnglish ? "Providers" : "Providers"}</span>
                </button>
                <button
                  onClick={() => setSettingsTab("payers")}
                  className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                    settingsTab === "payers"
                      ? "border-primary-blue text-primary-blue bg-blue-50/40 rounded-t-lg"
                      : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg"
                  }`}
                >
                  <Hospital className="w-4 h-4" />
                  <span>{isEnglish ? "Insurance / Payers" : "Aseguradoras / Payers"}</span>
                </button>
                <button
                  onClick={() => setSettingsTab("contract-rules")}
                  className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                    settingsTab === "contract-rules"
                      ? "border-primary-blue text-primary-blue bg-blue-50/40 rounded-t-lg"
                      : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg"
                  }`}
                >
                  <Sliders className="w-4 h-4" />
                  <span>{isEnglish ? "Contract Rules (Shares)" : "Reglas Contractuales (Shares)"}</span>
                </button>
                {[UserRole.Admin, UserRole.BillingManager].includes(currentUser.role) && (
                  <button
                    onClick={() => setSettingsTab("operations")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                      settingsTab === "operations"
                        ? "border-primary-blue text-primary-blue bg-blue-50/40 rounded-t-lg"
                        : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg"
                    }`}
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    <span>{isEnglish ? "Operations Center" : "Centro Operativo"}</span>
                  </button>
                )}
                {[UserRole.Admin, UserRole.BillingManager].includes(currentUser.role) && (
                  <button
                    onClick={() => setSettingsTab("import-templates")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                      settingsTab === "import-templates"
                        ? "border-primary-blue text-primary-blue bg-blue-50/40 rounded-t-lg"
                        : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg"
                    }`}
                  >
                    <Upload className="w-4 h-4" />
                    <span>{isEnglish ? "Import Templates" : "Templates de Import"}</span>
                  </button>
                )}
                {currentUser.role === UserRole.Admin && (
                  <button
                    onClick={() => setSettingsTab("backups")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                      settingsTab === "backups"
                        ? "border-primary-blue text-primary-blue bg-blue-50/40 rounded-t-lg"
                        : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg"
                    }`}
                  >
                    <History className="w-4 h-4" />
                    <span>{isEnglish ? "Backups" : "Salvas"}</span>
                  </button>
                )}
                {currentUser.role === UserRole.Admin && (
                  <button
                    onClick={() => setSettingsTab("data-cleanup")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
                      settingsTab === "data-cleanup"
                        ? "border-rose-500 text-rose-700 bg-rose-50/70 rounded-t-lg"
                        : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-t-lg"
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{isEnglish ? "Data Cleanup" : "Limpieza de Datos"}</span>
                  </button>
                )}
              </div>

              {/* Active Tab Content */}
              {settingsTab === "language" && (
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
                  <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
                    <div className="p-2 bg-blue-50 rounded-lg text-primary-blue">
                      <Languages className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{isEnglish ? "Application Language" : "Idioma de la Aplicación"}</h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {isEnglish ? "Select the language used by the application interface." : "Selecciona el idioma utilizado por la interfaz de la aplicación."}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 max-w-xl">
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {isEnglish ? "Display language" : "Idioma de visualización"}
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {([
                        { code: "en", name: "English", detail: isEnglish ? "Default language" : "Idioma predeterminado" },
                        { code: "es", name: "Español", detail: isEnglish ? "Spanish interface" : "Interfaz en español" }
                      ] as Array<{ code: AppLanguage; name: string; detail: string }>).map(option => {
                        const selected = language === option.code;
                        return (
                          <button
                            key={option.code}
                            type="button"
                            onClick={() => {
                              setLanguage(option.code);
                              notify(option.code === "en" ? "Language changed to English." : "Idioma cambiado a Español.", "success");
                            }}
                            className={`flex items-center justify-between rounded-xl border p-4 text-left transition-all ${
                              selected
                                ? "border-primary-blue bg-blue-50 shadow-sm"
                                : "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50"
                            }`}
                          >
                            <div>
                              <p className={`text-sm font-bold ${selected ? "text-dark-blue" : "text-slate-700"}`}>{option.name}</p>
                              <p className="mt-1 text-[10px] text-slate-400">{option.detail}</p>
                            </div>
                            <span className={`h-4 w-4 rounded-full border-4 ${selected ? "border-primary-blue bg-white" : "border-slate-300 bg-white"}`} />
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-4 text-[10px] leading-relaxed text-slate-400">
                      {isEnglish ? "The preference is saved in this browser and applied automatically on future visits." : "La preferencia se guarda en este navegador y se aplica automáticamente en futuras visitas."}
                    </p>
                  </div>
                </div>
              )}

              {settingsTab === "operations" && [UserRole.Admin, UserRole.BillingManager].includes(currentUser.role) && (
                <div className="space-y-5">
                  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{isEnglish ? "Operations Center" : "Centro Operativo"}</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          {isEnglish
                            ? "Monitor imports, data quality, review work, deposits, user activity and month-end controls."
                            : "Monitorea importaciones, calidad de datos, revisiones, depósitos, actividad de usuarios y cierres mensuales."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadOperationsCenter()}
                        disabled={isLoadingOperations}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                      >
                        <RefreshCw className={`h-4 w-4 ${isLoadingOperations ? "animate-spin" : ""}`} />
                        {isEnglish ? "Refresh" : "Actualizar"}
                      </button>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-4">
                      {[
                        { label: isEnglish ? "Active claims" : "Claims activos", value: operationsData?.health?.totals?.activeClaims ?? 0 },
                        { label: isEnglish ? "Open balance" : "Balance abierto", value: `$${Number(operationsData?.health?.totals?.openBalance || 0).toFixed(2)}` },
                        { label: isEnglish ? "Open review tasks" : "Tareas abiertas", value: operationsData?.health?.totals?.openReviewTasks ?? 0 },
                        { label: isEnglish ? "Imported rows 30d" : "Filas importadas 30d", value: operationsData?.metrics?.importedRows30Days ?? 0 }
                      ].map(card => (
                        <div key={card.label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{card.label}</p>
                          <p className="mt-2 text-lg font-bold text-slate-900">{card.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
                      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">{isEnglish ? "System Health Checks" : "Validaciones de Salud"}</h4>
                          <p className="mt-0.5 text-[10px] text-slate-500">{operationsData?.health?.generatedAt ? new Date(operationsData.health.generatedAt).toLocaleString() : "-"}</p>
                        </div>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {(operationsData?.health?.checks || []).map((check: any) => (
                          <div key={check.key} className="flex items-center justify-between gap-4 px-5 py-3">
                            <div className="flex items-center gap-3">
                              {check.severity === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                              <span className="text-xs font-semibold text-slate-700">{check.label}</span>
                            </div>
                            <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${check.severity === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                              {check.count}
                            </span>
                          </div>
                        ))}
                        {(!operationsData?.health?.checks || operationsData.health.checks.length === 0) && (
                          <div className="px-5 py-6 text-center text-xs font-semibold text-slate-400">{isLoadingOperations ? (isEnglish ? "Loading..." : "Cargando...") : "-"}</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">{isEnglish ? "Month-End Close" : "Cierre Mensual"}</h4>
                          <p className="mt-1 text-xs text-slate-500">
                            {isEnglish ? "Create a backup and register a formal close for a period." : "Crea una salva y registra un cierre formal del período."}
                          </p>
                        </div>
                        <Calendar className="h-5 w-5 text-primary-blue" />
                      </div>
                      <div className="mt-5 flex gap-3">
                        <input
                          type="month"
                          value={closeMonthPeriod}
                          onChange={event => setCloseMonthPeriod(event.target.value)}
                          className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 outline-none focus:border-primary-blue focus:ring-2 focus:ring-blue-100"
                        />
                        <button
                          type="button"
                          onClick={handleCloseMonth}
                          disabled={currentUser.role !== UserRole.Admin || closingMonth}
                          className="rounded-lg bg-dark-blue px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-secondary-blue disabled:opacity-60"
                        >
                          {closingMonth ? (isEnglish ? "Closing..." : "Cerrando...") : (isEnglish ? "Close month" : "Cerrar mes")}
                        </button>
                      </div>
                      <div className="mt-4 max-h-44 overflow-auto rounded-lg border border-slate-100">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                            <tr><th className="px-3 py-2">Period</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Closed By</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {(operationsData?.monthlyClosures || []).slice(0, 8).map((item: any) => (
                              <tr key={item.close_id}>
                                <td className="px-3 py-2 font-mono text-slate-700">{item.period}</td>
                                <td className="px-3 py-2"><span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{item.status}</span></td>
                                <td className="px-3 py-2 text-slate-500">{item.closed_by || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{isEnglish ? "Bank Deposit Reconciliation Import" : "Importación de Depósitos Bancarios"}</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          {isEnglish
                            ? "Upload a CSV/XLS/XLSX payment deposit report to group deposits by date, check/EFT and payer, then compare against recorded Payments."
                            : "Sube un CSV/XLS/XLSX de depósitos para agrupar por fecha, check/EFT y payer, y compararlo contra Payments registrados."}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          ref={bankDepositInputRef}
                          type="file"
                          accept=".csv,.xls,.xlsx"
                          className="hidden"
                          onChange={event => void handleImportBankDeposits(event.target.files?.[0])}
                        />
                        <button
                          type="button"
                          onClick={() => bankDepositInputRef.current?.click()}
                          disabled={isImportingBankDeposits}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-blue px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-dark-blue disabled:opacity-60"
                        >
                          <Upload className="h-4 w-4" />
                          {isImportingBankDeposits ? (isEnglish ? "Importing..." : "Importando...") : (isEnglish ? "Import deposits" : "Importar depósitos")}
                        </button>
                      </div>
                    </div>
                    {isImportingBankDeposits && (
                      <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3">
                        <div className="mb-2 flex items-center justify-between text-xs font-bold text-dark-blue">
                          <span>{isEnglish ? "Processing deposit file..." : "Procesando archivo de depósitos..."}</span>
                          <span>{isEnglish ? "In progress" : "En proceso"}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white">
                          <div className="h-full w-2/3 animate-pulse rounded-full bg-primary-blue" />
                        </div>
                      </div>
                    )}
                    {bankDepositImportSummary && (
                      <div className="mt-4 grid gap-3 md:grid-cols-5">
                        {[
                          [isEnglish ? "Rows" : "Filas", bankDepositImportSummary.totalRowsRead],
                          [isEnglish ? "Deposit groups" : "Grupos", bankDepositImportSummary.depositGroups],
                          [isEnglish ? "Matched" : "Cuadrados", bankDepositImportSummary.matchedDeposits],
                          [isEnglish ? "Review" : "Revisión", bankDepositImportSummary.mismatchDeposits],
                          [isEnglish ? "Deposit $" : "$ depósitos", `$${Number(bankDepositImportSummary.totalDepositAmount || 0).toFixed(2)}`]
                        ].map(([label, value]) => (
                          <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                            <p className="mt-1 text-sm font-bold text-slate-900">{value}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{isEnglish ? "Review Task Management" : "Gestión de Tareas de Revisión"}</h4>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {isEnglish ? "Assign ownership, due dates and resolution status for operational exceptions." : "Asigna responsable, vencimiento y estado para excepciones operativas."}
                        </p>
                      </div>
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{operationsData?.reviewTasks?.length || 0}</span>
                    </div>
                    <div className="max-h-96 overflow-auto">
                      <table className="w-full min-w-[1040px] text-left text-xs">
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Source</th>
                            <th className="px-3 py-2">Claim / CPT</th>
                            <th className="px-3 py-2">Reason</th>
                            <th className="px-3 py-2">Assigned To</th>
                            <th className="px-3 py-2">Priority</th>
                            <th className="px-3 py-2">Due Date</th>
                            <th className="px-3 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(operationsData?.reviewTasks || []).slice(0, 30).map((task: any) => (
                            <tr key={task.task_id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-semibold text-slate-700">{task.source || "-"}</td>
                              <td className="px-3 py-2">
                                <p className="font-mono font-bold text-dark-blue">{task.claim_id || "-"}</p>
                                <p className="font-mono text-[10px] text-slate-400">{task.cpt_code || "-"}</p>
                              </td>
                              <td className="max-w-sm px-3 py-2">
                                <p className="truncate text-slate-500" title={task.reason}>{task.reason || "-"}</p>
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={task.assigned_to || ""}
                                  disabled={savingReviewTaskId === task.task_id}
                                  onChange={event => void handleUpdateReviewTask(task, { assigned_to: event.target.value })}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-primary-blue"
                                >
                                  <option value="">{isEnglish ? "Unassigned" : "Sin asignar"}</option>
                                  {users.filter(user => user.active).map(user => <option key={user.user_id} value={user.user_id}>{user.name || user.email}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={task.priority || "Medium"}
                                  disabled={savingReviewTaskId === task.task_id}
                                  onChange={event => void handleUpdateReviewTask(task, { priority: event.target.value })}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-primary-blue"
                                >
                                  {["Low", "Medium", "High"].map(value => <option key={value} value={value}>{value}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="date"
                                  value={task.due_date || ""}
                                  disabled={savingReviewTaskId === task.task_id}
                                  onChange={event => void handleUpdateReviewTask(task, { due_date: event.target.value })}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-primary-blue"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={task.status || "Open"}
                                  disabled={savingReviewTaskId === task.task_id}
                                  onChange={event => void handleUpdateReviewTask(task, { status: event.target.value })}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-primary-blue"
                                >
                                  {["Open", "In Progress", "Resolved", "Dismissed"].map(value => <option key={value} value={value}>{value}</option>)}
                                </select>
                              </td>
                            </tr>
                          ))}
                          {(!operationsData?.reviewTasks || operationsData.reviewTasks.length === 0) && (
                            <tr><td colSpan={7} className="px-3 py-8 text-center text-xs font-semibold text-slate-400">{isEnglish ? "No review tasks." : "No hay tareas de revisión."}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="grid gap-5 xl:grid-cols-2">
                    {[
                      { title: isEnglish ? "Import History" : "Historial de Importación", rows: operationsData?.importHistory || [], columns: ["import_type", "file_name", "imported_rows", "rejected_rows", "status"] },
                      { title: isEnglish ? "Jobs" : "Procesos", rows: operationsData?.jobs || [], columns: ["job_type", "status", "progress", "requested_by", "requested_at"] },
                      { title: isEnglish ? "Bank Deposits" : "Depósitos Bancarios", rows: operationsData?.bankDeposits || [], columns: ["deposit_date", "payer_name", "deposit_amount", "matched_payment_total", "status"] },
                      { title: isEnglish ? "Notifications" : "Notificaciones", rows: operationsData?.notifications || [], columns: ["severity", "title", "message", "created_at", "target_role"] }
                    ].map(section => (
                      <div key={section.title} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                          <h4 className="text-sm font-bold text-slate-900">{section.title}</h4>
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{section.rows.length}</span>
                        </div>
                        <div className="max-h-72 overflow-auto">
                          <table className="w-full min-w-[640px] text-left text-xs">
                            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                              <tr>
                                {section.columns.map(column => <th key={column} className="px-3 py-2">{column.replace(/_/g, " ")}</th>)}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {section.rows.slice(0, 12).map((row: any, index: number) => (
                                <tr key={row.import_id || row.task_id || row.job_id || row.deposit_id || row.notification_id || index} className="hover:bg-slate-50">
                                  {section.columns.map(column => (
                                    <td key={column} className="max-w-[180px] truncate px-3 py-2 text-slate-600" title={String(row[column] ?? "")}>
                                      {column.includes("amount") || column.includes("total") ? `$${Number(row[column] || 0).toFixed(2)}` : String(row[column] ?? "-")}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                              {section.rows.length === 0 && (
                                <tr><td colSpan={section.columns.length} className="px-3 py-6 text-center text-xs font-semibold text-slate-400">{isEnglish ? "No records." : "No hay registros."}</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                      <h4 className="text-sm font-bold text-slate-900">{isEnglish ? "Recent User Activity" : "Actividad Reciente de Usuarios"}</h4>
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{operationsData?.activity?.length || 0}</span>
                    </div>
                    <div className="max-h-72 overflow-auto">
                      <table className="w-full min-w-[860px] text-left text-xs">
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                          <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Entity</th><th className="px-3 py-2">ID</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(operationsData?.activity || []).slice(0, 20).map((item: any) => (
                            <tr key={item.activity_id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-mono text-slate-500">{item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</td>
                              <td className="px-3 py-2 text-slate-700">{item.user_email}</td>
                              <td className="px-3 py-2 font-semibold text-slate-700">{item.action}</td>
                              <td className="px-3 py-2 text-slate-500">{item.entity_type}</td>
                              <td className="px-3 py-2 font-mono text-slate-500">{item.entity_id || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === "import-templates" && [UserRole.Admin, UserRole.BillingManager].includes(currentUser.role) && (
                <div className="space-y-5">
                  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{isEnglish ? "Payment Import Template Library" : "Biblioteca de Templates de Payment Import"}</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          {isEnglish
                            ? "Saved column mappings are stored in the Import_Mapping_Templates sheet and are auto-selected when a provider file has the same column signature."
                            : "Los mappings guardados se almacenan en Import_Mapping_Templates y se seleccionan automáticamente cuando el archivo tiene la misma firma de columnas."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadOperationsCenter()}
                        disabled={isLoadingOperations}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                      >
                        <RefreshCw className={`h-4 w-4 ${isLoadingOperations ? "animate-spin" : ""}`} />
                        {isEnglish ? "Refresh" : "Actualizar"}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                    <div className="overflow-auto">
                      <table className="w-full min-w-[1180px] text-left text-xs">
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Template</th>
                            <th className="px-3 py-2">Provider</th>
                            <th className="px-3 py-2">System</th>
                            <th className="px-3 py-2">Mapped Fields</th>
                            <th className="px-3 py-2">Column Signature</th>
                            <th className="px-3 py-2">Updated</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(operationsData?.importMappingTemplates || []).map((template: any) => {
                            const draft = editingTemplateDrafts[template.template_id] || {
                              template_name: template.template_name || "",
                              provider_name: template.provider_name || "",
                              system_name: template.system_name || ""
                            };
                            let mappedFields = 0;
                            try {
                              mappedFields = Object.values(JSON.parse(template.mapping_json || "{}")).filter(Boolean).length;
                            } catch {
                              mappedFields = 0;
                            }
                            return (
                              <tr key={template.template_id} className="hover:bg-slate-50">
                                <td className="px-3 py-2">
                                  <input
                                    value={draft.template_name}
                                    onChange={event => setEditingTemplateDrafts(current => ({ ...current, [template.template_id]: { ...draft, template_name: event.target.value } }))}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-800"
                                  />
                                  <p className="mt-1 font-mono text-[9px] text-slate-400">{template.template_id}</p>
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    value={draft.provider_name}
                                    onChange={event => setEditingTemplateDrafts(current => ({ ...current, [template.template_id]: { ...draft, provider_name: event.target.value } }))}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    value={draft.system_name}
                                    onChange={event => setEditingTemplateDrafts(current => ({ ...current, [template.template_id]: { ...draft, system_name: event.target.value } }))}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <span className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-bold text-dark-blue">{mappedFields}</span>
                                </td>
                                <td className="max-w-xs px-3 py-2">
                                  <p className="truncate font-mono text-[10px] text-slate-500" title={template.headers_signature}>{template.headers_signature || "-"}</p>
                                </td>
                                <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{template.updated_at ? new Date(template.updated_at).toLocaleString() : "-"}</td>
                                <td className="px-3 py-2">
                                  <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${template.active !== false ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                    {template.active !== false ? "Active" : "Inactive"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      disabled={savingTemplateId === template.template_id}
                                      onClick={() => void handleUpdateImportTemplate(template, draft)}
                                      className="rounded-lg bg-primary-blue px-3 py-1.5 text-[11px] font-bold text-white hover:bg-dark-blue disabled:opacity-60"
                                    >
                                      {savingTemplateId === template.template_id ? (isEnglish ? "Saving..." : "Guardando...") : (isEnglish ? "Save" : "Guardar")}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={savingTemplateId === template.template_id}
                                      onClick={() => void handleUpdateImportTemplate(template, { active: template.active === false })}
                                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                                    >
                                      {template.active === false ? (isEnglish ? "Activate" : "Activar") : (isEnglish ? "Deactivate" : "Desactivar")}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {(!operationsData?.importMappingTemplates || operationsData.importMappingTemplates.length === 0) && (
                            <tr><td colSpan={8} className="px-3 py-10 text-center text-xs font-semibold text-slate-400">{isLoadingOperations ? (isEnglish ? "Loading..." : "Cargando...") : (isEnglish ? "No saved payment import templates." : "No hay templates guardados.")}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === "backups" && currentUser.role === UserRole.Admin && (
                <div className="space-y-5">
                  <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="max-w-3xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-blue-50 rounded-lg text-primary-blue">
                            <History className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm">{isEnglish ? "Google Drive Backups" : "Salvas en Google Drive"}</h4>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              {isEnglish
                                ? "Create full spreadsheet backups, schedule automatic copies and restore from a selected backup."
                                : "Crea salvas completas del spreadsheet, programa copias automáticas y restaura desde una salva seleccionada."}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-3 md:grid-cols-3">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{isEnglish ? "Drive status" : "Estado Drive"}</p>
                            <p className={`mt-1 text-xs font-bold ${backupConfig?.googleDriveConfigured ? "text-emerald-700" : "text-rose-700"}`}>
                              {backupConfig?.googleDriveConfigured ? (isEnglish ? "Configured" : "Configurado") : (isEnglish ? "Not configured" : "No configurado")}
                            </p>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{isEnglish ? "Last backup" : "Última salva"}</p>
                            <p className="mt-1 text-xs font-bold text-slate-800">
                              {backupConfig?.lastBackupAt ? new Date(backupConfig.lastBackupAt).toLocaleString() : "-"}
                            </p>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{isEnglish ? "Next scheduled" : "Próxima programada"}</p>
                            <p className="mt-1 text-xs font-bold text-slate-800">
                              {backupConfig?.enabled && backupConfig?.nextBackupAt ? new Date(backupConfig.nextBackupAt).toLocaleString() : (isEnglish ? "Disabled" : "Desactivada")}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                        <button
                          type="button"
                          onClick={() => void loadBackups()}
                          disabled={isLoadingBackups}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                        >
                          <RefreshCw className={`w-4 h-4 ${isLoadingBackups ? "animate-spin" : ""}`} />
                          {isEnglish ? "Refresh" : "Actualizar"}
                        </button>
                        <button
                          type="button"
                          onClick={handleCreateBackupNow}
                          disabled={isCreatingBackup || !backupConfig?.googleDriveConfigured}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-blue px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-dark-blue disabled:opacity-60"
                        >
                          <FileDown className="w-4 h-4" />
                          {isCreatingBackup ? (isEnglish ? "Creating..." : "Creando...") : (isEnglish ? "Backup now" : "Crear salva ahora")}
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-4 lg:grid-cols-[160px_1fr_170px] lg:items-end">
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">{isEnglish ? "Enabled" : "Activa"}</span>
                        <button
                          type="button"
                          onClick={() => setBackupEnabled(!backupEnabled)}
                          className={`flex h-10 w-full items-center justify-between rounded-lg border px-3 text-xs font-bold ${backupEnabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}
                        >
                          <span>{backupEnabled ? (isEnglish ? "On" : "Sí") : (isEnglish ? "Off" : "No")}</span>
                          <span className={`h-4 w-4 rounded-full ${backupEnabled ? "bg-emerald-500" : "bg-slate-300"}`} />
                        </button>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">{isEnglish ? "Google Drive folder ID" : "Folder ID de Google Drive"}</span>
                        <input
                          value={backupFolderId}
                          onChange={event => setBackupFolderId(event.target.value)}
                          placeholder={isEnglish ? "Leave blank to use the spreadsheet folder" : "Dejar vacío para usar el folder del spreadsheet"}
                          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 outline-none focus:border-primary-blue focus:ring-2 focus:ring-blue-100"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">{isEnglish ? "Every hours" : "Cada horas"}</span>
                        <input
                          type="number"
                          min={1}
                          value={backupFrequencyHours}
                          onChange={event => setBackupFrequencyHours(Number(event.target.value || 24))}
                          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 outline-none focus:border-primary-blue focus:ring-2 focus:ring-blue-100"
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={handleSaveBackupSettings}
                        disabled={isSavingBackupSettings}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-dark-blue px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-secondary-blue disabled:opacity-60"
                      >
                        <Calendar className="w-4 h-4" />
                        {isSavingBackupSettings ? (isEnglish ? "Saving..." : "Guardando...") : (isEnglish ? "Save schedule" : "Guardar programación")}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{isEnglish ? "Available Backups" : "Salvas disponibles"}</h4>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {isEnglish ? "Restore creates a safety backup first, then replaces the current workbook data." : "Restaurar crea primero una salva de seguridad y luego reemplaza los datos actuales."}
                        </p>
                      </div>
                      <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] font-bold text-slate-500">{backups.length}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1080px] text-left text-xs">
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                          <tr>
                            <th className="px-4 py-3">{isEnglish ? "Created" : "Creada"}</th>
                            <th className="px-4 py-3">{isEnglish ? "Backup file" : "Archivo"}</th>
                            <th className="px-4 py-3">{isEnglish ? "Status" : "Estado"}</th>
                            <th className="px-4 py-3">{isEnglish ? "Last restored" : "Última restauración"}</th>
                            <th className="px-4 py-3">{isEnglish ? "Notes" : "Notas"}</th>
                            <th className="px-4 py-3 text-right">{isEnglish ? "Action" : "Acción"}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {backups.length === 0 && (
                            <tr>
                              <td colSpan={6} className="px-4 py-8 text-center text-xs font-semibold text-slate-400">
                                {isLoadingBackups ? (isEnglish ? "Loading backups..." : "Cargando salvas...") : (isEnglish ? "No backups found." : "No hay salvas disponibles.")}
                              </td>
                            </tr>
                          )}
                          {backups.map(backup => (
                            <tr key={backup.backup_file_id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-mono text-slate-500">{backup.created_at ? new Date(backup.created_at).toLocaleString() : "-"}</td>
                              <td className="px-4 py-3">
                                <p className="font-bold text-slate-800">{backup.backup_file_name}</p>
                                <p className="mt-0.5 font-mono text-[10px] text-slate-400">{backup.backup_file_id}</p>
                              </td>
                              <td className="px-4 py-3">
                                {backup.last_restored_at ? (
                                  <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                                    {isEnglish ? "Restored" : "Restaurada"}
                                  </span>
                                ) : (
                                  <span className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{backup.status || "Available"}</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {backup.last_restored_at ? (
                                  <div>
                                    <p className="font-mono text-slate-700">{new Date(backup.last_restored_at).toLocaleString()}</p>
                                    <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{backup.last_restored_by || "-"}</p>
                                  </div>
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )}
                              </td>
                              <td className="max-w-sm px-4 py-3 text-slate-500">{backup.notes || "-"}</td>
                              <td className="px-4 py-3">
                                <div className="flex justify-end gap-2">
                                  {backup.backup_drive_url && (
                                    <a
                                      href={backup.backup_drive_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                                    >
                                      Drive
                                    </a>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenRestoreBackup(backup)}
                                    disabled={restoringBackupId === backup.backup_file_id}
                                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                                  >
                                    {restoringBackupId === backup.backup_file_id ? (isEnglish ? "Restoring..." : "Restaurando...") : (isEnglish ? "Restore" : "Restaurar")}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === "data-cleanup" && currentUser.role === UserRole.Admin && (
                <div className="bg-white rounded-xl border border-rose-200 p-6 shadow-xs">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-2xl">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-rose-50 rounded-lg text-rose-600">
                          <Trash2 className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">
                            {isEnglish ? "Production Data Cleanup" : "Limpieza para Inicio en Producción"}
                          </h4>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {isEnglish
                              ? "Removes only patient and test movement data from operational sheets."
                              : "Elimina solo información de pacientes y movimientos de prueba de las hojas operativas."}
                          </p>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[10px] font-bold uppercase text-slate-500">{isEnglish ? "Will be cleared" : "Se limpiará"}</p>
                          <p className="mt-1 font-mono text-xs font-semibold text-slate-800">Claims, Payments, Notes, Audit_Log</p>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                          <p className="text-[10px] font-bold uppercase text-emerald-700">{isEnglish ? "Will not be touched" : "No se tocará"}</p>
                          <p className="mt-1 text-xs font-semibold text-emerald-900">
                            Providers, Payers, Users, Settings, FeeSchedules, Fee_Schedule, Eligibility_Coverage
                          </p>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setClearOperationalDataText("");
                        setShowClearOperationalDataConfirm(true);
                      }}
                      disabled={isClearingOperationalData}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>
                        {isClearingOperationalData
                          ? (isEnglish ? "Clearing..." : "Limpiando...")
                          : (isEnglish ? "Clear Operational Data" : "Limpiar Datos Operativos")}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === "users" && (
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-5">
                  <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-blue-50 rounded-lg text-primary-blue">
                        <UserRound className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">{isEnglish ? "Users & Role Access" : "Usuarios y Roles de Acceso"}</h4>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {isEnglish ? "Manage application users, role-based navigation access and active/inactive status." : "Gestiona usuarios, acceso por rol y estado activo/inactivo."}
                        </p>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder={isEnglish ? "Search user..." : "Buscar usuario..."}
                        value={userSearchTerm}
                        onChange={(e) => setUserSearchTerm(e.target.value)}
                        className="pl-8 pr-3 py-1.5 border border-slate-200 bg-slate-50 rounded-lg text-[11px] w-56 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-blue transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4 lg:grid-cols-[150px_1fr_1.4fr_220px_120px_auto]">
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">User ID</label>
                      <div className="flex min-h-[30px] items-center rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono font-bold text-slate-700">
                        {editingUser?.user_id || (isEnglish ? "Auto-generated" : "Autogenerado")}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">{isEnglish ? "Name" : "Nombre"}</label>
                      <input
                        value={userNameInput}
                        onChange={(e) => setUserNameInput(e.target.value)}
                        placeholder="Billing Specialist"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Email</label>
                      <input
                        type="email"
                        value={userEmailInput}
                        onChange={(e) => setUserEmailInput(e.target.value)}
                        placeholder="user@itera.health"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Role</label>
                      <select
                        value={userRoleInput}
                        onChange={(e) => handleUserRoleChange(e.target.value as UserRole)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold"
                      >
                        {Object.values(UserRole).map(role => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status</label>
                      <select
                        value={userActiveInput ? "active" : "inactive"}
                        onChange={(e) => setUserActiveInput(e.target.value === "active")}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={handleSaveUser}
                        className="rounded-lg bg-primary-blue px-3 py-1.5 text-[11px] font-bold text-white hover:bg-dark-blue"
                      >
                        {editingUser ? (isEnglish ? "Update" : "Actualizar") : (isEnglish ? "Add" : "Añadir")}
                      </button>
                      {editingUser && (
                        <button
                          type="button"
                          onClick={resetUserForm}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                        >
                          {isEnglish ? "Cancel" : "Cancelar"}
                        </button>
                      )}
                    </div>
                    <div className="lg:col-span-6 grid gap-3 border-t border-blue-100 pt-3 lg:grid-cols-3">
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">
                            {isEnglish ? "Menu access" : "Acceso al menú"}
                          </label>
                          <button
                            type="button"
                            onClick={() => setUserMenuAccessInput(ROLE_DEFAULT_MENU_ACCESS[userRoleInput])}
                            className="text-[9px] font-bold text-primary-blue hover:text-dark-blue"
                          >
                            {isEnglish ? "Role default" : "Default del rol"}
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {MENU_ACCESS_IDS.map(menuId => {
                            const labels: Record<MenuAccessId, string> = {
                              dashboard: isEnglish ? "Dashboard" : "Tablero",
                              claims: isEnglish ? "Claims Worklist" : "Worklist de Claims",
                              payments: isEnglish ? "Payment Control" : "Control de Pagos",
                              "payment-reconciliation-import": isEnglish ? "Payment Import" : "Importar Pagos",
                              "import-exceptions": isEnglish ? "Import Exceptions" : "Excepciones Import",
                              "rcm-work-queue": isEnglish ? "RCM Work Queue" : "Cola RCM",
                              "rcm-productivity": isEnglish ? "RCM Productivity" : "Productividad RCM",
                              denials: isEnglish ? "Denials Report" : "Reporte de Denials",
                              errors: isEnglish ? "Claims with Errors" : "Claims con Errores",
                              providers: isEnglish ? "Physician Balances" : "Balance de Médicos",
                              reports: isEnglish ? "Reports" : "Reportes",
                              settings: isEnglish ? "Settings" : "Configuración",
                              "audit-log": isEnglish ? "Audit Log" : "Log de Auditoría"
                            };
                            return (
                              <label key={menuId} className="flex items-center gap-2 rounded-md border border-slate-100 px-2 py-1.5 text-[10px] font-semibold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={userMenuAccessInput.includes(menuId)}
                                  onChange={() => toggleUserMenuAccess(menuId)}
                                  className="h-3.5 w-3.5 accent-primary-blue"
                                />
                                <span>{labels[menuId]}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">
                            {isEnglish ? "Action permissions" : "Permisos de acción"}
                          </label>
                          <button
                            type="button"
                            onClick={() => setUserActionAccessInput(ROLE_DEFAULT_ACTION_ACCESS[userRoleInput])}
                            className="text-[9px] font-bold text-primary-blue hover:text-dark-blue"
                          >
                            {isEnglish ? "Role default" : "Default del rol"}
                          </button>
                        </div>
                        <div className="grid max-h-32 grid-cols-1 gap-1.5 overflow-y-auto pr-1">
                          {ACTION_ACCESS_IDS.map(actionId => {
                            const labels: Record<ActionAccessId, string> = {
                              "claims.create": isEnglish ? "Create claims" : "Crear claims",
                              "claims.edit": isEnglish ? "Edit claims" : "Editar claims",
                              "claims.delete": isEnglish ? "Delete claims" : "Eliminar claims",
                              "claims.import": isEnglish ? "Import claims" : "Importar claims",
                              "payments.import": isEnglish ? "Import payments" : "Importar pagos",
                              "payments.apply": isEnglish ? "Apply payment matches" : "Aplicar matches de pago",
                              "review.assign": isEnglish ? "Assign review tasks" : "Asignar tareas",
                              "settings.manage": isEnglish ? "Manage settings" : "Gestionar settings",
                              "backups.restore": isEnglish ? "Restore backups" : "Restaurar salvas",
                              "data.cleanup": isEnglish ? "Clean test data" : "Limpiar data prueba"
                            };
                            return (
                              <label key={actionId} className="flex items-center gap-2 rounded-md border border-slate-100 px-2 py-1.5 text-[10px] font-semibold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={userActionAccessInput.includes(actionId)}
                                  onChange={() => toggleUserActionAccess(actionId)}
                                  className="h-3.5 w-3.5 accent-primary-blue"
                                />
                                <span>{labels[actionId]}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">
                            {isEnglish ? "Provider access" : "Acceso a providers"}
                          </label>
                          <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
                            <input
                              type="checkbox"
                              checked={userProviderAccessAllInput}
                              onChange={(event) => setUserProviderAccessAllInput(event.target.checked)}
                              className="h-3.5 w-3.5 accent-primary-blue"
                            />
                            {isEnglish ? "All providers" : "Todos los providers"}
                          </label>
                        </div>
                        <div className={`grid max-h-32 grid-cols-1 gap-1.5 overflow-y-auto pr-1 ${userProviderAccessAllInput ? "opacity-45" : ""}`}>
                          {providers.map(provider => (
                            <label key={provider.provider_id} className="flex items-center gap-2 rounded-md border border-slate-100 px-2 py-1.5 text-[10px] font-semibold text-slate-700">
                              <input
                                type="checkbox"
                                disabled={userProviderAccessAllInput}
                                checked={userProviderAccessIdsInput.includes(provider.provider_id)}
                                onChange={() => toggleUserProviderAccess(provider.provider_id)}
                                className="h-3.5 w-3.5 accent-primary-blue disabled:opacity-40"
                              />
                              <span className="truncate">{provider.provider_name}</span>
                              <span className="ml-auto font-mono text-[9px] text-slate-400">{provider.provider_id}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[10px] text-slate-500">
                    <span className="font-bold text-slate-700">{isEnglish ? "Access model:" : "Modelo de acceso:"}</span>{" "}
                    {isEnglish
                      ? "Role still controls the maximum capability. Menu access controls visible sections, and provider access limits which patients/claims the user can see."
                      : "El rol controla la capacidad máxima. El acceso al menú controla las secciones visibles y el acceso a providers limita qué pacientes/claims puede ver el usuario."}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider bg-slate-50 text-[10px]">
                          <th className="p-3">User ID</th>
                          <th className="p-3">{isEnglish ? "User" : "Usuario"}</th>
                          <th className="p-3">Email</th>
                          <th className="p-3">Role</th>
                          <th className="p-3">{isEnglish ? "Menu Access" : "Acceso menú"}</th>
                          <th className="p-3">{isEnglish ? "Providers" : "Providers"}</th>
                          <th className="p-3">Status</th>
                          <th className="p-3 text-right">{isEnglish ? "Actions" : "Acciones"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {users
                          .filter(user => `${user.user_id} ${user.name} ${user.email} ${user.role}`.toLowerCase().includes(userSearchTerm.toLowerCase()))
                          .map(user => (
                            <tr key={user.user_id} className="hover:bg-slate-50/60">
                              <td className="p-3 font-mono font-bold text-primary-blue">{user.user_id}</td>
                              <td className="p-3 font-semibold text-slate-800">{user.name}</td>
                              <td className="p-3 font-mono text-slate-600">{user.email}</td>
                              <td className="p-3">
                                <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-dark-blue">
                                  {user.role}
                                </span>
                              </td>
                              <td className="p-3 text-[10px] text-slate-500">
                                {getUserMenuAccess(user).length} {isEnglish ? "sections" : "secciones"}
                              </td>
                              <td className="p-3 text-[10px] text-slate-500">
                                {userHasAllProviderAccess(user)
                                  ? (isEnglish ? "All providers" : "Todos")
                                  : parseProviderAccess(user.provider_access).join(", ")}
                              </td>
                              <td className="p-3">
                                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${user.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                                  {user.active ? "Active" : "Inactive"}
                                </span>
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    type="button"
                                    disabled={!user.email}
                                    onClick={() => handleSendPasswordReset(user)}
                                    className="rounded p-1 text-slate-500 hover:bg-blue-50 hover:text-primary-blue disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                                    title={isEnglish ? "Send password reset email" : "Enviar email de reset password"}
                                  >
                                    <Mail className="h-3.5 w-3.5" />
                                  </button>
                                  {currentUser.role === UserRole.Admin && (
                                    <button
                                      type="button"
                                      disabled={!user.email}
                                      onClick={() => openAdminPasswordModal(user)}
                                      className="rounded p-1 text-slate-500 hover:bg-blue-50 hover:text-primary-blue disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                                      title={isEnglish ? "Change password" : "Cambiar password"}
                                    >
                                      <KeyRound className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleEditUser(user)}
                                    className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                    title={isEnglish ? "Edit" : "Editar"}
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={user.user_id === currentUser.user_id}
                                    onClick={() => handleDeleteUser(user)}
                                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                                    title={user.user_id === currentUser.user_id ? "Active session user cannot be deleted" : (isEnglish ? "Delete" : "Eliminar")}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {settingsTab === "providers" && (
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-5">
                  <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-blue-50 rounded-lg text-primary-blue">
                        <UserRound className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">{isEnglish ? "Provider Registry" : "Registro de Providers"}</h4>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {isEnglish ? "Register physician/provider names and NPIs used by Billing Worklist imports." : "Registra nombres y NPI de providers usados por los imports de Billing Worklist."}
                        </p>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder={isEnglish ? "Search provider..." : "Buscar provider..."}
                        value={providerSearchTerm}
                        onChange={(e) => setProviderSearchTerm(e.target.value)}
                        className="pl-8 pr-3 py-1.5 border border-slate-200 bg-slate-50 rounded-lg text-[11px] w-56 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-blue transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4 lg:grid-cols-[130px_1fr_150px_140px_1fr_120px_auto]">
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Provider ID</label>
                      <input
                        value={providerIdInput}
                        disabled={!!editingProvider}
                        onChange={(e) => setProviderIdInput(e.target.value)}
                        placeholder="PROV_05"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono font-bold disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">{isEnglish ? "Provider name" : "Nombre"}</label>
                      <input
                        value={providerNameInput}
                        onChange={(e) => setProviderNameInput(e.target.value)}
                        placeholder="Dr. Jane Smith"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">NPI</label>
                      <input
                        value={providerNpiInput}
                        onChange={(e) => setProviderNpiInput(e.target.value)}
                        placeholder="1122221221"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Practice ID</label>
                      <input
                        value={providerPracticeIdInput}
                        onChange={(e) => setProviderPracticeIdInput(e.target.value)}
                        placeholder="PRAC_01"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Practice</label>
                      <input
                        value={providerPracticeNameInput}
                        onChange={(e) => setProviderPracticeNameInput(e.target.value)}
                        placeholder="Metropolitan Care Group"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status</label>
                      <select
                        value={providerActiveInput ? "active" : "inactive"}
                        onChange={(e) => setProviderActiveInput(e.target.value === "active")}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={handleSaveProvider}
                        className="rounded-lg bg-primary-blue px-3 py-1.5 text-[11px] font-bold text-white hover:bg-dark-blue"
                      >
                        {editingProvider ? (isEnglish ? "Update" : "Actualizar") : (isEnglish ? "Add" : "Añadir")}
                      </button>
                      {editingProvider && (
                        <button
                          type="button"
                          onClick={resetProviderForm}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                        >
                          {isEnglish ? "Cancel" : "Cancelar"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider bg-slate-50 text-[10px]">
                          <th className="p-3">Provider ID</th>
                          <th className="p-3">{isEnglish ? "Provider" : "Provider"}</th>
                          <th className="p-3">NPI</th>
                          <th className="p-3">Practice</th>
                          <th className="p-3">Status</th>
                          <th className="p-3 text-right">{isEnglish ? "Actions" : "Acciones"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {providers
                          .filter(provider => `${provider.provider_id} ${provider.provider_name} ${provider.npi} ${provider.practice_name}`.toLowerCase().includes(providerSearchTerm.toLowerCase()))
                          .map(provider => (
                            <tr key={provider.provider_id} className="hover:bg-slate-50/60">
                              <td className="p-3 font-mono font-bold text-primary-blue">{provider.provider_id}</td>
                              <td className="p-3 font-semibold text-slate-800">{provider.provider_name}</td>
                              <td className="p-3 font-mono text-slate-600">{provider.npi}</td>
                              <td className="p-3 text-slate-500">
                                <div className="font-semibold text-slate-700">{provider.practice_name}</div>
                                <div className="font-mono text-[10px] text-slate-400">{provider.practice_id}</div>
                              </td>
                              <td className="p-3">
                                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${provider.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                                  {provider.active ? "Active" : "Inactive"}
                                </span>
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleEditProvider(provider)}
                                    className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                    title={isEnglish ? "Edit" : "Editar"}
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteProvider(provider)}
                                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                    title={isEnglish ? "Delete or deactivate" : "Eliminar o desactivar"}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {settingsTab === "payers" && (
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-5">
                  <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-blue-50 rounded-lg text-primary-blue">
                        <Hospital className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">{isEnglish ? "Insurance Payer Registry" : "Registro de Aseguradoras"}</h4>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {isEnglish ? "Define the insurance companies this billing workflow can use across claims and ERA reconciliation." : "Define las aseguradoras que usará el sistema en claims y conciliación ERA."}
                        </p>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder={isEnglish ? "Search payer..." : "Buscar aseguradora..."}
                        value={payerSearchTerm}
                        onChange={(e) => setPayerSearchTerm(e.target.value)}
                        className="pl-8 pr-3 py-1.5 border border-slate-200 bg-slate-50 rounded-lg text-[11px] w-56 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-blue transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4 lg:grid-cols-[140px_140px_1fr_150px_220px_120px_auto]">
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Payer ID</label>
                      <input
                        value={payerIdInput}
                        disabled={!!editingPayer}
                        onChange={(e) => setPayerIdInput(e.target.value)}
                        placeholder="PAY_06"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono font-bold disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">pVerify Code</label>
                      <input
                        value={payerPverifyCodeInput}
                        onChange={(e) => setPayerPverifyCodeInput(e.target.value)}
                        placeholder="00283"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">{isEnglish ? "Insurance name" : "Nombre de aseguradora"}</label>
                      <input
                        value={payerNameInput}
                        onChange={(e) => setPayerNameInput(e.target.value)}
                        placeholder="Humana Medicare Advantage"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Type</label>
                      <select
                        value={payerTypeInput}
                        onChange={(e) => setPayerTypeInput(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold"
                      >
                        <option>Medicare</option>
                        <option>Medicaid</option>
                        <option>Commercial</option>
                        <option>Medicare Advantage</option>
                        <option>Workers Comp</option>
                        <option>Self Pay</option>
                        <option>EDI</option>
                        <option>Non-EDI</option>
                        <option>Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">pVerify Support</label>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          ["Elig.", payerEligibilityInput, setPayerEligibilityInput],
                          ["Claim", payerClaimStatusInput, setPayerClaimStatusInput],
                          ["Dental", payerDentalEligibilityInput, setPayerDentalEligibilityInput]
                        ].map(([label, checked, setter]) => (
                          <label key={String(label)} className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-1.5 text-[10px] font-bold text-slate-600">
                            <input
                              type="checkbox"
                              checked={Boolean(checked)}
                              onChange={(event) => (setter as React.Dispatch<React.SetStateAction<boolean>>)(event.target.checked)}
                              className="h-3 w-3"
                            />
                            {String(label)}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status</label>
                      <select
                        value={payerActiveInput ? "active" : "inactive"}
                        onChange={(e) => setPayerActiveInput(e.target.value === "active")}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={handleSavePayer}
                        className="rounded-lg bg-primary-blue px-3 py-1.5 text-[11px] font-bold text-white hover:bg-dark-blue"
                      >
                        {editingPayer ? (isEnglish ? "Update" : "Actualizar") : (isEnglish ? "Add Payer" : "Añadir")}
                      </button>
                      {editingPayer && (
                        <button
                          type="button"
                          onClick={resetPayerForm}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                        >
                          {isEnglish ? "Cancel" : "Cancelar"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider bg-slate-50 text-[10px]">
                          <th className="p-3">Payer ID</th>
                          <th className="p-3">pVerify</th>
                          <th className="p-3">{isEnglish ? "Insurance" : "Aseguradora"}</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Support</th>
                          <th className="p-3">Status</th>
                          <th className="p-3 text-right">{isEnglish ? "Actions" : "Acciones"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {payers
                          .filter(payer => `${payer.payer_id} ${payer.payer_name} ${payer.payer_type} ${payer.pverify_payer_code || ""}`.toLowerCase().includes(payerSearchTerm.toLowerCase()))
                          .map(payer => (
                            <tr key={payer.payer_id} className="hover:bg-slate-50/60">
                              <td className="p-3 font-mono font-bold text-primary-blue">{payer.payer_id}</td>
                              <td className="p-3 font-mono text-slate-500">{payer.pverify_payer_code || "-"}</td>
                              <td className="p-3 font-semibold text-slate-800">{payer.payer_name}</td>
                              <td className="p-3 text-slate-500">{payer.payer_type}</td>
                              <td className="p-3">
                                <div className="flex flex-wrap gap-1">
                                  {[
                                    ["ELIG", payer.eligibility_supported],
                                    ["CLAIM", payer.claim_status_supported],
                                    ["DENTAL", payer.dental_eligibility_supported]
                                  ].map(([label, value]) => (
                                    <span
                                      key={String(label)}
                                      className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${toBooleanFlag(value) ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-400"}`}
                                    >
                                      {String(label)}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="p-3">
                                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${payer.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                                  {payer.active ? "Active" : "Inactive"}
                                </span>
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleEditPayer(payer)}
                                    className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                    title={isEnglish ? "Edit" : "Editar"}
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePayer(payer)}
                                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                    title={isEnglish ? "Delete or deactivate" : "Eliminar o desactivar"}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {settingsTab === "fee-schedules" && (
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-blue-50 rounded-lg text-primary-blue">
                        <Coins className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">FCSO-style CPT Fee Schedules Configuration Manager</h4>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {isEnglish
                            ? "Define one rate set per CPT/year, including historical semesters for 2025, 2026 and future years."
                            : "Define una tarifa por CPT/año, incluyendo semestres históricos de 2025, 2026 y años futuros."}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                        <input
                          type="text"
                          placeholder={isEnglish ? "Search CPT..." : "Buscar CPT..."}
                          value={fsSearchTerm}
                          onChange={(e) => setFsSearchTerm(e.target.value)}
                          className="pl-8 pr-3 py-1.5 border border-slate-200 bg-slate-50 rounded-lg text-[11px] w-40 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-blue transition-all"
                        />
                      </div>
                      <button
                        onClick={handleOpenAddFeeSchedule}
                        className="flex items-center gap-1 bg-primary-blue hover:bg-dark-blue text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {isEnglish ? "New Fee" : "Nueva Tarifa"}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider bg-slate-50 text-[10px]">
                          <th className="p-3">{isEnglish ? "CPT Code" : "Cód. CPT"}</th>
                          <th className="p-3">{isEnglish ? "Year" : "Año"}</th>
                          <th className="p-3">{isEnglish ? "Semester 1 Rate (Jan-Jun)" : "Tarifa Semestre 1 (Ene-Jun)"}</th>
                          <th className="p-3">{isEnglish ? "Semester 2 Rate (Jul-Dec)" : "Tarifa Semestre 2 (Jul-Dic)"}</th>
                          <th className="p-3 text-center">Max/DOS</th>
                          <th className="p-3">{isEnglish ? "Official Description" : "Descripción Oficial"}</th>
                          <th className="p-3 text-right">{isEnglish ? "Actions" : "Acciones"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {visibleFeeSchedules
                          .map(fs => (
                            <tr key={fs.key} className="hover:bg-slate-50/50 transition-colors">
                              <td className="p-3 font-mono font-bold text-primary-blue text-xs">{fs.cptCode || "-"}</td>
                              <td className="p-3 font-mono text-slate-600">{fs.year}</td>
                              <td className="p-3 font-mono font-bold text-slate-900">${fs.semester1Rate.toFixed(2)}</td>
                              <td className="p-3 font-mono font-bold text-slate-900">${fs.semester2Rate.toFixed(2)}</td>
                              <td className="p-3 text-center font-mono font-bold text-slate-700">{fs.maxPerDos}</td>
                              <td className="p-3 text-slate-500 max-w-xs truncate" title={fs.description}>{fs.description || "-"}</td>
                              <td className="p-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleOpenAddFeeScheduleYear(fs.source)}
                                    className="p-1 hover:bg-blue-50 text-slate-500 hover:text-primary-blue rounded transition-colors"
                                    title={isEnglish ? "Add another year for this CPT" : "Añadir otro año para este CPT"}
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleOpenEditFeeSchedule(fs.source)}
                                    className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-900 rounded transition-colors"
                                    title={isEnglish ? "Edit" : "Editar"}
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (!fs.id) {
                                        notify(isEnglish ? "This fee has no valid ID to delete. Edit and save it first." : "Esta tarifa no tiene ID válido para eliminar. Edítela y guárdela primero.", "warning");
                                        return;
                                      }
                                      handleDeleteFeeSchedule(fs.id);
                                    }}
                                    className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded transition-colors"
                                    title={isEnglish ? "Delete" : "Eliminar"}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {visibleFeeSchedules.length === 0 && (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-slate-400">
                              {feeScheduleSearch
                                ? (isEnglish ? "No fees matched that search." : "No se encontraron tarifas con ese criterio.")
                                : (isEnglish ? "No fees are configured in the Fee Schedule." : "No hay tarifas configuradas en el Fee Schedule.")}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {settingsTab === "contract-rules" && (
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
                    <div className="p-2 bg-blue-50 rounded-lg text-primary-blue">
                      <Sliders className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{isEnglish ? "Contract Revenue Share Rules" : "Reglas Contractuales de Reparto de Ingresos (Shares)"}</h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {isEnglish ? "Configure agreed shares and the payment reconciliation basis for ITERA's physician network." : "Configura los porcentajes acordados y la base de conciliación de pagos para la red de médicos de ITERA."}
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-6 max-w-3xl text-xs pt-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <label className="block text-slate-600 mb-1.5 font-bold uppercase tracking-wider text-[10px]">
                        {isEnglish ? "Contract payment model" : "Modelo de pago contractual"}
                      </label>
                      <select
                        defaultValue={settings.find(s => s.setting_key === "CONTRACT_PAYMENT_MODEL")?.setting_value || "PERCENTAGE"}
                        onChange={(e) => handleUpdateSetting("CONTRACT_PAYMENT_MODEL", e.target.value)}
                        className="p-2.5 border border-slate-200 bg-white rounded-lg text-slate-700 font-semibold w-full focus:outline-none focus:ring-1 focus:ring-primary-blue"
                      >
                        <option value="PERCENTAGE">{isEnglish ? "Percentage Share Model" : "Modelo por porcentaje"}</option>
                        <option value="FEE">{isEnglish ? "Fixed Fee Model" : "Modelo por fee fijo"}</option>
                      </select>
                      <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                        {isEnglish
                          ? "Choose whether revenue is split by percentage or by fixed fees depending on who performs the billing."
                          : "Escoge si la distribución se calcula por porcentaje o por fees fijos según quién realiza el billing."}
                      </p>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-slate-600 mb-1.5 font-bold uppercase tracking-wider text-[10px]">{isEnglish ? "Physician share percentage (%)" : "PORCENTAJE PARA EL MÉDICO (%)"}</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            defaultValue={settings.find(s => s.setting_key === "PROVIDER_SHARE_PERCENT")?.setting_value || 70}
                            onBlur={(e) => handleUpdateSetting("PROVIDER_SHARE_PERCENT", e.target.value)}
                            className="p-2 border border-slate-200 bg-white rounded font-mono font-bold w-full"
                          />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                          {isEnglish ? "Share of collections owed to the physician. Default is 70%." : "Parte proporcional de cobros que le corresponde al médico. Por defecto es 70%."}
                        </p>
                      </div>

                      <div>
                        <label className="block text-slate-600 mb-1.5 font-bold uppercase tracking-wider text-[10px]">{isEnglish ? "ITERA HEALTH share percentage (%)" : "PORCENTAJE ITERA HEALTH (%)"}</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            defaultValue={settings.find(s => s.setting_key === "ITERA_SHARE_PERCENT")?.setting_value || 30}
                            onBlur={(e) => handleUpdateSetting("ITERA_SHARE_PERCENT", e.target.value)}
                            className="p-2 border border-slate-200 bg-white rounded font-mono font-bold w-full"
                          />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                          {isEnglish ? "Platform share retained by ITERA HEALTH. Default is 30%." : "Cobro de plataforma retenido por ITERA HEALTH. Por defecto es 30%."}
                        </p>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-slate-600 mb-1.5 font-bold uppercase tracking-wider text-[10px]">
                          {isEnglish ? "ITERA fee when practice bills ($)" : "Fee de ITERA cuando factura la práctica ($)"}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={settings.find(s => s.setting_key === "ITERA_FEE_WHEN_PROVIDER_BILLS")?.setting_value || 0}
                          onBlur={(e) => handleUpdateSetting("ITERA_FEE_WHEN_PROVIDER_BILLS", e.target.value)}
                          className="p-2 border border-slate-200 bg-white rounded font-mono font-bold w-full"
                        />
                        <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                          {isEnglish
                            ? "Fixed amount ITERA earns from the physician when billing and collection are handled by the practice. The amount is capped by actual collections."
                            : "Monto fijo que ITERA cobra al médico cuando el billing/cobro se hace en la práctica. Se limita a lo efectivamente cobrado."}
                        </p>
                      </div>

                      <div>
                        <label className="block text-slate-600 mb-1.5 font-bold uppercase tracking-wider text-[10px]">
                          {isEnglish ? "Physician fee when ITERA bills ($)" : "Fee del médico cuando factura ITERA ($)"}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={settings.find(s => s.setting_key === "PHYSICIAN_FEE_WHEN_ITERA_BILLS")?.setting_value || 0}
                          onBlur={(e) => handleUpdateSetting("PHYSICIAN_FEE_WHEN_ITERA_BILLS", e.target.value)}
                          className="p-2 border border-slate-200 bg-white rounded font-mono font-bold w-full"
                        />
                        <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                          {isEnglish
                            ? "Fixed amount owed to the physician when ITERA handles billing and collection. The amount is capped by actual collections."
                            : "Monto fijo que se debe al médico cuando ITERA realiza el billing/cobro. Se limita a lo efectivamente cobrado."}
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-600 mb-1.5 font-bold uppercase tracking-wider text-[10px]">{isEnglish ? "Reconciliation basis" : "CRITERIO DE RECONCILIACIÓN (Basis)"}</label>
                      <select
                        defaultValue={settings.find(s => s.setting_key === "PAYMENT_BASIS")?.setting_value || "COLLECTIONS"}
                        onChange={(e) => handleUpdateSetting("PAYMENT_BASIS", e.target.value)}
                        className="p-2.5 border border-slate-200 bg-slate-50 rounded-lg text-slate-700 font-semibold w-full focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-blue"
                      >
                        <option value="COLLECTIONS">{isEnglish ? "COLLECTIONS (Physician is paid only on actual bank collections)" : "COLLECTIONS (Se liquida al médico solo sobre cobro cobrado real en banco)"}</option>
                        <option value="BILLED">{isEnglish ? "BILLED (Physician is paid on net contractual billed charges regardless of collections)" : "BILLED (Se liquida sobre cargo facturado neto contractual independientemente de cobros)"}</option>
                      </select>
                      <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                        {isEnglish ? "Determines how physician balances are settled in monthly balance reports." : "Determina cómo se liquida el saldo a favor del médico en los reportes de balance mensuales."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}
        </main>
      </div>

      {/* MODAL: CREATE MANUAL CLAIM */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-slate-950/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-6xl w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-dark-blue p-5 text-white flex items-center justify-between">
              <h4 className="font-bold font-display text-sm">
                {editingClaim
                  ? (isEnglish ? "Edit Digital Care Claim" : "Editar Claim de Digital Care")
                  : (isEnglish ? "Create New Digital Care Claim" : "Crear Nuevo Claim de Digital Care")}
              </h4>
              <button
                onClick={handleCloseClaimEditor}
                disabled={isSavingClaim}
                className="p-1 hover:bg-white/10 rounded-full text-white disabled:cursor-wait disabled:opacity-50"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <form onSubmit={handleCreateClaimManually} className="max-h-[82vh] overflow-y-auto p-6 space-y-4 text-xs font-sans" aria-busy={isSavingClaim}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                  <label className="block text-primary-blue mb-1 font-bold uppercase tracking-wider text-[9px]">{editingClaim ? "Claim ID" : (isEnglish ? "Claim ID - Preview" : "Claim ID - Vista previa")}</label>
                  <div className="font-mono font-bold text-dark-blue text-[11px] break-all">
                    {editingClaim
                      ? editingClaim.claim_id
                      : <>
                          CLM-{newPatientId ? newPatientId.trim().toUpperCase().replace(/^MRN[-_\s]*/i, "").replace(/[^A-Z0-9]+/g, "") || "MRN" : "MRN"}
                          -{newDos ? newDos.replace(/-/g, "") : (isEnglish ? "YYYYMMDD" : "AAAAMMDD")}
                          -<span className="text-slate-400">###</span>
                        </>}
                  </div>
                  <p className="mt-1 text-[9px] text-slate-500">
                    {editingClaim
                      ? (isEnglish ? "Claim ID is not changed during edit." : "El Claim ID no cambia durante la edición.")
                      : (isEnglish ? "The sequence number is assigned when saved." : "El consecutivo se asigna al guardar.")}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <label className="block text-emerald-700 mb-1 font-bold uppercase tracking-wider text-[9px]">Total Billed Charge</label>
                  <div className="font-mono text-lg font-bold text-emerald-800">
                    {newClaimLineCharges.length > 0 ? `$${newClaimTotalCharge.toFixed(2)}` : "--"}
                  </div>
                  <p className="mt-1 text-[9px] text-emerald-700">{isEnglish ? "Auto-calculated from Fee Schedules by CPT." : "Autocalculado desde Fee Schedules por CPT."}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">{isEnglish ? "Patient Name" : "Nombre del Paciente"}</label>
                  <input
                    type="text"
                    required
                    placeholder="Juan Díaz"
                    value={newPatientName}
                    onChange={(e) => setNewPatientName(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">{isEnglish ? "MRN (Patient ID)" : "MRN (ID de Paciente)"}</label>
                  <input
                    type="text"
                    required
                    placeholder="MRN-10293"
                    value={newPatientId}
                    onChange={(e) => setNewPatientId(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">{isEnglish ? "Provider" : "Médico (Provider)"}</label>
                  <select
                    required
                    value={newProviderId}
                    onChange={(e) => setNewProviderId(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50 text-slate-700"
                  >
                    <option value="" disabled>{isEnglish ? "Select provider" : "Selecciona provider"}</option>
                    {visibleProviders.map(p => (
                      <option key={p.provider_id} value={p.provider_id}>{p.provider_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">{isEnglish ? "Insurance (Payer)" : "Aseguradora (Payer)"}</label>
                  <PayerCombobox
                    payers={payers}
                    value={newPayerId}
                    onChange={setNewPayerId}
                    required
                    allowEmpty={false}
                    placeholder={isEnglish ? "Type insurance name..." : "Escriba el nombre del insurance..."}
                  />
                  {!newPayerId && (
                    <p className="mt-1 text-[10px] font-semibold text-amber-600">
                      {isEnglish ? "Select a payer from the filtered list." : "Seleccione un payer de la lista filtrada."}
                    </p>
                  )}
                  {selectedNewPayer && (
                    <p className="mt-1 font-mono text-[10px] text-slate-400">ID: {selectedNewPayer.payer_id}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">{isEnglish ? "Date of Service (DOS)" : "Fecha de Servicio (DOS)"}</label>
                  <input
                    type="date"
                    required
                    value={newDos}
                    onChange={(e) => {
                      const dos = e.target.value;
                      setNewDos(dos);
                      setNewClaimLines(prev => prev.map(line => line.useClaimDos ? { ...line, dos } : line));
                    }}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50 font-mono text-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Billed By</label>
                  <select
                    required
                    value={newBilledBy}
                    onChange={(e) => setNewBilledBy(e.target.value as "" | "ITERA" | "Provider")}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50 text-slate-700 font-semibold"
                  >
                    <option value="" disabled>{isEnglish ? "Select" : "Selecciona"}</option>
                    <option value="ITERA">ITERA</option>
                    <option value="Provider">Provider</option>
                  </select>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h5 className="text-[11px] font-bold text-slate-900">CPT / Service Lines</h5>
                    <p className="text-[9px] text-slate-500">{isEnglish ? "Add multiple CPTs to the same claim, even when they belong to different services. Each line can use the claim DOS or a custom DOS." : "Añade varios CPT en el mismo claim, incluso si pertenecen a servicios diferentes. Cada línea puede usar el DOS general o uno específico."}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600">
                      <input
                        type="checkbox"
                        checked={newClaimLines.length > 0 && newClaimLines.every(line => line.useClaimDos)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setNewClaimLines(prev => prev.map(line => ({
                            ...line,
                            useClaimDos: checked,
                            dos: checked ? newDos : (line.dos || newDos)
                          })));
                        }}
                        disabled={isSavingClaim}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-primary-blue"
                      />
                      {isEnglish ? "Use claim DOS for all" : "Usar DOS general en todos"}
                    </label>
                    <button
                      type="button"
                      onClick={() => setNewClaimLines(prev => [...prev, createNewClaimServiceLine({ dos: newDos, useClaimDos: true })])}
                      disabled={isSavingClaim}
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-primary-blue hover:bg-blue-100 disabled:cursor-wait disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {isEnglish ? "Add CPT" : "Añadir CPT"}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-[128px_minmax(360px,1fr)_168px_128px_34px] gap-2 px-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    <span>{isEnglish ? "Service" : "Servicio"}</span>
                    <span>CPT Code</span>
                    <span>Line DOS</span>
                    <span>Charge</span>
                    <span></span>
                  </div>
                  {newClaimLines.map((line) => {
                    const charge = getManualClaimLineCharge(line);
                    const cptOptions = getCptOptionsForService(line.serviceType);
                    const hasSelectedCpt = cptOptions.some(option => option.cpt === line.cpt);
                    const visibleCptOptions = line.cpt && !hasSelectedCpt
                      ? [{ cpt: line.cpt, serviceType: line.serviceType || inferServiceTypeForCpt(line.cpt), description: `${line.serviceType || "Imported"} - ${line.cpt}` }, ...cptOptions]
                      : cptOptions;
                    const effectiveLineDos = line.useClaimDos ? newDos : line.dos;
                    return (
                      <div key={line.id} className="grid grid-cols-[128px_minmax(360px,1fr)_168px_128px_34px] gap-2">
                        <select
                          value={line.serviceType}
                          onChange={(e) => {
                            const serviceType = e.target.value;
                            setNewClaimLines(prev => prev.map(item => {
                              if (item.id !== line.id) return item;
                              return {
                                ...item,
                                serviceType,
                                cpt: "",
                                charge: undefined
                              };
                            }));
                          }}
                          className="w-full rounded-lg border border-slate-200 bg-white p-2 text-[11px] font-mono text-slate-700"
                        >
                          <option value="" disabled>{isEnglish ? "Service" : "Servicio"}</option>
                          {getServiceTypeOptions().map(service => (
                            <option key={service} value={service}>{service}</option>
                          ))}
                        </select>
                        <select
                          required
                          value={line.cpt && visibleCptOptions.some(option => option.cpt === line.cpt) ? line.cpt : ""}
                          onChange={(e) => setNewClaimLines(prev => prev.map(item => item.id === line.id ? { ...item, cpt: e.target.value, charge: undefined } : item))}
                          disabled={!line.serviceType || visibleCptOptions.length === 0}
                          className="w-full rounded-lg border border-slate-200 bg-white p-2 font-mono text-[11px] disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <option value="" disabled>
                            {!line.serviceType
                              ? (isEnglish ? "Select service first" : "Selecciona servicio primero")
                              : visibleCptOptions.length === 0
                                ? (isEnglish ? "No CPTs configured" : "Sin CPT configurados")
                                : (isEnglish ? "Select CPT" : "Selecciona CPT")}
                          </option>
                          {visibleCptOptions.map(option => (
                            <option key={`${option.serviceType}-${option.cpt}`} value={option.cpt}>
                              {option.cpt} — {option.description.replace(`${option.serviceType} - `, "")}
                            </option>
                          ))}
                        </select>
                        <div className="space-y-1">
                          <input
                            type="date"
                            required
                            value={effectiveLineDos}
                            onChange={(e) => setNewClaimLines(prev => prev.map(item => item.id === line.id ? { ...item, dos: e.target.value, useClaimDos: false } : item))}
                            disabled={line.useClaimDos || isSavingClaim}
                            className="w-full rounded-lg border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-700 disabled:bg-slate-100 disabled:text-slate-500"
                          />
                          <label className="inline-flex items-center gap-1 text-[9px] font-semibold text-slate-500">
                            <input
                              type="checkbox"
                              checked={line.useClaimDos}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setNewClaimLines(prev => prev.map(item => item.id === line.id ? {
                                  ...item,
                                  useClaimDos: checked,
                                  dos: checked ? newDos : (item.dos || newDos)
                                } : item));
                              }}
                              disabled={isSavingClaim}
                              className="h-3 w-3 rounded border-slate-300 text-primary-blue"
                            />
                            {isEnglish ? "Use claim DOS" : "Usar DOS general"}
                          </label>
                        </div>
                        <div className={`flex items-center rounded-lg border px-2 py-1.5 font-mono text-[11px] font-bold ${line.cpt && charge > 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-400"}`}>
                          {line.cpt ? `$${charge.toFixed(2)}` : "--"}
                        </div>
                        <button
                          type="button"
                          onClick={() => setNewClaimLines(prev => prev.length === 1 ? prev : prev.filter(item => item.id !== line.id))}
                          disabled={newClaimLines.length === 1 || isSavingClaim}
                          className="flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                          title={isEnglish ? "Remove line" : "Eliminar línea"}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {isSavingClaim && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-bold text-dark-blue">
                      {editingClaim
                        ? (isEnglish ? "Updating claim..." : "Actualizando claim...")
                        : (isEnglish ? "Saving claim..." : "Guardando claim...")}
                    </p>
                    <span className="font-mono text-[11px] font-bold text-primary-blue">{Math.round(claimSaveProgress)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/80 ring-1 ring-blue-100">
                    <div
                      className="h-full rounded-full bg-primary-blue transition-all duration-300 ease-out"
                      style={{ width: `${claimSaveProgress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">
                    {isEnglish ? "Please wait while the claim is saved and the worklist refreshes." : "Espere mientras se guarda el claim y se actualiza el worklist."}
                  </p>
                </div>
              )}

              <div className="pt-4 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={handleCloseClaimEditor}
                    disabled={isSavingClaim}
                    className="px-4 py-2 border border-slate-200 hover:bg-slate-100 rounded-xl font-semibold text-slate-600 transition-colors disabled:cursor-wait disabled:opacity-50"
                  >
                  {isEnglish ? "Cancel" : "Cancelar"}
                </button>
                <button
                  type="submit"
                  disabled={isSavingClaim}
                  className="bg-primary-blue hover:bg-secondary-blue text-white px-5 py-2 rounded-xl font-bold transition-all shadow-md disabled:cursor-wait disabled:opacity-70"
                >
                  {isSavingClaim
                    ? (isEnglish ? "Saving..." : "Guardando...")
                    : editingClaim
                      ? (isEnglish ? "Update Claim" : "Actualizar Claim")
                      : (isEnglish ? "Save and Reconcile" : "Guardar y Conciliar")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETAIL AUDIT DIALOG */}
      {selectedClaim && (
        <ClaimDetailPanel
          claim={selectedClaim}
          onClose={() => setSelectedClaim(null)}
          onUpdate={handleUpdateClaim}
          onAddNote={handleAddClaimNote}
          onAddPayment={handleAddClaimPayment}
          notes={notes}
          auditLogs={auditLogs}
          userRole={currentUser.role}
          currentUser={{ name: currentUser.name, email: currentUser.email }}
          feeSchedules={feeSchedules}
          payers={payers}
          onSaveServiceLineNotes={handleSaveServiceLineNotes}
        />
      )}

      {/* MODAL: IMPORT CSV FILE */}
      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImport={handleImportCSV}
        onRollback={handleRollbackClaimImport}
      />

      {/* MODAL: RESTORE BACKUP CONFIRMATION */}
      {backupToRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-white p-2 text-amber-600 shadow-sm">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {isEnglish ? "Restore Backup" : "Restaurar Salva"}
                  </h4>
                  <p className="mt-0.5 text-[10px] font-semibold text-amber-700">
                    {isEnglish ? "Administrative recovery action" : "Acción administrativa de recuperación"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseRestoreBackup}
                disabled={Boolean(restoringBackupId)}
                className="rounded-full p-1 text-slate-500 hover:bg-white disabled:opacity-50"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs text-slate-700">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {isEnglish ? "Selected backup" : "Salva seleccionada"}
                </p>
                <p className="mt-1 break-words font-bold text-slate-900">{backupToRestore.backup_file_name}</p>
                <p className="mt-1 font-mono text-[10px] text-slate-500">{backupToRestore.backup_file_id}</p>
                <p className="mt-1 text-[10px] text-slate-500">
                  {backupToRestore.created_at ? new Date(backupToRestore.created_at).toLocaleString() : "-"}
                </p>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <p className="font-bold">
                  {isEnglish ? "This restore will replace current workbook data." : "Esta restauración reemplazará los datos actuales del workbook."}
                </p>
                <p className="mt-1 leading-relaxed">
                  {isEnglish
                    ? "Claims, Payments, Notes, Audit Log, users, payers, providers, settings and fee schedules will be restored from the selected backup. A safety backup will be created first."
                    : "Claims, Payments, Notes, Audit Log, usuarios, payers, providers, settings y fee schedules se restaurarán desde la salva seleccionada. Primero se creará una salva de seguridad."}
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {isEnglish ? "Type RESTORE to confirm" : "Escriba RESTORE para confirmar"}
                </span>
                <input
                  value={restoreConfirmationText}
                  onChange={event => setRestoreConfirmationText(event.target.value)}
                  disabled={Boolean(restoringBackupId)}
                  autoFocus
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-xs font-bold text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:bg-slate-100"
                  placeholder="RESTORE"
                />
              </label>

              {Boolean(restoringBackupId) && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-primary-blue">
                      {isEnglish ? "Restore progress" : "Progreso de restauración"}
                    </p>
                    <span className="font-mono text-[11px] font-bold text-primary-blue">{restoreProgress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-blue-100">
                    <div
                      className="h-full rounded-full bg-primary-blue transition-all duration-500 ease-out"
                      style={{ width: `${restoreProgress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[10px] font-semibold text-slate-600">
                    {restoreProgressLabel || (isEnglish ? "Restoring backup..." : "Restaurando salva...")}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
              <button
                type="button"
                onClick={handleCloseRestoreBackup}
                disabled={Boolean(restoringBackupId)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {isEnglish ? "Cancel" : "Cancelar"}
              </button>
              <button
                type="button"
                onClick={() => void handleRestoreBackup()}
                disabled={restoreConfirmationText !== "RESTORE" || Boolean(restoringBackupId)}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {restoringBackupId ? (isEnglish ? "Restoring..." : "Restaurando...") : (isEnglish ? "Restore Backup" : "Restaurar Salva")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearOperationalDataConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-white p-2 text-rose-600 shadow-sm">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {isEnglish ? "Confirm Operational Data Cleanup" : "Confirmar limpieza de datos operativos"}
                  </h4>
                  <p className="mt-0.5 text-[10px] font-semibold text-rose-700">
                    {isEnglish ? "Irreversible admin action" : "Acción administrativa irreversible"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isClearingOperationalData) return;
                  setShowClearOperationalDataConfirm(false);
                  setClearOperationalDataText("");
                  setClearOperationalDataProgress(0);
                  setClearOperationalDataProgressLabel("");
                }}
                disabled={isClearingOperationalData}
                className="rounded-full p-1 text-slate-500 hover:bg-white disabled:opacity-50"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs text-slate-700">
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">
                <p className="font-bold">
                  {isEnglish ? "This will permanently empty operational sheets." : "Esto vaciará permanentemente las hojas operativas."}
                </p>
                <p className="mt-1 leading-relaxed">
                  {isEnglish
                    ? "Only Claims, Payments, Notes and Audit_Log will be cleared. Providers, Payers, Users, Settings, FeeSchedules, Fee_Schedule, Eligibility_Coverage and other catalogs will not be touched."
                    : "Solo se limpiarán Claims, Payments, Notes y Audit_Log. No se tocarán Providers, Payers, Users, Settings, FeeSchedules, Fee_Schedule, Eligibility_Coverage ni otros catálogos."}
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {isEnglish ? "Type CLEAR OPERATIONAL DATA to confirm" : "Escriba CLEAR OPERATIONAL DATA para confirmar"}
                </span>
                <input
                  value={clearOperationalDataText}
                  onChange={event => setClearOperationalDataText(event.target.value)}
                  disabled={isClearingOperationalData}
                  autoFocus
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-xs font-bold text-slate-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 disabled:bg-slate-100"
                  placeholder="CLEAR OPERATIONAL DATA"
                />
              </label>

              {isClearingOperationalData && (
                <div className="rounded-xl border border-rose-100 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">
                        {isEnglish ? "Cleanup progress" : "Progreso de limpieza"}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-600">
                        {clearOperationalDataProgressLabel || (isEnglish ? "Processing cleanup..." : "Procesando limpieza...")}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold text-rose-700">
                      {clearOperationalDataProgress}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-rose-100">
                    <div
                      className="h-full rounded-full bg-rose-600 transition-all duration-300 ease-out"
                      style={{ width: `${clearOperationalDataProgress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                    {isEnglish
                      ? "Please keep this window open until the cleanup finishes."
                      : "Mantenga esta ventana abierta hasta que termine la limpieza."}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setShowClearOperationalDataConfirm(false);
                  setClearOperationalDataText("");
                  setClearOperationalDataProgress(0);
                  setClearOperationalDataProgressLabel("");
                }}
                disabled={isClearingOperationalData}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {isEnglish ? "Cancel" : "Cancelar"}
              </button>
              <button
                type="button"
                onClick={() => void handleClearOperationalData()}
                disabled={clearOperationalDataText !== "CLEAR OPERATIONAL DATA" || isClearingOperationalData}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isClearingOperationalData
                  ? (isEnglish ? "Clearing..." : "Limpiando...")
                  : (isEnglish ? "Clear Operational Data" : "Limpiar Datos Operativos")}
              </button>
            </div>
          </div>
        </div>
      )}

      {passwordTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-white p-2 text-primary-blue shadow-sm">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {isEnglish ? "Change User Password" : "Cambiar password de usuario"}
                  </h4>
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
                    {passwordTargetUser.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeAdminPasswordModal}
                disabled={isChangingUserPassword}
                className="rounded-full p-1 text-slate-500 hover:bg-white disabled:opacity-50"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <p className="font-bold">
                  {isEnglish ? "Admin password reset" : "Cambio de password por admin"}
                </p>
                <p className="mt-1 leading-relaxed">
                  {isEnglish
                    ? "The new password is sent directly to Firebase Auth and is not stored in Google Sheets. The action is logged without exposing the password."
                    : "El nuevo password se envía directamente a Firebase Auth y no se guarda en Google Sheets. La acción queda registrada sin exponer el password."}
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {isEnglish ? "New password" : "Nuevo password"}
                </span>
                <input
                  type="password"
                  value={adminNewPassword}
                  onChange={event => setAdminNewPassword(event.target.value)}
                  disabled={isChangingUserPassword}
                  autoComplete="new-password"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-primary-blue focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {isEnglish ? "Confirm new password" : "Confirmar nuevo password"}
                </span>
                <input
                  type="password"
                  value={adminConfirmPassword}
                  onChange={event => setAdminConfirmPassword(event.target.value)}
                  disabled={isChangingUserPassword}
                  autoComplete="new-password"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-primary-blue focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
              <button
                type="button"
                onClick={closeAdminPasswordModal}
                disabled={isChangingUserPassword}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {isEnglish ? "Cancel" : "Cancelar"}
              </button>
              <button
                type="button"
                onClick={() => void handleAdminChangeUserPassword()}
                disabled={isChangingUserPassword || adminNewPassword.length < 8 || adminNewPassword !== adminConfirmPassword}
                className="rounded-lg bg-primary-blue px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-dark-blue disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isChangingUserPassword ? (isEnglish ? "Changing..." : "Cambiando...") : (isEnglish ? "Change Password" : "Cambiar password")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT FEE SCHEDULE */}
      {isFsModalOpen && (
        <div className="fixed inset-0 bg-slate-950/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-dark-blue p-5 text-white flex items-center justify-between">
              <h4 className="font-bold font-display text-sm">
                {editingFs
                  ? (isEnglish ? "Edit Fee Schedule Rate" : "Editar Tarifa Fee Schedule")
                  : (isEnglish ? "New Fee Schedule Rate" : "Nueva Tarifa en Fee Schedule")}
              </h4>
              <button onClick={() => setIsFsModalOpen(false)} className="p-1 hover:bg-white/10 rounded-full text-white">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs font-sans">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1 font-semibold">{isEnglish ? "CPT Code" : "Código CPT"}</label>
                  <input
                    type="text"
                    required
                    placeholder="99454"
                    value={fsCptCode}
                    onChange={(e) => setFsCptCode(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50 font-mono font-bold uppercase"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1 font-semibold font-sans">{isEnglish ? "Year" : "Año"}</label>
                  <input
                    type="number"
                    required
                    placeholder="2026"
                    value={fsYear}
                    onChange={(e) => setFsYear(Number(e.target.value))}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1 font-semibold">{isEnglish ? "Semester 1 Rate ($)" : "Semestre 1 Rate ($)"}</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="62.44"
                    value={fsSemester1Rate || ""}
                    onChange={(e) => setFsSemester1Rate(Number(e.target.value))}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50 font-mono font-bold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1 font-semibold">{isEnglish ? "Semester 2 Rate ($)" : "Semestre 2 Rate ($)"}</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="63.10"
                    value={fsSemester2Rate || ""}
                    onChange={(e) => setFsSemester2Rate(Number(e.target.value))}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50 font-mono font-bold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1 font-semibold">{isEnglish ? "Max per DOS" : "Max por DOS"}</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={fsMaxPerDos || 1}
                    onChange={(e) => setFsMaxPerDos(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                    className="w-full p-2 border border-slate-200 rounded bg-slate-50 font-mono font-bold text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-500 mb-1 font-semibold">{isEnglish ? "Service Description" : "Descripción del Servicio"}</label>
                <textarea
                  placeholder="RPM - Device supply and daily recordings..."
                  value={fsDescription}
                  onChange={(e) => setFsDescription(e.target.value)}
                  className="w-full p-2 border border-slate-200 rounded bg-slate-50 h-20 text-slate-700"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsFsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-100 rounded-xl font-semibold text-slate-600 transition-colors"
                >
                  {isEnglish ? "Cancel" : "Cancelar"}
                </button>
                <button
                  onClick={handleSaveFeeSchedule}
                  className="bg-primary-blue hover:bg-secondary-blue text-white px-5 py-2 rounded-xl font-bold transition-all shadow-md cursor-pointer"
                >
                  {editingFs
                    ? (isEnglish ? "Update Rate" : "Actualizar Tarifa")
                    : (isEnglish ? "Add Rate" : "Agregar Tarifa")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
