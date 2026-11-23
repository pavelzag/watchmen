"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavbarCloudTabs() {
  const pathname = usePathname();

  // Specific sub-menus that should dim the cloud tabs
  const isSubMenu = ["/trace", "/findings", "/attack-paths", "/container-scan", "/tasks", "/history", "/compliance", "/settings"].some(sub =>
    pathname.includes(sub)
  );

  const isDashboardActive = pathname === "/dashboard" && !isSubMenu;

  return (
    <div className="flex items-center h-full shrink-0">
      <Link
        href="/dashboard"
        className="flex items-center gap-1.5 px-3 md:px-3.5 h-full text-xs uppercase tracking-widest transition-colors whitespace-nowrap shrink-0 terminal-nav-link"
        style={{
          color: isDashboardActive ? "var(--text-primary)" : "var(--text-muted)",
          background: isDashboardActive ? "var(--bg-card2)" : "transparent",
          boxShadow: isDashboardActive ? "0 0 18px #00ff4166" : undefined,
        }}
      >
        DASHBOARD
      </Link>
    </div>
  );
}
