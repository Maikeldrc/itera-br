/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { LucideIcon } from "lucide-react";

interface KPICardProps {
  id?: string;
  title: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  iconColorClass?: string;
  bgColorClass?: string;
  isActive?: boolean;
  onClick?: () => void;
}

export function KPICard({
  id,
  title,
  value,
  subValue,
  icon: Icon,
  iconColorClass = "text-primary-blue",
  bgColorClass = "bg-white",
  isActive = false,
  onClick
}: KPICardProps) {
  const isClickable = !!onClick;

  // Dynamically map iconColorClass to a thick left border color to match the theme
  let borderLeftColor = "border-l-slate-400";
  if (iconColorClass.includes("blue") || iconColorClass.includes("sky") || iconColorClass.includes("indigo") || iconColorClass.includes("primary")) {
    borderLeftColor = "border-l-primary-blue";
  } else if (iconColorClass.includes("emerald") || iconColorClass.includes("teal") || iconColorClass.includes("green")) {
    borderLeftColor = "border-l-emerald-500";
  } else if (iconColorClass.includes("rose") || iconColorClass.includes("red") || iconColorClass.includes("accent") || iconColorClass.includes("amber")) {
    borderLeftColor = "border-l-accent-orange";
  }

  // If this card is specifically about AP/Payables or Net ITERA, we can optionally make it stand out
  const isOwed = title.toLowerCase().includes("owed") || title.toLowerCase().includes("payable");
  const bgStyle = isOwed && !isActive ? "bg-white" : bgColorClass;

  return (
    <div
      id={id}
      onClick={onClick}
      className={`relative p-4 rounded-xl shadow-sm border border-slate-100 border-l-4 ${borderLeftColor} ${bgStyle} transition-all duration-150 ${
        isClickable ? "cursor-pointer hover:shadow-md hover:border-l-primary-blue" : ""
      } ${isActive ? "ring-2 ring-primary-blue shadow-sm border-transparent" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500/80 leading-tight truncate">{title}</span>
        <div className={`p-1.5 rounded bg-slate-50/80 shrink-0 ${iconColorClass}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-2">
        <h3 className="text-xl md:text-2xl font-bold font-display text-slate-800 tracking-tight leading-none">{value}</h3>
        {subValue && (
          <p className="text-[10px] text-slate-500 mt-1 font-mono flex items-center gap-1">
            <span>{subValue}</span>
          </p>
        )}
      </div>

      {isClickable && (
        <div className="absolute bottom-1 right-2 text-[8px] text-slate-400 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
          Filtrar
        </div>
      )}
    </div>
  );
}
