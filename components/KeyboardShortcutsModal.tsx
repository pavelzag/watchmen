"use client";

import { X } from "lucide-react";

export const ROUTE_SHORTCUTS = [
    { key: "G", href: "/dashboard", label: "GCP menu" },
    { key: "A", href: "/dashboard/aws", label: "AWS menu" },
    { key: "T", href: "/dashboard/tasks", label: "Tasks menu" },
    { key: "R", href: "/dashboard/trace", label: "Trace menu" },
    { key: "F", href: "/dashboard/findings", label: "Findings" },
    { key: "P", href: "/dashboard/attack-paths", label: "Attack Paths" },
    { key: "D", href: "/dashboard/container-scan", label: "Containers" },
    { key: "C", href: "/dashboard/compliance", label: "Compliance" },
    { key: "H", href: "/dashboard/history", label: "History" },
    { key: "S", href: "/dashboard/settings", label: "Settings" },
];

export const HELP_SHORTCUTS = [
    ...ROUTE_SHORTCUTS,
    { key: "?", href: "", label: "Show keyboard shortcuts" },
    { key: "/", href: "", label: "Open cloud brain query" },
    { key: "↑ / ↓", href: "", label: "Move selected item" },
    { key: "← / →", href: "", label: "Move between top navigation tabs" },
    { key: "Enter", href: "", label: "Open selected item" },
    { key: "Esc", href: "", label: "Close dialogs" },
];

export default function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
    return (
        <div
            className="fixed inset-0 z-[9998] flex items-start justify-center px-4 pt-24"
            style={{ background: "rgba(0,0,0,0.82)" }}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                className="w-full max-w-lg"
                style={{ border: "1px solid #00ff41", background: "#090909", boxShadow: "0 0 36px #00ff4133" }}
            >
                <div
                    className="flex items-center justify-between px-4 py-2 text-xs"
                    style={{ borderBottom: "1px solid #005c16" }}
                >
                    <span className="uppercase tracking-widest" style={{ color: "#00ff41" }}>
                        // Keyboard Shortcuts
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1"
                        style={{ color: "#00ff41" }}
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
                <div className="p-4 space-y-2">
                    {HELP_SHORTCUTS.map((shortcut) => (
                        <div
                            key={`${shortcut.key}-${shortcut.label}`}
                            className="flex items-center justify-between gap-4 text-xs font-mono"
                        >
                            <span style={{ color: "#e5e7eb" }}>{shortcut.label}</span>
                            <span
                                className="px-2 py-1 text-[10px] uppercase tracking-widest"
                                style={{ border: "1px solid #005c16", color: "#00ff41", minWidth: 64, textAlign: "center" }}
                            >
                                {shortcut.key}
                            </span>
                        </div>
                    ))}
                </div>
                <div className="px-4 py-2 text-[10px] font-mono" style={{ borderTop: "1px solid #003010", color: "#005c16" }}>
                    Shortcuts are ignored while typing in inputs, textareas, and editors.
                </div>
            </div>
        </div>
    );
}
