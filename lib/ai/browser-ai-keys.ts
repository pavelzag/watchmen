"use client";

import { type AIProvider } from "./client";

const BROWSER_KEYS_STORAGE_KEY = "watchmen_browser_ai_keys";

export interface BrowserAIKeys {
    [provider: string]: string;
}

export function getBrowserAIKeys(): BrowserAIKeys {
    if (typeof window === "undefined") return {};
    try {
        const stored = localStorage.getItem(BROWSER_KEYS_STORAGE_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
}

export function setBrowserAIKey(provider: AIProvider, apiKey: string): void {
    const keys = getBrowserAIKeys();
    keys[provider] = apiKey;
    localStorage.setItem(BROWSER_KEYS_STORAGE_KEY, JSON.stringify(keys));
}

export function removeBrowserAIKey(provider: AIProvider): void {
    const keys = getBrowserAIKeys();
    delete keys[provider];
    localStorage.setItem(BROWSER_KEYS_STORAGE_KEY, JSON.stringify(keys));
}

export function getBrowserAIKey(provider: AIProvider): string | null {
    return getBrowserAIKeys()[provider] ?? null;
}

export function getActiveBrowserAIKey(activeProvider?: AIProvider): { provider: AIProvider; key: string } | null {
    const keys = getBrowserAIKeys();
    if (activeProvider && keys[activeProvider]) {
        return { provider: activeProvider, key: keys[activeProvider] };
    }
    // Fallback to the first available browser key
    const entries = Object.entries(keys);
    if (entries.length > 0) {
        return { provider: entries[0][0] as AIProvider, key: entries[0][1] };
    }
    return null;
}
