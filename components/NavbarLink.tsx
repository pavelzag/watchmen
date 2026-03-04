"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

interface NavbarLinkProps {
    href: string;
    icon: React.ReactNode;
    label: string;
    danger?: boolean;
}

export default function NavbarLink({ href, icon, label, danger }: NavbarLinkProps) {
    const pathname = usePathname();
    const isActive = pathname.startsWith(href);

    return (
        <Link
            href={href}
            className={`flex items-center gap-1.5 px-3 h-full text-xs uppercase tracking-widest transition-colors ${danger ? "terminal-nav-link-danger" : "terminal-nav-link"
                }`}
            style={{
                borderRight: "1px solid var(--bg-card2)",
                background: isActive ? "var(--bg-card2)" : "transparent",
                color: isActive ? "var(--text-primary)" : undefined,
            }}
        >
            {icon}
            <span className="hidden sm:inline">{label}</span>
        </Link>
    );
}
