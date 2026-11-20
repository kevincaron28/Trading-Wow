import type { EarlyPoint, ItemHistory } from "./live";
import { TIMEFRAME_SECONDS, aggregateCandles, bucketStart, toCandles, type Candle } from "../lib/candles";
import type { PriceField, Timeframe } from "../app/store";

/** Candles for a timeframe from an item's history; `field` picks market price or lowest buyout. */
export function candlesFor(history: ItemHistory, timeframe: Timeframe, field: PriceField): Candle[] {
  // Lowest-buyout charts have no spread of their own: the body is the lowest buyout and there are no wicks.
  const points = field === "min" ? history.hourly.map((p) => ({ ...p, market: p.minBuyout, high: undefined })) : history.hourly;
  if (timeframe === "1h" || timeframe === "4h") {
    // The whole history at every timeframe, evenly spaced: before our own hourly prices, real hourly prices where
    // they are known (earlyHourly), otherwise one flat, faded bar per interval at that day's price (estimated).
    const hours = toCandles(points, timeframe);
    return [...earlyIntraday(history, timeframe, field, hours[0]?.time ?? null), ...hours];
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
 * 1H/4H candles for the time before `before` (our first own candle; null = none): one per interval from the first
 * daily price on, so the time axis stays evenly spaced. Known hourly prices make real candles (body from the previous
 * close, low wick at the lowest buyout); other intervals are flat at the day's price and marked estimated, carrying the
 * last day's price over days without one.
 */
export function earlyIntraday(history: ItemHistory, timeframe: "1h" | "4h", field: PriceField, before: number | null): Candle[] {
  const size = TIMEFRAME_SECONDS[timeframe];
  const days = candlesFor({ ...history, hourly: [] }, "1d", field);
  const dayClose = new Map(days.map((c) => [c.time, c.close]));
  const end = before ?? (days.length ? days.at(-1)!.time + 86_400 : null);
  const startDay = days[0]?.time;
  if (end == null || startDay == null) return [];
  const real = new Map<number, { close: number; low: number; high: number; volume: number; n: number }>();
  for (const p of history.earlyHourly ?? []) {
    if (p.time >= end) continue;
    const t = bucketStart(p.time, timeframe);
    const v = field === "min" ? p.min : p.market;
    const low = field === "market" ? Math.min(p.min, v) : v;
    const b = real.get(t);
    if (!b) real.set(t, { close: v, low, high: v, volume: p.quantity, n: 1 });
    else { b.close = v; b.low = Math.min(b.low, low); b.high = Math.max(b.high, v); b.volume += p.quantity; b.n++; }
  }
  const out: Candle[] = [];
  let prev: number | null = null;
  let dayValue: number | null = null;
  for (let t = startDay; t < end; t += size) {
    const day = Math.floor(t / 86_400) * 86_400;
    if (t === day) dayValue = dayClose.get(day) ?? dayValue;
    const r = real.get(t);
    if (r) {
      const open = prev ?? r.close;
      out.push({ time: t, open, high: Math.max(open, r.high, r.close), low: Math.min(open, r.low, r.close), close: r.close, volume: Math.round(r.volume / r.n) });
      prev = r.close;
    } else if (dayValue != null) {
      out.push({ time: t, open: dayValue, high: dayValue, low: dayValue, close: dayValue, volume: 0, estimated: true });
      prev = dayValue;
    }
  }
  return out;
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
