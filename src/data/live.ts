/**
 * Reads the price files the collector publishes on the repo's `data` branch (docs/DATA.md).
 * No credentials: the files are public and served with Access-Control-Allow-Origin: *.
 */
import type { Candle, PricePoint } from "../lib/candles";
import { toQuote, type LatestRow, type Quote } from "../lib/quotes";
import type { Lang } from "../lib/i18n";
import type { WeeklyRecap } from "../lib/weekly";

export const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? "https://raw.githubusercontent.com/kevincaron28/Trading-Wow/data/";
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
const offlineWorthy = (path: string) => path === "meta.json" || path === "items.json" || path.startsWith("latest/") || path.startsWith("h2/") || path.startsWith("early/") || path.startsWith("early-h/") || path.startsWith("weekly/");
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

async function getJson<T>(path: string, fresh = false): Promise<T> {
  const age = Date.now() - (fetchedAt.get(path) ?? 0);
  if (!fresh && cache.has(path) && age < MAX_AGE_MS) return cache.get(path) as Promise<T>;
  const promise = fetch(`${DATA_BASE}${path}?t=${fresh ? Date.now() : Math.floor(Date.now() / MAX_AGE_MS)}`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      const text = await res.text();
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
export interface IndexPeriod { start: number; level: number; provisional?: boolean; basket: [number, number, number][] }
export interface IndexSeries { id: string; periods: IndexPeriod[]; hourly: [number, number][]; link?: number; earlyUntil?: number }

/** Weekly recap of one house (weekly/<house>.json, collector/weekly.ts); null before the collector first writes it. */
export async function loadWeekly(house: number): Promise<WeeklyRecap | null> {
  return getJson<WeeklyRecap>(`weekly/${house}.json`).catch(() => null);
}

/** Goldline indexes: definitions (index/meta.json) and one house's series (index/<house>.json). */
export function loadIndexMeta(): Promise<{ baseEnd: number; indexes: IndexDefMeta[] }> {
  return getJson("index/meta.json");
}
export async function loadIndexes(house: number): Promise<Record<string, IndexSeries>> {
  return (await getJson<{ indexes: Record<string, IndexSeries> }>(`index/${house}.json`)).indexes;
}
