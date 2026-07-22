/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Filter, RotateCcw, Search, ChevronDown, ChevronUp } from "lucide-react";
import { ClaimStatus, ClaimClassification, Provider, Payer } from "../types";
import { useLanguage } from "./LanguageProvider";
import { MultiSelectFilter } from "./MultiSelectFilter";

export interface FilterState {
  search: string;
  startDate: string;
  endDate: string;
  providerId: string;
  payerId: string;
  serviceType: string;
  billedBy: string;
  paymentReceivedBy: string;
  status: string;
  classification: string;
  monthOfService: string;
  errorFlag: string;
}

interface ClaimFiltersProps {
  filters: FilterState;
  onChange: (updates: Partial<FilterState>) => void;
  onReset: () => void;
  providers: Provider[];
  payers: Payer[];
  availableServiceTypes: string[];
}

export function ClaimFilters({
  filters,
  onChange,
  onReset,
  providers,
  payers,
  availableServiceTypes
}: ClaimFiltersProps) {
  const [showAllFilters, setShowAllFilters] = useState(false);
  const { language } = useLanguage();
  const isEnglish = language === "en";

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm mb-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 mb-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-dark-blue" />
          <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wide">
            {isEnglish ? "Reconciliation Filters" : "Filtros de Conciliación"}
          </h4>
        </div>
        <div className="flex items-center gap-4 self-end md:self-auto">
          <button
            type="button"
            onClick={() => setShowAllFilters(!showAllFilters)}
            className="flex items-center gap-1.5 text-xs text-primary-blue hover:text-dark-blue font-bold uppercase tracking-wider transition-colors cursor-pointer select-none"
          >
            {showAllFilters ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                {isEnglish ? "Hide Filters" : "Ocultar Filtros"}
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                {isEnglish ? "More Filters" : "Más Filtros"}
              </>
            )}
          </button>
          <div className="w-px h-4 bg-slate-200" />
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-accent-orange font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {isEnglish ? "Reset Filters" : "Restablecer Filtros"}
          </button>
        </div>
      </div>

      {/* Filters Grid: 2 rows of 6 items when expanded */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* ROW 1: 6 Filters */}
        {/* 1. Search Input */}
        <div className="relative">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            {isEnglish ? "Search Claim" : "Buscar Reclamación"}
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder={isEnglish ? "ID, Patient..." : "ID, Paciente..."}
              value={filters.search}
              onChange={(e) => onChange({ search: e.target.value })}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded border border-slate-200 focus:outline-hidden focus:ring-1 focus:ring-primary-blue focus:border-primary-blue bg-slate-50 focus:bg-white text-slate-800 font-medium"
            />
          </div>
        </div>

        {/* 2. Status */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            {isEnglish ? "Claim Status" : "Estado Claim"}
          </label>
          <MultiSelectFilter
            value={filters.status}
            onChange={(status) => onChange({ status })}
            allLabel={isEnglish ? "All Statuses" : "Todos los Estados"}
            placeholder={isEnglish ? "Search status..." : "Buscar estado..."}
            options={Object.values(ClaimStatus).map(status => ({ value: status, label: status }))}
          />
        </div>

        {/* 3. Classification */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            {isEnglish ? "Classification" : "Clasificación"}
          </label>
          <MultiSelectFilter
            value={filters.classification}
            onChange={(classification) => onChange({ classification })}
            allLabel={isEnglish ? "All Classifications" : "Todas las Clasificaciones"}
            placeholder={isEnglish ? "Search classification..." : "Buscar clasificación..."}
            options={Object.values(ClaimClassification).map(classification => ({ value: classification, label: classification }))}
          />
        </div>

        {/* 4. Provider */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            {isEnglish ? "Physician / Provider" : "Médico / Proveedor"}
          </label>
          <MultiSelectFilter
            value={filters.providerId}
            onChange={(providerId) => onChange({ providerId })}
            allLabel={isEnglish ? "All Providers" : "Todos los Proveedores"}
            placeholder={isEnglish ? "Search provider..." : "Buscar provider..."}
            options={providers.map(provider => ({ value: provider.provider_id, label: provider.provider_name, meta: provider.npi }))}
          />
        </div>

        {/* 5. Insurance (Payer) */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            {isEnglish ? "Insurance (Payer)" : "Aseguradora (Payer)"}
          </label>
          <MultiSelectFilter
            value={filters.payerId}
            onChange={(payerId) => onChange({ payerId })}
            allLabel={isEnglish ? "All Insurances" : "Todas las Aseguradoras"}
            placeholder={isEnglish ? "Search insurance..." : "Buscar insurance..."}
            options={payers.map(payer => ({ value: payer.payer_id, label: payer.payer_name, meta: payer.payer_id }))}
          />
        </div>

        {/* 6. Month of Service (Moved to row 1) */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            {isEnglish ? "Month of Service" : "Mes de Servicio"}
          </label>
          <input
            type="month"
            value={filters.monthOfService}
            onChange={(e) => onChange({ monthOfService: e.target.value })}
            className="w-full py-1.5 px-2 text-xs rounded border border-slate-200 focus:outline-hidden focus:ring-1 focus:ring-primary-blue focus:border-primary-blue bg-slate-50 focus:bg-white text-slate-800 font-medium cursor-pointer"
          />
        </div>

        {/* ROW 2: Collapsible Filters */}
        {showAllFilters && (
          <>
            {/* 7. Service Type */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                {isEnglish ? "Service Type" : "Tipo de Servicio"}
              </label>
              <MultiSelectFilter
                value={filters.serviceType}
                onChange={(serviceType) => onChange({ serviceType })}
                allLabel={isEnglish ? "All Services" : "Todos los Servicios"}
                placeholder={isEnglish ? "Search service..." : "Buscar servicio..."}
                options={availableServiceTypes.map(type => ({ value: type, label: type }))}
              />
            </div>

            {/* 8. Billed By */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                {isEnglish ? "Billed By" : "Facturado por"}
              </label>
              <MultiSelectFilter
                value={filters.billedBy}
                onChange={(billedBy) => onChange({ billedBy })}
                allLabel={isEnglish ? "All" : "Todos"}
                options={[{ value: "ITERA", label: "ITERA" }, { value: "Provider", label: "Provider" }]}
              />
            </div>

            {/* 9. Payment Received By */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                {isEnglish ? "Collected By" : "Cobrado por"}
              </label>
              <MultiSelectFilter
                value={filters.paymentReceivedBy}
                onChange={(paymentReceivedBy) => onChange({ paymentReceivedBy })}
                allLabel={isEnglish ? "All" : "Todos"}
                options={["ITERA", "Provider", "Split", "Unknown"].map(item => ({ value: item, label: item }))}
              />
            </div>

            {/* 10. Date From */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                {isEnglish ? "Date From" : "Fecha Desde"}
              </label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => onChange({ startDate: e.target.value })}
                className="w-full py-1.5 px-2 text-xs rounded border border-slate-200 focus:outline-hidden focus:ring-1 focus:ring-primary-blue focus:border-primary-blue bg-slate-50 focus:bg-white text-slate-800 font-medium cursor-pointer"
              />
            </div>

            {/* 11. Date To */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                {isEnglish ? "Date To" : "Fecha Hasta"}
              </label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => onChange({ endDate: e.target.value })}
                className="w-full py-1.5 px-2 text-xs rounded border border-slate-200 focus:outline-hidden focus:ring-1 focus:ring-primary-blue focus:border-primary-blue bg-slate-50 focus:bg-white text-slate-800 font-medium cursor-pointer"
              />
            </div>

            {/* 12. Error Flag */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                {isEnglish ? "Errors / Blocks" : "Errores / Bloqueos"}
              </label>
              <MultiSelectFilter
                value={filters.errorFlag}
                onChange={(errorFlag) => onChange({ errorFlag })}
                allLabel={isEnglish ? "All claims" : "Todos los claims"}
                options={[
                  { value: "true", label: isEnglish ? "With Error / Blocked" : "Con Error / Bloqueado" },
                  { value: "false", label: isEnglish ? "No Error (Clean)" : "Sin Error (Limpio)" }
                ]}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
