"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";

const SEL = "nav-selected";

const ROUTE_SHORTCUTS = [
    { key: "G", href: "/dashboard", label: "GCP menu" },
    { key: "A", href: "/dashboard/aws", label: "AWS menu" },
    { key: "T", href: "/dashboard/tasks", label: "Tasks menu" },
    { key: "R", href: "/dashboard/trace", label: "Trace menu" },
    { key: "F", href: "/dashboard/findings", label: "Findings" },
    { key: "P", href: "/dashboard/attack-paths", label: "Attack Paths" },
    { key: "D", href: "/dashboard/container-scan", label: "Containers" },
    { key: "C", href: "/dashboard/compliance", label: "Compliance" },
    { key: "H", href: "/dashboard/history", label: "History" },
    { key: "S", href: "/dashboard/settings", label: "Settings" },
];

const HELP_SHORTCUTS = [
    ...ROUTE_SHORTCUTS,
    { key: "?", href: "", label: "Show keyboard shortcuts" },
    { key: "/", href: "", label: "Open cloud brain query" },
    { key: "↑ / ↓", href: "", label: "Move selected item" },
    { key: "← / →", href: "", label: "Move between top navigation tabs" },
    { key: "Enter", href: "", label: "Open selected item" },
    { key: "Esc", href: "", label: "Close dialogs" },
];

function normalizedShortcutKey(event: KeyboardEvent): string {
    if (event.code.startsWith("Key") && event.code.length === 4) {
        return event.code.slice(3).toUpperCase();
    }
    return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Adds/removes the `nav-selected` CSS class instead of relying on browser
 * focus(), giving us full control over the visual selection indicator.
 * Uses { capture: true } to intercept ArrowUp/Down before the browser
 * can scroll, regardless of what else is on the page.
 */
export default function GlobalKeyNav() {
    const router = useRouter();
    const [helpOpen, setHelpOpen] = useState(false);
    const [shortcutHit, setShortcutHit] = useState<{ key: string; label: string } | null>(null);
    const shortcutHitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    function flashShortcut(key: string, label: string) {
        if (shortcutHitTimeoutRef.current) {
            clearTimeout(shortcutHitTimeoutRef.current);
        }
        setShortcutHit({ key, label });
        shortcutHitTimeoutRef.current = setTimeout(() => {
            setShortcutHit(null);
            shortcutHitTimeoutRef.current = null;
        }, 650);
    }

    useEffect(() => {
        function items(): HTMLElement[] {
            return Array.from(document.querySelectorAll("[data-nav]")) as HTMLElement[];
        }

        function current(): HTMLElement | null {
            return document.querySelector(`.${SEL}`);
        }

        function select(el: HTMLElement | null) {
            items().forEach((i) => i.classList.remove(SEL));
            if (!el) return;
            el.classList.add(SEL);
            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }

        function handleKeyDown(e: KeyboardEvent) {
            // Never intercept when the user is typing
            if (isTypingTarget(e.target)) return;

            if (e.key === "Escape" && helpOpen) {
                e.preventDefault();
                setHelpOpen(false);
                return;
            }

            const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
            const shortcutKey = normalizedShortcutKey(e);

            if (!hasModifier && (e.key === "?" || (e.shiftKey && e.key === "/"))) {
                e.preventDefault();
                flashShortcut("?", "Keyboard shortcuts");
                setHelpOpen(true);
                return;
            }

            if (!hasModifier) {
                const shortcut = ROUTE_SHORTCUTS.find((item) => item.key === shortcutKey);
                if (shortcut) {
                    e.preventDefault();
                    flashShortcut(shortcut.key, shortcut.label);
                    setHelpOpen(false);
                    router.push(shortcut.href);
                    return;
                }
            }

            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                const all = items();
                if (all.length === 0) return;
                e.preventDefault();
                const cur = current();
                const idx = cur ? all.indexOf(cur) : -1;
                if (e.key === "ArrowDown") {
                    select(all[idx < all.length - 1 ? idx + 1 : 0]);
                } else {
                    select(all[idx > 0 ? idx - 1 : all.length - 1]);
                }
            }

            if (e.key === "/") {
                const queryInput = document.getElementById("query-input") as HTMLTextAreaElement | null;
                if (queryInput) {
                    e.preventDefault();
                    flashShortcut("/", "Cloud brain query");
                    queryInput.focus();
                    queryInput.setSelectionRange(queryInput.value.length, queryInput.value.length);
                }
            }

            if (e.key === "Enter") {
                const all = items();
                if (all.length === 0) return;
                const cur = current();
                if (!cur) return;
                // Navigate: if the selected element is an <a>, click it;
                // otherwise find the first <a> inside it.
                const link =
                    cur.tagName === "A"
                        ? (cur as HTMLAnchorElement)
                        : cur.querySelector<HTMLAnchorElement>("a");
                if (link) {
                    e.preventDefault();
                    link.click();
                } else {
                    cur.click();
                }
            }

        }

        // capture: true → fires before scroll, textarea keydown, etc.
        document.addEventListener("keydown", handleKeyDown, { capture: true });
        return () =>
            document.removeEventListener("keydown", handleKeyDown, { capture: true });
    }, [helpOpen, router]);

    useEffect(() => {
        return () => {
            if (shortcutHitTimeoutRef.current) {
                clearTimeout(shortcutHitTimeoutRef.current);
            }
        };
    }, []);

    if (!helpOpen && !shortcutHit) return null;

    return (
        <>
            {shortcutHit && (
                <div
                    key={`${shortcutHit.key}-${shortcutHit.label}`}
                    className="fixed left-1/2 top-1/2 z-[10000] flex items-center gap-3 px-4 py-3 text-xs font-mono uppercase tracking-widest pointer-events-none"
                    style={{
                        border: "1px solid #00ff41",
                        background: "#050d05",
                        color: "#00ff41",
                        boxShadow: "0 0 24px #00ff4144",
                        animation: "shortcut-hit 650ms ease-out both",
                    }}
                >
                    <span
                        className="px-2 py-1 text-[10px]"
                        style={{ border: "1px solid #005c16", background: "#090909" }}
                    >
                        {shortcutHit.key}
                    </span>
                    <span>{shortcutHit.label}</span>
                </div>
            )}
            <style jsx global>{`
                @keyframes shortcut-hit {
                    0% {
                        opacity: 0;
                        transform: translate(-50%, calc(-50% - 8px)) scale(0.98);
                    }
                    14% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                    72% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                    100% {
                        opacity: 0;
                        transform: translate(-50%, calc(-50% - 4px)) scale(0.98);
                    }
                }
            `}</style>
            {helpOpen && (
                <div
                    className="fixed inset-0 z-[9998] flex items-start justify-center px-4 pt-24"
                    style={{ background: "rgba(0,0,0,0.82)" }}
                    onClick={(event) => {
                        if (event.target === event.currentTarget) setHelpOpen(false);
                    }}
                >
                    <div
                        className="w-full max-w-lg"
                        style={{ border: "1px solid #00ff41", background: "#090909", boxShadow: "0 0 36px #00ff4133" }}
                    >
                        <div
                            className="flex items-center justify-between px-4 py-2 text-xs"
                            style={{ borderBottom: "1px solid #005c16" }}
                        >
                            <span className="uppercase tracking-widest" style={{ color: "#00ff41" }}>
                                // Keyboard Shortcuts
                            </span>
                            <button
                                type="button"
                                onClick={() => setHelpOpen(false)}
                                className="p-1"
                                style={{ color: "#00ff41" }}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                        <div className="p-4 space-y-2">
                            {HELP_SHORTCUTS.map((shortcut) => (
                                <div
                                    key={`${shortcut.key}-${shortcut.label}`}
                                    className="flex items-center justify-between gap-4 text-xs font-mono"
                                >
                                    <span style={{ color: "#e5e7eb" }}>{shortcut.label}</span>
                                    <span
                                        className="px-2 py-1 text-[10px] uppercase tracking-widest"
                                        style={{ border: "1px solid #005c16", color: "#00ff41", minWidth: 64, textAlign: "center" }}
                                    >
                                        {shortcut.key}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="px-4 py-2 text-[10px] font-mono" style={{ borderTop: "1px solid #003010", color: "#005c16" }}>
                            Shortcuts are ignored while typing in inputs, textareas, and editors.
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
