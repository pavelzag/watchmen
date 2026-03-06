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
    Eye,
    Code,
    ChevronDown,
    Globe,
    Layers,
    Activity,
    Brain,
    Lock,
    Zap,
    MessageSquare,
    Search,
    Layout,
    Wifi,
    HardDrive,
    Bell
} from "lucide-react";
import { cn } from "@/lib/utils";

// Map icon names from strings to components
const ICON_MAP: Record<string, any> = {
    ShieldCheck, Database, Cloud, Server, CheckCircle2, Globe, Layers,
    Activity, Brain, Lock, Zap, MessageSquare, Search, Layout, Wifi,
    HardDrive, Bell, Code
};

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

type InfrastructureNode = {
    id: string;
    label: string;
    icon: any;
    description: string;
};

// Default nodes for non-scenario endpoints
const DEFAULT_NODES: InfrastructureNode[] = [
    { id: "gateway", label: "API Gateway", icon: ShieldCheck, description: "Authenticating & Validating" },
    { id: "lb", label: "Load Balancer", icon: Server, description: "Distributing Traffic" },
    { id: "service", label: "Cloud Run (Go)", icon: Cloud, description: "Processing Business Logic" },
    { id: "db", label: "Cloud SQL", icon: Database, description: "Persisting Record" },
    { id: "response", label: "Final Response", icon: CheckCircle2, description: "Success 200 OK" },
];

const DEFAULT_ENDPOINTS = [
    { id: "mock", label: "Local Mock", url: "", provider: "mock", description: "Simulated trace in local environment" },
];

export default function TraceClient() {
    const [inputJson, setInputJson] = useState(JSON.stringify(DEFAULT_JSON, null, 2));
    const [endpoints, setEndpoints] = useState<any[]>(DEFAULT_ENDPOINTS);
    const [targetEndpoint, setTargetEndpoint] = useState<any>(DEFAULT_ENDPOINTS[0]);
    const [isRunning, setIsRunning] = useState(false);
    const [isLoadingEndpoints, setIsLoadingEndpoints] = useState(true);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [activeNodeIndex, setActiveNodeIndex] = useState(-1);
    const [logs, setLogs] = useState<string[]>([]);
    const [outputJson, setOutputJson] = useState<any>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [modalTab, setModalTab] = useState<"details" | "pods" | "logs">("details");
    const [selectedPodName, setSelectedPodName] = useState<string | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    // Derived nodes from current endpoint
    const currentNodes = targetEndpoint?.scenario?.nodes || DEFAULT_NODES;
    const currentNodeDetails = targetEndpoint?.scenario?.nodeDetails || {};

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setSelectedNodeId(null);
                setIsEditorOpen(false);
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as any)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        const fetchEndpoints = async () => {
            try {
                const res = await fetch("/api/discovery/endpoints");
                const data = await res.json();
                if (data.endpoints) {
                    setEndpoints(data.endpoints);
                    if (data.endpoints.length > 1) {
                        setTargetEndpoint(data.endpoints[0]);
                    }
                }
            } catch (err) {
                console.error("Failed to load endpoints:", err);
            } finally {
                setIsLoadingEndpoints(false);
            }
        };
        fetchEndpoints();
    }, []);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const runTrace = async () => {
        if (isRunning) return;
        setIsRunning(true);
        setActiveNodeIndex(0);
        setLogs([`[${new Date().toLocaleTimeString()}] Initiating trace for payload...`]);
        setOutputJson(null);

        for (let i = 0; i < currentNodes.length; i++) {
            setActiveNodeIndex(i);
            const node = currentNodes[i];
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Entering ${node.label}: ${node.description}`]);

            // Logic for API call simulation
            if (node.id === "service" || node.id === "pods" || node.id === "run" || node.id === "eks") {
                try {
                    const response = await fetch("/api/trace", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            ...JSON.parse(inputJson),
                            target_url: targetEndpoint.url
                        })
                    });
                    const data = await response.json();
                    setOutputJson(data);
                    const sourceLabel = data.source === "Mock" ? "Mock" : "Cloud Service";
                    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${sourceLabel} Signal Received: Record committed`]);
                } catch (err) {
                    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: Failed to contact upstream`]);
                }
            }
            await new Promise(r => setTimeout(r, 1200));
        }
        setIsRunning(false);
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Trace complete. 100% Delivery.`]);
    };

    const selectedNodeDetail = currentNodeDetails[selectedNodeId || ""] || null;

    return (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 overflow-hidden">
            <div className="lg:col-span-4 flex flex-col gap-4 min-h-0">
                <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1" ref={dropdownRef}>
                        <h2 className="text-xs uppercase tracking-widest text-slate-500 font-bold flex items-center gap-2">
                            <Code className="w-3.5 h-3.5" /> Simulation
                        </h2>
                        <div className="relative">
                            <button
                                onClick={() => !isRunning && setIsDropdownOpen(!isDropdownOpen)}
                                disabled={isRunning || isLoadingEndpoints}
                                className="flex items-center gap-2 text-[10px] text-emerald-500/70 hover:text-emerald-500 font-bold uppercase tracking-widest outline-none cursor-pointer disabled:cursor-not-allowed transition-colors"
                            >
                                {isLoadingEndpoints ? "Loading..." : targetEndpoint.label}
                                <ChevronDown className={cn("w-3 h-3 text-slate-500 transition-transform duration-300", isDropdownOpen && "rotate-180")} />
                            </button>

                            <AnimatePresence>
                                {isDropdownOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                        className="absolute left-0 top-full mt-2 w-72 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl z-[100] p-1 overflow-hidden"
                                    >
                                        <div className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em] px-3 py-2 border-b border-slate-800/50 mb-1">
                                            Select Scenario/Target
                                        </div>
                                        <div className="max-h-80 overflow-y-auto custom-scrollbar">
                                            {endpoints.map(ep => (
                                                <button
                                                    key={ep.id}
                                                    onClick={() => {
                                                        setTargetEndpoint(ep);
                                                        setIsDropdownOpen(false);
                                                    }}
                                                    className={cn(
                                                        "w-full flex flex-col items-start px-3 py-2 rounded-md transition-all text-left group",
                                                        targetEndpoint.id === ep.id
                                                            ? "bg-emerald-500/10 text-emerald-500"
                                                            : "text-slate-400 hover:bg-slate-800 hover:text-white"
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between w-full">
                                                        <span className="text-[10px] font-bold uppercase tracking-widest">{ep.label}</span>
                                                        {targetEndpoint.id === ep.id && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />}
                                                    </div>
                                                    <div className="text-[9px] opacity-50 group-hover:opacity-100 transition-opacity truncate w-full">
                                                        {ep.description}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

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

                <div
                    onClick={() => !isRunning && setIsEditorOpen(true)}
                    className={cn(
                        "flex-1 bg-slate-900/50 border border-slate-800 rounded-lg p-4 font-mono text-sm relative group cursor-pointer hover:border-emerald-500/30 transition-colors",
                        isRunning && "opacity-50 cursor-not-allowed"
                    )}
                >
                    <div className="text-emerald-500/70 overflow-hidden whitespace-pre pointer-events-none select-none text-xs">
                        {inputJson.split('\n').slice(0, 10).join('\n')}
                        {inputJson.split('\n').length > 10 && "\n..."}
                    </div>
                </div>

                <div className="h-48 bg-black border border-slate-800 rounded-lg p-3 font-mono text-[10px] overflow-y-auto overflow-x-hidden space-y-1 custom-scrollbar">
                    {logs.map((log, i) => (
                        <div key={i} className="text-slate-400">
                            <span className="text-emerald-500 opacity-50">$</span> {log}
                        </div>
                    ))}
                    <div ref={logEndRef} />
                </div>
            </div>

            <div className="lg:col-span-8 flex flex-col gap-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs uppercase tracking-widest text-slate-500 font-bold">Infrastructure Journey</h2>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                            <Activity className="w-3 h-3 text-emerald-500" />
                            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tight">
                                {currentNodes.length} Active Nodes
                            </span>
                        </div>
                        <div className="text-[10px] text-slate-600 font-medium uppercase tracking-tighter">
                            // {targetEndpoint.type === "Scenario" ? targetEndpoint.label : "Custom Trace"}
                        </div>
                    </div>
                </div>
                <div className="relative flex-1 bg-slate-900/30 border border-slate-800/50 rounded-xl flex flex-col items-center justify-center p-8 overflow-x-auto custom-scrollbar">
                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
                        style={{ backgroundImage: "radial-gradient(circle, #10b981 1px, transparent 1px)", backgroundSize: "24px 24px" }}
                    />

                    <div className="relative min-w-[600px] w-full max-w-5xl flex items-center justify-between px-10">
                        <div className="absolute top-1/2 left-10 right-10 h-0.5 bg-slate-800 -translate-y-1/2" />
                        {(isRunning || activeNodeIndex >= 0) && (
                            <motion.div
                                initial={{ width: "0%" }}
                                animate={{ width: `${(Math.max(0, activeNodeIndex) / (currentNodes.length - 1)) * 85 + 5}%` }}
                                className="absolute top-1/2 left-10 h-0.5 bg-emerald-500 -translate-y-1/2 shadow-[0_0_8px_#10b981]"
                            />
                        )}

                        {currentNodes.map((node: any, i: number) => {
                            const isActive = i === activeNodeIndex;
                            const isCompleted = i < activeNodeIndex;
                            const Icon = typeof node.icon === "string" ? (ICON_MAP[node.icon] || Code) : node.icon;

                            return (
                                <div key={node.id} className="relative z-10 flex flex-col items-center">
                                    <motion.div
                                        animate={isActive ? { scale: [1, 1.1, 1], borderColor: ["#1e293b", "#10b981", "#1e293b"] } : {}}
                                        transition={{ repeat: Infinity, duration: 2 }}
                                        onClick={() => {
                                            setSelectedNodeId(node.id);
                                            setModalTab("details");
                                        }}
                                        className={cn(
                                            "w-12 h-12 rounded-xl border flex items-center justify-center transition-all duration-500 cursor-pointer group/node",
                                            isActive ? "bg-emerald-500/20 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]" :
                                                isCompleted ? "bg-emerald-500/10 border-emerald-500/50 hover:border-emerald-500" :
                                                    "bg-slate-900 border-slate-800 hover:border-slate-600"
                                        )}
                                    >
                                        <Icon className={cn(
                                            "w-5 h-5 transition-colors duration-500 group-hover/node:scale-110",
                                            isActive ? "text-emerald-400" : isCompleted ? "text-emerald-500" : "text-slate-600"
                                        )} />
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
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Info className="w-3.5 h-3.5 text-emerald-500" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Infrastructure Context</h3>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                        {targetEndpoint.description || "Simulating data flow across discovered architectural nodes."}
                    </p>
                </div>
            </div>

            {/* Node Detail Modal */}
            <AnimatePresence>
                {selectedNodeId && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setSelectedNodeId(null)}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                            className="relative w-full max-w-2xl bg-[#141921] border border-slate-800 rounded-2xl shadow-3xl flex flex-col overflow-hidden max-h-[80vh]"
                        >
                            <div className="p-6 border-b border-slate-800 bg-slate-900/40">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Terminal className="w-4 h-4 text-emerald-500" />
                                        <h3 className="text-sm font-bold uppercase tracking-widest text-white">
                                            {selectedNodeDetail?.title || "Node Inspection"}
                                        </h3>
                                    </div>
                                    <button onClick={() => setSelectedNodeId(null)} className="p-1 hover:bg-white/5 rounded-full transition-colors">
                                        <AlertCircle className="w-5 h-5 text-slate-500 rotate-45" />
                                    </button>
                                </div>
                                <p className="text-xs text-slate-400 mt-2">{selectedNodeDetail?.description}</p>

                                {/* Tabs */}
                                <div className="flex gap-4 mt-6">
                                    {["details", "pods", "logs"].map((tab) => (
                                        <button
                                            key={tab}
                                            onClick={() => setModalTab(tab as any)}
                                            className={cn(
                                                "text-[10px] uppercase tracking-widest font-bold pb-2 transition-all border-b-2",
                                                modalTab === tab ? "text-emerald-500 border-emerald-500" : "text-slate-500 border-transparent hover:text-slate-300"
                                            )}
                                        >
                                            {tab}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                                {modalTab === "details" && (
                                    <div className="space-y-6">
                                        {(selectedNodeDetail?.details || []).map((detail: any, idx: number) => (
                                            <div key={idx} className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{detail.label}</span>
                                                    {detail.type === "status" && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                                                </div>
                                                {detail.type === "code" ? (
                                                    <div className="bg-black/50 border border-slate-800 rounded p-3 font-mono text-xs text-emerald-400 leading-relaxed whitespace-pre overflow-x-auto">{detail.value}</div>
                                                ) : (
                                                    <p className={cn("text-sm font-medium", detail.type === "status" ? "text-emerald-400" : "text-slate-200")}>{detail.value}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {modalTab === "pods" && (
                                    <div className="space-y-4">
                                        {!selectedNodeDetail?.pods ? (
                                            <div className="text-center py-10 text-slate-600 text-[10px] uppercase tracking-widest">No pods identified in this node type</div>
                                        ) : (
                                            <div className="grid gap-2">
                                                {selectedNodeDetail.pods.map((pod: any) => (
                                                    <div key={pod.name} className="bg-slate-900/50 border border-slate-800 p-3 rounded-lg flex items-center justify-between group">
                                                        <div className="flex items-center gap-3">
                                                            <div className={cn("w-2 h-2 rounded-full", pod.status === "Running" ? "bg-emerald-500" : "bg-amber-500")} />
                                                            <div className="flex flex-col">
                                                                <span className="text-xs font-bold text-slate-200">{pod.name}</span>
                                                                <span className="text-[10px] text-slate-500">Age: {pod.age} • Restarts: {pod.restarts}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <div className="text-[9px] text-slate-500 text-right">
                                                                <div>CPU: {pod.cpu}</div>
                                                                <div>MEM: {pod.memory}</div>
                                                            </div>
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedPodName(pod.name);
                                                                    setModalTab("logs");
                                                                }}
                                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-emerald-500/10 rounded-md text-emerald-500"
                                                            >
                                                                <Terminal className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {modalTab === "logs" && (
                                    <div className="bg-black border border-slate-800 rounded-lg p-4 font-mono text-[11px] h-64 overflow-y-auto custom-scrollbar">
                                        {!selectedNodeDetail?.pods ? (
                                            <div className="text-slate-600 italic">Logs currently unavailable for this resource.</div>
                                        ) : (
                                            (selectedNodeDetail.pods.find((p: any) => p.name === (selectedPodName || selectedNodeDetail.pods[0].name))?.logs || []).map((line: string, i: number) => (
                                                <div key={i} className="text-slate-300 mb-1">
                                                    <span className="text-emerald-500/50 mr-2">{">"}</span>
                                                    {line}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Request Editor Modal */}
            <AnimatePresence>
                {isEditorOpen && (
                    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setIsEditorOpen(false)}
                            className="absolute inset-0 bg-black/80 backdrop-blur-md"
                        />
                        <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="relative w-full max-w-3xl h-[80vh] bg-[#0d1117] border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                        >
                            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50">
                                <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-white">Edit Request Payload</h3>
                                <button onClick={() => setIsEditorOpen(false)} className="p-2 hover:bg-white/5 rounded-full text-slate-500 transition-colors">
                                    <AlertCircle className="w-5 h-5 rotate-45" />
                                </button>
                            </div>
                            <textarea
                                value={inputJson}
                                onChange={(e) => setInputJson(e.target.value)}
                                className="flex-1 bg-transparent p-6 outline-none text-emerald-500/90 font-mono text-base resize-none overflow-y-auto custom-scrollbar"
                                spellCheck={false}
                            />
                            <div className="p-4 bg-slate-900/30 flex justify-end">
                                <button onClick={() => setIsEditorOpen(false)} className="px-6 py-2 bg-emerald-500 text-black rounded text-xs font-bold uppercase tracking-widest shadow-lg active:scale-95 transition-all">Apply Changes</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
