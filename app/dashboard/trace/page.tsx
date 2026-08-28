import RequestTracer from "./RequestTracer";

export default function TracePage() {
  const demoMode = process.env.DEMO_MODE === "true";
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#02040a]">
      <div className="flex-1 flex flex-col p-6 overflow-hidden">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="text-emerald-500 font-mono">//</span>
              REQUEST TRACER
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Send a request and watch it flow through your real AWS and GCP infrastructure
            </p>
          </div>
          <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-[10px] uppercase tracking-widest text-emerald-400">
            Live Topology
          </div>
        </div>

        <RequestTracer demoMode={demoMode} />
      </div>
    </div>
  );
}
