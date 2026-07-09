/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { CheckCircle2, RefreshCw, UserCheck, ShieldAlert, LogOut } from "lucide-react";
import { User, UserRole } from "../types";
import { useLanguage } from "./LanguageProvider";

interface HeaderProps {
  sheetStatus: {
    configured: boolean;
    hasClientEmail: boolean;
    hasPrivateKey: boolean;
    hasSheetId: boolean;
    usingFallback: boolean;
  } | null;
  currentUser: User;
  allUsers: User[];
  onUserChange: (user: User) => void;
  onSync: () => Promise<void>;
  isSyncing: boolean;
  isAuthEnabled?: boolean;
  onSignOut?: () => Promise<void>;
}

export function Header({
  sheetStatus,
  currentUser,
  allUsers,
  onUserChange,
  onSync,
  isSyncing,
  isAuthEnabled = false,
  onSignOut
}: HeaderProps) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const { language } = useLanguage();
  const isEnglish = language === "en";

  return (
    <header className="bg-white border-b border-slate-200 h-16 px-6 flex items-center justify-between sticky top-0 z-40">
      {/* Page Title & Active Role Badge */}
      <div className="flex items-center gap-4">
        <h1 className="text-base md:text-lg font-semibold text-slate-800">
          {isEnglish ? "Reconciliation Overview" : "Panel de Reconciliación"}
        </h1>
        <div className="hidden sm:flex items-center gap-2 bg-slate-100 px-3 py-1 rounded text-xs">
          <span className="text-slate-500 font-medium">Role:</span>
          <span className="text-primary-blue uppercase font-bold tracking-tighter font-mono">{currentUser.role}</span>
        </div>
      </div>

      {/* Badges & Actions */}
      <div className="flex items-center gap-4">
        {/* System Connection Badge */}
        {sheetStatus && (
          <div
            className={`hidden md:flex items-center gap-1.5 px-3 py-1 rounded border text-xs font-medium font-mono ${
              sheetStatus.configured
                ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                : "bg-amber-50 border-amber-100 text-amber-700 hover:text-accent-orange cursor-help"
            }`}
            title={
              sheetStatus.configured
                ? (isEnglish ? "Secure data service connected" : "Servicio de datos seguro conectado")
                : (isEnglish ? "Running in local demo mode." : "Ejecutando en modo demo local.")
            }
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{sheetStatus.configured ? (isEnglish ? "System Online" : "Sistema Activo") : (isEnglish ? "Local / Demo Mode" : "Modo Local / Demo")}</span>
          </div>
        )}

        {/* Sync Button */}
        {sheetStatus?.configured && (
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="flex items-center justify-center p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition-colors disabled:opacity-50"
            title={isEnglish ? "Refresh system data" : "Actualizar datos del sistema"}
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin text-primary-blue" : ""}`} />
          </button>
        )}

        {/* Current Active Role Widget (Interactive Avatar) */}
        <div className="relative">
          <button
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-3 transition-all text-left cursor-pointer group"
          >
            <div className="hidden sm:block text-right">
              <p className="text-xs font-semibold text-slate-800 group-hover:text-primary-blue leading-tight">{currentUser.name}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-none font-mono uppercase tracking-wide">
                {currentUser.role}
              </p>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary-blue flex items-center justify-center font-bold text-white text-xs shadow-sm transition-transform group-hover:scale-105">
              {currentUser.name.split(" ").map(n => n[0]).slice(0, 2).join("")}
            </div>
          </button>

          {isUserMenuOpen && (
            <div className="absolute right-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 p-2 w-64 z-50 animate-fade-in">
              <div className="px-3 py-2 border-b border-slate-100 mb-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                  {isAuthEnabled ? (isEnglish ? "Authenticated Session" : "Sesión Autenticada") : (isEnglish ? "Simulate User Role" : "Simular Rol de Usuario")}
                </p>
                <p className="text-[11px] text-slate-500">
                  {isAuthEnabled
                    ? currentUser.email
                    : (isEnglish ? "Switch users to review HIPAA, audit and access-control restrictions." : "Cambia de usuario para ver las limitaciones de HIPAA, auditoría y control de acceso.")}
                </p>
              </div>
              {isAuthEnabled ? (
                <button
                  onClick={async () => {
                    await onSignOut?.();
                    setIsUserMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded p-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  <span>{isEnglish ? "Sign out" : "Cerrar sesión"}</span>
                  <LogOut className="h-4 w-4 text-slate-400" />
                </button>
              ) : (
                <div className="space-y-0.5">
                  {allUsers.map((u) => (
                    <button
                      key={u.user_id}
                      onClick={() => {
                        onUserChange(u);
                        setIsUserMenuOpen(false);
                      }}
                      className={`w-full text-left p-2 rounded text-xs flex items-center justify-between transition-colors cursor-pointer ${
                        currentUser.user_id === u.user_id
                          ? "bg-blue-50 text-dark-blue font-semibold"
                          : "hover:bg-slate-50 text-slate-600"
                      }`}
                    >
                      <div>
                        <p className="font-semibold">{u.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{u.role}</p>
                      </div>
                      {currentUser.user_id === u.user_id && <UserCheck className="w-4 h-4 text-primary-blue" />}
                    </button>
                  ))}
                </div>
              )}
              
              <div className="mt-2 pt-2 border-t border-slate-100 px-3 py-1.5 bg-amber-50/50 rounded text-[10px] text-slate-500 flex items-start gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-accent-orange shrink-0 mt-0.5" />
                <span>{isEnglish ? "Editing actions automatically record the active user's email and changes in the HIPAA log." : "Las acciones de edición registrarán automáticamente el correo y cambios del usuario activo en el log de HIPAA."}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
