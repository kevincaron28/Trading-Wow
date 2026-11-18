/**
 * Pure helpers for the price history files the collector publishes (no network, no file system),
 * so they can be unit-tested. File formats are documented in docs/DATA.md.
 */
import { summarizeSnapshot, type Listing, type PricePoint } from "../src/lib/candles.ts";

export const HOUR = 3_600;
export const DAY = 86_400;
/** Hourly points kept per item; older hours survive only as daily candles. */
export const HOURLY_KEEP_SECONDS = 14 * DAY;
/** Daily candles kept per item. */
export const DAILY_KEEP_SECONDS = 730 * DAY;
/** Items are split into this many history files per house (itemId % SHARDS). */
export const SHARDS = 32;

/** Hourly row: [hour index, min buyout, market, listed qty, auctions]. Hour index = unix seconds / 3600. */
export type HourRow = [number, number, number, number, number];
/** Daily row: [day index, open, high, low, close, avg listed qty, lowest min buyout]. Day index = unix seconds / 86400. */
export type DayRow = [number, number, number, number, number, number, number];

export interface ItemHistory {
  h: HourRow[];
  d: DayRow[];
}

export interface Shard {
  v: 1;
  items: Record<string, ItemHistory>;
}

export function emptyShard(): Shard {
  return { v: 1, items: {} };
}

export function shardOf(itemId: number): number {
  return itemId % SHARDS;
}

/** Raw Blizzard auction row (item auctions and commodities share this shape loosely). */
export interface RawAuction {
  item: { id: number };
  quantity?: number;
  unit_price?: number;
  buyout?: number;
}

/** Group a house snapshot by item and summarize each item. Bid-only auctions (no buyout) are ignored. */
export function summarizeHouse(time: number, auctions: readonly RawAuction[]): Map<number, PricePoint> {
  const byItem = new Map<number, Listing[]>();
  for (const a of auctions) {
    const quantity = a.quantity ?? 1;
    const unitPrice = a.unit_price ?? (a.buyout ? Math.floor(a.buyout / Math.max(1, quantity)) : 0);
    if (!a.item?.id || unitPrice <= 0 || quantity <= 0) continue;
    let list = byItem.get(a.item.id);
    if (!list) byItem.set(a.item.id, (list = []));
    list.push({ unitPrice, quantity });
  }
  const out = new Map<number, PricePoint>();
  for (const [id, listings] of byItem) {
    const point = summarizeSnapshot(time, listings);
    if (point) out.set(id, point);
  }
  return out;
}

/** Add one snapshot point to an item's history: replaces the same hour, prunes old hours, refreshes that day's candle. */
export function addPoint(history: ItemHistory, point: PricePoint, now: number = point.time): ItemHistory {
  const hourIndex = Math.floor(point.time / HOUR);
  const row: HourRow = [hourIndex, point.minBuyout, point.market, point.listed, point.auctions];
  const minHour = Math.floor((now - HOURLY_KEEP_SECONDS) / HOUR);
  const h = history.h.filter((r) => r[0] !== hourIndex && r[0] > minHour);
  h.push(row);
  h.sort((a, b) => a[0] - b[0]);

  const dayIndex = Math.floor(point.time / DAY);
  // Hourly rows are kept for 14 days, so the whole day is always present: rebuild its candle from them.
  const dayRows = h.filter((r) => Math.floor((r[0] * HOUR) / DAY) === dayIndex);
  const markets = dayRows.map((r) => r[2]);
  const candle: DayRow = [
    dayIndex,
    dayRows[0]![2],
    Math.max(...markets),
    Math.min(...markets),
    dayRows.at(-1)![2],
    Math.round(dayRows.reduce((s, r) => s + r[3], 0) / dayRows.length),
    Math.min(...dayRows.map((r) => r[1])),
  ];
  const minDay = Math.floor((now - DAILY_KEEP_SECONDS) / DAY);
  const d = history.d.filter((r) => r[0] !== dayIndex && r[0] > minDay);
  d.push(candle);
  d.sort((a, b) => a[0] - b[0]);
  return { h, d };
}

/** Latest row per item for the house's latest file: [min, market, listed, auctions, market 24h ago | 0, 7-day avg market]. */
export type LatestRow = [number, number, number, number, number, number];

export function latestRow(history: ItemHistory): LatestRow | null {
  const last = history.h.at(-1);
  if (!last) return null;
  const dayAgo = [...history.h].reverse().find((r) => r[0] <= last[0] - 24);
  const week = history.h.filter((r) => r[0] > last[0] - 24 * 7);
  const avg = Math.round(week.reduce((s, r) => s + r[2], 0) / week.length);
  return [last[1], last[2], last[3], last[4], dayAgo ? dayAgo[2] : 0, avg];
}

/** Mark items that vanished from the house this hour: they keep their history but get no new point. */
export function snapshotHour(lastModified: string | null, fallback: number): number {
  const parsed = lastModified ? Date.parse(lastModified) / 1000 : NaN;
  const t = Number.isFinite(parsed) ? parsed : fallback;
  return Math.floor(t / HOUR) * HOUR;
}
