"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TerminalSelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface TerminalSelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<TerminalSelectOption<T>>;
  ariaLabel: string;
  prefix?: string;
  align?: "left" | "right";
  active?: boolean;
  className?: string;
}

export default function TerminalSelect<T extends string = string>({
  value,
  onChange,
  options,
  ariaLabel,
  prefix,
  align = "left",
  active,
  className,
}: TerminalSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selected = options.find((opt) => opt.value === value) ?? options[0];
  const isHighlighted = active ?? open;

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs font-mono transition-colors whitespace-nowrap",
          "bg-[#09090b] hover:bg-white/[0.03] focus:outline-none"
        )}
        style={{
          border: isHighlighted ? "1px solid var(--green)" : "1px solid var(--border-dim)",
          color: isHighlighted ? "var(--green)" : "#cbd5e1",
        }}
      >
        <span className="flex items-center gap-1.5 truncate">
          {prefix && (
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {prefix}
            </span>
          )}
          <span className="truncate">{selected?.label ?? value}</span>
        </span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 shrink-0 transition-transform", open && "rotate-180")}
          style={{ color: isHighlighted ? "var(--green)" : "var(--text-muted)" }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            "absolute z-30 mt-1 min-w-full w-max max-w-[280px] max-h-64 overflow-y-auto py-1 shadow-2xl",
            align === "right" ? "right-0" : "left-0"
          )}
          style={{
            background: "#09090b",
            border: "1px solid var(--border-dim)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.8)",
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs font-mono transition-colors",
                  isSelected
                    ? "bg-emerald-500/10"
                    : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
                )}
                style={isSelected ? { color: "var(--green)" } : undefined}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="w-3 h-3 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
