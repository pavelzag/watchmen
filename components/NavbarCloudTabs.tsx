"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavbarCloudTabs() {
  const pathname = usePathname();
  const isAws = pathname.startsWith("/dashboard/aws");

  return (
    <div className="flex items-center" style={{ borderRight: "1px solid #003010", marginRight: "4px", paddingRight: "4px" }}>
      <Link
        href="/dashboard"
        className="flex items-center gap-1 px-3 h-full text-xs uppercase tracking-widest transition-colors"
        style={{
          color: !isAws ? "#00ff41" : "#005c16",
          background: !isAws ? "#0a1a0a" : "transparent",
          borderRight: "1px solid #0a1a0a",
          height: "100%",
          display: "flex",
          alignItems: "center",
        }}
      >
        [GCP]
      </Link>
      <Link
        href="/dashboard/aws"
        className="flex items-center gap-1 px-3 h-full text-xs uppercase tracking-widest transition-colors"
        style={{
          color: isAws ? "#f97316" : "#5c3010",
          background: isAws ? "#1a0d00" : "transparent",
          borderRight: "1px solid #0a1a0a",
          height: "100%",
          display: "flex",
          alignItems: "center",
        }}
      >
        [AWS]
      </Link>
    </div>
  );
}
