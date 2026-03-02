"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Loader2, CornerDownLeft, History, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveQuery, getHistory, clearHistory, type QueryHistoryEntry } from "@/lib/query-history";
import type { ResourceItem } from "@/lib/claude/query-processor";

const SUGGESTED_QUERIES = [
  "Which buckets are publicly accessible?",
  "List all expired service account keys",
  "Which VMs have external IPs?",
  "Who has owner or editor access?",
  "What secrets does allUsers have access to?",
  "Show all firewall rules open to the internet",
];

interface QueryBoxProps {
  onResult: (result: QueryResult) => void;
}

export interface QueryResult {
  query: string;
  answer: string;
  intent: {
    queryType: string;
    user?: string;
    resourceType?: string;
    resourceName?: string;
    projectId?: string;
    region?: string;
  };
  resources?: ResourceItem[];
  fetchedAt: string;
}

export default function QueryBox({ onResult }: QueryBoxProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setHistory(getHistory());
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      const result = data as QueryResult;
      onResult(result);
      saveQuery(result.query, result.answer);
      setHistory(getHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  function useQuery(q: string) {
    setQuery(q);
    setShowHistory(false);
    textareaRef.current?.focus();
  }

  function handleClearHistory() {
    clearHistory();
    setHistory([]);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit}>
        <div
          className={cn(
            "glass rounded-2xl p-1 transition-all duration-200",
            "focus-within:border-zinc-600 focus-within:ring-1 focus-within:ring-white/10"
          )}
        >
          <div className="flex items-start gap-3 px-4 pt-3">
            <Search className="w-5 h-5 text-zinc-500 mt-0.5 shrink-0" />
            <textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your GCP IAM permissions..."
              rows={2}
              className="flex-1 bg-transparent text-zinc-100 placeholder:text-zinc-600 resize-none outline-none text-sm leading-relaxed"
              disabled={loading}
            />
          </div>
          <div className="flex items-center justify-between px-4 pb-2 pt-1">
            <span className="text-xs text-zinc-700 font-mono">
              shift+enter for new line
            </span>
            <button
              type="submit"
              disabled={!query.trim() || loading}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
                query.trim() && !loading
                  ? "bg-zinc-100 text-zinc-900 hover:bg-white"
                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              )}
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CornerDownLeft className="w-3.5 h-3.5" />
              )}
              {loading ? "Thinking..." : "Ask"}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Suggested queries — shown when input is empty */}
      {!query && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-600 font-medium uppercase tracking-widest">
            Suggested queries
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUERIES.map((q) => (
              <button
                key={q}
                onClick={() => useQuery(q)}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-200 transition-all duration-150 text-left"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Query history */}
      {history.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowHistory((s) => !s)}
              className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <History className="w-3.5 h-3.5" />
              Recent queries ({history.length})
              <ChevronDown className={cn("w-3 h-3 transition-transform", showHistory && "rotate-180")} />
            </button>
            {showHistory && (
              <button
                onClick={handleClearHistory}
                className="flex items-center gap-1 text-xs text-zinc-600 hover:text-red-400 transition-colors"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
          {showHistory && (
            <div className="flex flex-wrap gap-2">
              {history.slice(0, 10).map((entry) => (
                <button
                  key={entry.savedAt}
                  onClick={() => useQuery(entry.query)}
                  title={entry.query}
                  className="px-3 py-1.5 rounded-lg text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-200 transition-all duration-150 text-left max-w-[240px] truncate"
                >
                  {entry.query}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
