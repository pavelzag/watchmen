"use client";

import Link from "next/link";
import { Mail } from "lucide-react";

export default function DemoAiNotice({ className = "" }: { className?: string }) {
  return (
    <div className={`border p-4 space-y-2 ${className}`} style={{ borderColor: "var(--border-dim)", background: "#050505" }}>
      <p className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--border-dim)" }}>
        // AI disabled in demo
      </p>
      <p className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>
        AI queries are disabled in the demo environment. For a preview with AI functionality or real, non-fake data, email{" "}
        <Link href="mailto:zagalsky@gmail.com" style={{ color: "var(--green)", textDecoration: "underline" }}>
          zagalsky@gmail.com
        </Link>.
      </p>
      <div className="flex items-center gap-2 text-xs font-mono" style={{ color: "var(--green)" }}>
        <Mail className="h-3.5 w-3.5" />
        zagalsky@gmail.com
      </div>
    </div>
  );
}
