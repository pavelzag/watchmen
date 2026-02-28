"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export default function DetailDrawer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
}: DetailDrawerProps) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      />

      {/* Drawer panel */}
      <div
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-slate-900 border-l border-slate-700/50 shadow-2xl",
          "flex flex-col transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-700/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white truncate">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {children}
        </div>
      </div>
    </>
  );
}

// ── Re-usable sub-components for drawer sections ──────────────────────────────

export function DrawerSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      {children}
    </div>
  );
}

export function DrawerField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-slate-800">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className={cn("text-xs text-right", mono ? "font-mono text-slate-200" : "text-slate-200")}>
        {value}
      </span>
    </div>
  );
}

export function StatusBadge({ active, label }: { active: boolean; label?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
      active
        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
        : "text-slate-400 bg-slate-500/10 border-slate-500/20"
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full", active ? "bg-emerald-400" : "bg-slate-500")} />
      {label ?? (active ? "Active" : "Inactive")}
    </span>
  );
}
