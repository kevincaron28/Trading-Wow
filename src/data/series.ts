import type { EarlyPoint, ItemHistory } from "./live";
import { aggregateCandles, toCandles, type Candle } from "../lib/candles";
import type { PriceField, Timeframe } from "../app/store";

/** Candles for a timeframe from an item's history; `field` picks market price or lowest buyout. */
export function candlesFor(history: ItemHistory, timeframe: Timeframe, field: PriceField): Candle[] {
  // Lowest-buyout charts have no spread of their own: the body is the lowest buyout and there are no wicks.
  const points = field === "min" ? history.hourly.map((p) => ({ ...p, market: p.minBuyout, high: undefined })) : history.hourly;
  if (timeframe === "1h" || timeframe === "4h") {
    // The whole history at every timeframe: before our hourly prices start (they cover the last 14 days), the
    // chart shows one candle per day, from the same daily history as the 1D chart. Nothing is spread into hours.
    const hours = toCandles(points, timeframe);
    const firstDay = hours.length ? Math.floor(hours[0]!.time / 86_400) * 86_400 : Infinity;
    return [...candlesFor(history, "1d", field).filter((c) => c.time < firstDay), ...hours];
  }
  // Daily and weekly: days covered by hourly points (the last 14 days) are rebuilt from them, with real wicks;
  // older days come from the stored daily candles (market price), kept two years.
  const fromHours = toCandles(points, "1d");
  const firstHourDay = fromHours[0]?.time ?? Infinity;
  const older = field === "min" ? [] : history.daily.filter((c) => c.time < firstHourDay);
  const known = [...older, ...fromHours];
  const daily = [...earlyCandles(history.early ?? [], known[0]?.time ?? Infinity, field), ...known];
  return timeframe === "1w" ? aggregateCandles(daily, "1w") : daily;
}

/**
 * Daily candles for the days before our own collection: one merged value per day, so the body runs from the previous
 * day's close to this day's value; the low wick is the day's real lowest buyout (market charts), never invented.
 */
export function earlyCandles(early: EarlyPoint[], before: number, field: PriceField): Candle[] {
  const out: Candle[] = [];
  let prev: number | null = null;
  for (const p of early) {
    if (p.time >= before) break;
    const close = field === "min" ? p.min : p.market;
    const open = prev ?? close;
    const low = Math.min(open, close, field === "market" ? p.min : close);
    out.push({ time: p.time, open, high: Math.max(open, close), low, close, volume: p.quantity });
    prev = close;
  }
  return out;
}
