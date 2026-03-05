"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Play,
    Database,
    Cloud,
    ShieldCheck,
    Server,
    CheckCircle2,
    AlertCircle,
    Info,
    Terminal,
    Eye
} from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_JSON = {
    "id": "req-9981-ax",
    "source": "client-ui-v1",
    "data": {
        "user_id": "user_44",
        "action": "purchase",
        "amount": 125.50,
        "currency": "USD"
    },
    "metadata": {
        "ip": "192.168.1.1",
        "ua": "Mozilla/5.0..."
    }
};

type Node = {
    id: string;
    label: string;
    icon: any;
    description: string;
};

const NODES: Node[] = [
    { id: "gateway", label: "API Gateway", icon: ShieldCheck, description: "Authenticating & Validating" },
    { id: "lb", label: "Load Balancer", icon: Server, description: "Distributing Traffic" },
    { id: "service", label: "Cloud Run (Go)", icon: Cloud, description: "Processing Business Logic" },
    { id: "db", label: "Cloud SQL", icon: Database, description: "Persisting Record" },
    { id: "response", label: "Final Response", icon: CheckCircle2, description: "Success 200 OK" },
];

type NodeDetail = {
    title: string;
    description: string;
    details: {
        label: string;
        value: string;
        type?: "code" | "text" | "status";
    }[];
};

const NODE_DETAILS: Record<string, NodeDetail> = {
    gateway: {
        title: "API Gateway Inspection",
        description: "Edge validation and authentication layer.",
        details: [
            { label: "Auth Protocol", value: "OAuth 2.0 / JWT", type: "text" },
            { label: "Rate Limiting", value: "500 req/sec (Active)", type: "status" },
            { label: "IP Filtering", value: "Allowed: 192.168.1.0/24", type: "text" },
            { label: "Validated Headers", value: '{\n  "Authorization": "Bearer ...",\n  "X-Request-ID": "req-9981-ax"\n}', type: "code" }
        ]
    },
    lb: {
        title: "Load Balancer Analysis",
        description: "Traffic distribution and SSL termination.",
        details: [
            { label: "SSL Status", value: "Handshake Complete (TLS 1.3)", type: "status" },
            { label: "Algorithm", value: "Round Robin", type: "text" },
            { label: "Backend Target", value: "cloud-run-mesh-01", type: "text" },
            { label: "Forwarded Protocol", value: "HTTP/2", type: "text" }
        ]
    },
    service: {
        title: "Cloud Run (Go) Trace",
        description: "Execution details for the request-processor service.",
        details: [
            { label: "Runtime", value: "Go 1.21 on Cloud Run", type: "text" },
            { label: "Morphic Logic", value: 'func process(req Request) {\n  req.Processed = true\n  req.ServerID = "watchmen-7f4b"\n}', type: "code" },
            { label: "Env Vars", value: "DB_CONN, TRACE_ENABLED=true", type: "text" },
            { label: "Execution Time", value: "42ms", type: "status" }
        ]
    },
    db: {
        title: "Cloud SQL Interaction",
        description: "Persistence event for current transaction.",
        details: [
            { label: "Database", value: "PostgreSQL 15 (Managed)", type: "text" },
            { label: "Executed Query", value: "INSERT INTO audit_logs (id, payload) VALUES ($1, $2)", type: "code" },
            { label: "Query Time", value: "12ms", type: "status" },
            { label: "Consistency", value: "Strong (Committed)", type: "text" }
        ]
    },
    response: {
        title: "Final Response Assembly",
        description: "Egress formatting and client dispatch.",
        details: [
            { label: "Status Code", value: "200 OK", type: "status" },
            { label: "Content Type", value: "application/json", type: "text" },
            { label: "Compression", value: "gzip (92% reduction)", type: "text" },
            { label: "Packet Size", value: "1.2KB", type: "text" }
        ]
    }
};

export default function TraceClient() {
    const [inputJson, setInputJson] = useState(JSON.stringify(DEFAULT_JSON, null, 2));
    const [isRunning, setIsRunning] = useState(false);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [activeNodeIndex, setActiveNodeIndex] = useState(-1);
    const [logs, setLogs] = useState<string[]>([]);
    const [outputJson, setOutputJson] = useState<any>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);

    const addLog = (msg: string) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const runTrace = async () => {
        if (isRunning) return;

        setIsRunning(true);
        setActiveNodeIndex(0);
        setLogs([`[${new Date().toLocaleTimeString()}] Initiating trace for payload...`]);
        setOutputJson(null);

        // Node-by-node simulation
        for (let i = 0; i < NODES.length; i++) {
            setActiveNodeIndex(i);
            const node = NODES[i];
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Entering ${node.label}: ${node.description}`]);

            // At the service node, we call the actual API
            if (i === 2) {
                try {
                    const response = await fetch("/api/trace", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: inputJson
                    });
                    const data = await response.json();
                    setOutputJson(data);
                    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Go Service Signal Received: Record committed`]);
                } catch (err) {
                    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: Failed to contact Go Service`]);
                }
            }

            await new Promise(r => setTimeout(r, 1500));
        }

        setIsRunning(false);
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Trace complete. 100% Delivery.`]);
    };

    return (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 overflow-hidden">
            {/* Left Column: Controls & Logs */}
            <div className="lg:col-span-4 flex flex-col gap-4 min-h-0">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs uppercase tracking-widest text-slate-500 font-bold flex items-center gap-2">
                        <Code className="w-3.5 h-3.5" /> Simulation
                    </h2>
                    <button
                        onClick={runTrace}
                        disabled={isRunning}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded text-xs font-bold uppercase tracking-widest transition-all",
                            isRunning
                                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                                : "bg-emerald-500 text-black hover:bg-emerald-400 active:scale-95 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                        )}
                    >
                        <Play className={cn("w-3 h-3 fill-current", isRunning && "animate-pulse")} />
                        {isRunning ? "Tracing..." : "Run Trace"}
                    </button>
                </div>

                {/* Editor Trigger */}
                <div
                    onClick={() => !isRunning && setIsEditorOpen(true)}
                    className={cn(
                        "flex-1 bg-slate-900/50 border border-slate-800 rounded-lg p-4 font-mono text-sm relative group cursor-pointer hover:border-emerald-500/30 transition-colors",
                        isRunning && "opacity-50 cursor-not-allowed"
                    )}
                >
                    <div className="text-emerald-500/70 overflow-hidden whitespace-pre pointer-events-none select-none">
                        {inputJson.split('\n').slice(0, 12).join('\n')}
                        {inputJson.split('\n').length > 12 && "\n..."}
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-950/80 rounded-lg" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-emerald-500 text-black text-[10px] font-bold px-3 py-1.5 rounded uppercase tracking-widest shadow-lg">
                            Edit Payload
                        </div>
                    </div>
                    <div className="absolute top-2 right-2">
                        <div className="text-[10px] text-slate-600 bg-black/50 px-2 py-0.5 rounded border border-slate-800">
                            JSON
                        </div>
                    </div>
                </div>

                <div className="h-48 bg-black border border-slate-800 rounded-lg p-3 font-mono text-[10px] overflow-y-auto overflow-x-hidden space-y-1">
                    {logs.map((log, i) => (
                        <div key={i} className="text-slate-400 animate-in fade-in slide-in-from-left-2 duration-300">
                            <span className="text-emerald-500 opacity-50">$</span> {log}
                        </div>
                    ))}
                    <div ref={logEndRef} />
                </div>
            </div>

            {/* Right Column: Visualization */}
            <div className="lg:col-span-8 flex flex-col gap-6">
                <h2 className="text-xs uppercase tracking-widest text-slate-500 font-bold">Infrastructure Journey</h2>

                {/* Pipeline SVG */}
                <div className="relative flex-1 bg-slate-900/30 border border-slate-800/50 rounded-xl flex flex-col items-center justify-center p-8">
                    {/* Background Grid */}
                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
                        style={{ backgroundImage: "radial-gradient(circle, #10b981 1px, transparent 1px)", backgroundSize: "24px 24px" }}
                    />

                    <div className="relative w-full max-w-4xl flex items-center justify-between">
                        {/* Connecting Lines */}
                        <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-800 -translate-y-1/2" />

                        {/* Active Path */}
                        {(isRunning || activeNodeIndex >= 0) && (
                            <motion.div
                                initial={{ width: "0%" }}
                                animate={{ width: `${(Math.max(0, activeNodeIndex) / (NODES.length - 1)) * 100}%` }}
                                className="absolute top-1/2 left-0 h-0.5 bg-emerald-500 -translate-y-1/2 shadow-[0_0_8px_#10b981]"
                            />
                        )}

                        {/* Nodes */}
                        {NODES.map((node, i) => {
                            const isActive = i === activeNodeIndex;
                            const isCompleted = i < activeNodeIndex;
                            const Icon = node.icon;

                            return (
                                <div key={node.id} className="relative z-10 flex flex-col items-center">
                                    <motion.div
                                        animate={isActive ? { scale: [1, 1.1, 1], borderColor: ["#1e293b", "#10b981", "#1e293b"] } : {}}
                                        transition={{ repeat: Infinity, duration: 2 }}
                                        onClick={() => setSelectedNodeId(node.id)}
                                        className={cn(
                                            "w-14 h-14 rounded-xl border flex items-center justify-center transition-all duration-500 cursor-pointer group/node",
                                            isActive ? "bg-emerald-500/20 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]" :
                                                isCompleted ? "bg-emerald-500/10 border-emerald-500/50 hover:border-emerald-500" :
                                                    "bg-slate-900 border-slate-800 hover:border-slate-600"
                                        )}
                                    >
                                        <Icon className={cn(
                                            "w-6 h-6 transition-colors duration-500 group-hover/node:scale-110",
                                            isActive ? "text-emerald-400" :
                                                isCompleted ? "text-emerald-500" :
                                                    "text-slate-600"
                                        )} />

                                        <div className="absolute -top-1 -right-1 opacity-0 group-hover/node:opacity-100 transition-opacity">
                                            <div className="bg-emerald-500 rounded-full p-0.5 shadow-lg">
                                                <Eye className="w-3 h-3 text-black" />
                                            </div>
                                        </div>

                                        {/* Status Ring */}
                                        {isActive && (
                                            <motion.div
                                                className="absolute inset-0 rounded-xl border-2 border-emerald-500/50"
                                                initial={{ scale: 0.8, opacity: 1 }}
                                                animate={{ scale: 1.5, opacity: 0 }}
                                                transition={{ repeat: Infinity, duration: 1.5 }}
                                            />
                                        )}
                                    </motion.div>

                                    <div className="absolute top-full mt-4 flex flex-col items-center text-center w-32">
                                        <span className={cn(
                                            "text-[10px] uppercase tracking-tighter font-bold",
                                            isActive ? "text-emerald-400" : isCompleted ? "text-slate-300" : "text-slate-600"
                                        )}>
                                            {node.label}
                                        </span>
                                        {isActive && (
                                            <motion.span
                                                initial={{ opacity: 0, y: 5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="text-[9px] text-slate-500 mt-1 leading-tight"
                                            >
                                                {node.description}
                                            </motion.span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {/* Moving Packet */}
                        <AnimatePresence>
                            {isRunning && activeNodeIndex < NODES.length - 1 && (
                                <motion.div
                                    key="packet"
                                    initial={{ left: `${(activeNodeIndex / (NODES.length - 1)) * 100}%` }}
                                    animate={{ left: `${((activeNodeIndex + 1) / (NODES.length - 1)) * 100}%` }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 1.2, ease: "linear" }}
                                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_#10b981] z-20"
                                />
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Transform Details */}
                    <AnimatePresence>
                        {outputJson && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="mt-24 w-full max-w-2xl bg-black/40 border border-slate-800 rounded-xl p-6 backdrop-blur-sm"
                            >
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">Transformation Result</h3>
                                </div>
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-[9px] uppercase tracking-widest text-slate-500">Inputs</label>
                                        <div className="bg-slate-900/50 rounded p-2 text-[10px] font-mono text-emerald-700">
                                            {JSON.stringify(JSON.parse(inputJson).data, null, 1)}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[9px] uppercase tracking-widest text-slate-500">Outputs (Morphed)</label>
                                        <div className="bg-emerald-500/5 rounded p-2 text-[10px] font-mono text-emerald-400">
                                            {JSON.stringify(outputJson.processed_data, null, 1)}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Theory of Discovery Section */}
                <div className="mt-8 bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Info className="w-4 h-4 text-emerald-500" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Theory of Discovery</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-tighter text-slate-400">1. Cloud Graphing</span>
                            <p className="text-[10px] text-slate-500 leading-relaxed">System queries Resource Manager APIs to map relationships between LBs, Services, and DBs.</p>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-tighter text-slate-400">2. Runtime Tracing</span>
                            <p className="text-[10px] text-slate-500 leading-relaxed">Trace context (W3C Traceparent) is injected into headers to track real-time hops via OpenTelemetry.</p>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-tighter text-slate-400">3. IAM Simulation</span>
                            <p className="text-[10px] text-slate-500 leading-relaxed">Reachable paths are calculated by simulating service-account permissions across the network.</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal Overlay */}
            <AnimatePresence>
                {isEditorOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsEditorOpen(false)}
                            className="absolute inset-0 bg-black/80 backdrop-blur-md"
                        />
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="relative w-full max-w-3xl h-[80vh] bg-[#0d1117] border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                        >
                            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50">
                                <div className="flex items-center gap-3">
                                    <Code className="w-4 h-4 text-emerald-500" />
                                    <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-white">Edit Request Payload</h3>
                                </div>
                                <button
                                    onClick={() => setIsEditorOpen(false)}
                                    className="p-2 hover:bg-white/5 rounded-full text-slate-400 hover:text-white transition-colors"
                                >
                                    <AlertCircle className="w-5 h-5 rotate-45" />
                                </button>
                            </div>

                            <div className="flex-1 p-6 overflow-hidden">
                                <textarea
                                    value={inputJson}
                                    onChange={(e) => setInputJson(e.target.value)}
                                    className="w-full h-full bg-transparent outline-none text-emerald-500/90 font-mono text-base resize-none overflow-y-auto custom-scrollbar"
                                    spellCheck={false}
                                    autoFocus
                                />
                            </div>

                            <div className="p-4 border-t border-slate-800 bg-slate-900/30 flex justify-end gap-3">
                                <button
                                    onClick={() => setIsEditorOpen(false)}
                                    className="px-6 py-2 rounded text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                                >
                                    Done
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Node Detail Modal */}
            <AnimatePresence>
                {selectedNodeId && NODE_DETAILS[selectedNodeId] && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSelectedNodeId(null)}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="relative w-full max-w-lg bg-[#141921] border border-slate-800 rounded-2xl shadow-3xl flex flex-col overflow-hidden"
                        >
                            <div className="p-6 border-b border-slate-800 bg-slate-900/40">
                                <div className="flex items-center gap-3 mb-2">
                                    <Terminal className="w-4 h-4 text-emerald-500" />
                                    <h3 className="text-sm font-bold uppercase tracking-widest text-white">
                                        {NODE_DETAILS[selectedNodeId].title}
                                    </h3>
                                </div>
                                <p className="text-xs text-slate-400">{NODE_DETAILS[selectedNodeId].description}</p>
                            </div>

                            <div className="p-6 space-y-6">
                                {NODE_DETAILS[selectedNodeId].details.map((detail, idx) => (
                                    <div key={idx} className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                                                {detail.label}
                                            </span>
                                            {detail.type === "status" && (
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            )}
                                        </div>
                                        {detail.type === "code" ? (
                                            <div className="bg-black/50 border border-slate-800 rounded p-3 font-mono text-xs text-emerald-400 leading-relaxed whitespace-pre overflow-x-auto">
                                                {detail.value}
                                            </div>
                                        ) : (
                                            <p className={cn(
                                                "text-sm font-medium",
                                                detail.type === "status" ? "text-emerald-400" : "text-slate-200"
                                            )}>
                                                {detail.value}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="p-4 bg-slate-900/20 flex justify-end">
                                <button
                                    onClick={() => setSelectedNodeId(null)}
                                    className="px-6 py-2 rounded text-[10px] font-bold uppercase tracking-widest bg-slate-800 text-slate-400 hover:text-white transition-colors"
                                >
                                    Dismiss
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
