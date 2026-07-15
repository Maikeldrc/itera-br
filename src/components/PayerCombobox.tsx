/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Payer } from "../types";
import { useLanguage } from "./LanguageProvider";

interface PayerComboboxProps {
  payers: Payer[];
  value: string;
  onChange: (payerId: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  excludePayerId?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}

export function PayerCombobox({
  payers,
  value,
  onChange,
  placeholder,
  allowEmpty = true,
  emptyLabel,
  excludePayerId = "",
  required = false,
  disabled = false,
  className = "",
  inputClassName = ""
}: PayerComboboxProps) {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const selectedPayer = payers.find(payer => payer.payer_id === value);
  const [search, setSearch] = useState(selectedPayer?.payer_name || "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSearch(selectedPayer?.payer_name || "");
  }, [selectedPayer?.payer_id, selectedPayer?.payer_name]);

  const filteredPayers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return payers
      .filter(payer => payer.active !== false)
      .filter(payer => !excludePayerId || payer.payer_id !== excludePayerId)
      .filter(payer => {
        if (!needle) return true;
        return `${payer.payer_name} ${payer.payer_id} ${payer.pverify_payer_code || ""}`.toLowerCase().includes(needle);
      })
      .slice(0, 40);
  }, [excludePayerId, payers, search]);

  const choosePayer = (payer: Payer | null) => {
    onChange(payer?.payer_id || "");
    setSearch(payer?.payer_name || "");
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        required={required}
        disabled={disabled}
        value={search}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        onChange={(event) => {
          const nextValue = event.target.value;
          setSearch(nextValue);
          setOpen(true);
          const exactMatch = payers.find(payer =>
            payer.active !== false &&
            (!excludePayerId || payer.payer_id !== excludePayerId) &&
            payer.payer_name.toLowerCase() === nextValue.trim().toLowerCase()
          );
          onChange(exactMatch?.payer_id || "");
        }}
        placeholder={placeholder || (isEnglish ? "Type insurance name..." : "Escriba el nombre del insurance...")}
        className={`w-full rounded border border-slate-200 bg-slate-50 py-2 pl-8 pr-8 text-xs font-medium text-slate-700 outline-none focus:border-primary-blue focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400 ${search && !value ? "border-amber-300" : ""} ${inputClassName}`}
      />
      {(search || value) && !disabled && (
        <button
          type="button"
          onMouseDown={event => event.preventDefault()}
          onClick={() => choosePayer(null)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title={isEnglish ? "Clear payer" : "Limpiar payer"}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && !disabled && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {allowEmpty && (
            <button
              type="button"
              onMouseDown={event => event.preventDefault()}
              onClick={() => choosePayer(null)}
              className={`flex w-full px-3 py-2 text-left text-[11px] font-semibold hover:bg-slate-50 ${!value ? "text-primary-blue" : "text-slate-500"}`}
            >
              {emptyLabel || (isEnglish ? "All payers" : "Todos los payers")}
            </button>
          )}
          {filteredPayers.length > 0 ? (
            filteredPayers.map(payer => (
              <button
                type="button"
                key={payer.payer_id}
                onMouseDown={event => event.preventDefault()}
                onClick={() => choosePayer(payer)}
                className={`flex w-full flex-col px-3 py-2 text-left text-[11px] hover:bg-blue-50 ${
                  payer.payer_id === value ? "bg-blue-50 text-dark-blue" : "text-slate-700"
                }`}
              >
                <span className="font-bold">{payer.payer_name}</span>
                <span className="font-mono text-[9px] text-slate-400">
                  {payer.payer_id}{payer.pverify_payer_code ? ` · ${payer.pverify_payer_code}` : ""}
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-4 text-center text-[11px] font-semibold text-slate-400">
              {isEnglish ? "No matching payers." : "No hay payers coincidentes."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
