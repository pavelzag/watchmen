"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, ShieldAlert, Search, Clock, ClipboardCheck, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard",            icon: LayoutDashboard, label: "Dashboard",  exact: true  },
  { href: "/dashboard/findings",   icon: ShieldAlert,     label: "Findings",   highlight: true },
  { href: "/dashboard/principal",  icon: Search,          label: "Principal"  },
  { href: "/dashboard/history",    icon: Clock,           label: "History"    },
  { href: "/dashboard/compliance", icon: ClipboardCheck,  label: "Compliance" },
  { href: "/dashboard/settings",   icon: Settings,        label: "Settings"   },
] as const;

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {NAV_ITEMS.map(({ href, icon: Icon, label, ...rest }) => {
        const exact = "exact" in rest ? rest.exact : false;
        const highlight = "highlight" in rest ? rest.highlight : false;
        const isActive = exact ? pathname === href : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-150",
              isActive
                ? "text-white bg-zinc-800"
                : highlight
                ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </Link>
        );
      })}
    </>
  );
}
