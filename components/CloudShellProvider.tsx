"use client";

import { useState, useEffect } from "react";
import CloudShell from "./CloudShell";

export default function CloudShellProvider({ children }: { children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Toggle with ~ (tilde) or Ctrl+`
            if (e.key === "`" || (e.ctrlKey && e.key === "`")) {
                e.preventDefault();
                setIsOpen(prev => !prev);
            }
            if (e.key === "Escape" && isOpen) {
                setIsOpen(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen]);

    return (
        <>
            {children}
            <CloudShell isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
}
