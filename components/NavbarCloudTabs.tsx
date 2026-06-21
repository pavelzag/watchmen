"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavbarCloudTabs() {
  const pathname = usePathname();

  const isAwsContext = pathname?.startsWith("/dashboard/aws") ?? false;
  const isGcpDashboard = pathname === "/dashboard";

  return (
    <div
      className="hidden md:flex items-center gap-1 px-1.5 py-1 border"
      style={{ borderColor: "var(--border-dim)", background: "var(--bg-card)" }}
      aria-label="Cloud dashboard view"
    >
      <span className="px-2 text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        Cloud View
      </span>
      <Link
        href="/dashboard"
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-widest transition-colors"
        style={{
          color: isGcpDashboard ? "var(--text-primary)" : "var(--text-muted)",
          background: isGcpDashboard ? "var(--bg-card2)" : "transparent",
          boxShadow: isGcpDashboard ? "0 0 18px #00ff4166" : undefined,
        }}
      >
        GCP
      </Link>
      <Link
        href="/dashboard/aws"
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-widest transition-colors"
        style={{
          color: isAwsContext ? "var(--text-primary)" : "var(--text-muted)",
          background: isAwsContext ? "var(--bg-card2)" : "transparent",
          boxShadow: isAwsContext ? "0 0 18px #00ff4166" : undefined,
        }}
      >
        AWS
      </Link>
    </div>
  );
}
