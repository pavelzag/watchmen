"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, History, X, ChevronDown } from "lucide-react";
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
      setQuery("");
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
    <div className="space-y-3">
      <form onSubmit={handleSubmit}>
        {/* Terminal input box */}
        <div
          style={{
            border: "1px solid #005c16",
            background: "#0a0a0a",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = "#00ff41";
            (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 10px #00ff4133";
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#005c16";
              (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
            }
          }}
        >
          {/* Prompt line */}
          <div className="flex items-start gap-2 p-3">
            <span
              className="text-sm shrink-0 select-none pt-0.5"
              style={{ color: "#00ff41", textShadow: "0 0 8px #00ff41" }}
            >
              $&nbsp;query:
            </span>
            <textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ask anything about your GCP IAM..."
              rows={2}
              disabled={loading}
              className="flex-1 resize-none outline-none text-sm leading-relaxed"
              style={{
                background: "transparent",
                color: "#00ff41",
                fontFamily: "JetBrains Mono, monospace",
              }}
            />
            {!query && (
              <span className="blink text-sm select-none pt-0.5" style={{ color: "#00ff41" }}>
                ▌
              </span>
            )}
          </div>

          {/* Toolbar */}
          <div
            className="flex items-center justify-between px-3 py-2 text-xs"
            style={{ borderTop: "1px solid #0a1a0a" }}
          >
            <span style={{ color: "#005c16" }}>// Enter to execute · Shift+Enter for newline</span>
            <button
              type="submit"
              disabled={!query.trim() || loading}
              className="flex items-center gap-1.5 px-4 py-1 text-xs uppercase tracking-widest transition-all"
              style={
                query.trim() && !loading
                  ? { background: "#00ff41", color: "#090909", fontWeight: 700 }
                  : { border: "1px solid #005c16", color: "#005c16", background: "transparent", cursor: "not-allowed" }
              }
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : null}
              {loading ? "EXECUTING..." : "[EXECUTE]"}
            </button>
          </div>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div
          className="px-3 py-2 text-sm"
          style={{ border: "1px solid #ff3333", background: "#1a0000", color: "#ff3333" }}
        >
          !! ERROR: {error}
        </div>
      )}

      {/* Suggested queries */}
      {!query && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest" style={{ color: "#005c16" }}>
            // suggested commands
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUERIES.map((q) => (
              <button
                key={q}
                onClick={() => useQuery(q)}
                className="px-3 py-1 text-xs text-left transition-all"
                style={{ border: "1px solid #003010", color: "#00aa2b", background: "transparent" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#00ff41";
                  (e.currentTarget as HTMLButtonElement).style.color = "#00ff41";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#003010";
                  (e.currentTarget as HTMLButtonElement).style.color = "#00aa2b";
                }}
              >
                &gt; {q}
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
              className="flex items-center gap-1.5 text-xs transition-colors"
              style={{ color: "#005c16" }}
            >
              <History className="w-3 h-3" />
              // history ({history.length})
              <ChevronDown
                className="w-3 h-3 transition-transform"
                style={{ transform: showHistory ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            </button>
            {showHistory && (
              <button
                onClick={handleClearHistory}
                className="flex items-center gap-1 text-xs"
                style={{ color: "#ff3333" }}
              >
                <X className="w-3 h-3" />
                [CLEAR]
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
                  className="px-3 py-1 text-xs text-left max-w-[260px] truncate transition-all"
                  style={{ border: "1px solid #003010", color: "#00aa2b" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#00ff41";
                    (e.currentTarget as HTMLButtonElement).style.color = "#00ff41";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#003010";
                    (e.currentTarget as HTMLButtonElement).style.color = "#00aa2b";
                  }}
                >
                  ↑ {entry.query}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
