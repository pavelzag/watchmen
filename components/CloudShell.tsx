"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, X, Minimize2, Maximize2, Command, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CloudShellProps {
    isOpen: boolean;
    onClose: () => void;
    contextNode?: string;
}

export default function CloudShell({ isOpen, onClose, contextNode }: CloudShellProps) {
    const [history, setHistory] = useState<{ type: "cmd" | "out" | "err"; content: string }[]>([
        { type: "out", content: "Watchmen Cloud Shell v1.0.4 (Authenticated)" },
        { type: "out", content: "Type 'help' for available commands." }
    ]);
    const [input, setInput] = useState("");
    const [isMaximized, setIsMaximized] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
            if (contextNode) {
                setHistory(prev => [...prev, { type: "out", content: `Context switched to: ${contextNode}` }]);
            }
        }
    }, [isOpen, contextNode]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [history]);

    const handleCommand = (e: React.FormEvent) => {
        e.preventDefault();
        const cmd = input.trim().toLowerCase();
        if (!cmd) return;

        setHistory(prev => [...prev, { type: "cmd", content: input }]);
        setInput("");

        // Simulation Logic
        setTimeout(() => {
            if (cmd === "help") {
                setHistory(prev => [...prev, { type: "out", content: "Available: gcloud, kubectl, aws, terraform, status, clear" }]);
            } else if (cmd === "clear") {
                setHistory([{ type: "out", content: "Terminal cleared." }]);
            } else if (cmd.startsWith("kubectl get pods")) {
                setHistory(prev => [...prev, { type: "out", content: "NAME                     READY   STATUS    RESTARTS   AGE\nwatchmen-api-6f4b-1    1/1     Running   0          4d\nwatchmen-api-6f4b-2    1/1     Running   1          12h" }]);
            } else if (cmd.includes("gcloud")) {
                setHistory(prev => [...prev, { type: "out", content: "Project: gke-wm-test-cluster-wm-test\nRegion: us-central1\nStatus: ACTIVE" }]);
            } else if (cmd.includes("aws s3 ls")) {
                setHistory(prev => [...prev, { type: "out", content: "2026-03-01 12:00:00  wm-prod-backups\n2026-03-05 09:12:33  wm-static-assets" }]);
            } else {
                setHistory(prev => [...prev, { type: "err", content: `Command not found: ${cmd}` }]);
            }
        }, 100);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ y: "100%" }}
                    animate={{ y: isMaximized ? "0%" : "60%" }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    className={cn(
                        "fixed bottom-0 left-0 right-0 z-[200] bg-black border-t-2 border-emerald-500/30 flex flex-col shadow-[0_-20px_50px_rgba(0,0,0,0.8)]",
                        isMaximized ? "top-0 h-full" : "h-[40vh]"
                    )}
                >
                    {/* Shell Header */}
                    <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-white/5">
                        <div className="flex items-center gap-3">
                            <Terminal className="w-4 h-4 text-emerald-500" />
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-500/80 flex items-center gap-2">
                                Cloud Shell
                                <span className="text-slate-600 font-normal">[{contextNode || "Global"}]</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => setIsMaximized(!isMaximized)} className="p-1.5 hover:bg-white/5 rounded transition-colors text-slate-500">
                                {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={onClose} className="p-1.5 hover:bg-red-500/20 rounded transition-colors text-slate-500 hover:text-red-500">
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Shell Content */}
                    <div
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto p-4 font-mono text-xs custom-scrollbar"
                    >
                        {history.map((line, i) => (
                            <div key={i} className={cn(
                                "mb-1 whitespace-pre-wrap flex gap-2",
                                line.type === "cmd" ? "text-white" : line.type === "err" ? "text-red-400" : "text-emerald-500/80"
                            )}>
                                {line.type === "cmd" && <span className="text-emerald-500 font-bold">$</span>}
                                <span>{line.content}</span>
                            </div>
                        ))}
                        <form onSubmit={handleCommand} className="flex items-center gap-2">
                            <span className="text-emerald-500 font-bold">$</span>
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                className="flex-1 bg-transparent border-none outline-none text-white"
                                spellCheck={false}
                                autoComplete="off"
                            />
                        </form>
                    </div>

                    {/* Shell Footer */}
                    <div className="px-4 py-1.5 bg-slate-900/30 border-t border-white/5 flex items-center justify-between text-[9px] text-slate-600 font-mono">
                        <div className="flex gap-4">
                            <span>SESSION: wm-admin-2026</span>
                            <span>USER: {contextNode ? `infra-mgr@${contextNode}` : "admin@watchmen.cloud"}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <ChevronRight className="w-3 h-3" />
                            Ready
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
