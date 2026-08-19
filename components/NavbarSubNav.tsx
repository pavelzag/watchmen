"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import NavbarCloudTabs from "./NavbarCloudTabs";

const NAV_ITEMS = [
    { href: "/dashboard", label: "DASHBOARD" },
    { href: "/dashboard/self-managed", label: "SELF-MANAGED" },
    { href: "/dashboard/trace", label: "TRACE" },
    { href: "/dashboard/findings", label: "FINDINGS" },
    { href: "/dashboard/attack-paths", label: "ATTACK PATHS" },
    { href: "/dashboard/container-scan", label: "CONTAINERS" },
    { href: "/dashboard/tasks", label: "TASKS" },
    { href: "/dashboard/history", label: "HISTORY" },
    { href: "/dashboard/compliance", label: "COMPLIANCE" },
    { href: "/dashboard/settings", label: "SETTINGS" },
];

export default function NavbarSubNav({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input
            if (
                document.activeElement instanceof HTMLInputElement ||
                document.activeElement instanceof HTMLTextAreaElement ||
                (document.activeElement as HTMLElement)?.isContentEditable
            ) {
                return;
            }

            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const currentIndex = NAV_ITEMS.findIndex(item =>
                    item.href === "/dashboard"
                        ? pathname === item.href || pathname === "/dashboard/aws"
                        : pathname.startsWith(item.href)
                );

                if (currentIndex === -1) return;

                let nextIndex;
                if (e.key === "ArrowRight") {
                    nextIndex = (currentIndex + 1) % NAV_ITEMS.length;
                } else {
                    nextIndex = (currentIndex - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
                }

                router.push(NAV_ITEMS[nextIndex].href);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [pathname, router]);

    return (
        <div
            className="max-w-7xl mx-auto px-4 md:px-6 h-8 flex items-center gap-0 overflow-x-auto no-scrollbar scroll-smooth"
            style={{ borderTop: "1px solid var(--bg-card2)" }}
        >
            <NavbarCloudTabs />
            {children}
        </div>
    );
}
