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
}

/** Latest file row: [min, market, listed, auctions, market 24h ago | 0, 7-day average, sold last 24h | -1 (newer files)]. */
export type LatestRow = [number, number, number, number, number, number, number?];

export function toQuote(id: number, row: LatestRow): Quote {
  return { id, min: row[0], market: row[1], listed: row[2], auctions: row[3], prev24h: row[4] > 0 ? row[4] : null, avg7d: row[5], soldPerDay: row[6] != null && row[6] >= 0 ? row[6] : null };
}

/** 24h change of the market price in percent, or null. */
export function change24h(q: Quote): number | null {
  return q.prev24h ? ((q.market - q.prev24h) / q.prev24h) * 100 : null;
}

/** Auction house cut on a sale: 5% on faction houses, 15% on the neutral (Blackwater) house. */
export function houseCut(faction: string): number {
  return faction === "blackwater" ? 0.15 : 0.05;
}
