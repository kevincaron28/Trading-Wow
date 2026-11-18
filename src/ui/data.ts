import { useEffect, useState } from "preact/hooks";
import { loadCatalog, loadHistory, loadMeta, loadQuotes, type CatalogItem, type ItemHistory, type Meta } from "../data/live";
import type { Quote } from "../lib/quotes";

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Run an async loader when `key` changes; `version` forces a reload (pull to refresh, hourly refresh). */
export function useAsync<T>(load: () => Promise<T>, key: string): Async<T> {
  const [state, setState] = useState<Async<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    load().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error: unknown) => alive && setState((s) => ({ data: s.data, error: error instanceof Error ? error.message : String(error), loading: false })),
    );
    return () => {
      alive = false;
    };
  }, [key]);
  return state;
}

let refreshVersion = 0;
const refreshListeners = new Set<() => void>();
/** Bump the data version: every hook reloads (files are re-fetched when older than 10 minutes). */
export function bumpRefresh(): void {
  refreshVersion++;
  refreshListeners.forEach((fn) => fn());
}
export function useRefreshVersion(): number {
  const [v, setV] = useState(refreshVersion);
  useEffect(() => {
    const fn = () => setV(refreshVersion);
    refreshListeners.add(fn);
    return () => refreshListeners.delete(fn);
  }, []);
  return v;
}

export function useMeta(): Async<Meta> {
  const v = useRefreshVersion();
  return useAsync(() => loadMeta(), `meta:${v}`);
}

export function useCatalog(): Async<Map<number, CatalogItem>> {
  return useAsync(() => loadCatalog(), "catalog");
}

export function useQuotes(house: number): Async<Map<number, Quote>> {
  const v = useRefreshVersion();
  return useAsync(() => loadQuotes(house), `quotes:${house}:${v}`);
}

export function useHistory(house: number, itemId: number | null): Async<ItemHistory> {
  const v = useRefreshVersion();
  return useAsync(() => (itemId == null ? Promise.resolve({ hourly: [], daily: [] }) : loadHistory(house, itemId)), `history:${house}:${itemId}:${v}`);
}
