"use client";

import { Maximize2, MessageSquare } from "lucide-react";

export type UIMode = "minimal" | "maximal";

interface ModeToggleProps {
    mode: UIMode;
    onChange: (mode: UIMode) => void;
}

export default function ModeToggle({ mode, onChange }: ModeToggleProps) {
    return (
        <div className="flex items-center gap-0" style={{ border: "1px solid #005c16" }}>
            {(["minimal", "maximal"] as UIMode[]).map((m) => (
                <button
                    key={m}
                    onClick={() => onChange(m)}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs uppercase tracking-widest transition-all"
                    style={
                        mode === m
                            ? { background: "#00ff41", color: "#090909", fontWeight: 700 }
                            : { background: "transparent", color: "#00aa2b" }
                    }
                >
                    {m === "minimal"
                        ? <MessageSquare className="w-3 h-3" />
                        : <Maximize2 className="w-3 h-3" />}
                    [{m === "minimal" ? "MINIMAL" : "MAXIMAL"}]
                </button>
            ))}
        </div>
    );
}
