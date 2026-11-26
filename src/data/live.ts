/**
 * Reads the price files the collector publishes (docs/DATA.md): first from Cloudflare R2 (docs/R2_DATA.md), else from
 * the repo's `data` branch on GitHub, which stays a copy until R2 is confirmed.
 * No credentials: the files are public and served with Access-Control-Allow-Origin: *.
 */
import type { Candle, PricePoint } from "../lib/candles";
import { toQuote, type LatestRow, type Quote } from "../lib/quotes";
import type { Lang } from "../lib/i18n";
import type { RecapFile, RecapKind, RecapList, WeeklyRecap } from "../lib/weekly";

/** The `data` branch on GitHub: the fallback (and a copy of everything). */
export const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? "https://raw.githubusercontent.com/kevincaron28/Trading-Wow/data/";
/** Cloudflare R2 behind a custom domain (collector/r2-publish.ts). Tried first; an empty VITE_DATA_R2 turns it off. */
export const R2_BASE = (import.meta.env.VITE_DATA_R2 as string | undefined) ?? "https://data.kcaron.top/";
/** R2 is used only while its meta.json is at most this old: a stalled R2 copy never hides newer prices on GitHub. */
const R2_MAX_STALE_S = 3 * 3_600;
/** R2 keeps histories in 64 files per house (h64/) instead of 256 (h2/); 64 divides 256, so shard s is in s % 64. */
const R2_SHARDS = 64;
const SHARDS = 32;
const SHARDS_V2 = 256;
const HOUR = 3_600;
const DAY = 86_400;

export interface HouseInfo {
  id: number;
  realm: string;
  faction: "alliance" | "horde" | "blackwater";
  snapshot: number;
  lastModified: string | null;
  items: number;
}

/** When Blizzard last refreshed a house (falls back to the snapshot hour). */
export function houseUpdated(h: HouseInfo | undefined): number | null {
  if (!h) return null;
  const parsed = h.lastModified ? Date.parse(h.lastModified) / 1000 : NaN;
  return Number.isFinite(parsed) ? parsed : h.snapshot;
}

export interface Meta {
  updated: number;
  iconBase: string;
  houses: HouseInfo[];
}

/** Catalog row: [English name, French name, quality, item class, item subclass, icon file id]. */
export type CatalogRow = [string, string, number, number, number, string];

export interface CatalogItem {
  id: number;
  name: Record<Lang, string>;
  quality: number;
  itemClass: number;
  subclass: number;
  icon: string;
}

export interface ItemHistory {
  hourly: PricePoint[];
  daily: Candle[];
  /** Days before Goldline's own collection covered the item (one merged value per day; see collector/merge-history.ts). */
  early?: EarlyPoint[];
  /** Hourly prices before our own collection (time = hour start), when known. */
  earlyHourly?: EarlyPoint[];
}

export interface EarlyPoint { time: number; market: number; min: number; quantity: number }

const cache = new Map<string, Promise<unknown>>();
/** Files change about hourly; refetch after this long. */
const MAX_AGE_MS = 10 * 60_000;
const fetchedAt = new Map<string, number>();

/** Files kept on the device so the app still shows the last prices offline. */
const OFFLINE_PREFIX = "goldline:file:";
const offlineWorthy = (path: string) => path === "meta.json" || path === "items.json" || path.startsWith("latest/") || path.startsWith("h2/") || path.startsWith("early/") || path.startsWith("early-h/") || path.startsWith("weekly/") || path.startsWith("recap/");
let offline = false;
const offlineListeners = new Set<(offline: boolean) => void>();
export function isOffline(): boolean {
  return offline;
}
export function onOfflineChange(fn: (offline: boolean) => void): () => void {
  offlineListeners.add(fn);
  return () => offlineListeners.delete(fn);
}
function setOffline(value: boolean): void {
  if (value === offline) return;
  offline = value;
  offlineListeners.forEach((fn) => fn(value));
}
function saveOffline(path: string, text: string): void {
  if (!offlineWorthy(path) || text.length > 1_500_000) return;
  try {
    localStorage.setItem(OFFLINE_PREFIX + path, text);
  } catch {
    // Storage full: drop older price files and keep going without an offline copy.
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith(OFFLINE_PREFIX + "latest/") || key.startsWith(OFFLINE_PREFIX + "h2/")) localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
function readOffline(path: string): string | null {
  try {
    return localStorage.getItem(OFFLINE_PREFIX + path);
  } catch {
    return null;
  }
}

/** Where a data branch path lives on R2, or null when R2 does not hold it (the old history/ layout). */
export function r2Path(path: string): string | null {
  const h2 = /^h2\/(\d+)\/(\d+)\.json$/.exec(path);
  if (h2) return `h64/${h2[1]}/${Number(h2[2]) % R2_SHARDS}.json`;
  return path.startsWith("history/") ? null : path;
}

let r2Usable: Promise<boolean> | null = null;
/** Decided once per refresh (clearCache): R2 answers and its prices are recent. */
function useR2(): Promise<boolean> {
  if (!R2_BASE) return Promise.resolve(false);
  r2Usable ??= fetch(`${R2_BASE}meta.json?t=${Math.floor(Date.now() / 60_000)}`, { signal: AbortSignal.timeout(8_000) })
    .then(async (res) => res.ok && ((await res.json()) as { updated?: number }).updated! > Date.now() / 1000 - R2_MAX_STALE_S)
    .catch(() => false);
  return r2Usable;
}

/** One file's text: from R2 when it is usable, else (or when that file fails there) from GitHub. */
export async function fetchText(path: string, fresh = false): Promise<string> {
  // Shared time buckets keep the CDN cache useful: a minute for fresh checks, 10 minutes otherwise.
  const t = fresh ? Math.floor(Date.now() / 60_000) : Math.floor(Date.now() / MAX_AGE_MS);
  const onR2 = r2Path(path);
  if (onR2 && (await useR2())) {
    try {
      const res = await fetch(`${R2_BASE}${onR2}?t=${t}`);
      if (res.ok) return await res.text();
    } catch {
      // Fall through to GitHub.
    }
  }
  const res = await fetch(`${DATA_BASE}${path}?t=${t}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

async function getJson<T>(path: string, fresh = false): Promise<T> {
  const age = Date.now() - (fetchedAt.get(path) ?? 0);
  if (!fresh && cache.has(path) && age < MAX_AGE_MS) return cache.get(path) as Promise<T>;
  const promise = fetchText(path, fresh)
    .then(async (text) => {
      saveOffline(path, text);
      setOffline(false);
      return JSON.parse(text) as T;
    })
    .catch((error: unknown) => {
      const saved = offlineWorthy(path) ? readOffline(path) : null;
      if (saved == null) throw error;
      setOffline(true);
      return JSON.parse(saved) as T;
    });
  cache.set(path, promise);
  fetchedAt.set(path, Date.now());
  promise.catch(() => cache.delete(path));
  return promise;
}

export function clearCache(): void {
  cache.clear();
  fetchedAt.clear();
  r2Usable = null;
}

export async function loadMeta(fresh = false): Promise<Meta> {
  return getJson<Meta>("meta.json", fresh);
}

let catalogPromise: Promise<Map<number, CatalogItem>> | null = null;
export function loadCatalog(): Promise<Map<number, CatalogItem>> {
  catalogPromise ??= getJson<Record<string, CatalogRow>>("items.json").then((rows) => parseCatalog(rows));
  catalogPromise.catch(() => (catalogPromise = null));
  return catalogPromise;
}

export function parseCatalog(rows: Record<string, CatalogRow>): Map<number, CatalogItem> {
  const map = new Map<number, CatalogItem>();
  for (const [key, r] of Object.entries(rows)) {
    const id = Number(key);
    map.set(id, { id, name: { en: r[0], fr: r[1] || r[0] }, quality: r[2], itemClass: r[3], subclass: r[4], icon: r[5] });
  }
  return map;
}

export async function loadQuotes(house: number, fresh = false): Promise<Map<number, Quote>> {
  const file = await getJson<{ t: number; items: Record<string, LatestRow> }>(`latest/${house}.json`, fresh);
  return parseLatest(file.items);
}

export function parseLatest(items: Record<string, LatestRow>): Map<number, Quote> {
  const map = new Map<number, Quote>();
  for (const [key, row] of Object.entries(items)) map.set(Number(key), toQuote(Number(key), row));
  return map;
}

type HourRow = [number, number, number, number, number, (number | null)?, number?];
type DayRow = [number, number, number, number, number, number, number];

export async function loadHistory(house: number, itemId: number): Promise<ItemHistory> {
  type ShardFile = { items: Record<string, { h: HourRow[]; d: DayRow[] }> };
  // v2 layout (256 small files per house); older data only has the v1 layout (32 files).
  const none = () => ({ items: {} as Record<string, number[][]> });
  const [shard, early, earlyH] = await Promise.all([
    getJson<ShardFile>(`h2/${house}/${itemId % SHARDS_V2}.json`).catch(() => getJson<ShardFile>(`history/${house}/${itemId % SHARDS}.json`)),
    getJson<{ items: Record<string, number[][]> }>(`early/${house}/${itemId % SHARDS_V2}.json`).catch(none),
    getJson<{ items: Record<string, number[][]> }>(`early-h/${house}/${itemId % SHARDS_V2}.json`).catch(none),
  ]);
  return { ...parseHistory(shard.items[itemId]), early: parseEarly(early.items[itemId]), earlyHourly: parseEarlyHourly(earlyH.items[itemId]) };
}

/** Early hourly rows [hour, market, min, quantity]. */
export function parseEarlyHourly(rows: number[][] | undefined): EarlyPoint[] {
  return (rows ?? []).filter((r) => r[1]! > 0).map((r) => ({ time: r[0]! * HOUR, market: r[1]!, min: r[2]! || r[1]!, quantity: r[3] ?? 0 }));
}

/** Early rows [day, market, min, quantity, sources]: the source mask is internal and dropped here. */
export function parseEarly(rows: number[][] | undefined): EarlyPoint[] {
  return (rows ?? []).filter((r) => r[1]! > 0).map((r) => ({ time: r[0]! * DAY, market: r[1]!, min: r[2]! || r[1]!, quantity: r[3] ?? 0 }));
}

export function parseHistory(raw: { h: HourRow[]; d: DayRow[] } | undefined): ItemHistory {
  if (!raw) return { hourly: [], daily: [] };
  return {
    hourly: raw.h.map((r) => ({
      time: r[0] * HOUR,
      minBuyout: r[1],
      market: r[2],
      listed: r[3],
      auctions: r[4],
      ...(r[5] != null ? { sold: r[5] } : {}),
      ...(r[6] != null ? { high: r[6] } : {}),
    })),
    daily: raw.d.map((r) => ({ time: r[0] * DAY, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })),
  };
}

export function iconUrl(meta: Meta | null, icon: string): string {
  if (!icon) return "";
  const base = meta?.iconBase || "https://render.worldofwarcraft.com/forever-us/icons/56/";
  return `${base}${icon}.jpg`;
}

export interface IndexDefMeta { id: string; name: { en: string; fr: string }; about: { en: string; fr: string }; size: number; cap: number }
/** index/meta.json: definitions and the rebalance calendar (next, last; since 26 Nov 2026). */
export interface IndexMeta { baseEnd: number; indexes: IndexDefMeta[]; next?: number; nextQuarterly?: boolean; last?: number | null }
/** One rebalance: items added and removed with their weights (index/<house>.json `changes`). `launch`: a weekly review of the launch weeks. */
export interface BasketChange { at: number; kind: "monthly" | "quarterly"; launch?: boolean; added: [number, number][]; removed: [number, number][]; kept: number; level: number }
export interface IndexPeriod { start: number; level: number; provisional?: boolean; basket: [number, number, number][] }
export interface IndexSeries { id: string; periods: IndexPeriod[]; hourly: [number, number][]; link?: number; earlyUntil?: number; method?: number; changes?: BasketChange[] }

/** Weekly recap of one house (weekly/<house>.json, collector/weekly.ts); null before the collector first writes it. */
export async function loadWeekly(house: number): Promise<WeeklyRecap | null> {
  return getJson<WeeklyRecap>(`weekly/${house}.json`).catch(() => null);
}

/** The list of a house's daily, weekly and monthly recaps (recap/<house>/list.json); null before the first one. */
export async function loadRecapList(house: number): Promise<RecapList | null> {
  return getJson<RecapList>(`recap/${house}/list.json`).catch(() => null);
}
/** One recap of a house. */
export function loadRecap(house: number, kind: RecapKind, key: string): Promise<RecapFile> {
  return getJson<RecapFile>(`recap/${house}/${kind}-${key}.json`);
}

/** Goldline indexes: definitions (index/meta.json) and one house's series (index/<house>.json). */
export function loadIndexMeta(): Promise<IndexMeta> {
  return getJson("index/meta.json");
}
export async function loadIndexes(house: number): Promise<Record<string, IndexSeries>> {
  return (await getJson<{ indexes: Record<string, IndexSeries> }>(`index/${house}.json`)).indexes;
}
