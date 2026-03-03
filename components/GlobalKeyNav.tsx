"use client";

import { useEffect } from "react";

const SEL = "nav-selected";

/**
 * Adds/removes the `nav-selected` CSS class instead of relying on browser
 * focus(), giving us full control over the visual selection indicator.
 * Uses { capture: true } to intercept ArrowUp/Down before the browser
 * can scroll, regardless of what else is on the page.
 */
export default function GlobalKeyNav() {
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
            const tag = (e.target as HTMLElement).tagName;
            if (
                tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
                (e.target as HTMLElement).isContentEditable
            ) return;

            const all = items();
            if (all.length === 0) return;

            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const cur = current();
                const idx = cur ? all.indexOf(cur) : -1;
                if (e.key === "ArrowDown") {
                    select(all[idx < all.length - 1 ? idx + 1 : 0]);
                } else {
                    select(all[idx > 0 ? idx - 1 : all.length - 1]);
                }
            }

            if (e.key === "Enter") {
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
        window.addEventListener("keydown", handleKeyDown, { capture: true });
        return () =>
            window.removeEventListener("keydown", handleKeyDown, { capture: true });
    }, []);

    return null;
}
