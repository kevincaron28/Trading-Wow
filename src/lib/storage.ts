/** Small wrappers around localStorage: it can be missing or throw (private windows), so every call is guarded. */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, fallback: T, store: KeyValueStore | null = safeStore()): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown, store: KeyValueStore | null = safeStore()): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the page keeps working without it.
  }
}

/** Add the item if missing, remove it if present. Returns a new list. */
export function toggleWatch(list: readonly number[], itemId: number): number[] {
  return list.includes(itemId) ? list.filter((id) => id !== itemId) : [...list, itemId];
}

/** Keep only positive integer IDs, without duplicates (guards against an edited or corrupt store). */
export function cleanWatchlist(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const v of value) if (Number.isInteger(v) && v > 0) seen.add(v);
  return [...seen];
}
