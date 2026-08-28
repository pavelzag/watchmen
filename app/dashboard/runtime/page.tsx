import RuntimeSecurityPanel from "../trace/RuntimeSecurityPanel";

export default function RuntimePage() {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#02040a]">
      <div className="flex-1 flex flex-col p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="text-emerald-500 font-mono">//</span>
              RUNTIME SECURITY
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Review live request decisions, matched alerts, and detect-only runtime policy rules.
            </p>
          </div>
          <div className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-[10px] uppercase tracking-widest text-amber-300">
            Detect Only
          </div>
        </div>

        <RuntimeSecurityPanel />
      </div>
    </div>
  );
}
