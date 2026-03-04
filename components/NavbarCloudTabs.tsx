"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavbarCloudTabs() {
  const pathname = usePathname();
  const isAws = pathname?.startsWith("/dashboard/aws") ?? false;

  return (
    <div className="flex items-center" style={{ borderRight: "1px solid var(--bg-card2)", marginRight: "4px", paddingRight: "4px" }}>
      <Link
        href="/dashboard"
        className="flex items-center gap-1 px-2 md:px-3 h-full text-[10px] md:text-xs uppercase tracking-widest transition-colors border-r"
        style={{
          color: !isAws ? "var(--text-primary)" : "var(--text-muted)",
          background: !isAws ? "var(--bg-card2)" : "transparent",
          borderColor: "var(--bg-card2)",
          height: "100%",
          display: "flex",
          alignItems: "center",
        }}
      >
        GCP
      </Link>
      <Link
        href="/dashboard/aws"
        className="flex items-center gap-1 px-2 md:px-3 h-full text-[10px] md:text-xs uppercase tracking-widest transition-colors border-r"
        style={{
          color: isAws ? "var(--text-primary)" : "var(--text-muted)",
          background: isAws ? "var(--bg-card2)" : "transparent",
          borderColor: "var(--bg-card2)",
          height: "100%",
          display: "flex",
          alignItems: "center",
        }}
      >
        AWS
      </Link>
    </div>
  );
}
