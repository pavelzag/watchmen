"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Plus,
  Trash2,
  Cpu,
  KeyRound,
  Activity,
  Loader2,
} from "lucide-react";
import type { ShirudoOverview } from "@/lib/shirudo/exposure";

interface ShirudoOverviewResponse extends ShirudoOverview {
  demoMode?: boolean;
}

export default function ShirudoFleetPanel({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<ShirudoOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upatchId, setUpatchId] = useState("");
  const [advisoryId, setAdvisoryId] = useState("");
  const [shieldKind, setShieldKind] = useState<"bpf_upatch" | "java_agent">("bpf_upatch");
  const [saving, setSaving] = useState(false);
  const [attestChallenge, setAttestChallenge] = useState<{
    id: string;
    nodeKey: string;
    nonce: string;
    command: string;
  } | null>(null);
  const [attestQuoteInput, setAttestQuoteInput] = useState("");
  const [attestMessage, setAttestMessage] = useState<string | null>(null);
  const [attesting, setAttesting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shirudo");
      const json = (await res.json().catch(() => ({}))) as Partial<ShirudoOverviewResponse> & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (!json || typeof json.summary !== "object" || !Array.isArray(json.nodes)) {
        setData(null);
      } else {
        setData(json as ShirudoOverviewResponse);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Shirudo fleet overview.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleAddMapping() {
    if (!upatchId.trim() || !advisoryId.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/shirudo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upatchId: upatchId.trim(),
          advisoryId: advisoryId.trim().toUpperCase(),
          shieldKind,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setUpatchId("");
      setAdvisoryId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mapping.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMapping(upatch: string, advisory: string) {
    setError(null);
    try {
      const res = await fetch(
        `/api/shirudo?upatchId=${encodeURIComponent(upatch)}&advisoryId=${encodeURIComponent(advisory)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove mapping.");
    }
  }

  async function handleIssueAttestChallenge(nodeKey: string) {
    setAttesting(true);
    setAttestMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/shirudo/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue", nodeKey }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        command?: string;
        challenge?: { id: string; nodeKey: string; nonce: string };
      };
      if (!res.ok || !json.challenge) throw new Error(json.error ?? `HTTP ${res.status}`);
      setAttestChallenge({
        id: json.challenge.id,
        nodeKey: json.challenge.nodeKey,
        nonce: json.challenge.nonce,
        command: json.command ?? `shirudo attest --nonce=${json.challenge.nonce}`,
      });
      setAttestQuoteInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue TPM challenge.");
    } finally {
      setAttesting(false);
    }
  }

  async function handleVerifyAttestChallenge() {
    if (!attestChallenge || !attestQuoteInput.trim()) return;
    setAttesting(true);
    setAttestMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/shirudo/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          challengeId: attestChallenge.id,
          quote: attestQuoteInput.trim(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        verified?: boolean;
        reason?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.verified) {
        setAttestMessage("TPM challenge verified cleanly.");
        setAttestChallenge(null);
        setAttestQuoteInput("");
        await load();
      } else {
        setAttestMessage(`Verification failed: ${json.reason ?? "invalid quote"}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify TPM challenge.");
    } finally {
      setAttesting(false);
    }
  }

  if (compact) {
    if (loading || !data?.summary || (data.summary.totalNodes === 0 && (data.fixes?.length ?? 0) === 0)) {
      return null;
    }

    return (
      <div className="glass rounded-2xl p-5 border border-violet-500/30 bg-violet-950/10 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-400" />
            <p className="text-xs font-semibold text-violet-200 uppercase tracking-wider">
              Shirudo Runtime Shielding &amp; Attestation Evidence
            </p>
            {data.demoMode && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-violet-500/30 text-violet-300">
                DEMO
              </span>
            )}
          </div>
          <Link
            href="/dashboard/runtime"
            className="text-xs font-mono text-violet-300 hover:text-violet-200 underline"
          >
            Inspect Shirudo Fleet →
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <div className="text-[10px] font-mono uppercase text-slate-500">Shielded Nodes</div>
            <div className="text-lg font-bold text-emerald-300 mt-0.5">
              {data.summary.healthyNodes}/{data.summary.totalNodes}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <div className="text-[10px] font-mono uppercase text-slate-500">TPM-Quoted</div>
            <div className="text-lg font-bold text-sky-300 mt-0.5">{data.summary.quotedNodes}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <div className="text-[10px] font-mono uppercase text-slate-500">Shielded CVEs</div>
            <div className="text-lg font-bold text-violet-300 mt-0.5">{data.summary.shieldedAdvisories}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <div className="text-[10px] font-mono uppercase text-slate-500">Exploits Blocked</div>
            <div className="text-lg font-bold text-amber-300 mt-0.5">{data.summary.totalBlockedHits}</div>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Compensating control proof: unpatched CVEs mitigated at runtime by signed Shirudo <code>upatch</code> shields can be referenced in SOC 2 (CC7.1 / CC8.1) and ISO 27001 (A.8.8) audit reviews.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-violet-500/25 bg-[#060812] p-5 space-y-5 mt-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center rounded border border-violet-500/35 bg-violet-500/10 text-violet-300">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold uppercase tracking-widest text-violet-200">
                Shirudo Fleet &amp; Live Shields
              </h2>
              {data?.demoMode && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 border border-violet-500/30 text-violet-300">
                  DEMO
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-slate-400 mt-0.5">
              OTLP keepalives (/api/ingest/shirudo/v1/logs) · shield hit metrics (/v1/metrics) · CVE coverage
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/settings?tab=integrations"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono border border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <KeyRound className="w-3 h-3 text-sky-400" />
            OTLP Setup
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs font-mono text-red-300 border border-red-500/30 bg-red-500/10">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center gap-2 py-4 text-xs font-mono text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading Shirudo fleet status...
        </div>
      ) : data ? (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="border border-slate-800 bg-black/40 p-3">
              <div className="text-[10px] font-mono uppercase text-slate-500">Nodes</div>
              <div className="text-lg font-bold text-slate-100 mt-0.5">{data.summary.totalNodes}</div>
            </div>
            <div className="border border-slate-800 bg-black/40 p-3">
              <div className="text-[10px] font-mono uppercase text-slate-500">Healthy</div>
              <div className="text-lg font-bold text-emerald-300 mt-0.5">{data.summary.healthyNodes}</div>
            </div>
            <div className="border border-slate-800 bg-black/40 p-3">
              <div className="text-[10px] font-mono uppercase text-slate-500">Tampered</div>
              <div className={`text-lg font-bold mt-0.5 ${data.summary.tamperedNodes > 0 ? "text-red-400" : "text-slate-400"}`}>
                {data.summary.tamperedNodes}
              </div>
            </div>
            <div className="border border-slate-800 bg-black/40 p-3">
              <div className="text-[10px] font-mono uppercase text-slate-500">Shielded CVEs</div>
              <div className="text-lg font-bold text-violet-300 mt-0.5">{data.summary.shieldedAdvisories}</div>
            </div>
            <div className="border border-slate-800 bg-black/40 p-3">
              <div className="text-[10px] font-mono uppercase text-slate-500">Blocked Hits</div>
              <div className="text-lg font-bold text-amber-300 mt-0.5">{data.summary.totalBlockedHits}</div>
            </div>
          </div>

          {/* Nodes + Fix Mappings */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Nodes */}
            <div className="border border-slate-800 bg-black/30 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-violet-400" />
                  Shirudo Target Nodes ({data.nodes.length})
                </span>
              </div>
              {data.nodes.length === 0 ? (
                <p className="text-xs font-mono text-slate-500 py-3">
                  No Shirudo keepalives received yet. Point <code>map_export.otel_endpoint</code> at <code>/api/ingest/shirudo</code> with a <code>wm_...</code> Bearer token.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.nodes.map((node) => {
                    const isHealthy = node.verdict === "ok";
                    const isTampered = node.verdict === "tampered" || node.verdict === "lsm-off";
                    return (
                      <div key={node.nodeKey} className="border border-slate-800/80 bg-slate-950/60 p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            {isTampered ? (
                              <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" />
                            ) : (
                              <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${isHealthy ? "text-emerald-400" : "text-amber-300"}`} />
                            )}
                            <span className="text-xs font-bold text-slate-100 truncate">
                              {node.hostName || node.nodeKey.slice(0, 16)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {node.historyContradiction && (
                              <span
                                className="text-[9px] font-mono uppercase px-1.5 py-0.5 border border-red-500/50 bg-red-500/15 text-red-300"
                                title="Monotonic TPM reset/clock rollback detected across keepalives"
                              >
                                Replay / Rollback
                              </span>
                            )}
                            {node.quoteVerified ? (
                              <span
                                className="text-[9px] font-mono uppercase px-1.5 py-0.5 border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                title={node.tpmClock ? `ECDSA P-256 TPM quote verified (reset=${node.tpmResetCount ?? 0}, clock=${node.tpmClock})` : "TPM quote verified"}
                              >
                                TPM Verified
                              </span>
                            ) : node.quotePresent ? (
                              <span
                                className="text-[9px] font-mono uppercase px-1.5 py-0.5 border border-amber-500/40 text-amber-300"
                                title={node.quoteVerificationError ?? "TPM quote present but unverified"}
                              >
                                Quote Unverified
                              </span>
                            ) : null}
                            <span
                              className={`text-[9px] font-mono uppercase px-1.5 py-0.5 border ${
                                isTampered
                                  ? "border-red-500/40 text-red-300 bg-red-500/10"
                                  : isHealthy
                                    ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                                    : "border-amber-500/40 text-amber-300 bg-amber-500/10"
                              }`}
                            >
                              {node.verdict}
                            </span>
                            {!data.demoMode && (
                              <button
                                type="button"
                                onClick={() => void handleIssueAttestChallenge(node.nodeKey)}
                                disabled={attesting}
                                className="text-[9px] font-mono uppercase px-1.5 py-0.5 border border-sky-500/35 text-sky-300 hover:bg-sky-500/10"
                                title="Issue a fresh cryptographic TPM nonce challenge for this node"
                              >
                                Attest
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          kernel: {node.kernelRelease || "unknown"} · upatches loaded: {node.loadedCount}
                          {node.tamperTotal > 0 ? ` · tamper counters: ${node.tamperTotal}` : ""}
                        </div>
                        {node.loadedUpatches.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            {node.loadedUpatches.map((u) => (
                              <span
                                key={u}
                                className="text-[10px] font-mono px-1.5 py-0.5 border border-violet-500/35 bg-violet-500/10 text-violet-200"
                              >
                                {u}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {attestMessage && (
                <div className="px-3 py-2 text-xs font-mono border border-emerald-500/35 bg-emerald-500/10 text-emerald-200">
                  {attestMessage}
                </div>
              )}

              {attestChallenge && (
                <div className="border border-sky-500/35 bg-sky-950/15 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-sky-300">
                      TPM Challenge ({attestChallenge.nodeKey.slice(0, 14)}…)
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttestChallenge(null)}
                      className="text-[10px] font-mono text-slate-400 hover:text-slate-200"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-[11px] font-mono text-slate-300">
                    Run on target: <code className="text-sky-200">{attestChallenge.command}</code>
                  </p>
                  <textarea
                    rows={2}
                    value={attestQuoteInput}
                    onChange={(e) => setAttestQuoteInput(e.target.value)}
                    placeholder="Paste shirudo.quote string (attest=...;sig=...;ak=...)"
                    className="w-full p-2 text-[11px] font-mono bg-[#050805] border border-slate-800 text-slate-200 outline-none focus:border-sky-500/60"
                  />
                  <button
                    type="button"
                    onClick={() => void handleVerifyAttestChallenge()}
                    disabled={attesting || !attestQuoteInput.trim()}
                    className="px-3 py-1 text-[10px] font-mono uppercase border border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25 disabled:opacity-40"
                  >
                    {attesting ? "Verifying..." : "Verify TPM Quote"}
                  </button>
                </div>
              )}
            </div>

            {/* Upatch <-> CVE mappings & recent hits */}
            <div className="space-y-4">
              <div className="border border-slate-800 bg-black/30 p-3.5 space-y-2.5">
                <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-violet-400" />
                  upatch → CVE Shield Mappings ({data.fixes.length})
                </span>

                {!data.demoMode && (
                  <div className="flex gap-1.5 flex-wrap">
                    <input
                      type="text"
                      value={upatchId}
                      onChange={(e) => setUpatchId(e.target.value)}
                      placeholder="upatch id (e.g. xz-lzma-guard)"
                      className="flex-1 min-w-[140px] h-7 px-2 text-[11px] font-mono bg-[#050805] border border-slate-800 text-slate-200 outline-none focus:border-violet-500/60"
                    />
                    <input
                      type="text"
                      value={advisoryId}
                      onChange={(e) => setAdvisoryId(e.target.value)}
                      placeholder="CVE-2024-3094"
                      className="w-32 h-7 px-2 text-[11px] font-mono bg-[#050805] border border-slate-800 text-slate-200 outline-none focus:border-violet-500/60"
                    />
                    <select
                      value={shieldKind}
                      onChange={(e) => setShieldKind(e.target.value as "bpf_upatch" | "java_agent")}
                      className="h-7 px-2 text-[11px] font-mono bg-[#050805] border border-slate-800 text-slate-200 outline-none"
                    >
                      <option value="bpf_upatch">BPF C</option>
                      <option value="java_agent">Java</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleAddMapping()}
                      disabled={saving || !upatchId.trim() || !advisoryId.trim()}
                      className="h-7 px-2.5 inline-flex items-center gap-1 text-[10px] font-mono uppercase border border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25 disabled:opacity-40"
                    >
                      <Plus className="w-3 h-3" />
                      Link
                    </button>
                  </div>
                )}

                {data.fixes.length === 0 ? (
                  <p className="text-xs font-mono text-slate-500 py-2">
                    No upatch → CVE links yet. Link one above to mark matching Container Scan CVEs as Shielded.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {data.fixes.map((fix) => (
                      <div
                        key={`${fix.upatchId}:${fix.advisoryId}`}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 border border-slate-800 bg-slate-950/60 text-[11px] font-mono"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-violet-300 font-semibold truncate">{fix.upatchId}</span>
                          <span className="text-slate-500">→</span>
                          <span className="text-emerald-300">{fix.advisoryId}</span>
                          <span className="text-[9px] text-slate-500 uppercase">({fix.shieldKind})</span>
                        </div>
                        {!data.demoMode && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteMapping(fix.upatchId, fix.advisoryId)}
                            className="text-slate-500 hover:text-red-400 p-1"
                            title="Remove link"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border border-slate-800 bg-black/30 p-3.5 space-y-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-amber-300" />
                  Recent Shield Hits ({data.recentHits.length})
                </span>
                {data.recentHits.length === 0 ? (
                  <p className="text-xs font-mono text-slate-500 py-2">
                    No shield hit telemetry reported yet.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {data.recentHits.slice(0, 6).map((hit) => (
                      <div
                        key={hit.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 border border-slate-800 bg-slate-950/60 text-[11px] font-mono"
                      >
                        <div className="min-w-0 truncate">
                          <span className="text-slate-200">{hit.upatchId}</span>
                          {hit.advisoryId && <span className="text-violet-300"> ({hit.advisoryId})</span>}
                          <span className="text-slate-500"> · {hit.hostName || hit.nodeKey.slice(0, 12)}</span>
                        </div>
                        <span className="text-amber-300 shrink-0">{hit.hitCount} hits</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
