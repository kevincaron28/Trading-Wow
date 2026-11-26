/** One item's current price summary in one auction house (from the collector's latest file). */
export interface Quote {
  id: number;
  /** Lowest buyout per unit, copper. */
  min: number;
  /** Market price per unit (average of the cheapest 15% listed), copper. */
  market: number;
  /** Quantity listed. */
  listed: number;
  /** Number of auctions. */
  auctions: number;
  /** Market price about 24 hours earlier, or null when unknown. */
  prev24h: number | null;
  /** Average market price over the last 7 days (or since collection started). */
  avg7d: number;
  /** Estimated quantity sold in the last 24 hours (auctions bought or cancelled before expiring), or null when unknown. */
  soldPerDay: number | null;
  /** Market price about an hour earlier (previous snapshot, at most 3 hours old), or null when unknown. */
  prev1h: number | null;
  /** Average quantity sold per day over the last 7 days (or since sales were first counted), or null when unknown. */
  soldAvg7d: number | null;
}

/**
 * Latest file row: [min, market, listed, auctions, market 24h ago | 0, 7-day average, sold last 24h | -1,
 * market 1h ago | 0, average sold per day over 7 days | -1]. The last four are missing in older files.
 */
export type LatestRow = [number, number, number, number, number, number, number?, number?, number?];

export function toQuote(id: number, row: LatestRow): Quote {
  return { id, min: row[0], market: row[1], listed: row[2], auctions: row[3], prev24h: row[4] > 0 ? row[4] : null, avg7d: row[5], soldPerDay: row[6] != null && row[6] >= 0 ? row[6] : null, prev1h: row[7] != null && row[7] > 0 ? row[7] : null, soldAvg7d: row[8] != null && row[8] >= 0 ? row[8] : null };
}

/** Estimated units sold per day: the 7-day average when counted, else the last 24 hours; null when unknown. */
export function salesPerDay(q: Quote): number | null {
  return q.soldAvg7d ?? q.soldPerDay;
}

/** Whether an item sells at least `min` units a day. 0 keeps everything, including items with unknown sales. */
export function sellsAtLeast(q: Quote, min: number): boolean {
  return min <= 0 || (salesPerDay(q) ?? 0) >= min;
}

/** 24h change of the market price in percent, or null. */
export function change24h(q: Quote): number | null {
  return q.prev24h ? ((q.market - q.prev24h) / q.prev24h) * 100 : null;
}

/** Change over the chosen window (last 24 hours or last hour): percent and copper, null when unknown. */
export function changeOver(q: Quote | undefined, window: "1d" | "1h"): { pct: number | null; abs: number | null } {
  const before = q ? (window === "1h" ? q.prev1h : q.prev24h) : null;
  if (!q || !before) return { pct: null, abs: null };
  return { pct: ((q.market - before) / before) * 100, abs: q.market - before };
}

/** Auction house cut on a sale: 5% on faction houses, 15% on the neutral (Blackwater) house. */
export function houseCut(faction: string): number {
  return faction === "blackwater" ? 0.15 : 0.05;
}
