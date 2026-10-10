/**
 * Browser-only record of finished interviews. Kept deliberately small and
 * capped, because the point of the feature is a downloadable document, not a
 * server-side archive. Nothing here ever leaves the browser.
 */

export type LocalHistoryItem = {
  id: string;
  scenario: string;
  difficulty: string;
  completedAt: string;
  architectureHealth: number;
  evaluationScore: number;
  /** The session run token — /interview?scenario=…&run=… restores the live snapshot. */
  run: string;
};

const HISTORY_KEY = "blueprint-local-history-v1";
const MAX_ITEMS = 12;

export const snapshotKeyFor = (run: string) => `blueprint-live-${run}`;

export function loadLocalHistory(): LocalHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]") as LocalHistoryItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string" && typeof item.run === "string");
  } catch {
    return [];
  }
}

function persist(items: LocalHistoryItem[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // Storage is full or blocked — the history list is a convenience, not a requirement.
  }
}

export function saveLocalHistoryItem(item: LocalHistoryItem): LocalHistoryItem[] {
  const next = [item, ...loadLocalHistory().filter((existing) => existing.id !== item.id)].slice(0, MAX_ITEMS);
  persist(next);
  return next;
}

export function removeLocalHistoryItem(id: string): LocalHistoryItem[] {
  const next = loadLocalHistory().filter((item) => item.id !== id);
  persist(next);
  return next;
}

export function clearLocalHistory(): LocalHistoryItem[] {
  persist([]);
  return [];
}