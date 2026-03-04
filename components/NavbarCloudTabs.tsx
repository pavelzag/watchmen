"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavbarCloudTabs() {
  const pathname = usePathname();

  // Specific sub-menus that should dim the cloud tabs
  const isSubMenu = ["/findings", "/history", "/compliance", "/settings"].some(sub =>
    pathname.includes(sub)
  );

  const isAwsContext = pathname?.startsWith("/dashboard/aws") ?? false;
  const isAwsActive = isAwsContext && !isSubMenu;
  const isGcpActive = !isAwsContext && pathname?.startsWith("/dashboard") && !isSubMenu;

  return (
    <div className="flex items-center h-full">
      <Link
        href="/dashboard"
        className="flex items-center gap-1.5 px-3 h-full text-xs uppercase tracking-widest transition-colors border-r"
        style={{
          color: isGcpActive ? "var(--text-primary)" : "var(--text-muted)",
          background: isGcpActive ? "var(--bg-card2)" : "transparent",
          borderColor: "var(--bg-card2)",
        }}
      >
        GCP
      </Link>
      <Link
        href="/dashboard/aws"
        className="flex items-center gap-1.5 px-3 h-full text-xs uppercase tracking-widest transition-colors border-r"
        style={{
          color: isAwsActive ? "var(--text-primary)" : "var(--text-muted)",
          background: isAwsActive ? "var(--bg-card2)" : "transparent",
          borderColor: "var(--bg-card2)",
        }}
      >
        AWS
      </Link>
    </div>
  );
}
