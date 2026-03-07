"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Play,
    Database,
    Cloud,
    ShieldCheck,
    ShieldAlert,
    Server,
    CheckCircle2,
    AlertCircle,
    Info,
    Terminal,
    Eye,
    Loader2,
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
    Bell,
    X,
    RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getDemoCredentials, getDemoGcpSnapshot, getDemoAwsSnapshot, setDemoGcpSnapshot } from "@/lib/demo-credentials";
import type { GcpSnapshot } from "@/lib/gcp/types";
import type { AwsSnapshot } from "@/lib/aws/types";
import { getGcpLbScenario, getGcpRunScenario, getGcpVmScenario } from "@/lib/mock/scenarios";

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
    vulnerability?: {
        id: string;
        level: "critical" | "high" | "medium" | "low";
        title: string;
        description: string;
        remediation: string;
    };
    lateralPaths?: string[];
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

    const [isBreachMode, setIsBreachMode] = useState(false);
    const [isLiveMode, setIsLiveMode] = useState(false);
    const [remediationScript, setRemediationScript] = useState<{ script: string; explanation: string } | null>(null);
    const [isRemediating, setIsRemediating] = useState(false);
    const [customUrl, setCustomUrl] = useState("");
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);

    // Derived nodes from current endpoint
    const currentNodes = (targetEndpoint?.scenario?.nodes || DEFAULT_NODES) as InfrastructureNode[];
    const [currentNodeDetails, setCurrentNodeDetails] = useState<Record<string, any>>({});

    useEffect(() => {
        setCurrentNodeDetails(targetEndpoint?.scenario?.nodeDetails || {});
    }, [targetEndpoint]);

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

    const fetchEndpoints = useCallback(async (preserveId?: string) => {
        setIsLoadingEndpoints(true);
        try {
            const res = await fetch("/api/discovery/endpoints");
            const data = await res.json();
            const rawEndpoints = data.endpoints || [];

            // Assign dynamic scenarios to discovered endpoints from the API
            const discoveryEndpoints = rawEndpoints.map((ep: any) => {
                if (ep.type === "Load Balancer" && !ep.scenario) {
                    return { ...ep, scenario: getGcpLbScenario(ep.id.replace("gcp-lb-", ""), ep.url.replace("http://", "")) };
                } else if (ep.type === "Cloud Run" && !ep.scenario) {
                    return { ...ep, scenario: getGcpRunScenario(ep.id.replace("gcp-run-", ""), ep.url) };
                } else if (ep.type === "Compute Engine" && !ep.scenario) {
                    return { ...ep, scenario: getGcpVmScenario(ep.id.replace("gcp-vm-", ""), ep.url.replace("http://", "")) };
                }
                return ep;
            });

            // 2. Add endpoints from sessionStorage (for Demo Users who run Real Scans)
            const sessionEndpoints: any[] = [];
            const gcpSnap = getDemoGcpSnapshot() as GcpSnapshot;
            const awsSnap = getDemoAwsSnapshot() as AwsSnapshot;

            if (gcpSnap?.loadBalancers) {
                gcpSnap.loadBalancers.forEach(lb => {
                    if (lb.ipAddress && !discoveryEndpoints.find((e: any) => e.url.includes(lb.ipAddress!))) {
                        sessionEndpoints.push({
                            id: `session-gcp-lb-${lb.name}`,
                            label: `[Discovered] LB: ${lb.name}`,
                            url: `http://${lb.ipAddress}`,
                            provider: "gcp",
                            type: "Load Balancer",
                            description: `Discovered in current session via Real Scan`,
                            scenario: getGcpLbScenario(lb.name, lb.ipAddress)
                        });
                    }
                });
            }

            if (gcpSnap?.cloudRunServices) {
                gcpSnap.cloudRunServices.forEach(svc => {
                    if (svc.url && !discoveryEndpoints.find((e: any) => e.url === svc.url)) {
                        sessionEndpoints.push({
                            id: `session-gcp-run-${svc.name}`,
                            label: `[Discovered] CR: ${svc.name}`,
                            url: svc.url,
                            provider: "gcp",
                            type: "Cloud Run",
                            description: `Discovered in current session via Real Scan`,
                            scenario: getGcpRunScenario(svc.name, svc.url)
                        });
                    }
                });
            }

            if (gcpSnap?.vms) {
                gcpSnap.vms.forEach(vm => {
                    if (vm.externalIp && !discoveryEndpoints.find((e: any) => e.url.includes(vm.externalIp!))) {
                        sessionEndpoints.push({
                            id: `session-gcp-vm-${vm.name}`,
                            label: `[Discovered] VM: ${vm.name}`,
                            url: `http://${vm.externalIp}`,
                            provider: "gcp",
                            type: "Compute Engine",
                            description: `Discovered in current session via Real Scan`,
                            scenario: getGcpVmScenario(vm.name, vm.externalIp!)
                        });
                    }
                });
            }

            if (awsSnap?.loadBalancers) {
                awsSnap.loadBalancers.forEach(lb => {
                    if (lb.dnsName && !discoveryEndpoints.find((e: any) => e.url.includes(lb.dnsName!))) {
                        sessionEndpoints.push({
                            id: `session-aws-lb-${lb.name}`,
                            label: `[Discovered] ELB: ${lb.name}`,
                            url: `http://${lb.dnsName}`,
                            provider: "aws",
                            type: "Elastic Load Balancer",
                            description: `Discovered in current session via Real Scan`
                        });
                    }
                });
            }

            // Merge and add a "Custom" option for manual entry
            const finalEndpoints = [
                ...discoveryEndpoints,
                ...sessionEndpoints,
                {
                    id: "custom",
                    label: "Manual Entry (Custom URL)",
                    url: "",
                    provider: "other",
                    type: "External",
                    description: "Send requests to any accessible IP or domain"
                }
            ];

            setEndpoints(finalEndpoints);

            if (preserveId) {
                const found = finalEndpoints.find(e => e.id === preserveId);
                if (found) setTargetEndpoint(found);
            } else if (finalEndpoints.length > 0 && !targetEndpoint?.id) {
                setTargetEndpoint(finalEndpoints[0]);
            }
        } catch (err) {
            console.error("Failed to load endpoints:", err);
        } finally {
            setIsLoadingEndpoints(false);
        }
    }, [targetEndpoint?.id]);

    const triggerScan = async () => {
        setIsSyncing(true);
        setSyncError(null);
        try {
            const demoCreds = getDemoCredentials();
            const body = demoCreds.gcp ? { demoCredentials: { gcp: demoCreds.gcp } } : {};
            const res = await fetch("/api/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await res.json().catch(() => ({})) as { error?: string; credentialsRequired?: boolean; snapshot?: object };

            if (!res.ok) {
                const errorMsg = data.error || (res.status === 422 ? "GCP Credentials Required in Settings" : "Sync Failed");
                setSyncError(errorMsg);
                return;
            }

            if (data.snapshot) {
                setDemoGcpSnapshot(data.snapshot);
            }
            await fetchEndpoints(targetEndpoint?.id);
        } catch (err) {
            console.error("Sync failed:", err);
            setSyncError("Network Error: Failed to reach scan API");
        } finally {
            setIsSyncing(false);
        }
    };

    useEffect(() => {
        fetchEndpoints();
    }, [fetchEndpoints]);

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

            // Enhanced Logging and Logic for API call simulation
            if (i === currentNodes.length - 2 && targetEndpoint.url) {
                try {
                    const startTime = Date.now();
                    const payload = JSON.parse(inputJson);
                    const targetUrl = targetEndpoint.id === "custom" ? customUrl : targetEndpoint.url;

                    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Fetch: POST ${targetUrl}...`]);

                    const response = await fetch("/api/trace", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            ...payload,
                            target_url: targetUrl
                        })
                    });

                    const duration = Date.now() - startTime;
                    const data = await response.json();
                    setOutputJson(data);

                    const status = response.status;
                    const isAuthError = status === 401 || status === 403 || (data?.message?.includes("not authenticated") || data?.error?.includes("unauthorized"));

                    if (isAuthError) {
                        setLogs(prev => [
                            ...prev,
                            `[${new Date().toLocaleTimeString()}] 🔴 AUTH BLOCKER: ${status} Unauthorized`,
                            `[${new Date().toLocaleTimeString()}] 🛡️ IAM POLICY: Cloud Run requires authentication.`,
                            `[${new Date().toLocaleTimeString()}] 💡 TIP: Allow unauthenticated invocations or add Authorization header.`
                        ]);

                        // Dynamically update the node detail with a vulnerability in the targetEndpoint state
                        const runNodeIndex = currentNodes.findIndex(n => n.id === "gcp-run" || n.label.includes("RUN") || n.label.includes("Cloud Run") || n.id === "service");
                        if (runNodeIndex !== -1) {
                            const nodeId = currentNodes[runNodeIndex].id;
                            setTargetEndpoint((prev: any) => ({
                                ...prev,
                                scenario: {
                                    ...prev.scenario,
                                    nodeDetails: {
                                        ...prev.scenario?.nodeDetails,
                                        [nodeId]: {
                                            ...(prev.scenario?.nodeDetails?.[nodeId] || {}),
                                            vulnerabilities: [
                                                {
                                                    id: "iam-unauthorized",
                                                    title: "IAM Policy Blocked: Unauthenticated Access Prohibited",
                                                    severity: "high",
                                                    description: "The Cloud Run service is configured to require authentication, but the request was sent anonymously. This is a common IAM misconfiguration for public-facing services.",
                                                    insight: "Run: gcloud run services add-iam-policy-binding --member='allUsers' --role='roles/run.invoker' to allow public access."
                                                }
                                            ]
                                        }
                                    }
                                }
                            }));
                            setIsBreachMode(true); // Turn trace red for visibility
                        }

                        // Stop the simulation loop
                        setIsRunning(false);
                        break;
                    }

                    const statusColor = status >= 200 && status < 300 ? "SUCCESS" : "ERROR";

                    setLogs(prev => [
                        ...prev,
                        `[${new Date().toLocaleTimeString()}] ${statusColor} ${status} (${duration}ms) | Size: ${JSON.stringify(data).length} bytes`,
                        `[${new Date().toLocaleTimeString()}] Remote Trace ID: ${response.headers.get("x-trace-id") || "N/A"}`,
                        `[${new Date().toLocaleTimeString()}] Payload committed to backend.`
                    ]);
                } catch (err) {
                    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Network Error: Failed to reach backend`]);
                }
            }
            await new Promise(r => setTimeout(r, 1200));
        }
        setIsRunning(false);
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Trace complete. 100% Delivery.`]);
    };

    const runRemediation = async (vulnerability: any) => {
        setIsRemediating(true);
        setRemediationScript(null);
        try {
            const res = await fetch("/api/remediate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vulnerability })
            });
            const data = await res.json();
            setRemediationScript(data);
        } catch (err) {
            console.error("Remediation failed:", err);
        } finally {
            setIsRemediating(false);
        }
    };

    // Real-time Request Mirroring Logic
    const lastRequestRef = useRef<string | null>(null);
    useEffect(() => {
        if (!isLiveMode) return;

        const pollHistory = async () => {
            try {
                const res = await fetch("/api/trace/history");
                if (res.ok) {
                    const history = await res.json();
                    if (history && history.length > 0) {
                        const latest = history[0];

                        // Check if this is a new request we haven't seen yet
                        if (latest.request_id !== lastRequestRef.current) {
                            lastRequestRef.current = latest.request_id;

                            // Auto-trigger visualization for the new request
                            setOutputJson(latest);
                            setLogs(prev => [
                                ...prev.slice(-10),
                                `[${new Date().toLocaleTimeString()}] 🟢 MIRROR: Captured incoming request ${latest.request_id.substring(0, 8)}`,
                                `[${new Date().toLocaleTimeString()}] 📡 SOURCE: ${latest.original_data?.source || "Unknown"}`,
                                `[${new Date().toLocaleTimeString()}] 🚀 AUTO-TRACE: Analyzing infrastructure journey...`
                            ]);

                            // Start the visualization animation
                            setIsRunning(true);
                            setActiveNodeIndex(0);

                            // Simulate progressive visualization steps for the mirrored request
                            let step = 0;
                            const steps = currentNodes.length;
                            const stepInterval = setInterval(() => {
                                step++;
                                setActiveNodeIndex(prev => prev + 1);
                                if (step >= steps) {
                                    clearInterval(stepInterval);
                                    setIsRunning(false);
                                }
                            }, 800);
                        }
                    }
                }
            } catch (err) {
                console.error("History polling failed:", err);
            }
        };

        const interval = setInterval(pollHistory, 3000);
        return () => clearInterval(interval);
    }, [isLiveMode, currentNodes.length]);

    const selectedNodeDetail = currentNodeDetails[selectedNodeId || ""] || null;

    return (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 overflow-hidden">
            <div className="lg:col-span-4 flex flex-col gap-4 min-h-0">
                <div className="flex items-start justify-between gap-4 pb-2">
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5" ref={dropdownRef}>
                        <div className="flex items-center gap-4">
                            <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold flex items-center gap-2">
                                <Code className="w-3.5 h-3.5" /> Simulation
                            </h2>
                            <button
                                onClick={triggerScan}
                                disabled={isSyncing}
                                className="flex items-center gap-1 text-[9px] uppercase tracking-widest transition-colors hover:text-emerald-500 disabled:opacity-50"
                                style={{ color: isSyncing ? "#ffaa00" : "#00aa2b" }}
                            >
                                <RefreshCw className={cn("w-2.5 h-2.5", isSyncing && "animate-spin")} />
                                {isSyncing ? "[SYNCING...]" : "[SYNC GCP]"}
                            </button>
                        </div>

                        <AnimatePresence>
                            {syncError && (
                                <motion.div
                                    initial={{ opacity: 0, y: -5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    className="flex items-center gap-2 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded text-[9px] text-red-400 font-bold uppercase tracking-widest mt-1"
                                >
                                    <AlertCircle className="w-2.5 h-2.5" />
                                    <span>{syncError}</span>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="relative">
                            <button
                                onClick={() => !isRunning && setIsDropdownOpen(!isDropdownOpen)}
                                disabled={isRunning || isLoadingEndpoints}
                                className="flex items-center gap-2 text-[11px] text-emerald-500/80 hover:text-emerald-500 font-bold uppercase tracking-wider outline-none cursor-pointer disabled:cursor-not-allowed transition-colors text-left group"
                            >
                                <span className="truncate max-w-[200px] lg:max-w-[300px]">
                                    {isLoadingEndpoints ? "Loading..." : targetEndpoint.label}
                                </span>
                                <ChevronDown className={cn("w-3.5 h-3.5 text-slate-500 transition-transform duration-300", isDropdownOpen && "rotate-180")} />
                            </button>

                            {/* Custom URL Input (Conditional) */}
                            <AnimatePresence>
                                {targetEndpoint.id === "custom" && !isDropdownOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.98 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="mt-2"
                                    >
                                        <input
                                            type="text"
                                            value={customUrl}
                                            onChange={(e) => setCustomUrl(e.target.value)}
                                            placeholder="Paste Cluster IP or Domain (e.g. http://136.113.99.70)"
                                            className="w-full px-3 py-1.5 bg-black border border-emerald-500/30 rounded text-[10px] text-emerald-400 font-mono shadow-[0_0_10px_rgba(16,185,129,0.1)] outline-none focus:border-emerald-500 transition-all placeholder:text-slate-700"
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>

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
                                                        <span className="text-[10px] font-bold uppercase tracking-widest truncate mr-2">{ep.label}</span>
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

                    <div className="flex flex-col gap-2">
                        <button
                            onClick={runTrace}
                            disabled={isRunning}
                            className={cn(
                                "flex-shrink-0 flex items-center gap-3 px-6 h-12 rounded-lg text-xs font-black uppercase tracking-[0.15em] transition-all relative overflow-hidden group/btn",
                                isRunning
                                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                                    : "bg-emerald-500 text-black hover:bg-emerald-400 active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.4)]"
                            )}
                        >
                            {!isRunning && (
                                <div className="absolute inset-0 opacity-10 pointer-events-none bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,0,0,0.5)_2px,rgba(0,0,0,0.5)_4px)]" />
                            )}
                            <Play className={cn("w-4 h-4 fill-current", isRunning && "animate-pulse")} />
                            <span>{isRunning ? "Tracing..." : "Run Trace"}</span>
                        </button>

                        {!isLiveMode && (
                            <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest text-center animate-pulse">
                                Click "Go Live" to see external curls →
                            </div>
                        )}
                    </div>
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
                    <h2 className="text-xs uppercase tracking-widest text-slate-500 font-bold flex items-center gap-4">
                        Infrastructure Journey
                        <button
                            onClick={() => setIsBreachMode(!isBreachMode)}
                            className={cn(
                                "flex items-center gap-2 px-3 py-1 rounded-full border transition-all text-[9px] font-bold uppercase tracking-widest",
                                isBreachMode
                                    ? "bg-red-500/10 border-red-500 text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]"
                                    : "bg-slate-800/50 border-slate-700 text-slate-500 hover:text-slate-300"
                            )}
                        >
                            <ShieldAlert className={cn("w-3 h-3", isBreachMode && "animate-pulse")} />
                            {isBreachMode ? "Breach Mode: ACTIVE" : "Simulate Breach"}
                        </button>
                        <button
                            onClick={() => setIsLiveMode(!isLiveMode)}
                            className={cn(
                                "flex items-center gap-2 px-3 py-1 rounded-full border transition-all text-[9px] font-bold uppercase tracking-widest",
                                isLiveMode
                                    ? "bg-emerald-500/10 border-emerald-500 text-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                                    : "bg-slate-800/50 border-slate-700 text-slate-500 hover:text-slate-300"
                            )}
                        >
                            <Wifi className={cn("w-3 h-3", isLiveMode && "animate-pulse")} />
                            {isLiveMode ? "LIVE: STREAMING" : "Go Live"}
                        </button>
                    </h2>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                            <Activity className="w-3 h-3 text-emerald-500" />
                            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tight">
                                {currentNodes.length} Active Nodes
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-4">
                    <AnimatePresence>
                        {isBreachMode && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 overflow-hidden"
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                                    <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Breach Simulation Active</span>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-relaxed">
                                    Visualizing potential <span className="text-red-400 font-bold">Attack Paths</span>. This mode highlights how vulnerabilities in one component
                                    (e.g., GKE Pods) can be exploited for <span className="text-red-400 font-bold">Lateral Movement</span> into sensitive downstream resources.
                                    Red dashed lines indicate compromised communication channels.
                                </p>
                            </motion.div>
                        )}
                        {isLiveMode && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 overflow-hidden"
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <Wifi className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Real-time Observability Mode</span>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-relaxed">
                                    Streaming <span className="text-emerald-400 font-bold">Live production-like metrics</span>. Simulating real-time log ingestion, heartbeats,
                                    and service health signals. Workload health and log streams are updated dynamically to reflect the
                                    active state of your infrastructure.
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="relative flex-1 bg-slate-900/30 border border-slate-800/50 rounded-xl flex flex-col items-center justify-center p-8 overflow-x-auto custom-scrollbar">
                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
                        style={{ backgroundImage: "radial-gradient(circle, #10b981 1px, transparent 1px)", backgroundSize: "24px 24px" }}
                    />

                    <div className="relative min-w-[600px] w-full max-w-5xl flex items-center justify-between px-10">
                        <div className="absolute top-1/2 left-10 right-10 h-0.5 bg-slate-800 -translate-y-1/2" />

                        {/* Lateral Movement Channels */}
                        {isBreachMode && currentNodes.map((node, idx) => (
                            (node.lateralPaths || []).map(targetId => {
                                const targetIdx = currentNodes.findIndex(n => n.id === targetId);
                                if (targetIdx === -1) return null;
                                const startPos = (idx / (currentNodes.length - 1)) * 100;
                                const endPos = (targetIdx / (currentNodes.length - 1)) * 100;
                                return (
                                    <motion.div
                                        key={`${node.id}-${targetId}`}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="absolute top-[40%] h-0.5 border-t border-dashed border-red-500/40 -translate-y-1/2"
                                        style={{
                                            left: `calc(40px + ${startPos * 0.85}%)`,
                                            width: `calc(${(endPos - startPos) * 0.85}%)`,
                                            borderRadius: "100px"
                                        }}
                                    />
                                );
                            })
                        ))}

                        {(isRunning || activeNodeIndex >= 0) && (
                            <motion.div
                                initial={{ width: "0%" }}
                                animate={{ width: `${(Math.max(0, activeNodeIndex) / (currentNodes.length - 1)) * 85 + 5}%` }}
                                className={cn(
                                    "absolute top-1/2 left-10 h-0.5 -translate-y-1/2 transition-colors duration-500",
                                    isBreachMode ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : "bg-emerald-500 shadow-[0_0_8px_#10b981]"
                                )}
                            />
                        )}

                        {currentNodes.map((node: any, i: number) => {
                            const isActive = i === activeNodeIndex;
                            const isCompleted = i < activeNodeIndex;
                            const Icon = typeof node.icon === "string" ? (ICON_MAP[node.icon] || Code) : node.icon;

                            return (
                                <div key={node.id} className="relative z-10 flex flex-col items-center">
                                    <motion.div
                                        animate={isActive ? { scale: [1, 1.1, 1], borderColor: [isBreachMode ? "#ef4444" : "#10b981"] } : {}}
                                        transition={{ repeat: Infinity, duration: 2 }}
                                        onClick={() => {
                                            setSelectedNodeId(node.id);
                                            setModalTab("details");
                                        }}
                                        className={cn(
                                            "w-12 h-12 rounded-xl border flex items-center justify-center transition-all duration-500 cursor-pointer group/node relative",
                                            isActive ? (isBreachMode ? "bg-red-500/20 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]" : "bg-emerald-500/20 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]") :
                                                isCompleted ? (isBreachMode ? "bg-red-500/10 border-red-500/50 hover:border-red-500" : "bg-emerald-500/10 border-emerald-500/50 hover:border-emerald-500") :
                                                    "bg-slate-900 border-slate-800 hover:border-slate-600"
                                        )}
                                    >
                                        <Icon className={cn(
                                            "w-5 h-5 transition-colors duration-500 group-hover/node:scale-110",
                                            isActive ? (isBreachMode ? "text-red-400" : "text-emerald-400") :
                                                isCompleted ? (isBreachMode ? "text-red-500" : "text-emerald-500") : "text-slate-600"
                                        )} />

                                        {/* Vulnerability Indicator */}
                                        {node.vulnerability && !isCompleted && (
                                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-slate-900 animate-bounce" title="Vulnerability Detected" />
                                        )}

                                        {isActive && (
                                            <motion.div
                                                className={cn("absolute inset-0 rounded-xl border-2", isBreachMode ? "border-red-500/50" : "border-emerald-500/50")}
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
                                        {/* Vulnerability Alert Section */}
                                        {currentNodes.find(n => n.id === selectedNodeId)?.vulnerability && (
                                            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <ShieldAlert className="w-4 h-4 text-red-500" />
                                                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-red-500">Security Breach Risk</h4>
                                                </div>
                                                <p className="text-xs text-slate-300 font-medium mb-3">
                                                    {currentNodes.find(n => n.id === selectedNodeId)?.vulnerability?.title}:
                                                    <span className="text-slate-500 font-normal"> {currentNodes.find(n => n.id === selectedNodeId)?.vulnerability?.description}</span>
                                                </p>

                                                {!remediationScript ? (
                                                    <button
                                                        onClick={() => runRemediation(currentNodes.find(n => n.id === selectedNodeId)?.vulnerability)}
                                                        disabled={isRemediating}
                                                        className="w-full py-2 bg-red-500 hover:bg-red-400 disabled:bg-slate-800 text-black text-[10px] font-bold uppercase tracking-[0.2em] rounded transition-all flex items-center justify-center gap-2"
                                                    >
                                                        {isRemediating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 fill-current" />}
                                                        {isRemediating ? "Analyzing with Cloud Brain..." : "Remediate with AI"}
                                                    </button>
                                                ) : (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: "auto" }}
                                                        className="space-y-3 pt-2"
                                                    >
                                                        <div className="flex items-center gap-2 text-[10px] text-emerald-500 font-bold uppercase">
                                                            <CheckCircle2 className="w-3.5 h-3.5" /> Fix Generated
                                                        </div>
                                                        <div className="bg-black/90 border border-emerald-500/30 rounded-lg overflow-hidden group relative">
                                                            <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
                                                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Remediation Script</span>
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        onClick={() => {
                                                                            navigator.clipboard.writeText(remediationScript.script);
                                                                            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Script copied to clipboard`]);
                                                                        }}
                                                                        className="p-1 hover:bg-white/10 rounded transition-colors text-slate-500 hover:text-emerald-500"
                                                                        title="Copy to Clipboard"
                                                                    >
                                                                        <Code className="w-3 h-3" />
                                                                    </button>
                                                                    <button onClick={() => setRemediationScript(null)} className="p-1 hover:bg-white/10 rounded transition-colors text-slate-500 hover:text-red-500">
                                                                        <X className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="p-4 font-mono text-[10px] text-emerald-400 overflow-x-auto custom-scrollbar">
                                                                <pre className="whitespace-pre-wrap break-all leading-relaxed">
                                                                    {remediationScript.script}
                                                                </pre>
                                                            </div>
                                                        </div>
                                                        <p className="text-[10px] text-slate-400 italic">
                                                            {remediationScript.explanation}
                                                        </p>
                                                        <button
                                                            onClick={() => {
                                                                setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] AI Remediation applied to ${selectedNodeId}`]);
                                                                setRemediationScript(null);
                                                            }}
                                                            className="w-full py-2 border border-emerald-500/50 text-emerald-500 text-[10px] font-bold uppercase tracking-widest rounded hover:bg-emerald-500/10 transition-all"
                                                        >
                                                            Apply Fix to Infrastructure
                                                        </button>
                                                    </motion.div>
                                                )}
                                            </div>
                                        )}

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
                                            <div className="space-y-1">
                                                {/* Initial Pod Boot/Status Logs */}
                                                {(selectedNodeDetail.pods.find((p: any) => p.name === (selectedPodName || selectedNodeDetail.pods[0].name))?.logs || []).map((line: string, i: number) => (
                                                    <div key={`init-${i}`} className="text-slate-500 opacity-60">
                                                        <span className="text-slate-700 mr-2">{"#"}</span>
                                                        {line}
                                                    </div>
                                                ))}

                                                {/* Dynamic Trace Logs from Backend */}
                                                {outputJson?.trace?.filter((t: any) =>
                                                    t.component.toLowerCase().includes(selectedNodeId?.toLowerCase() || "") ||
                                                    (selectedNodeId === "gke-pods" && t.component === "GKE Pod") ||
                                                    (selectedNodeId === "gcp-lb" && t.component === "Load Balancer") ||
                                                    (selectedNodeId === "gateway" && t.component === "API Gateway") ||
                                                    (selectedNodeId === "storage" && t.component === "Cloud SQL")
                                                ).map((step: any, i: number) => (
                                                    <div key={`trace-${i}`} className="text-emerald-400 border-l-2 border-emerald-500/30 pl-3 py-1 my-2 bg-emerald-500/5">
                                                        <div className="flex items-center gap-2 mb-0.5">
                                                            <span className="text-[9px] text-emerald-600 font-bold">[{new Date(step.time).toLocaleTimeString()}]</span>
                                                            <span className="text-[9px] uppercase tracking-widest px-1 bg-emerald-500/20 rounded text-emerald-400">{step.status}</span>
                                                        </div>
                                                        <div className="text-[10px] font-bold">
                                                            {step.component}: <span className="text-slate-200 font-normal">{step.action}</span>
                                                        </div>
                                                    </div>
                                                ))}

                                                {isRunning && activeNodeIndex === currentNodes.findIndex(n => n.id === selectedNodeId) && (
                                                    <div className="flex items-center gap-2 text-emerald-500 animate-pulse pt-2">
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                        <span className="text-[10px] font-bold uppercase tracking-widest">Processing Layer...</span>
                                                    </div>
                                                )}
                                            </div>
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
