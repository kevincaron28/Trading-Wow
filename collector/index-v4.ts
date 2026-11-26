/**
 * Index method 4 (docs/INDEXES.md): the formula, the point-in-time baskets and the review calendar. Pure functions
 * (no network, no file system). collector/backfill-indexes.ts builds the series from the first day of data with it, and
 * collector/indexes.ts keeps an index on method 4 once its stored file is one.
 *
 * - Value = level at the period start x exp(sum(weight x ln(price now / price at the period start))): a weighted
 *   geometric mean of price relatives with weights fixed for the period.
 * - Price: the median of the last 7 hourly market values, held within x2 or /2 of the median of the 72 hours before
 *   (daily values before our own hourly data: within x2 or /2 of the median of the 3 days before).
 * - Weight: the median daily gold traded over the selection window (before sales are known: median daily gold listed),
 *   capped per item.
 * - Baskets use only what was known at the time, except the very first one: it comes from the first five days (5 to
 *   9 November), because one launch-day snapshot is full of joke prices. The new basket starts from the old basket's
 *   level at the same prices, so a review never moves the index.
 */
import { HOURLY_KEEP_SECONDS } from "./store.ts";
import { MIN_BASKET, MIN_SOLD, RULES, capWeights, isQuarterly, rebalanceTimes, type IndexDef, type IndexFile, type Period, type Series } from "./indexes.ts";

const HOUR = 3_600;
const DAY = 86_400;
/** Hours of hourly rows the collector keeps for every listed item (14 days). */
const KEPT_HOURS = HOURLY_KEEP_SECONDS / HOUR;

export interface Params {
  /** Hourly prices are the median of this many hours. */
  smoothHours: number;
  /** A price is held within x guard or / guard of its recent median (Infinity turns this off). */
  guard: number;
  guardHours: number;
  guardDays: number;
  /** In the value, one item's price counts as at most x ratio or / ratio of its price at the period start. */
  ratio: number;
  /** The first basket's selection window ends on this day (index): the formation days. */
  formationDay: number;
  /** A price older than this many hours (daily phase: days) is left out. */
  staleHours: number;
  staleDays: number;
  /** "geometric" is the method; "arithmetic" exists to compare the two (docs/INDEXES.md, "Tests"). */
  mean: "geometric" | "arithmetic";
}

export const PARAMS: Readonly<Params> = { smoothHours: 7, guard: 2, guardHours: 72, guardDays: 3, ratio: 3, formationDay: Date.UTC(2026, 10, 9) / 86_400_000, staleHours: 72, staleDays: 3, mean: "geometric" };
export const METHOD4 = 4;
/** Fewer recent reference prices than this: the guard has nothing to compare with and does nothing. */
const GUARD_MIN_HOURS = 12;
export const LAUNCH_DAY4 = Date.UTC(2026, 10, 4) / (DAY * 1000);
/** The first weekly reset after our own hourly data has run for (nearly) a week: the last launch review. */
export const LAUNCH_REVIEWS: readonly number[] = [10, 17, 24].map((d) => Date.UTC(2026, 10, d, 15) / 1000);
/** Base of the houses without earlier history: the close of our first day of hourly data (18 Nov). */
export const HOURLY_BASE = Date.UTC(2026, 10, 19) / 1000;
/**
 * Last day close on which such a series can start between reviews (19 to 23 Nov): five formation days, as at launch.
 * A series that has not formed by then starts at a monthly review.
 */
export const HOURLY_FORMATION_END = Date.UTC(2026, 10, 23) / 1000;

/** Early daily rows per item: day index -> [market value, quantity listed]. */
export type DailySeries = Map<number, Map<number, [price: number, qty: number]>>;
export type Catalog = Map<number, { itemClass: number; subclass: number }>;

export type Period4 = Period & { daily?: boolean; splice?: boolean };
export interface IndexFile4 extends Omit<IndexFile, "periods"> {
  periods: Period4[];
  method: number;
}

const median = (v: number[]): number => {
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};

const hold = (price: number, ref: number, k: number) => Math.min(ref * k, Math.max(ref / k, price));

/** The price method 4 uses for an item at hour h: smoothed and held near its recent level; null when stale. */
export function priceHour(s: Series | undefined, h: number, p: Params = PARAMS): number | null {
  if (!s) return null;
  const recent: number[] = [];
  for (let k = h - p.smoothHours + 1; k <= h; k++) {
    const v = s.price.get(k);
    if (v != null && v > 0) recent.push(v);
  }
  let price: number | null = recent.length ? median(recent) : null;
  if (price == null) {
    for (let k = h - p.smoothHours; k > h - p.staleHours; k--) {
      const v = s.price.get(k);
      if (v != null && v > 0) { price = v; break; }
    }
  }
  if (price == null) return null;
  const ref: number[] = [];
  const end = h - p.smoothHours;
  for (let k = end - p.guardHours + 1; k <= end; k++) {
    const v = s.price.get(k);
    if (v != null && v > 0) ref.push(v);
  }
  return ref.length >= GUARD_MIN_HOURS ? hold(price, median(ref), p.guard) : price;
}

/** The same for a day of the early daily history. */
export function priceDay(days: Map<number, [number, number]> | undefined, d: number, p: Params = PARAMS): number | null {
  if (!days) return null;
  let price: number | null = null;
  let at = d;
  for (; at > d - p.staleDays; at--) {
    const v = days.get(at)?.[0];
    if (v != null && v > 0) { price = v; break; }
  }
  if (price == null) return null;
  const ref: number[] = [];
  for (let k = at - p.guardDays; k < at; k++) {
    const v = days.get(k)?.[0];
    if (v != null && v > 0) ref.push(v);
  }
  return ref.length ? hold(price, median(ref), p.guard) : price;
}

/** Items with a price a basket needs before it gives a value. */
const need = (basket: Period["basket"]) => Math.min(MIN_BASKET, basket.length);

/**
 * Value of a basket given each item's price; unpriced items are left out and the other weights renormalised.
 * Null when fewer than MIN_BASKET items are priced.
 */
export function value(period: Pick<Period, "level" | "basket">, price: (id: number) => number | null, p: Params = PARAMS): number | null {
  let sum = 0;
  let weights = 0;
  let n = 0;
  for (const [id, w, p0] of period.basket) {
    const now = price(id);
    if (now == null || !(p0 > 0)) continue;
    const relative = hold(now / p0, 1, p.ratio);
    sum += w * (p.mean === "geometric" ? Math.log(relative) : relative);
    weights += w;
    n++;
  }
  if (n < need(period.basket) || weights <= 0) return null;
  return period.level * (p.mean === "geometric" ? Math.exp(sum / weights) : sum / weights);
}

interface Candidate { id: number; value: number; p0: number }

/** Rank the candidates (buffer for constituents), cap the weights, and give the basket. */
function toBasket(def: IndexDef, scored: Candidate[], incumbents: readonly number[] | undefined): Period["basket"] {
  scored.sort((a, b) => b.value - a.value || a.id - b.id);
  let top = scored.slice(0, def.size);
  if (incumbents?.length) {
    const inc = new Set(incumbents);
    const stay = scored.slice(0, Math.ceil(def.size * RULES.buffer)).filter((x) => inc.has(x.id));
    const join = scored.filter((x) => !inc.has(x.id)).slice(0, Math.max(0, def.size - stay.length));
    top = [...stay, ...join].sort((a, b) => b.value - a.value || a.id - b.id).slice(0, def.size);
  }
  if (top.length < MIN_BASKET) return [];
  const weights = capWeights(top.map((x) => x.value), def.cap);
  return top.map((x, i) => [x.id, Math.round(weights[i]! * 1e6) / 1e6, Math.round(x.p0 * 1e4) / 1e4]);
}

const inUniverse = (def: IndexDef, catalog: Catalog, id: number) => {
  const info = catalog.get(id);
  return !!info && def.select(info);
};

/**
 * Basket from our hourly data before time t (sales are known): liquid items (RULES), ranked by their median daily gold
 * traded over the window, so one odd day cannot buy a weight. p0 is the price at the last hour before t.
 */
export function selectHourly(def: IndexDef, items: Map<number, Series>, catalog: Catalog, t: number, windowHours: number, houseHours: ReadonlySet<number>, incumbents?: readonly number[], p: Params = PARAMS): Period["basket"] {
  const end = Math.floor(t / HOUR) - 1;
  const hours: number[] = [];
  for (let k = end - windowHours + 1; k <= end; k++) if (houseHours.has(k)) hours.push(k);
  if (!hours.length) return [];
  const days = hours.length / 24;
  // 24-hour blocks counted back from t; a block counts when the house has at least 12 hours of data in it.
  const blocks = new Map<number, number[]>();
  for (const k of hours) {
    const b = Math.floor((end - k) / 24);
    let list = blocks.get(b);
    if (!list) blocks.set(b, (list = []));
    list.push(k);
  }
  const full = [...blocks.values()].filter((b) => b.length >= 12);
  const used = full.length ? full : [...blocks.values()];
  const scored: Candidate[] = [];
  for (const [id, s] of items) {
    if (!inUniverse(def, catalog, id)) continue;
    const prices: number[] = [];
    let sold = 0;
    for (const k of hours) {
      const v = s.price.get(k);
      if (v != null && v > 0) prices.push(v);
      sold += Math.max(0, s.sold.get(k) ?? 0);
    }
    if (sold < MIN_SOLD || sold / days < RULES.minSoldPerDay || prices.length < Math.max(1, Math.floor(hours.length / 2))) continue;
    if ((sold * median(prices)) / days < RULES.minDailyValue) continue;
    const daily = used.map((block) => {
      const q: number[] = [];
      let n = 0;
      for (const k of block) {
        const v = s.price.get(k);
        if (v != null && v > 0) q.push(v);
        n += Math.max(0, s.sold.get(k) ?? 0);
      }
      return q.length ? (n * median(q) * 24) / block.length : 0;
    });
    const traded = median(daily);
    const p0 = priceHour(s, end, p);
    if (traded > 0 && p0 != null) scored.push({ id, value: traded, p0 });
  }
  return toBasket(def, scored, incumbents);
}

/**
 * Basket from the early daily history over the days [from, to]: no sales are known, so items rank by their median
 * daily gold listed (quantity x market value; docs/INDEXES.md gives how well this stands in for gold traded). They must
 * be listed on at least half of the days and list at least 1 gold on a typical day. p0 is the price on day `priced`
 * (items without one are left out).
 */
export function selectDaily(def: IndexDef, daily: DailySeries, catalog: Catalog, from: number, to: number, priced: number, houseDays: ReadonlySet<number>, incumbents?: readonly number[], p: Params = PARAMS): Period["basket"] {
  const days: number[] = [];
  for (let d = from; d <= to; d++) if (houseDays.has(d)) days.push(d);
  if (!days.length) return [];
  const scored: Candidate[] = [];
  for (const [id, rows] of daily) {
    if (!inUniverse(def, catalog, id)) continue;
    const values = days.map((d) => { const r = rows.get(d); return r && r[0] > 0 ? r[0] * r[1] : 0; });
    if (values.filter((v) => v > 0).length < Math.ceil(days.length / 2)) continue;
    const listed = median(values);
    const p0 = priceDay(rows, priced, p);
    if (listed >= RULES.minDailyValue && p0 != null) scored.push({ id, value: listed, p0 });
  }
  return toBasket(def, scored, incumbents);
}

/** Review times after `after`, up to `until`: the launch reviews, then the monthly calendar of indexes.ts. */
export function reviewTimes(after: number, until: number): { at: number; kind: "launch" | "monthly" | "quarterly" }[] {
  const launch = LAUNCH_REVIEWS.filter((t) => t > after && t <= until).map((at) => ({ at, kind: "launch" as const }));
  const monthly = rebalanceTimes(Math.max(after, LAUNCH_REVIEWS.at(-1)!), until).map((at) => ({ at, kind: isQuarterly(at) ? ("quarterly" as const) : ("monthly" as const) }));
  return [...launch, ...monthly];
}

const windowHoursFor = (kind: "launch" | "monthly" | "quarterly") => (kind === "quarterly" ? RULES.quarterlyWindowHours : RULES.monthlyWindowHours);
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
const round2 = (x: number) => Math.round(x * 100) / 100;

export interface HouseData {
  hourly: Map<number, Series>;
  daily: DailySeries;
}

/**
 * One house's data prepared once for all its indexes. `firstHour` and `lastHour` bound the hours for which every item
 * still has its rows: the collector drops them after 14 days, but only for items still listed, so an item that vanished
 * keeps older ones. Daily values count only before the day our own rows start.
 */
export function prepare(data: HouseData) {
  const all = new Set<number>();
  for (const s of data.hourly.values()) for (const h of s.price.keys()) all.add(h);
  let ownStart = Infinity;
  let lastHour = -Infinity;
  for (const h of all) {
    if (h < ownStart) ownStart = h;
    if (h > lastHour) lastHour = h;
  }
  const firstHour = Math.max(ownStart, lastHour - KEPT_HOURS + 1);
  const hours = new Set([...all].filter((h) => h >= firstHour));
  const days = new Set<number>();
  const cut = Number.isFinite(ownStart) ? Math.floor(ownStart / 24) : Infinity;
  for (const rows of data.daily.values()) for (const d of rows.keys()) if (d >= LAUNCH_DAY4 && d < cut) days.add(d);
  return { ...data, hours, firstHour, lastHour, days, dayList: [...days].sort((a, b) => a - b) };
}
export type Prepared = ReturnType<typeof prepare>;

interface Daily { periods: Period4[]; points: [number, number][] }

/**
 * The first day of the series: the first day on which at least half of the formation basket (chosen from the first
 * days, to `formationDay`) has a price.
 */
function launchBasket(def: IndexDef, data: Prepared, catalog: Catalog, p: Params): { day: number; basket: Period["basket"] } | null {
  const first = data.dayList[0];
  if (first == null) return null;
  for (const day of data.dayList) {
    const to = Math.max(p.formationDay, day);
    const size = selectDaily(def, data.daily, catalog, first, to, to, data.days, undefined, p).length;
    if (!size) continue;
    const basket = selectDaily(def, data.daily, catalog, first, to, day, data.days, undefined, p);
    if (basket.length >= Math.max(MIN_BASKET, Math.ceil(size / 2))) return { day, basket };
  }
  return null;
}

/**
 * The daily segment, from launch to the day before our hourly data starts: base 100 on the first day, then a launch
 * review at each weekly reset (from that day on, values use a basket chosen from the 7 days before it).
 */
function dailySegment(def: IndexDef, data: Prepared, catalog: Catalog, p: Params): Daily | null {
  const start = launchBasket(def, data, catalog, p);
  if (!start) return null;
  const periods: Period4[] = [{ start: start.day * DAY, level: 100, daily: true, basket: start.basket }];
  const points: [number, number][] = [[start.day * 24 + 23, 100]];
  let level = 100;
  let last = start.day;
  for (const d of data.dayList) {
    if (d <= start.day) continue;
    let period = periods.at(-1)!;
    const due = LAUNCH_REVIEWS.filter((t) => t > period.start && Math.floor(t / DAY) <= d).at(-1);
    if (due != null) {
      const day = Math.floor(due / DAY);
      // Base prices are the last point's, so the review itself does not move the level.
      const basket = selectDaily(def, data.daily, catalog, day - 7, day - 1, last, data.days, period.basket.map(([id]) => id), p);
      if (basket.length) periods.push((period = { start: due, level: round4(level), kind: "launch", daily: true, basket }));
    }
    const v = value(period, (id) => priceDay(data.daily.get(id), d, p), p);
    if (v == null) continue;
    level = v;
    last = d;
    points.push([d * 24 + 23, round2(v)]);
  }
  return { periods, points };
}

/**
 * The same basket continued on our hourly prices. The two sources measure prices differently, so no price relative
 * crosses from one to the other: each item's p0 is its hourly price at the first hour. An item first seen later joins
 * at the level the others have reached then.
 */
function splice(daily: Daily, data: Prepared, p: Params): Period4 | null {
  const h0 = data.firstHour;
  const level = daily.points.at(-1)![1];
  const prev = daily.periods.at(-1)!;
  const basket: [number, number, number][] = [];
  const late: [id: number, w: number][] = [];
  for (const [id, w] of prev.basket) {
    const p0 = priceHour(data.hourly.get(id), h0, p);
    if (p0 != null) basket.push([id, w, round4(p0)]);
    else late.push([id, w]);
  }
  if (basket.length < need(prev.basket)) return null;
  const core = { level, basket: [...basket] };
  for (const [id, w] of late) {
    for (let h = h0 + 1; h < h0 + p.staleHours; h++) {
      const price = priceHour(data.hourly.get(id), h, p);
      if (price == null) continue;
      const others = value(core, (x) => priceHour(data.hourly.get(x), h, p), p);
      if (others != null) basket.push([id, w, round4((price * level) / others)]);
      break;
    }
  }
  return { start: h0 * HOUR, level, splice: true, basket };
}

/**
 * The first period of a series without usable earlier history: base 100 at the close of the first of the formation days
 * (while our hourly data still reaches back to them) or, failing those, at a monthly review.
 */
function hourlyBase(def: IndexDef, data: Prepared, catalog: Catalog, p: Params): Period4 | null {
  const closes: number[] = [];
  if (data.firstHour * HOUR < HOURLY_BASE) for (let t = HOURLY_BASE; t <= HOURLY_FORMATION_END; t += DAY) closes.push(t);
  // A review counts only while its whole selection window is still there, so a later run cannot start it differently.
  const reviews = rebalanceTimes(HOURLY_FORMATION_END, data.lastHour * HOUR).filter((t) => t / HOUR - RULES.monthlyWindowHours >= data.firstHour);
  for (const t of [...closes, ...reviews]) {
    if (t / HOUR > data.lastHour) break;
    const basket = selectHourly(def, data.hourly, catalog, t, RULES.monthlyWindowHours, data.hours, undefined, p);
    if (basket.length) return { start: t - HOUR, level: 100, basket };
  }
  return null;
}

/**
 * One index of one house with method 4. Without a stored method-4 file the whole series is built from the first day of
 * data (the backfill). With one, its periods are kept as they are, due reviews are added, and hourly values are
 * recomputed only where the hourly history still holds everything they depend on; older values stay as stored.
 */
export function buildIndex(def: IndexDef, stored: IndexFile4 | null, data: Prepared, catalog: Catalog, now: number, p: Params = PARAMS): IndexFile4 | null {
  if (!Number.isFinite(data.firstHour)) return stored;
  let periods: Period4[];
  let points: [number, number][];
  let earlyUntil: number | undefined;
  let computeFrom: number;
  if (stored) {
    periods = [...stored.periods];
    earlyUntil = stored.earlyUntil;
    const firstHourly = stored.hourly.find(([h]) => h >= (stored.earlyUntil ?? 0))?.[0] ?? data.firstHour;
    const lastStored = stored.hourly.at(-1)?.[0] ?? firstHourly - 1;
    // Hourly rows are dropped after 14 days. While they still reach the start of the series, everything is recomputed;
    // later, a value near the oldest kept row has lost part of its reference, so it stays as stored.
    computeFrom = data.firstHour <= firstHourly ? firstHourly : Math.min(data.firstHour + p.smoothHours + p.guardHours, lastStored + 1);
    points = stored.hourly.filter(([h]) => h < computeFrom);
  } else {
    const daily = dailySegment(def, data, catalog, p);
    // The daily segment is used only when it runs up to our hourly data (no gap of more than a few days).
    const joins = daily && data.firstHour - daily.points.at(-1)![0] <= 24 * p.staleDays;
    const first = joins ? splice(daily, data, p) : null;
    if (daily && first) {
      periods = [...daily.periods, first];
      points = [...daily.points];
      earlyUntil = data.firstHour;
      computeFrom = data.firstHour;
    } else {
      const base = hourlyBase(def, data, catalog, p);
      if (!base) return null;
      periods = [base];
      points = [];
      computeFrom = base.start / HOUR;
    }
  }
  const priceAtHour = (h: number) => (id: number) => priceHour(data.hourly.get(id), h, p);
  // Reviews: due once a snapshot at or after the review time exists, so a late run gives the same result.
  for (const { at, kind } of reviewTimes(periods.at(-1)!.start + HOUR, Math.min(now, data.lastHour * HOUR))) {
    const h = at / HOUR;
    const prev = periods.at(-1)!;
    const level = value(prev, priceAtHour(h - 1), p);
    const quarterly = kind === "quarterly";
    const basket = selectHourly(def, data.hourly, catalog, at, windowHoursFor(kind), data.hours, quarterly ? undefined : prev.basket.map(([id]) => id), p);
    if (level == null || !basket.length) continue;
    periods.push({ start: at, level: round4(level), kind, basket });
  }
  let i = 0;
  for (let h = computeFrom; h <= data.lastHour; h++) {
    while (i + 1 < periods.length && periods[i + 1]!.start <= h * HOUR) i++;
    if (periods[i]!.daily) continue;
    const v = value(periods[i]!, priceAtHour(h), p);
    if (v != null) points.push([h, round2(v)]);
  }
  if (!points.length) return null;
  return {
    id: def.id,
    periods,
    hourly: points,
    ...(earlyUntil != null ? { link: Math.round((periods.find((x) => x.splice)!.level / 100) * 1e6) / 1e6, earlyUntil } : {}),
    method: METHOD4,
  };
}
