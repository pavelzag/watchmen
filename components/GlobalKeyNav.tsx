"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import KeyboardShortcutsModal, { ROUTE_SHORTCUTS } from "./KeyboardShortcutsModal";

const SEL = "nav-selected";

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

function isCommandPaletteOpen(): boolean {
    return Boolean(document.querySelector("[data-command-palette-open='true']"));
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
            if (isCommandPaletteOpen()) return;

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
            {helpOpen && <KeyboardShortcutsModal onClose={() => setHelpOpen(false)} />}
        </>
    );
}
