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

const ACTIVE_PROVIDER_STORAGE_KEY = "watchmen_active_browser_ai_provider";

export function getActiveBrowserProvider(): AIProvider | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(ACTIVE_PROVIDER_STORAGE_KEY) as AIProvider | null;
}

export function setActiveBrowserProvider(provider: AIProvider | null): void {
    if (typeof window === "undefined") return;
    if (provider) {
        localStorage.setItem(ACTIVE_PROVIDER_STORAGE_KEY, provider);
    } else {
        localStorage.removeItem(ACTIVE_PROVIDER_STORAGE_KEY);
    }
}

export function getBrowserAIKey(provider: AIProvider): string | null {
    return getBrowserAIKeys()[provider] ?? null;
}

export function getActiveBrowserAIKey(): { provider: AIProvider; key: string } | null {
    const keys = getBrowserAIKeys();
    const activeProvider = getActiveBrowserProvider();

    // 1. Try explicitly selected browser-only active provider
    if (activeProvider && keys[activeProvider]) {
        return { provider: activeProvider, key: keys[activeProvider] };
    }

    // 2. Fallback to the first available browser key
    const entries = Object.entries(keys);
    if (entries.length > 0) {
        return { provider: entries[0][0] as AIProvider, key: entries[0][1] };
    }
    return null;
}
