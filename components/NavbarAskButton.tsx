"use client";

import { openCommandPalette } from "./CommandPalette";
import { MessageSquare } from "lucide-react";

export default function NavbarAskButton() {
    return (
        <button
            onClick={() => openCommandPalette()}
            className="terminal-btn flex items-center gap-1.5 px-3 py-1 text-xs uppercase tracking-widest"
            title="Press '/' anywhere to open"
        >
            <MessageSquare className="w-3 h-3" />
            [&gt; ASK AI]
        </button>
    );
}
