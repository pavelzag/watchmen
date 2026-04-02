"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyTextButtonProps {
  text: string;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function CopyTextButton({
  text,
  label = "Copy",
  className,
  style,
}: CopyTextButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={className}
      style={style}
      title={copied ? "Copied" : label}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}
