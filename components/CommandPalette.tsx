"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Check, Copy, Loader2, X, Terminal } from "lucide-react";
import { usePathname } from "next/navigation";
import { saveQuery, getHistory } from "@/lib/query-history";
import type { ResourceItem } from "@/lib/claude/query-processor";
import { linkifyText } from "@/lib/utils/linkify";
import { Clock, Tag, ChevronDown, ChevronUp, ArrowRight, User, HardDrive, Server, KeySquare, MonitorDot, Play, Database, BarChart3, Radio, Lock, Flame, ShieldAlert, Users } from "lucide-react";
import Link from "next/link";

// Simple cross-component event bus — no context provider needed
export function openCommandPalette() {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("cmd-palette:open"));
    }
}

interface ResultPeek {
    answer: string;
    query: string;
    resources?: ResourceItem[];
    fetchedAt: string;
}

// Shared linkify used below
const RESOURCE_LINKS: Record<string, string> = {
    bucket: "/dashboard/buckets",
    gke_cluster: "/dashboard/clusters",
    service_account: "/dashboard/service-accounts",
    vm: "/dashboard/vms",
    cloud_run: "/dashboard/cloud-run",
    cloud_sql: "/dashboard/cloud-sql",
    bigquery: "/dashboard/bigquery",
    pubsub: "/dashboard/pubsub",
    secret: "/dashboard/secrets",
    firewall: "/dashboard/firewall",
    s3_bucket: "/dashboard/aws/s3",
    ec2_instance: "/dashboard/aws/ec2",
    rds_instance: "/dashboard/aws/rds",
    eks_cluster: "/dashboard/aws/eks",
    lambda_function: "/dashboard/aws/lambda",
    iam_user: "/dashboard/aws/iam",
    iam_role: "/dashboard/aws/iam",
    aws_account: "/dashboard/aws",
    load_balancer: "/dashboard/trace",
};

function resourceHref(item: ResourceItem): string {
    const base = RESOURCE_LINKS[item.type ?? ""];
    if (!base) return "#";
    return `${base}?search=${encodeURIComponent(item.name)}`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(text: string): string {
    const safe = escapeHtml(text);
    return safe
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/^- (.+)$/gm, "<li>$1</li>")
        .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
        .replace(/\n/g, "<br />");
}

function linkifyResources(text: string, resources: ResourceItem[]): string {
    return linkifyText(text, resources, resourceHref);
}

function isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export default function CommandPalette() {
    const pathname = usePathname();
    const isAws = pathname?.startsWith("/dashboard/aws") ?? false;
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ResultPeek | null>(null);
    const [historyItems, setHistoryItems] = useState<string[]>([]);
    const [histIdx, setHistIdx] = useState(-1);
    const [copied, setCopied] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Load history on open
    useEffect(() => {
        if (open) {
            setHistoryItems(getHistory().slice(0, 20).map((h) => h.query));
            setHistIdx(-1);
            setResult(null);
            setError(null);
            setQuery("");
            setCopied(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    // Listen for global open event + "/" key
    useEffect(() => {
        function handleOpen() {
            setOpen(true);
        }
        function handleKey(e: KeyboardEvent) {
            // "/" opens palette when not already in an input
            const tag = (e.target as HTMLElement).tagName;
            if (
                e.key === "/" &&
                tag !== "INPUT" &&
                tag !== "TEXTAREA" &&
                !e.metaKey &&
                !e.ctrlKey
            ) {
                e.preventDefault();
                setOpen(true);
            }
            // Escape closes
            if (e.key === "Escape") setOpen(false);
        }
        window.addEventListener("cmd-palette:open", handleOpen);
        window.addEventListener("keydown", handleKey);
        return () => {
            window.removeEventListener("cmd-palette:open", handleOpen);
            window.removeEventListener("keydown", handleKey);
        };
    }, []);

    const submit = useCallback(async () => {
        if (!query.trim() || loading) return;
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const endpoint = isAws ? "/api/aws/query" : "/api/query";
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: query.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Request failed");
            saveQuery(data.query, data.answer);
            setResult({
                answer: data.answer,
                query: data.query,
                resources: data.resources,
                fetchedAt: data.fetchedAt || new Date().toISOString()
            });
            setCopied(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    }, [query, loading, isAws]); // Added isAws to dependency array

    const copyResult = useCallback(async () => {
        if (!result?.answer) return;
        try {
            await navigator.clipboard.writeText(result.answer);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        } catch {
            setError("Failed to copy response.");
        }
    }, [result]);

    useEffect(() => {
        if (!open || !result) return;

        function handleCopyKey(e: KeyboardEvent) {
            if (isEditableTarget(e.target)) return;
            if (e.key.toLowerCase() !== "c" || e.metaKey || e.ctrlKey || e.altKey) return;
            const selection = window.getSelection()?.toString();
            if (selection) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            void copyResult();
        }

        window.addEventListener("keydown", handleCopyKey, { capture: true });
        return () => window.removeEventListener("keydown", handleCopyKey, { capture: true });
    }, [open, result, copyResult]);

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
        // Up/Down cycle through history
        if (e.key === "ArrowUp") {
            e.preventDefault();
            const next = Math.min(histIdx + 1, historyItems.length - 1);
            setHistIdx(next);
            setQuery(historyItems[next] ?? "");
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = Math.max(histIdx - 1, -1);
            setHistIdx(next);
            setQuery(next === -1 ? "" : historyItems[next] ?? "");
        }
        if (e.key === "Escape") setOpen(false);
    }

    if (!open) return null;

    return (
        <div
            data-command-palette-open="true"
            className="fixed inset-0 z-[9999] flex items-start justify-center pt-24 px-4"
            style={{ background: "rgba(0,0,0,0.85)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
            {/* Scanline overlay on the backdrop */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px)",
                }}
            />

            <div
                className="relative w-full max-w-2xl flex flex-col overflow-hidden"
                style={{ border: "1px solid #00ff41", background: "#090909", boxShadow: "0 0 40px #00ff4140", maxHeight: "calc(100vh - 8rem)" }}
            >
                {/* Title bar */}
                <div
                    className="flex items-center justify-between px-4 py-2 text-xs"
                    style={{ borderBottom: "1px solid #005c16" }}
                >
                    <div className="flex items-center gap-2" style={{ color: "#00ff41" }}>
                        <Terminal className="w-3 h-3" />
                        <span className="uppercase tracking-widest">// CLOUD BRAIN QUERY</span>
                    </div>
                    <div className="flex items-center gap-3" style={{ color: "#005c16" }}>
                        <span>↑↓ history · Enter execute · Esc close</span>
                        <button
                            onClick={() => setOpen(false)}
                            className="terminal-btn-danger p-1"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                </div>

                {/* Input */}
                <div className="flex items-start gap-2 p-4">
                    <span
                        className="text-sm shrink-0 select-none pt-0.5"
                        style={{ color: "#00ff41", textShadow: "0 0 8px #00ff41" }}
                    >
                        $&nbsp;query<span style={{ animation: "blink 1s step-end infinite" }}>_</span>
                    </span>
                    <textarea
                        ref={inputRef}
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setHistIdx(-1); }}
                        onKeyDown={handleKeyDown}
                        placeholder="ask anything about your cloud..."
                        rows={2}
                        disabled={loading}
                        className="flex-1 resize-none outline-none text-sm leading-relaxed"
                        style={{ background: "transparent", color: "#00ff41", fontFamily: "JetBrains Mono, monospace" }}
                    />
                </div>

                {/* Footer / execute */}
                <div
                    className="flex items-center justify-between px-4 py-2 text-xs"
                    style={{ borderTop: "1px solid #0a1a0a" }}
                >
                    <span style={{ color: "#003010" }}>
                        {historyItems.length > 0 ? `// ${historyItems.length} history entries — ↑↓ to cycle` : "// no history"}
                    </span>
                    <button
                        onClick={submit}
                        disabled={!query.trim() || loading}
                        className="flex items-center gap-1.5 px-4 py-1 text-xs uppercase tracking-widest"
                        style={
                            query.trim() && !loading
                                ? { background: "#00ff41", color: "#090909", fontWeight: 700 }
                                : { border: "1px solid #005c16", color: "#005c16", cursor: "not-allowed" }
                        }
                    >
                        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        {loading ? "[EXECUTING]" : "[EXECUTE]"}
                    </button>
                </div>

                {/* Scrollable output area */}
                {(error || result) && <div className="overflow-y-auto flex-1">

                    {/* Error */}
                    {error && (
                        <div
                            className="mx-4 mb-3 px-3 py-2 text-xs"
                            style={{ border: "1px solid #ff3333", background: "#1a0000", color: "#ff3333" }}
                        >
                            !! ERROR: {error}
                        </div>
                    )}

                    {/* Result */}
                    {result && (
                        <div
                            className="mx-4 mb-4 p-3 text-sm"
                            style={{ border: "1px solid #005c16", background: "#050d05" }}
                        >
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <p className="text-xs uppercase tracking-widest" style={{ color: "#005c16" }}>
                  // OUTPUT
                                </p>
                                <button
                                    type="button"
                                    onClick={copyResult}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-widest transition-colors"
                                    style={{ border: "1px solid #003010", color: copied ? "#00ff41" : "#00aa2b" }}
                                    title="Copy response (C)"
                                >
                                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                    {copied ? "[COPIED]" : "[COPY] C"}
                                </button>
                            </div>
                            <div
                                className="prose-answer text-[11px] md:text-xs leading-relaxed break-words"
                                dangerouslySetInnerHTML={{ __html: linkifyText(renderMarkdown(result.answer), result.resources ?? [], resourceHref) }}
                            />
                            <div className="mt-3 pt-2 text-xs" style={{ borderTop: "1px solid #003010", color: "#005c16" }}>
              // query saved to history · close overlay to return to dashboard
                            </div>
                        </div>
                    )}

                </div>}
            </div>
        </div>
    );
}
