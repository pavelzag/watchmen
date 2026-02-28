const MAX_HISTORY = 20;
const KEY = "watchmen_query_history";

export interface QueryHistoryEntry {
  query: string;
  answer: string;
  savedAt: string;
}

export function saveQuery(query: string, answer: string): void {
  if (typeof window === "undefined") return;
  const existing = getHistory();
  const entry: QueryHistoryEntry = { query, answer, savedAt: new Date().toISOString() };
  const updated = [entry, ...existing.filter((e) => e.query !== query)].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // localStorage quota exceeded or unavailable
  }
}

export function getHistory(): QueryHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueryHistoryEntry[];
  } catch {
    return [];
  }
}

export function clearHistory(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
