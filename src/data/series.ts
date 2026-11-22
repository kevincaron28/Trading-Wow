import type { ItemHistory } from "./live";
import { aggregateCandles, toCandles, type Candle } from "../lib/candles";
import { toWall } from "../lib/time";
import type { PriceField, Timeframe } from "../app/store";

/**
 * Candles for a timeframe from an item's history; `field` picks market price or lowest buyout. Times are wall-clock
 * seconds in `zone` (src/lib/time.ts): hourly candles show local hours and daily candles start at local midnight.
 */
export function candlesFor(history: ItemHistory, timeframe: Timeframe, field: PriceField, zone = "UTC"): Candle[] {
  // Lowest-buyout charts have no spread of their own: the body is the lowest buyout and there are no wicks.
  const points = history.hourly.map((p) => ({ ...p, time: toWall(p.time, zone), ...(field === "min" ? { market: p.minBuyout, high: undefined } : {}) }));
  if (timeframe === "1h" || timeframe === "4h") return toCandles(points, timeframe);
  // Daily and weekly: days covered by hourly points (the last 14 days) are rebuilt from them, with real wicks;
  // older days come from the stored daily candles (market price), kept two years.
  const fromHours = toCandles(points, "1d");
  const firstHourDay = fromHours[0]?.time ?? Infinity;
  const older = field === "min" ? [] : history.daily.filter((c) => c.time < firstHourDay);
  const known = [...older, ...fromHours];
  return timeframe === "1w" ? aggregateCandles(known, "1w") : known;
}
