"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, History, X, ChevronDown } from "lucide-react";
import { saveQuery, getHistory, clearHistory, type QueryHistoryEntry } from "@/lib/query-history";
import type { ResourceItem } from "@/lib/claude/query-processor";
import { getActiveBrowserAIKey } from "@/lib/ai/browser-ai-keys";

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

async function readApiResponse(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    const text = await res.text().catch(() => "");
    return { error: text || `Request failed with HTTP ${res.status}` };
  }
}

export default function QueryBox({ onResult }: QueryBoxProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [demoUsage, setDemoUsage] = useState<{ count: number; limit: number; globalCount: number; globalLimit: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setHistory(getHistory());
    fetchUsage();
  }, []);

  async function fetchUsage() {
    try {
      const res = await fetch("/api/demo/usage");
      if (res.ok) {
        const data = await res.json();
        if (data.limit > 0) setDemoUsage(data);
      }
    } catch {
      // Ignore
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const browserAI = getActiveBrowserAIKey();
      const demoCredentials = browserAI ? { aiKey: browserAI.key, aiProvider: browserAI.provider } : undefined;

      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          demoCredentials
        }),
      });

      const data = await readApiResponse(res);
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      const result = data as QueryResult;
      onResult(result);
      saveQuery(result.query, result.answer);
      setHistory(getHistory());
      setQuery("");
      fetchUsage();
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
      <div
        className="relative overflow-hidden group"
        style={{
          border: "1px solid var(--border)",
          background: "var(--bg-card)",
          boxShadow: "0 0 20px var(--green-glow)",
        }}
      >
        <form onSubmit={handleSubmit} className="flex flex-col text-sm md:text-base">
          <textarea
            ref={textareaRef}
            id="query-input"
            rows={1}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your cloud infrastructure..."
            className="w-full bg-transparent p-4 md:p-6 focus:outline-none resize-none no-scrollbar placeholder:opacity-30"
            style={{ color: "var(--text-primary)", minHeight: "80px", fontFamily: "JetBrains Mono, monospace" }}
          />

          {/* Toolbar */}
          <div
            className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 md:px-6 py-3 gap-3"
            style={{ borderTop: "1px solid var(--bg-card2)", background: "var(--bg-card2)" }}
          >
            <div className="flex flex-wrap items-center gap-3 md:gap-4 text-[10px] md:text-xs">
              {demoUsage && (
                <div className="flex gap-3">
                  <span style={{ color: demoUsage.count >= demoUsage.limit ? "var(--red)" : "var(--text-muted)" }}>
                    // user: {demoUsage.limit - demoUsage.count} left
                  </span>
                  <span style={{ color: demoUsage.globalCount >= demoUsage.globalLimit ? "var(--red)" : "var(--border-dim)" }}>
                    // global: {demoUsage.globalLimit - demoUsage.globalCount} / {demoUsage.globalLimit}
                  </span>
                </div>
              )}
              <span className="hidden sm:inline" style={{ color: "var(--border-dim)" }}>// Enter to execute</span>
            </div>
            <button
              type="submit"
              disabled={!query.trim() || loading}
              className="flex items-center gap-1.5 px-4 py-1 text-xs uppercase tracking-widest transition-all"
              style={
                query.trim() && !loading
                  ? { background: "var(--green)", color: "var(--bg)", fontWeight: 700 }
                  : { border: "1px solid var(--border-dim)", color: "var(--text-muted)", opacity: 0.5, background: "transparent", cursor: "not-allowed" }
              }
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : null}
              {loading ? "EXECUTING..." : "[EXECUTE]"}
            </button>
          </div>
        </form>
      </div >

      {/* Error */}
      {
        error && (
          <div
            className="px-3 py-2 text-sm font-bold"
            style={{ border: "1px solid var(--red)", background: "rgba(255, 0, 0, 0.05)", color: "var(--red)" }}
          >
            !! ERROR: {error}
          </div>
        )
      }

      {/* Suggested queries */}
      {
        !query && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest" style={{ color: "var(--border-dim)" }}>
            // suggested commands
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => useQuery(q)}
                  className="px-3 py-1 text-xs text-left transition-all border border-border-dim text-text-muted hover:border-green hover:text-green bg-transparent"
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--green)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--green)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-dim)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
                  }}
                >
                  &gt; {q}
                </button>
              ))}
            </div>
          </div>
        )
      }

      {/* Query history */}
      {
        history.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowHistory((s) => !s)}
                className="flex items-center gap-1.5 text-xs transition-colors"
                style={{ color: "var(--border-dim)" }}
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
                  style={{ color: "var(--red)" }}
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
                    style={{ border: "1px solid var(--border-dim)", color: "var(--text-muted)" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--green)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--green)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-dim)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
                    }}
                  >
                    ↑ {entry.query}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      }
    </div >
  );
}
