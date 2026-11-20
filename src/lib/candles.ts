/**
 * Price maths. The auction house only shows what is LISTED, not what sold, so every number here is a
 * snapshot of listings: "volume" means quantity listed, never quantity traded.
 */

/** One auction (or commodity price level) from a snapshot. Prices in copper per unit. */
import { quantile, robust } from "./market.ts";

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
  /** Estimated quantity sold since the previous snapshot, when known. */
  sold?: number;
  /** Top of the realistic price range: the price at which 30% of the listed quantity is reached (since 0.8). */
  high?: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Average quantity listed during the candle. */
  volume: number;
  /** Estimated from the day's price (only daily data for that period): drawn flat and faded. */
  estimated?: boolean;
}

/** Share of the listed quantity whose price is the top of an hour's candle wick. */
export const HIGH_SHARE = 0.3;

/**
 * One snapshot's summary. Market value: the robust formula (src/lib/market.ts), used since 19 Nov 2026 (0.8): cheapest
 * 30% of units, outliers beyond 0.5-1.5x their median dropped, cheaper half averaged by quantity. Before that it was
 * the average of the cheapest 15% of units; on live snapshots both give the same value for the typical item.
 */
export function summarizeSnapshot(time: number, listings: readonly Listing[]): PricePoint | null {
  const valid = listings.filter((l) => l.unitPrice > 0 && l.quantity > 0);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a.unitPrice - b.unitPrice);
  const listed = sorted.reduce((sum, l) => sum + l.quantity, 0);
  return {
    time,
    minBuyout: sorted[0]!.unitPrice,
    market: robust(sorted),
    listed,
    auctions: sorted.length,
    high: quantile(sorted, HIGH_SHARE),
  };
}

/**
 * The real price range of one snapshot for the candle wicks, clipped to half and one and a half times the market value
 * so a lone undercut or an overpriced listing cannot draw a giant wick. Without a stored high (data before 0.8) the
 * top is the market value itself; the bottom is the lowest buyout, which every snapshot has.
 */
export function pointRange(p: Pick<PricePoint, "market" | "minBuyout" | "high">): { low: number; high: number } {
  const low = Math.min(p.market, Math.max(p.minBuyout, Math.round(p.market * 0.5)));
  const high = p.high == null ? p.market : Math.max(p.market, Math.min(p.high, Math.round(p.market * 1.5)));
  return { low, high };
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
 * at the previous close, so a single snapshot per hour still draws a real body. Wicks come from each snapshot's own
 * listing spread (pointRange): real prices only, nothing invented between snapshots.
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
      const range = pointRange(point);
      current = {
        time: start,
        open,
        high: Math.max(open, point.market, range.high),
        low: Math.min(open, point.market, range.low),
        close: point.market,
        volume: 0,
        samples: 1,
        listedSum: point.listed,
      };
    } else {
      const range = pointRange(point);
      current.high = Math.max(current.high, point.market, range.high);
      current.low = Math.min(current.low, point.market, range.low);
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

/** Merge candles (e.g. daily) into larger buckets (e.g. weekly): first open, max high, min low, last close, average volume. */
export function aggregateCandles(candles: readonly Candle[], timeframe: Timeframe): Candle[] {
  const out: Candle[] = [];
  let count = 0;
  for (const c of [...candles].sort((a, b) => a.time - b.time)) {
    const start = bucketStart(c.time, timeframe);
    const last = out.at(-1);
    if (!last || last.time !== start) {
      if (last) last.volume = Math.round(last.volume / count);
      out.push({ ...c, time: start });
      count = 1;
    } else {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
      count++;
    }
  }
  const last = out.at(-1);
  if (last && count > 0) last.volume = Math.round(last.volume / count);
  return out;
}
