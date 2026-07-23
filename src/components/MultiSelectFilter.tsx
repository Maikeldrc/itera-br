import React, { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { decodeMultiFilter, encodeMultiFilter } from "../multiSelectFilters";

export type MultiSelectOption = {
  value: string;
  label: string;
  meta?: string;
};

export function MultiSelectFilter({
  value,
  onChange,
  options,
  allLabel,
  placeholder,
  className = "",
  buttonClassName = "",
  disabled = false
}: {
  value: string;
  onChange: (value: string) => void;
  options: MultiSelectOption[];
  allLabel: string;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = decodeMultiFilter(value);
  const selectedSet = new Set(selected);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    const unique = Array.from(new Map(options.filter(option => option.value).map(option => [option.value, option])).values());
    if (!normalizedSearch) return unique;
    return unique.filter(option => [option.label, option.value, option.meta].some(item => String(item ?? "").toLowerCase().includes(normalizedSearch)));
  }, [normalizedSearch, options]);
  const selectedLabels = selected
    .map(item => options.find(option => option.value === item)?.label || item)
    .filter(Boolean);
  const displayText = selectedLabels.length === 0
    ? allLabel
    : selectedLabels.length === 1
      ? selectedLabels[0]
      : `${selectedLabels.length} selected`;

  const toggleValue = (optionValue: string) => {
    const next = selectedSet.has(optionValue)
      ? selected.filter(item => item !== optionValue)
      : [...selected, optionValue];
    onChange(encodeMultiFilter(next));
  };

  const closeMenu = () => {
    setOpen(false);
    setSearch("");
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        className={`flex w-full items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs font-medium text-slate-800 outline-none transition hover:bg-white focus:border-primary-blue focus:ring-1 focus:ring-primary-blue disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 ${buttonClassName}`}
        title={selectedLabels.join(", ") || allLabel}
      >
        <span className={selectedLabels.length ? "truncate" : "truncate text-slate-500"}>{displayText}</span>
        <span className="flex shrink-0 items-center gap-1">
          {selected.length > 0 && (
            <span className="rounded-full bg-primary-blue px-1.5 py-0.5 text-[9px] font-bold text-white">{selected.length}</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={closeMenu} />
          <div className="absolute left-0 top-full z-40 mt-1 w-full min-w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            <div className="relative mb-2">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={placeholder || "Search..."}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary-blue focus:bg-white"
              />
            </div>
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  closeMenu();
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50"
              >
                <X className="h-3 w-3" /> Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(encodeMultiFilter(filteredOptions.map(option => option.value)));
                  closeMenu();
                }}
                className="rounded-md px-2 py-1 text-[10px] font-bold text-primary-blue hover:bg-blue-50"
              >
                Select visible
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filteredOptions.length === 0 ? (
                <div className="px-2 py-5 text-center text-xs text-slate-400">No options found.</div>
              ) : (
                filteredOptions.map(option => {
                  const active = selectedSet.has(option.value);
                  return (
                    <button
                      type="button"
                      key={option.value}
                      onClick={() => toggleValue(option.value)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-blue-50 ${active ? "text-primary-blue" : "text-slate-700"}`}
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${active ? "border-primary-blue bg-primary-blue text-white" : "border-slate-300 bg-white"}`}>
                        {active && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{option.label}</span>
                        {option.meta && <span className="block truncate text-[10px] text-slate-400">{option.meta}</span>}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="mt-2 border-t border-slate-100 pt-2">
              <button
                type="button"
                onClick={closeMenu}
                className="w-full rounded-lg bg-primary-blue px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-600"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
