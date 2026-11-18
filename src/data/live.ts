/**
 * Reads the price files the collector publishes on the repo's `data` branch (docs/DATA.md).
 * No credentials: the files are public and served with Access-Control-Allow-Origin: *.
 */
import type { Candle, PricePoint } from "../lib/candles";
import { toQuote, type LatestRow, type Quote } from "../lib/quotes";
import type { Lang } from "../lib/i18n";

export const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? "https://raw.githubusercontent.com/kevincaron28/Trading-Wow/data/";
const SHARDS = 32;
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
}

const cache = new Map<string, Promise<unknown>>();
/** Files change about hourly; refetch after this long. */
const MAX_AGE_MS = 10 * 60_000;
const fetchedAt = new Map<string, number>();

async function getJson<T>(path: string, fresh = false): Promise<T> {
  const age = Date.now() - (fetchedAt.get(path) ?? 0);
  if (!fresh && cache.has(path) && age < MAX_AGE_MS) return cache.get(path) as Promise<T>;
  const promise = fetch(`${DATA_BASE}${path}?t=${Math.floor(Date.now() / MAX_AGE_MS)}`).then((res) => {
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json() as Promise<T>;
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

type HourRow = [number, number, number, number, number];
type DayRow = [number, number, number, number, number, number, number];

export async function loadHistory(house: number, itemId: number): Promise<ItemHistory> {
  const shard = await getJson<{ items: Record<string, { h: HourRow[]; d: DayRow[] }> }>(`history/${house}/${itemId % SHARDS}.json`);
  return parseHistory(shard.items[itemId]);
}

export function parseHistory(raw: { h: HourRow[]; d: DayRow[] } | undefined): ItemHistory {
  if (!raw) return { hourly: [], daily: [] };
  return {
    hourly: raw.h.map((r) => ({ time: r[0] * HOUR, minBuyout: r[1], market: r[2], listed: r[3], auctions: r[4] })),
    daily: raw.d.map((r) => ({ time: r[0] * DAY, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })),
  };
}

export function iconUrl(meta: Meta | null, icon: string): string {
  if (!icon) return "";
  const base = meta?.iconBase || "https://render.worldofwarcraft.com/forever-us/icons/56/";
  return `${base}${icon}.jpg`;
}
