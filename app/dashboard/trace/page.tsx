import TraceClient from "./TraceClient";
import LiveTraces from "./LiveTraces";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default async function TracePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "live" ? "live" : "tracer";

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#02040a]">
      <div className="flex-1 flex flex-col p-6 overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="text-emerald-500 font-mono">//</span>
              {tab === "live" ? "LIVE TRACES" : "REQUEST TRACER"}
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              {tab === "live"
                ? "Incoming requests from GCP Cloud Trace — last 1 hour"
                : "Visualize data transformation across your cloud infrastructure"}
            </p>
          </div>

          {tab === "tracer" && (
            <div className="flex items-center gap-4">
              <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10px] uppercase tracking-widest text-emerald-400">
                Go Service: ACTIVE
              </div>
              <div className="px-3 py-1 bg-sky-500/10 border border-sky-500/20 rounded text-[10px] uppercase tracking-widest text-sky-400">
                Nodes: 5
              </div>
            </div>
          )}
        </div>

        {/* tab bar */}
        <div className="flex gap-1 mb-6 border-b border-white/[0.06]">
          <Link
            href="/dashboard/trace?tab=tracer"
            className={cn(
              "px-4 py-2 text-xs font-medium tracking-wide transition-colors border-b-2 -mb-px",
              tab === "tracer"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            )}
          >
            REQUEST TRACER
          </Link>
          <Link
            href="/dashboard/trace?tab=live"
            className={cn(
              "px-4 py-2 text-xs font-medium tracking-wide transition-colors border-b-2 -mb-px",
              tab === "live"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            )}
          >
            LIVE TRACES
          </Link>
        </div>

        {tab === "live" ? <LiveTraces /> : <TraceClient />}
      </div>
    </div>
  );
}
