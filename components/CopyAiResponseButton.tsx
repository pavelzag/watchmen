"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

interface CopyAiResponseButtonProps {
  text: string;
  className?: string;
  compact?: boolean;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function CopyAiResponseButton({ text, className = "", compact = false }: CopyAiResponseButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await copyText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void handleCopy();
      }}
      className={`inline-flex items-center gap-1.5 uppercase tracking-widest transition-colors ${compact ? "px-2 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]"} ${className}`}
      style={{ border: "1px solid #3b0764", color: copied ? "#c084fc" : "#a78bfa", background: "rgba(88,28,135,0.12)" }}
      title="Copy AI response"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
