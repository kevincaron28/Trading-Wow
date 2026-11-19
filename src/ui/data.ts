import { useEffect, useState } from "preact/hooks";
import { loadCatalog, loadExt, loadHistory, loadIndexes, loadIndexMeta, loadMeta, loadQuotes, loadSeed, loadTsm, loadTsmRegion, type IndexDefMeta, type IndexSeries, type TsmItem, type TsmRegion, type CatalogItem, type ItemHistory, type Meta, type SeedPoint } from "../data/live";
import type { Quote } from "../lib/quotes";

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Run an async loader when `key` changes. Keys may end in ":<refresh version>"; a refresh of the same thing keeps
 * showing the old data while it reloads, but switching to something else (another item or house) starts empty, so a
 * failed load never shows the previous item's data.
 */
export function useAsync<T>(load: () => Promise<T>, key: string): Async<T> {
  const [state, setState] = useState<Async<T> & { id?: string }>({ data: null, error: null, loading: true });
  const id = key.replace(/:\d+$/, "");
  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.id === id ? s.data : null, error: null, loading: true, id }));
    load().then(
      (data) => alive && setState({ data, error: null, loading: false, id }),
      (error: unknown) => alive && setState((s) => ({ data: s.data, error: error instanceof Error ? error.message : String(error), loading: false, id })),
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

export function useTsm(house: number, itemId: number): Async<TsmItem | null> {
  const v = useRefreshVersion();
  return useAsync(() => loadTsm(house, itemId), `tsm:${house}:${itemId}:${v}`);
}
export function useTsmRegion(itemId: number): Async<TsmRegion | null> {
  return useAsync(() => loadTsmRegion(itemId), `tsmr:${itemId}:0`);
}
export function useIndexMeta(): Async<{ baseEnd: number; indexes: IndexDefMeta[] }> {
  return useAsync(() => loadIndexMeta(), "indexmeta:0");
}
export function useIndexes(house: number): Async<Record<string, IndexSeries>> {
  const v = useRefreshVersion();
  return useAsync(() => loadIndexes(house), `indexes:${house}:${v}`);
}

export function useExt(house: number, itemId: number): Async<SeedPoint[]> {
  return useAsync(() => loadExt(house, itemId), `ext:${house}:${itemId}:0`);
}

export function useSeed(house: number, itemId: number): Async<SeedPoint[]> {
  return useAsync(() => loadSeed(house, itemId), `seed:${house}:${itemId}:0`);
}
