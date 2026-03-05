import TraceClient from "./TraceClient";

export default function TracePage() {
    return (
        <div className="flex-1 flex flex-col min-h-0 bg-[#02040a]">
            <div className="flex-1 flex flex-col p-6 overflow-hidden">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                            <span className="text-emerald-500 font-mono">//</span> REQUEST TRACER
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">
                            Visualize data transformation across your cloud infrastructure
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10px] uppercase tracking-widest text-emerald-400">
                            Go Service: ACTIVE
                        </div>
                        <div className="px-3 py-1 bg-sky-500/10 border border-sky-500/20 rounded text-[10px] uppercase tracking-widest text-sky-400">
                            Nodes: 5
                        </div>
                    </div>
                </div>

                <TraceClient />
            </div>
        </div>
    );
}
