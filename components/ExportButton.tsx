"use client";

import { useState, useRef, useEffect } from "react";
import { Download, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExportButtonProps {
  data: Record<string, unknown>[];
  filename: string;
}

function toCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return "";
  const keys = Object.keys(data[0]);
  const escape = (v: unknown): string => {
    const s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = keys.join(",");
  const rows = data.map((row) => keys.map((k) => escape(row[k])).join(","));
  return [header, ...rows].join("\n");
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportButton({ data, filename }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleCSV() {
    downloadFile(toCSV(data), `${filename}.csv`, "text/csv");
    setOpen(false);
  }

  function handleJSON() {
    downloadFile(JSON.stringify(data, null, 2), `${filename}.json`, "application/json");
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-700/50 transition-all duration-150"
      >
        <Download className="w-3.5 h-3.5" />
        Export
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 rounded-xl bg-slate-900 border border-slate-700/50 shadow-xl z-10 overflow-hidden">
          <button
            onClick={handleCSV}
            className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            Download CSV
          </button>
          <button
            onClick={handleJSON}
            className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            Download JSON
          </button>
        </div>
      )}
    </div>
  );
}
