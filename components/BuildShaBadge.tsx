import { getBuildSha } from "@/lib/deployment-info";

/**
 * Small fixed footer tag showing the exact build SHA of the running deployment
 * (baked in at image build time). Hidden on local dev where no SHA is set.
 */
export default function BuildShaBadge() {
  const sha = getBuildSha();
  if (!sha) return null;

  return (
    <div
      aria-label={`Build ${sha}`}
      title={`Build ${sha}`}
      className="fixed bottom-1 left-3 z-40 pointer-events-none select-none text-[9px] font-mono uppercase tracking-widest"
      style={{ color: "var(--text-muted)", opacity: 0.45 }}
    >
      build {sha}
    </div>
  );
}
