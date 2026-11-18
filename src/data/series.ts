import type { ItemHistory } from "./live";
import { aggregateCandles, toCandles, type Candle } from "../lib/candles";
import type { PriceField, Timeframe } from "../app/store";

/** Candles for a timeframe from an item's history; `field` picks market price or lowest buyout. */
export function candlesFor(history: ItemHistory, timeframe: Timeframe, field: PriceField): Candle[] {
  const points = field === "min" ? history.hourly.map((p) => ({ ...p, market: p.minBuyout })) : history.hourly;
  if (timeframe === "1h" || timeframe === "4h") return toCandles(points, timeframe);
  // Daily and weekly: daily candles (kept two years) for the market price; lowest buyout from the hourly points.
  const daily = field === "min" || history.daily.length === 0 ? toCandles(points, "1d") : history.daily;
  return timeframe === "1w" ? aggregateCandles(daily, "1w") : daily;
}
