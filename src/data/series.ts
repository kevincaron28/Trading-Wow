import type { EarlyPoint, ItemHistory } from "./live";
import { TIMEFRAME_SECONDS, aggregateCandles, bucketStart, toCandles, type Candle } from "../lib/candles";
import { toWall } from "../lib/time";
import type { PriceField, Timeframe } from "../app/store";

const DAY = 86_400;
const HOUR = 3_600;

/**
 * Candles for a timeframe from an item's history; `field` picks market price or lowest buyout. Times are wall-clock
 * seconds in `zone` (src/lib/time.ts): hourly candles show local hours and daily candles start at local midnight.
 * Days before our own hourly prices are stored per date and keep their date.
 */
export function candlesFor(history: ItemHistory, timeframe: Timeframe, field: PriceField, zone = "UTC"): Candle[] {
  // Lowest-buyout charts have no spread of their own: the body is the lowest buyout and there are no wicks.
  const points = history.hourly.map((p) => ({ ...p, time: toWall(p.time, zone), ...(field === "min" ? { market: p.minBuyout, high: undefined } : {}) }));
  if (timeframe === "1h" || timeframe === "4h") {
    // The whole history at every timeframe, evenly spaced: before our own hourly prices, real hourly prices where
    // they are known (earlyHourly), otherwise an estimated value per interval drawn as a faded line.
    const hours = toCandles(points, timeframe);
    return [...earlyIntraday(history, timeframe, field, hours[0]?.time ?? null, zone), ...hours];
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

/** Median of the values within two hours either side: a run of one or two odd hours cannot spike the line. */
export function smoothHours(rows: { time: number; value: number }[]): number[] {
  return rows.map((r, i) => {
    const near: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(rows.length - 1, i + 2); j++) if (Math.abs(rows[j]!.time - r.time) <= 2 * HOUR) near.push(rows[j]!.value);
    near.sort((x, y) => x - y);
    return near.length % 2 ? near[(near.length - 1) / 2]! : Math.round((near[near.length / 2 - 1]! + near[near.length / 2]!) / 2);
  });
}

/**
 * Early hourly prices come from an earlier source whose "median" covers every listing (about 1.5x the lowest buyout); Goldline's
 * market value is within 5% of the lowest buyout for most items. Capping at 1.1x the hour's lowest buyout keeps the
 * history one series (collector/merge-history.ts does the same for days, at 1.25x the day's lowest).
 */
export const EARLY_HOUR_CAP = 1.1;

/**
 * 1H/4H candles for the time before `before` (our first own candle, wall time; null = none): one per interval from
 * the first daily price on, so the time axis stays evenly spaced.
 * - Known hourly prices (earlyHourly) make real candles: the value is smoothed over neighbouring hours, the body runs
 *   from the previous close, and the low wick is the lowest buyout (kept within half the value). No upper wick: the
 *   source's median of all listings is too noisy for one.
 * - Other intervals are estimated: a straight line between the known values (each day's price at noon, and the real
 *   hours), marked `estimated` so the chart draws them as a faded line, never as candles.
 */
export function earlyIntraday(history: ItemHistory, timeframe: "1h" | "4h", field: PriceField, before: number | null, zone = "UTC"): Candle[] {
  const size = TIMEFRAME_SECONDS[timeframe];
  const days = candlesFor({ ...history, hourly: [] }, "1d", field);
  const end = before ?? (days.length ? days.at(-1)!.time + DAY : null);
  const startDay = days[0]?.time;
  if (end == null || startDay == null) return [];

  const hourRows = (history.earlyHourly ?? [])
    .map((p) => ({ time: toWall(p.time, zone), value: field === "min" ? p.min : Math.min(p.market, Math.round(p.min * EARLY_HOUR_CAP)), min: p.min, quantity: p.quantity }))
    .filter((p) => p.time < end)
    .sort((a, b) => a.time - b.time);
  const smooth = smoothHours(hourRows);
  const buckets = new Map<number, { close: number; low: number; volume: number; n: number }>();
  hourRows.forEach((p, i) => {
    const v = smooth[i]!;
    const low = field === "market" ? Math.min(v, Math.max(p.min, Math.round(v * 0.5))) : v;
    const t = bucketStart(p.time, timeframe);
    const b = buckets.get(t);
    if (!b) buckets.set(t, { close: v, low, volume: p.quantity, n: 1 });
    else { b.close = v; b.low = Math.min(b.low, low); b.volume += p.quantity; b.n++; }
  });
  // Hourly prices count only on days they cover at least half of: a few scattered scans would draw lone candles in the
  // middle of the faded line, and the day's price already includes them.
  const perDay = new Map<number, number>();
  for (const t of buckets.keys()) perDay.set(Math.floor(t / DAY) * DAY, (perDay.get(Math.floor(t / DAY) * DAY) ?? 0) + 1);
  const realDays = new Set([...perDay].filter(([, n]) => n >= DAY / size / 2).map(([d]) => d));
  const real = new Map([...buckets].filter(([t]) => realDays.has(Math.floor(t / DAY) * DAY)));

  // Known values for the estimated line: each day's price at noon (days without real hours), then the real hours.
  const anchors: [number, number][] = days.filter((d) => d.time < end && !realDays.has(d.time)).map((d) => [d.time + DAY / 2, d.close]);
  for (const [t, r] of real) anchors.push([t, r.close]);
  anchors.sort((a, b) => a[0] - b[0]);
  const estimate = linear(anchors);

  const out: Candle[] = [];
  let prev: number | null = null;
  for (let t = startDay; t < end; t += size) {
    const r = real.get(t);
    if (r) {
      const open = prev ?? r.close;
      out.push({ time: t, open, high: Math.max(open, r.close), low: Math.min(open, r.low, r.close), close: r.close, volume: Math.round(r.volume / r.n) });
      prev = r.close;
    } else {
      const v = estimate(t);
      if (v == null) continue;
      out.push({ time: t, open: v, high: v, low: v, close: v, volume: 0, estimated: true });
      prev = v;
    }
  }
  return out;
}

/** Straight lines between sorted [time, value] anchors; flat before the first and after the last. Call with rising t. */
function linear(anchors: [number, number][]): (t: number) => number | null {
  let i = 0;
  return (t) => {
    if (!anchors.length) return null;
    if (t <= anchors[0]![0]) return anchors[0]![1];
    while (i < anchors.length - 1 && anchors[i + 1]![0] <= t) i++;
    const [t0, v0] = anchors[i]!;
    if (i === anchors.length - 1) return v0;
    const [t1, v1] = anchors[i + 1]!;
    return Math.round(v0 + ((v1 - v0) * (t - t0)) / (t1 - t0));
  };
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
