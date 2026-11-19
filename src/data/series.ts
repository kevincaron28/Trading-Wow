import type { ItemHistory } from "./live";
import { aggregateCandles, toCandles, type Candle } from "../lib/candles";
import type { PriceField, Timeframe } from "../app/store";

/** Candles for a timeframe from an item's history; `field` picks market price or lowest buyout. */
export function candlesFor(history: ItemHistory, timeframe: Timeframe, field: PriceField): Candle[] {
  // Lowest-buyout charts have no spread of their own: the body is the lowest buyout and there are no wicks.
  const points = field === "min" ? history.hourly.map((p) => ({ ...p, market: p.minBuyout, high: undefined })) : history.hourly;
  if (timeframe === "1h" || timeframe === "4h") return toCandles(points, timeframe);
  // Daily and weekly: days covered by hourly points (the last 14 days) are rebuilt from them, with real wicks;
  // older days come from the stored daily candles (market price), kept two years.
  const fromHours = toCandles(points, "1d");
  const firstHourDay = fromHours[0]?.time ?? Infinity;
  const older = field === "min" ? [] : history.daily.filter((c) => c.time < firstHourDay);
  const daily = [...older, ...fromHours];
  return timeframe === "1w" ? aggregateCandles(daily, "1w") : daily;
}
