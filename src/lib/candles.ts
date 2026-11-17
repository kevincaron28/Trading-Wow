/**
 * Price maths. The auction house only shows what is LISTED, not what sold, so every number here is a
 * snapshot of listings: "volume" means quantity listed, never quantity traded.
 */

/** One auction (or commodity price level) from a snapshot. Prices in copper per unit. */
export interface Listing {
  unitPrice: number;
  quantity: number;
}

/** The summary of one auction house snapshot for one item (normally one per hour). */
export interface PricePoint {
  /** Unix seconds, start of the hour the snapshot belongs to. */
  time: number;
  /** Lowest unit price listed. */
  minBuyout: number;
  /** Market price: average unit price of the cheapest MARKET_SHARE of the listed quantity. */
  market: number;
  /** Total quantity listed. */
  listed: number;
  /** Number of separate auctions. */
  auctions: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Average quantity listed during the candle. */
  volume: number;
}

/** Share of the cheapest listed quantity that sets the market price (ignores overpriced junk listings). */
export const MARKET_SHARE = 0.15;

export function summarizeSnapshot(time: number, listings: readonly Listing[]): PricePoint | null {
  const valid = listings.filter((l) => l.unitPrice > 0 && l.quantity > 0);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a.unitPrice - b.unitPrice);
  const listed = sorted.reduce((sum, l) => sum + l.quantity, 0);
  const target = Math.max(1, Math.ceil(listed * MARKET_SHARE));
  let taken = 0;
  let cost = 0;
  for (const l of sorted) {
    const take = Math.min(l.quantity, target - taken);
    cost += take * l.unitPrice;
    taken += take;
    if (taken >= target) break;
  }
  return {
    time,
    minBuyout: sorted[0]!.unitPrice,
    market: Math.round(cost / taken),
    listed,
    auctions: sorted.length,
  };
}

export type Timeframe = "1h" | "4h" | "1d" | "1w";

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
  "1w": 604_800,
};

/** Start of the bucket containing `time`. Weeks start on Tuesday 15:00 UTC (the US weekly reset). */
export function bucketStart(time: number, timeframe: Timeframe): number {
  const size = TIMEFRAME_SECONDS[timeframe];
  if (timeframe === "1w") {
    // 1970-01-06 was a Tuesday; shift so buckets begin at Tuesday 15:00 UTC.
    const origin = 5 * 86_400 + 15 * 3_600;
    return Math.floor((time - origin) / size) * size + origin;
  }
  return Math.floor(time / size) * size;
}

/**
 * Turn hourly price points into candles of the market price. Candles are continuous: each one opens
 * at the previous close, so a single snapshot per hour still draws a real body.
 */
export function toCandles(points: readonly PricePoint[], timeframe: Timeframe): Candle[] {
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const candles: Candle[] = [];
  let current: (Candle & { samples: number; listedSum: number }) | null = null;
  let previousClose: number | null = null;

  for (const point of sorted) {
    const start = bucketStart(point.time, timeframe);
    if (!current || current.time !== start) {
      if (current) {
        candles.push(finish(current));
        previousClose = current.close;
      }
      const open: number = previousClose ?? point.market;
      current = {
        time: start,
        open,
        high: Math.max(open, point.market),
        low: Math.min(open, point.market),
        close: point.market,
        volume: 0,
        samples: 1,
        listedSum: point.listed,
      };
    } else {
      current.high = Math.max(current.high, point.market);
      current.low = Math.min(current.low, point.market);
      current.close = point.market;
      current.samples += 1;
      current.listedSum += point.listed;
    }
  }
  if (current) candles.push(finish(current));
  return candles;
}

function finish(c: Candle & { samples: number; listedSum: number }): Candle {
  return {
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: Math.round(c.listedSum / c.samples),
  };
}
