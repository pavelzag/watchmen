"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Server } from "lucide-react";
import NavbarCloudTabs from "./NavbarCloudTabs";
import NavbarLink from "./NavbarLink";
import { SELF_MANAGED_CLUSTERS_CHANGED_EVENT } from "@/lib/kubernetes/cluster-events";

const NAV_ITEMS = [
    { href: "/dashboard", label: "DASHBOARD" },
    { href: "/dashboard/self-managed", label: "SELF-MANAGED" },
    { href: "/dashboard/trace", label: "TRACE" },
    { href: "/dashboard/runtime", label: "RUNTIME" },
    { href: "/dashboard/findings", label: "FINDINGS" },
    { href: "/dashboard/attack-paths", label: "ATTACK PATHS" },
    { href: "/dashboard/container-scan", label: "CONTAINERS" },
    { href: "/dashboard/history", label: "HISTORY" },
    { href: "/dashboard/compliance", label: "COMPLIANCE" },
    { href: "/dashboard/settings", label: "SETTINGS" },
];

export default function NavbarSubNav({
    children,
    initialHasSelfManaged = false,
}: {
    children: React.ReactNode;
    initialHasSelfManaged?: boolean;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [hasSelfManaged, setHasSelfManaged] = useState(initialHasSelfManaged);

    useEffect(() => {
        setHasSelfManaged(initialHasSelfManaged);
    }, [initialHasSelfManaged]);

    useEffect(() => {
        const handleClustersChanged = (event: Event) => {
            const detail = (event as CustomEvent<{ hasClusters?: boolean }>).detail;
            if (typeof detail?.hasClusters === "boolean") {
                setHasSelfManaged(detail.hasClusters);
                return;
            }
            fetch("/api/kubernetes/clusters", { cache: "no-store" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => {
                    if (d && Array.isArray(d.clusters)) {
                        setHasSelfManaged(d.clusters.length > 0);
                    }
                })
                .catch(() => {});
        };

        window.addEventListener(SELF_MANAGED_CLUSTERS_CHANGED_EVENT, handleClustersChanged);
        return () => window.removeEventListener(SELF_MANAGED_CLUSTERS_CHANGED_EVENT, handleClustersChanged);
    }, []);

    const navItems = useMemo(
        () => (hasSelfManaged ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.href !== "/dashboard/self-managed")),
        [hasSelfManaged]
    );

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
                const currentIndex = navItems.findIndex(item =>
                    item.href === "/dashboard"
                        ? pathname === item.href || pathname === "/dashboard/aws"
                        : pathname.startsWith(item.href)
                );

                if (currentIndex === -1) return;

                let nextIndex;
                if (e.key === "ArrowRight") {
                    nextIndex = (currentIndex + 1) % navItems.length;
                } else {
                    nextIndex = (currentIndex - 1 + navItems.length) % navItems.length;
                }

                router.push(navItems[nextIndex].href);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [navItems, pathname, router]);

    return (
        <div
            className="max-w-7xl mx-auto px-4 md:px-6 h-9 flex items-center overflow-x-auto no-scrollbar scroll-smooth"
            style={{ borderTop: "1px solid var(--bg-card2)" }}
        >
            <nav
                aria-label="Dashboard navigation"
                className="mx-auto flex items-center justify-center gap-1 sm:gap-2 md:gap-3 h-full shrink-0"
            >
                <NavbarCloudTabs />
                {hasSelfManaged && (
                    <NavbarLink href="/dashboard/self-managed" icon={<Server className="w-3 h-3" />} label="SELF-MANAGED" />
                )}
                {children}
            </nav>
        </div>
    );
}
