"use client";

import { Clock, Tag, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { QueryResult } from "./QueryBox";

interface ResultCardProps {
  result: QueryResult;
  index: number;
}

const INTENT_COLORS: Record<string, string> = {
  user_access: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  resource_owners: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  specific_resource_access: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  list_users: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  list_resources: "text-teal-400 bg-teal-500/10 border-teal-500/20",
  unknown: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n/g, "<br />");
}

export default function ResultCard({ result, index }: ResultCardProps) {
  const [showIntent, setShowIntent] = useState(false);
  const intentColor =
    INTENT_COLORS[result.intent.queryType] ?? INTENT_COLORS.unknown;

  return (
    <div className="glass rounded-2xl overflow-hidden animate-in slide-in-from-top-2 duration-300">
      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-500">#{index + 1}</span>
          <p className="text-sm text-slate-300 font-medium line-clamp-1">
            {result.query}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "px-2 py-0.5 rounded-md text-xs font-medium border",
              intentColor
            )}
          >
            {result.intent.queryType.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Answer */}
      <div className="px-5 py-4">
        <div
          className="prose-answer text-sm"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(result.answer) }}
        />
      </div>

      {/* Footer */}
      <div className="px-5 py-2 border-t border-slate-700/30 flex items-center justify-between">
        <button
          onClick={() => setShowIntent(!showIntent)}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 transition-colors"
        >
          <Tag className="w-3 h-3" />
          {showIntent ? "Hide" : "Show"} intent
          {showIntent ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>
        <div className="flex items-center gap-1 text-xs text-slate-600">
          <Clock className="w-3 h-3" />
          {new Date(result.fetchedAt).toLocaleTimeString()}
        </div>
      </div>

      {/* Expandable intent debug */}
      {showIntent && (
        <div className="px-5 pb-4">
          <pre className="text-xs text-slate-400 bg-slate-800/60 rounded-xl p-3 overflow-x-auto border border-slate-700/30 font-mono">
            {JSON.stringify(result.intent, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
