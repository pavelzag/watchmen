"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Play,
    Database,
    Cloud,
    ShieldCheck,
    Server,
    ArrowRight,
    Code,
    CheckCircle2,
    AlertCircle
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

export default function TraceClient() {
    const [inputJson, setInputJson] = useState(JSON.stringify(DEFAULT_JSON, null, 2));
    const [isRunning, setIsRunning] = useState(false);
    const [activeNodeIndex, setActiveNodeIndex] = useState(-1);
    const [logs, setLogs] = useState<string[]>([]);
    const [outputJson, setOutputJson] = useState<any>(null);
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
            {/* Left Column: Input */}
            <div className="lg:col-span-4 flex flex-col gap-4 min-h-0">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs uppercase tracking-widest text-slate-500 font-bold flex items-center gap-2">
                        <Code className="w-3.5 h-3.5" /> Payload Editor
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

                <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-lg p-4 font-mono text-sm relative group">
                    <textarea
                        value={inputJson}
                        onChange={(e) => setInputJson(e.target.value)}
                        disabled={isRunning}
                        className="w-full h-full bg-transparent outline-none text-emerald-500/90 resize-none selection:bg-emerald-500/20"
                        spellCheck={false}
                    />
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="text-[10px] text-slate-600 bg-black/50 px-2 py-0.5 rounded border border-slate-800">
                            UTF-8
                        </div>
                    </div>
                </div>

                <div className="h-40 bg-black border border-slate-800 rounded-lg p-3 font-mono text-[10px] overflow-y-auto overflow-x-hidden space-y-1">
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
                                        className={cn(
                                            "w-14 h-14 rounded-xl border flex items-center justify-center transition-all duration-500",
                                            isActive ? "bg-emerald-500/20 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]" :
                                                isCompleted ? "bg-emerald-500/10 border-emerald-500/50" :
                                                    "bg-slate-900 border-slate-800"
                                        )}
                                    >
                                        <Icon className={cn(
                                            "w-6 h-6 transition-colors duration-500",
                                            isActive ? "text-emerald-400" :
                                                isCompleted ? "text-emerald-500" :
                                                    "text-slate-600"
                                        )} />

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
                                            {JSON.stringify(outputJson.processed, null, 1)}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
