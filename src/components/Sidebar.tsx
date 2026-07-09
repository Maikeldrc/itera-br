/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  LayoutDashboard,
  FileSpreadsheet,
  Coins,
  FileX,
  FileWarning,
  Hospital,
  Sliders,
  History,
  Info,
  ChevronLeft,
  ChevronRight,
  BarChart3
} from "lucide-react";
import { User, UserRole } from "../types";
import { useLanguage } from "./LanguageProvider";
import { canUserAccessMenu } from "../accessControl";

export type ViewType =
  | "dashboard"
  | "claims"
  | "payments"
  | "denials"
  | "errors"
  | "providers"
  | "reports"
  | "settings"
  | "audit-log";

interface SidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  currentUser: User;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ currentView, onViewChange, currentUser, isCollapsed, onToggleCollapse }: SidebarProps) {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  // Navigation tabs with role access restrictions
  const navigationItems = [
    {
      id: "dashboard" as ViewType,
      label: isEnglish ? "Dashboard" : "Tablero",
      icon: LayoutDashboard,
      roles: [UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist, UserRole.ProviderViewer, UserRole.Auditor],
    },
    {
      id: "claims" as ViewType,
      label: isEnglish ? "Claims Worklist" : "Worklist de Claims",
      icon: FileSpreadsheet,
      roles: [UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist, UserRole.ProviderViewer, UserRole.Auditor],
    },
    {
      id: "payments" as ViewType,
      label: isEnglish ? "Payment Control" : "Control de Pagos",
      icon: Coins,
      roles: [UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist, UserRole.ProviderViewer],
    },
    {
      id: "denials" as ViewType,
      label: isEnglish ? "Denials Report" : "Reporte de Denials",
      icon: FileX,
      roles: [UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist, UserRole.Auditor],
    },
    {
      id: "errors" as ViewType,
      label: isEnglish ? "Claims with Errors" : "Claims con Errores",
      icon: FileWarning,
      roles: [UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist, UserRole.Auditor],
    },
    {
      id: "providers" as ViewType,
      label: isEnglish ? "Physician Balances" : "Balance de Médicos",
      icon: Hospital,
      roles: [UserRole.Admin, UserRole.BillingManager, UserRole.ProviderViewer, UserRole.Auditor],
    },
    {
      id: "reports" as ViewType,
      label: isEnglish ? "Reports" : "Reportes",
      icon: BarChart3,
      roles: [UserRole.Admin, UserRole.BillingManager, UserRole.ReconciliationSpecialist, UserRole.ProviderViewer, UserRole.Auditor],
    },
    {
      id: "audit-log" as ViewType,
      label: isEnglish ? "Audit Log (HIPAA)" : "Log de Auditoría (HIPAA)",
      icon: History,
      roles: [UserRole.Admin, UserRole.BillingManager, UserRole.Auditor],
    },
    {
      id: "settings" as ViewType,
      label: isEnglish ? "Settings" : "Configuración",
      icon: Sliders,
      roles: [UserRole.Admin, UserRole.BillingManager],
    }
  ];

  // Filter based on user roles
  const allowedItems = navigationItems.filter((item) =>
    item.roles.includes(currentUser.role) && canUserAccessMenu(currentUser, item.id)
  );

  return (
    <aside className={`${isCollapsed ? "w-16" : "w-56"} bg-dark-blue text-white flex flex-col h-full shrink-0 border-r border-secondary-blue shadow-md transition-all duration-300`}>
      {/* Sidebar Header Brand Display */}
      <div className={`p-4 border-b border-secondary-blue flex ${isCollapsed ? "flex-col items-center gap-4" : "items-center justify-between"}`}>
        {!isCollapsed && (
          <div className="flex flex-col">
            <div className="text-[9px] tracking-widest text-white/60 uppercase mb-0.5 font-mono">{isEnglish ? "Healthcare Billing" : "Facturación Médica"}</div>
            <div className="text-lg font-bold flex items-center gap-2 text-white font-display">
              <div className="w-4 h-4 bg-primary-blue rounded-sm shrink-0"></div> ITERA
            </div>
          </div>
        )}
        {isCollapsed && (
          <div className="w-5 h-5 bg-primary-blue rounded-sm shrink-0" title="ITERA Healthcare Billing"></div>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded bg-blue-950/40 hover:bg-secondary-blue/50 text-white/80 hover:text-white transition-colors cursor-pointer"
          title={isCollapsed ? (isEnglish ? "Expand menu" : "Expandir menú") : (isEnglish ? "Collapse menu" : "Contraer menú")}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {!isCollapsed && (
          <p className="px-6 text-[10px] uppercase tracking-widest opacity-40 mb-2 font-mono">
            {isEnglish ? "Main navigation" : "Navegación principal"}
          </p>
        )}
        <div className="space-y-0.5">
          {allowedItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            const isErrorView = item.id === "errors";
            return (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                title={item.label}
                className={`w-full flex items-center transition-all duration-150 cursor-pointer ${
                  isCollapsed ? "justify-center py-3 px-0" : "gap-3 px-6 py-2"
                } text-xs font-medium ${
                  isActive
                    ? "bg-secondary-blue text-white"
                    : isErrorView
                    ? "text-accent-orange hover:bg-secondary-blue/20 hover:opacity-100"
                    : "text-white/70 hover:bg-secondary-blue/30 hover:text-white"
                }`}
              >
                {isCollapsed ? (
                  <div className="relative flex items-center justify-center">
                    <Icon className={`w-4.5 h-4.5 shrink-0 ${isErrorView ? "text-accent-orange" : (isActive ? "text-white opacity-100" : "opacity-60")}`} />
                    {isActive && (
                      <div className="absolute -left-2 w-1.5 h-4 bg-accent-orange rounded-r-md"></div>
                    )}
                  </div>
                ) : (
                  <>
                    {isActive ? (
                      <div className="w-1.5 h-1.5 rounded-full bg-accent-orange shrink-0"></div>
                    ) : (
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${isErrorView ? "text-accent-orange" : "opacity-60"}`} />
                    )}
                    <span className="truncate">{item.label}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Connection & HIPAA Compliance Advisory Footer */}
      {!isCollapsed ? (
        <div className="p-6 mt-auto border-t border-secondary-blue text-[11px] flex flex-col gap-3">
          <div className="opacity-60 space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
              <span>{isEnglish ? "System Online" : "Sistema Activo"}</span>
            </div>
            <div className="font-mono text-[9px]">v1.2.0-Production</div>
          </div>

          <div className="p-2 bg-blue-950/30 border border-secondary-blue/30 rounded text-[10px] text-blue-200">
            <p className="font-bold text-white uppercase tracking-wider text-[9px]">{isEnglish ? "HIPAA Notice" : "Aviso HIPAA"}</p>
            <p className="mt-0.5 leading-relaxed opacity-80">
              {isEnglish ? "PHI is encrypted and audited." : "PHI encriptado y auditado."}
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 mt-auto border-t border-secondary-blue flex flex-col items-center gap-4">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" title={isEnglish ? "System Online" : "Sistema Activo"}></div>
          <Info className="w-4 h-4 text-blue-200 opacity-60" title="HIPAA Compliant - PHI Encrypted" />
        </div>
      )}
    </aside>
  );
}
