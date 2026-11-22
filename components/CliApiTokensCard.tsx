"use client";

import { useEffect, useState } from "react";
import { KeyRound, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Terminal, ChevronDown, ChevronUp } from "lucide-react";
import CopyTextButton from "@/components/CopyTextButton";

interface TokenRecord {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default function CliApiTokensCard({ isDemoUser }: { isDemoUser: boolean }) {
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [newPlaintextToken, setNewPlaintextToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mcpSetupOpen, setMcpSetupOpen] = useState(false);
  const [mcpClientTab, setMcpClientTab] = useState<"opencode" | "claude" | "codex">("opencode");

  async function loadTokens() {
    if (isDemoUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/api-tokens");
      const data = (await res.json().catch(() => ({}))) as { tokens?: TokenRecord[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTokens(data.tokens ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API tokens.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemoUser]);

  async function handleCreate() {
    if (isDemoUser || creating) return;
    setCreating(true);
    setError(null);
    setNewPlaintextToken(null);
    try {
      const res = await fetch("/api/settings/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tokenName.trim() || "CLI Token" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        token?: string;
        tokens?: TokenRecord[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNewPlaintextToken(data.token ?? null);
      setTokens(data.tokens ?? []);
      setTokenName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API token.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (isDemoUser || revokingId) return;
    setRevokingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/settings/api-tokens?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { tokens?: TokenRecord[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTokens(data.tokens ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API token.");
    } finally {
      setRevokingId(null);
    }
  }

  const activeTokens = tokens.filter((t) => !t.revokedAt);
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const tokenPlaceholder = newPlaintextToken ?? "${WATCHMEN_API_TOKEN}";

  const mcpSnippet =
    mcpClientTab === "opencode"
      ? JSON.stringify(
          {
            mcp: {
              watchmen: {
                type: "remote",
                url: `${origin}/api/mcp`,
                headers: {
                  Authorization: `Bearer ${tokenPlaceholder}`,
                },
              },
            },
          },
          null,
          2
        )
      : mcpClientTab === "claude"
        ? `claude mcp add --transport http watchmen ${origin}/api/mcp --header "Authorization: Bearer ${tokenPlaceholder}"`
        : `[mcp_servers.watchmen]\nurl = "${origin}/api/mcp"\nbearer_token_env_var = "WATCHMEN_API_TOKEN"`;

  const stdioSnippet = JSON.stringify(
    {
      command: "node",
      args: ["scripts/watchmen-mcp.mjs"],
      env: {
        WATCHMEN_URL: origin,
        WATCHMEN_API_TOKEN: newPlaintextToken ?? "<paste wm_... token>",
      },
    },
    null,
    2
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--border-dim)" }}>
          CLI & MCP Personal API Tokens
        </h2>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          Scoped <code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300 font-mono">wm_...</code> bearer tokens for fetching and updating Watchmen CLI Handoff tasks from OpenCode, Claude Code, Codex, or scripts.
        </p>
      </div>

      <div
        className="border p-5 space-y-4"
        style={{ background: "rgba(16, 185, 129, 0.04)", borderColor: "rgba(16, 185, 129, 0.2)" }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <span className="text-sm font-bold text-emerald-400">Watchmen Handoff API</span>
              <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                GET / POST / PATCH /api/handoff/tasks · v0.9
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {activeTokens.length} active token{activeTokens.length === 1 ? "" : "s"}
          </span>
        </div>

        {isDemoUser ? (
          <p className="text-xs font-mono text-amber-300/90">
            Personal API tokens are disabled in Demo mode. Sign in with your own account to create CLI tokens.
          </p>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
                placeholder="Token label (e.g. macbook-opencode, claude-workstation)"
                className="flex-1 min-w-[220px] px-3 py-2 bg-slate-900/60 border text-xs font-mono"
                style={{ border: "1px solid var(--border-dim)", color: "var(--text-primary)" }}
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="terminal-btn text-xs px-4 py-2 inline-flex items-center gap-1.5 font-bold"
                style={{ background: "#10b981", color: "#000" }}
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Generate Token
              </button>
            </div>

            {newPlaintextToken && (
              <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-950/30 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Token created — copy it now (it will not be shown again):
                  </span>
                  <CopyTextButton text={newPlaintextToken} label="Copy Token" className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10" />
                </div>
                <pre className="text-xs font-mono text-white bg-slate-950/80 border border-slate-800 rounded px-2.5 py-2 overflow-x-auto">
                  {newPlaintextToken}
                </pre>
                <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] font-mono text-slate-400">
                  <span>export WATCHMEN_API_TOKEN=&quot;{newPlaintextToken}&quot;</span>
                  <CopyTextButton
                    text={`export WATCHMEN_API_TOKEN="${newPlaintextToken}"`}
                    label="Copy export"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-slate-700 text-slate-300 hover:bg-slate-800"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {loading ? (
              <div className="text-xs font-mono text-slate-500 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading tokens...
              </div>
            ) : activeTokens.length === 0 ? (
              <p className="text-xs font-mono text-slate-500">
                No active tokens yet. Generate one to let local CLI agents pull and update Watchmen tasks.
              </p>
            ) : (
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
                {activeTokens.map((tok) => (
                  <div
                    key={tok.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 bg-slate-950/40 text-xs flex-wrap"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <KeyRound className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-200 truncate">{tok.name}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {tok.tokenPrefix}… · created {new Date(tok.createdAt).toLocaleDateString()}
                          {tok.lastUsedAt ? ` · last used ${new Date(tok.lastUsedAt).toLocaleString()}` : " · never used"}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRevoke(tok.id)}
                      disabled={revokingId === tok.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      {revokingId === tok.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* MCP Setup Snippets */}
            <div className="border-t border-emerald-500/20 pt-3 space-y-3">
              <button
                type="button"
                onClick={() => setMcpSetupOpen((v) => !v)}
                className="flex items-center justify-between w-full text-left text-xs font-mono text-emerald-300 hover:text-emerald-200"
              >
                <span>Connect CLI Tools via MCP ({origin}/api/mcp)</span>
                {mcpSetupOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {mcpSetupOpen && (
                <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono">
                      {(["opencode", "claude", "codex"] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setMcpClientTab(tab)}
                          className={`px-2.5 py-1 rounded border transition-colors ${
                            mcpClientTab === tab
                              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                              : "border-slate-800 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {tab === "opencode" ? "OpenCode" : tab === "claude" ? "Claude Code" : "Codex"}
                        </button>
                      ))}
                    </div>
                    <CopyTextButton
                      text={mcpSnippet}
                      label="Copy MCP Config"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-slate-700 text-slate-300 hover:bg-slate-800"
                    />
                  </div>

                  <pre className="text-[11px] font-mono text-slate-300 bg-[#04060a] border border-slate-800 rounded p-2.5 overflow-x-auto">
                    {mcpSnippet}
                  </pre>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                        Or local stdio bridge (node scripts/watchmen-mcp.mjs)
                      </span>
                      <CopyTextButton
                        text={stdioSnippet}
                        label="Copy stdio"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-slate-700 text-slate-300 hover:bg-slate-800"
                      />
                    </div>
                    <pre className="text-[11px] font-mono text-slate-400 bg-[#04060a] border border-slate-800 rounded p-2.5 overflow-x-auto">
                      {stdioSnippet}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
