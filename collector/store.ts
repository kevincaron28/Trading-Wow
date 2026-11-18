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
/** Version-1 layout (`history/`): itemId % 32. Still written so the 0.2 app keeps working. */
export const SHARDS = 32;
/** Version-2 layout (`h2/`): itemId % 256, so one chart downloads about 1/256 of a house. */
export const SHARDS_V2 = 256;

/** Hourly row: [hour index, min buyout, market, listed qty, auctions, estimated sold qty?]. Hour index = unix seconds / 3600. */
export type HourRow = [number, number, number, number, number, number?];
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

export function shardOfV2(itemId: number): number {
  return itemId % SHARDS_V2;
}

/** Raw Blizzard auction row (item auctions and commodities share this shape loosely). */
export interface RawAuction {
  id?: number;
  time_left?: string;
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
export function addPoint(history: ItemHistory, point: PricePoint, now: number = point.time, sold?: number): ItemHistory {
  const hourIndex = Math.floor(point.time / HOUR);
  const row: HourRow = sold == null ? [hourIndex, point.minBuyout, point.market, point.listed, point.auctions] : [hourIndex, point.minBuyout, point.market, point.listed, point.auctions, sold];
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

/** Latest row per item: [min, market, listed, auctions, market 24h ago | 0, 7-day avg market, estimated sold in the last 24h | -1 unknown]. */
export type LatestRow = [number, number, number, number, number, number, number];

export function latestRow(history: ItemHistory): LatestRow | null {
  const last = history.h.at(-1);
  if (!last) return null;
  const dayAgo = [...history.h].reverse().find((r) => r[0] <= last[0] - 24);
  const week = history.h.filter((r) => r[0] > last[0] - 24 * 7);
  const avg = Math.round(week.reduce((s, r) => s + r[2], 0) / week.length);
  const day = history.h.filter((r) => r[0] > last[0] - 24);
  const known = day.filter((r) => r[5] != null);
  const sold = known.length === 0 ? -1 : known.reduce((s, r) => s + (r[5] ?? 0), 0);
  return [last[1], last[2], last[3], last[4], dayAgo ? dayAgo[2] : 0, avg, sold];
}

/** Mark items that vanished from the house this hour: they keep their history but get no new point. */
export function snapshotHour(lastModified: string | null, fallback: number): number {
  const parsed = lastModified ? Date.parse(lastModified) / 1000 : NaN;
  const t = Number.isFinite(parsed) ? parsed : fallback;
  return Math.floor(t / HOUR) * HOUR;
}

/** Previous snapshot of a house: auction id -> [item id, quantity, time-left code]. */
export type AuctionState = Record<string, [number, number, number]>;
const TIME_LEFT: Record<string, number> = { SHORT: 0, MEDIUM: 1, LONG: 2, VERY_LONG: 3 };

export function auctionState(auctions: readonly RawAuction[]): AuctionState {
  const out: AuctionState = {};
  for (const a of auctions) if (a.id != null && a.item?.id) out[a.id] = [a.item.id, a.quantity ?? 1, TIME_LEFT[a.time_left ?? ""] ?? 0];
  return out;
}

/**
 * Estimated quantity sold per item between two snapshots: auctions that disappeared although they had at least
 * 2 hours left (LONG or VERY_LONG) were bought or cancelled, not expired. Partly bought commodity stacks count the
 * missing quantity. Returns null when the snapshots are too far apart to compare.
 */
export function estimateSold(previous: AuctionState | null, previousTime: number, auctions: readonly RawAuction[], time: number): Map<number, number> | null {
  if (!previous || time - previousTime <= 0 || time - previousTime > 2 * HOUR) return null;
  const now = new Map<number, number>();
  for (const a of auctions) if (a.id != null) now.set(a.id, a.quantity ?? 1);
  const sold = new Map<number, number>();
  for (const [id, [item, qty, left]] of Object.entries(previous)) {
    const current = now.get(Number(id));
    let gone = 0;
    if (current == null) gone = left >= 2 ? qty : 0;
    else if (current < qty) gone = qty - current;
    if (gone > 0) sold.set(item, (sold.get(item) ?? 0) + gone);
  }
  return sold;
}
