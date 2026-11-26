/**
 * Weekly market recap, computed from Goblin Ledger's own price history for every house.
 *
 *   node collector/weekly.ts <dataDir>        writes weekly/<house>.json (after collector/indexes.ts)
 *
 * The week is the 7 days (168 hours) up to the house's latest snapshot. Every number comes from stored prices:
 * - indexes: each index's change over the week (index/<house>.json);
 * - risers and fallers: the item's price now against a week ago (median of 7 hourly prices, as the indexes do), among
 *   items that really trade (src/lib/overview.ts rules);
 * - new highs and lows: a daily close this week above or below every daily close before it (at least 7 earlier days,
 *   early history included);
 * - flips and crafts: the app's own rules (quickFlips, topCrafts) replayed on the prices of the week, every 6 hours for
 *   flips and once a day for crafts, and how each one turned out at today's prices.
 * A section is null when the history is too short for it (the app then says "not enough data yet"). Nothing is
 * interpolated or guessed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { latestRow, type ItemHistory } from "./store.ts";
import { toQuote, houseCut, type Quote } from "../src/lib/quotes.ts";
import { NOISY_CLASSES, isGear, isLiquid, overviewClass, quickFlips, topCrafts, type ClassOf } from "../src/lib/overview.ts";
import { bestCost, craftProfit, parseRecipes, type RecipeBook, type RecipeRow } from "../src/lib/crafting.ts";
import { categoryOf } from "../src/lib/categories.ts";

/** Raid consumables: what raiders buy before raid night (the Raid prep index uses the same subcategories). */
export const RAID_SUBS: readonly string[] = ["flask", "elixir", "potion"];

const HOUR = 3_600;
const DAY = 86_400;
export const WEEK_HOURS = 168;
const SMOOTH_HOURS = 7;
const LIMIT = 5;
/** Movers: same liquidity bar as the Market tab (5+ sold a day, 20 gold traded a day, 20+ listed, at most x3 or /3). */
const MIN_SOLD = 5;
const MIN_VALUE = 200_000;
const MIN_LISTED = 20;
const MAX_RATIO = 3;
/** A record must beat the old one by 2% and have at least 7 earlier days behind it. */
const RECORD_MARGIN = 0.02;
const MIN_PRIOR_DAYS = 7;
const FLIP_EVERY_HOURS = 6;
/** A replayed flip needs this much earlier history: the "usual price" (7-day average) of a few hours means nothing. */
const FLIP_MIN_HISTORY_HOURS = 72;
/** A period longer than our 14 days of hourly rows (a month) is replayed over the hours we have, when at least 13 days. */
const REPLAY_MIN_HOURS = 13 * 24;

export interface WeeklyFile {
  v: 1;
  house: number;
  /** Week start and end, unix seconds (end = the latest snapshot). */
  start: number;
  end: number;
  /** First hour of Goblin Ledger's own hourly prices for this house, unix seconds. */
  ownSince: number;
  /** [index id, value a week ago, value now, change %]; null without a value a week ago. */
  indexes: [string, number, number, number][] | null;
  /** [item, price a week ago, price now, change %, sold per day]. */
  risers: [number, number, number, number, number][] | null;
  fallers: [number, number, number, number, number][] | null;
  /** [item, record close, day of the record (unix seconds), previous record, earlier days compared, sold per day]. */
  highs: [number, number, number, number, number, number][] | null;
  lows: [number, number, number, number, number, number][] | null;
  /** Flips found during the week: [item, found at, buy, resale target, profit then, market now | 0, result now % | null, reached target 0/1, sold per day then]. */
  flips: { found: number; paid: number; reached: number; rows: [number, number, number, number, number, number, number | null, number, number?][] } | null;
  /** Crafts found during the week: [item, found at, best profit then, % then, profit now | null, % now | null]. */
  crafts: { found: number; stillProfitable: number; rows: [number, number, number, number, number | null, number | null][] } | null;
  /** Most traded items (since 1.2): [item, gold traded per day (copper), sold per day, market now, change % | null]. */
  traded?: [number, number, number, number, number | null][] | null;
  /** Raid consumables, flasks, elixirs and potions (since 1.2): units sold per day, the period before, change %, and the
   * busiest ones [item, sold per day, market now, price change % | null]. */
  raid?: { soldPerDay: number; prevSoldPerDay: number | null; change: number | null; rows: [number, number, number, number | null][] } | null;
}

export interface WeeklyInput {
  house: number;
  faction: string;
  histories: Map<number, ItemHistory>;
  /** Early daily market values: item -> day index -> price. */
  early: Map<number, Map<number, number>>;
  classOf: ClassOf;
  indexes: Record<string, { hourly: [number, number][] }>;
  book: RecipeBook | null;
  /** Raid consumables (flasks, elixirs, potions); without it the raid section is left out. */
  raidItem?: (id: number) => boolean;
}

/** The item's quote as the app would have seen it at hour `h` (null when not listed within 3 hours before). */
export function quoteAt(id: number, history: ItemHistory, h: number): Quote | null {
  let n = history.h.length;
  while (n > 0 && history.h[n - 1]![0] > h) n--;
  if (n === 0 || history.h[n - 1]![0] < h - 3) return null;
  const row = latestRow({ h: history.h.slice(0, n), d: [] });
  return row ? toQuote(id, row) : null;
}

/** Median of the market prices in the SMOOTH_HOURS hours up to h; null without one. */
export function smoothAt(history: ItemHistory, h: number): number | null {
  const v = history.h.filter((r) => r[0] > h - SMOOTH_HOURS && r[0] <= h).map((r) => r[2]).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2]! : Math.round((v[v.length / 2 - 1]! + v[v.length / 2]!) / 2);
}

/**
 * One price per day: early days first, then our own daily candles' close, then, for days our hourly prices cover, the
 * median of that day's hourly prices (a single odd hour cannot set a record). Later sources win on the same day.
 */
export function dailyCloses(history: ItemHistory, early: Map<number, number> | undefined): Map<number, number> {
  const out = new Map<number, number>(early ?? []);
  for (const d of history.d) out.set(d[0], d[4]);
  const byDay = new Map<number, number[]>();
  for (const r of history.h) {
    const day = Math.floor((r[0] * HOUR) / DAY);
    byDay.set(day, [...(byDay.get(day) ?? []), r[2]]);
  }
  for (const [day, v] of byDay) {
    v.sort((a, b) => a - b);
    out.set(day, v.length % 2 ? v[(v.length - 1) / 2]! : Math.round((v[v.length / 2 - 1]! + v[v.length / 2]!) / 2));
  }
  return out;
}

const traded = (q: Quote) => (q.soldAvg7d ?? q.soldPerDay ?? 0);

/** How often the flip and craft rules are replayed, by period length: about 28 times a period, at most daily. */
export function replaySteps(hours: number): { flip: number; craft: number } {
  if (hours <= 24) return { flip: 2, craft: 6 };
  if (hours <= WEEK_HOURS) return { flip: FLIP_EVERY_HOURS, craft: 24 };
  return { flip: 24, craft: 24 };
}

/**
 * The item's price at the start of a period: the 7-hour median when our hourly prices reach that far back, else the
 * daily close of that day or of the 2 days before it (hourly rows are kept 14 days, daily candles and early days
 * longer), else the first daily close in the 7 days after it, else null.
 */
export function startPrice(history: ItemHistory, early: Map<number, number> | undefined, startH: number, endH: number = startH + WEEK_HOURS): number | null {
  const s = smoothAt(history, startH);
  if (s != null) return s;
  if (history.h.length && history.h[0]![0] <= startH) return null;
  const closes = dailyCloses({ h: [], d: history.d }, early);
  const day = Math.floor((startH * HOUR) / DAY);
  for (let d = day; d >= day - 2; d--) {
    const v = closes.get(d);
    if (v != null && v > 0) return v;
  }
  // A period that starts before the item first traded (November 2026 starts before launch): its first price, within 7 days.
  const lastDay = Math.floor((endH * HOUR) / DAY) - 1;
  for (let d = day + 1; d <= Math.min(day + 7, lastDay); d++) {
    const v = closes.get(d);
    if (v != null && v > 0) return v;
  }
  return null;
}

/** Hourly rows of an item within (fromH, toH]. */
const rowsIn = (h: ItemHistory, fromH: number, toH: number) => h.h.filter((r) => r[0] > fromH && r[0] <= toH);

/**
 * One recap of a house over (startH, endH] (hour indexes). The weekly recap of the Market tab is the 168 hours up to
 * the latest snapshot (buildWeekly); the daily, weekly and monthly recaps (collector/recaps.ts) use fixed periods.
 */
export function buildRecap(input: WeeklyInput, startH: number, endH: number): WeeklyFile | null {
  let ownSinceH = Infinity;
  let any = false;
  for (const h of input.histories.values()) {
    if (!h.h.length) continue;
    any = true;
    ownSinceH = Math.min(ownSinceH, h.h[0]![0]);
  }
  if (!any) return null;
  const hours = endH - startH;
  const steps = replaySteps(hours);
  const cut = houseCut(input.faction);

  // Quotes of every item listed at the end of the period.
  const now = new Map<number, Quote>();
  for (const [id, h] of input.histories) {
    const q = quoteAt(id, h, endH);
    if (q) now.set(id, q);
  }
  const busy = (id: number) => {
    const q = now.get(id);
    if (q == null || !isLiquid(q, input.classOf(id))) return null;
    return q.listed >= MIN_LISTED && traded(q) >= MIN_SOLD && traded(q) * q.market >= MIN_VALUE ? q : null;
  };

  // Indexes: value at the end against the value at or before the start.
  let indexes: WeeklyFile["indexes"] = [];
  for (const [id, s] of Object.entries(input.indexes)) {
    const last = [...s.hourly].reverse().find(([x]) => x <= endH);
    if (!last || last[0] < endH - 3) continue;
    const before = [...s.hourly].reverse().find(([x]) => x <= startH);
    if (!before || before[1] <= 0) continue;
    indexes.push([id, before[1], last[1], ((last[1] - before[1]) / before[1]) * 100]);
  }
  if (!indexes.length) indexes = null;

  // Risers and fallers: price at the end (7-hour median) against the price at the start.
  const startPrices = new Map<number, number>();
  const moves: [number, number, number, number, number][] = [];
  for (const [id, h] of input.histories) {
    const a = startPrice(h, input.early.get(id), startH, endH);
    if (a != null && a > 0) startPrices.set(id, a);
    const q = busy(id);
    const b = smoothAt(h, endH);
    if (!q || a == null || b == null || a <= 0) continue;
    const ratio = b / a;
    if (ratio > MAX_RATIO || ratio < 1 / MAX_RATIO) continue;
    moves.push([id, a, b, (ratio - 1) * 100, Math.round(traded(q))]);
  }
  const risers = moves.length ? moves.filter((m) => m[3] > 0).sort((x, y) => y[3] - x[3]).slice(0, LIMIT) : null;
  const fallers = moves.length ? moves.filter((m) => m[3] < 0).sort((x, y) => x[3] - y[3]).slice(0, LIMIT) : null;

  // New highs and lows: a daily close in the period beyond every earlier close (at least MIN_PRIOR_DAYS of them).
  const startDay = Math.floor(((startH + 1) * HOUR) / DAY);
  const highs: [number, number, number, number, number, number][] = [];
  const lows: [number, number, number, number, number, number][] = [];
  let anyPrior = false;
  for (const [id, h] of input.histories) {
    const q = busy(id);
    if (!q) continue;
    const closes = [...dailyCloses({ h: h.h.filter((r) => r[0] <= endH), d: h.d }, input.early.get(id))].filter(([d, v]) => v > 0 && d * DAY <= endH * HOUR).sort((a, b) => a[0] - b[0]);
    const prior = closes.filter(([d]) => d < startDay);
    const period = closes.filter(([d]) => d >= startDay);
    if (prior.length < MIN_PRIOR_DAYS || !period.length) continue;
    anyPrior = true;
    const pMax = Math.max(...prior.map(([, v]) => v));
    const pMin = Math.min(...prior.map(([, v]) => v));
    const top = period.reduce((a, b) => (b[1] > a[1] ? b : a));
    const bottom = period.reduce((a, b) => (b[1] < a[1] ? b : a));
    const sold = Math.round(traded(q));
    // A record more than x3 beyond the old one is a relisted stack, not a market move.
    if (top[1] > pMax * (1 + RECORD_MARGIN) && top[1] <= pMax * MAX_RATIO) highs.push([id, top[1], top[0] * DAY, pMax, prior.length, sold]);
    if (bottom[1] < pMin * (1 - RECORD_MARGIN) && bottom[1] >= pMin / MAX_RATIO) lows.push([id, bottom[1], bottom[0] * DAY, pMin, prior.length, sold]);
  }
  // The most traded items first: a record on a busy market matters more than one on a quiet one.
  const value = (r: [number, number, number, number, number, number]) => r[5] * (now.get(r[0])?.market ?? 0);
  const recordHighs = anyPrior ? highs.sort((a, b) => value(b) - value(a)).slice(0, LIMIT) : null;
  const recordLows = anyPrior ? lows.sort((a, b) => value(b) - value(a)).slice(0, LIMIT) : null;

  // The replays (flips, crafts, sales) need our own hourly prices: from the start, or from the first hours we have.
  const replayFrom = Math.max(startH, ownSinceH);
  const covered = endH - replayFrom;
  // A full period, or (for a month: hourly rows are kept 14 days) at least 13 days of it.
  const replayable = ownSinceH <= startH || covered >= REPLAY_MIN_HOURS;

  // Most traded: estimated units sold over the covered hours, per day, times the market price at the end.
  let tradedRows: NonNullable<WeeklyFile["traded"]> | null = null;
  if (replayable) {
    const days = Math.max(1, covered) / 24;
    const rows: NonNullable<WeeklyFile["traded"]> = [];
    for (const [id, h] of input.histories) {
      const q = now.get(id);
      const cls = input.classOf(id);
      if (!q || !isLiquid(q, cls)) continue;
      const sold = rowsIn(h, replayFrom, endH).reduce((s, r) => s + Math.max(0, r[5] ?? 0), 0) / days;
      if (sold < MIN_SOLD) continue;
      const a = startPrices.get(id);
      const change = a != null && a > 0 ? (q.market / a - 1) * 100 : null;
      rows.push([id, Math.round(sold * q.market), Math.round(sold), q.market, change != null && Math.abs(change) <= (MAX_RATIO - 1) * 100 ? change : null]);
    }
    tradedRows = rows.sort((a, b) => b[1] - a[1]).slice(0, LIMIT);
  }

  // Raid consumables (flasks, elixirs, potions): units sold per day in the period against the period before.
  let raid: WeeklyFile["raid"] = null;
  if (replayable && input.raidItem) {
    const days = Math.max(1, covered) / 24;
    const prevFrom = replayFrom - covered;
    const prevCovered = ownSinceH <= prevFrom;
    let sold = 0;
    let prevSold = 0;
    const rows: [number, number, number, number | null][] = [];
    for (const [id, h] of input.histories) {
      if (!input.raidItem(id)) continue;
      const s = rowsIn(h, replayFrom, endH).reduce((x, r) => x + Math.max(0, r[5] ?? 0), 0) / days;
      sold += s;
      if (prevCovered) prevSold += rowsIn(h, prevFrom, replayFrom).reduce((x, r) => x + Math.max(0, r[5] ?? 0), 0) / days;
      const q = now.get(id);
      if (!q || !isLiquid(q, input.classOf(id)) || s < 1) continue;
      const a = startPrices.get(id);
      rows.push([id, Math.round(s), q.market, a != null && a > 0 && q.market / a <= MAX_RATIO && q.market / a >= 1 / MAX_RATIO ? (q.market / a - 1) * 100 : null]);
    }
    rows.sort((a, b) => b[1] * b[2] - a[1] * a[2]);
    raid = {
      soldPerDay: Math.round(sold),
      prevSoldPerDay: prevCovered ? Math.round(prevSold) : null,
      change: prevCovered && prevSold > 0 ? (sold / prevSold - 1) * 100 : null,
      rows: rows.slice(0, LIMIT),
    };
  }

  // Flips the Market tab would have shown during the period, and how they turned out.
  let flips: WeeklyFile["flips"] = null;
  if (replayable) {
    // Only items that trade at all (the rules ask 3+ sold a day): replaying every item is wasted work.
    const candidates = [...input.histories].filter(([id, h]) => {
      const sold = rowsIn(h, replayFrom, endH).reduce((s, r) => s + (r[5] ?? 0), 0);
      const cls = input.classOf(id);
      return sold >= (3 * Math.max(covered, 24)) / 24 && !isGear(cls) && !NOISY_CLASSES.includes(cls!);
    });
    const found = new Map<number, { at: number; buy: number; sell: number; profit: number; sold: number }>();
    for (let s = replayFrom + steps.flip; s <= endH - steps.flip; s += steps.flip) {
      if (s - ownSinceH < FLIP_MIN_HISTORY_HOURS) continue;
      const quotes: Quote[] = [];
      for (const [id, h] of candidates) {
        const q = quoteAt(id, h, s);
        if (q) quotes.push(q);
      }
      // Sales filter: a flip is only worth listing when the item sells at least MIN_SOLD a day.
      for (const f of quickFlips(quotes, input.classOf, cut, { limit: 20, minSold: MIN_SOLD })) {
        if (!found.has(f.quote.id)) found.set(f.quote.id, { at: s, buy: f.buy, sell: f.sell, profit: f.profit, sold: Math.round(traded(f.quote)) });
      }
    }
    const rows: NonNullable<WeeklyFile["flips"]>["rows"] = [];
    for (const [id, f] of found) {
      const h = input.histories.get(id)!;
      const market = smoothAt(h, endH);
      const result = market != null ? ((market * (1 - cut) - f.buy) / f.buy) * 100 : null;
      const reached = h.h.some((r) => r[0] > f.at && r[0] <= endH && r[2] >= f.sell) ? 1 : 0;
      rows.push([id, f.at * HOUR, f.buy, f.sell, f.profit, market ?? 0, result, reached, f.sold]);
    }
    rows.sort((a, b) => b[4] - a[4]);
    flips = {
      found: rows.length,
      paid: rows.filter((r) => r[6] != null && r[6] > 0).length,
      reached: rows.filter((r) => r[7] === 1).length,
      rows: rows.slice(0, LIMIT),
    };
  }

  // Crafts the Market tab would have shown, and their margin at the end of the period.
  let crafts: WeeklyFile["crafts"] = null;
  if (replayable && input.book) {
    const book = input.book;
    const ids = new Set<number>();
    for (const r of book.all) {
      ids.add(r.item);
      for (const g of r.reagents) ids.add(g.id);
    }
    const best = new Map<number, { at: number; profit: number; pct: number }>();
    for (let s = Math.min(replayFrom + steps.craft, endH); s <= endH; s += steps.craft) {
      const quotes = new Map<number, Quote>();
      for (const id of ids) {
        const h = input.histories.get(id);
        const q = h ? quoteAt(id, h, s) : null;
        if (q) quotes.set(id, q);
      }
      for (const c of topCrafts(book, quotes, "market", cut, 10)) {
        const prev = best.get(c.item);
        if (!prev || c.profit > prev.profit) best.set(c.item, { at: prev?.at ?? s, profit: c.profit, pct: c.pct });
      }
    }
    const rows: [number, number, number, number, number | null, number | null][] = [];
    for (const [item, b] of best) {
      const sell = now.get(item)?.market;
      const cost = bestCost(book.byItem.get(item), (id) => now.get(id)?.market, book.vendor);
      const { profit, pct } = craftProfit(cost?.perItem ?? null, sell, cut);
      rows.push([item, b.at * HOUR, b.profit, b.pct, profit, pct]);
    }
    rows.sort((a, b) => b[2] - a[2]);
    crafts = { found: rows.length, stillProfitable: rows.filter((r) => r[4] != null && r[4] > 0).length, rows: rows.slice(0, LIMIT) };
  }

  return {
    v: 1,
    house: input.house,
    start: startH * HOUR,
    end: endH * HOUR,
    ownSince: ownSinceH * HOUR,
    indexes,
    risers,
    fallers,
    highs: recordHighs,
    lows: recordLows,
    flips,
    crafts,
    traded: tradedRows,
    raid,
  };
}

/** The rolling weekly recap of the Market tab: the `weekHours` hours up to the house's latest snapshot. */
export function buildWeekly(input: WeeklyInput, weekHours: number = WEEK_HOURS): WeeklyFile | null {
  let endH = -Infinity;
  for (const h of input.histories.values()) if (h.h.length) endH = Math.max(endH, h.h.at(-1)![0]);
  if (!Number.isFinite(endH)) return null;
  return buildRecap(input, endH - weekHours, endH);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readShards<T>(dir: string): Map<number, T> {
  const out = new Map<number, T>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    for (const [id, v] of Object.entries(readJson<{ items: Record<string, T> }>(join(dir, f)).items)) out.set(Number(id), v);
  }
  return out;
}

/** What every house shares: houses, item classes, raid consumables and the recipe book. */
export interface RecapContext {
  houses: { id: number; faction: string }[];
  classOf: ClassOf;
  raidItem: (id: number) => boolean;
  book: RecipeBook | null;
  /** Item names from items.json (English, French). */
  names: Map<number, { en: string; fr: string }>;
}

export function loadContext(dataDir: string): RecapContext {
  const meta = readJson<{ houses: { id: number; faction: string }[] }>(join(dataDir, "meta.json"));
  const rows = readJson<Record<string, [string, string, number, number, number, string]>>(join(dataDir, "items.json"));
  const classOf: ClassOf = (id) => {
    const r = rows[id];
    return r ? overviewClass({ itemClass: r[3], name: { en: r[0] } }) : undefined;
  };
  const raidItem = (id: number) => {
    const r = rows[id];
    if (!r) return false;
    const [c, sub] = categoryOf({ itemClass: r[3], subclass: r[4] });
    return c === "consumable" && RAID_SUBS.includes(sub);
  };
  const recipeFile = new URL("../src/data/recipes.json", import.meta.url);
  const book = existsSync(recipeFile) ? parseRecipes(JSON.parse(readFileSync(recipeFile, "utf8")) as { recipes: RecipeRow[]; vendor: Record<string, number> }) : null;
  const names = new Map(Object.entries(rows).map(([id, r]) => [Number(id), { en: r[0], fr: r[1] || r[0] }]));
  return { houses: meta.houses, classOf, raidItem, book, names };
}

/** One house's price history and index series, as buildRecap reads them. */
export function loadHouse(dataDir: string, ctx: RecapContext, house: number, faction: string): WeeklyInput {
  const histories = readShards<ItemHistory>(join(dataDir, "h2", String(house)));
  const early = new Map([...readShards<number[][]>(join(dataDir, "early", String(house)))].map(([id, r]) => [id, new Map(r.map((x) => [x[0]!, x[1]!]))]));
  const indexFile = join(dataDir, "index", `${house}.json`);
  const indexes = existsSync(indexFile) ? readJson<{ indexes: Record<string, { hourly: [number, number][] }> }>(indexFile).indexes : {};
  return { house, faction, histories, early, classOf: ctx.classOf, indexes, book: ctx.book, raidItem: ctx.raidItem };
}

export function weeklyLog(file: WeeklyFile): string {
  return `${new Date(file.start * 1000).toISOString().slice(0, 13)}..${new Date(file.end * 1000).toISOString().slice(0, 13)}, movers ${file.risers ? `${file.risers.length}/${file.fallers!.length}` : "n/a"}, records ${file.highs ? `${file.highs.length}/${file.lows!.length}` : "n/a"}, flips ${file.flips?.found ?? "n/a"}, crafts ${file.crafts?.found ?? "n/a"}, traded ${file.traded?.length ?? "n/a"}`;
}

function main(): void {
  const dataDir = process.argv[2]!;
  // `--hours N` shortens the week for a local preview of a house with less than 7 days of hourly prices. The collector
  // never passes it: published files always cover 168 hours.
  const hoursArg = process.argv.indexOf("--hours");
  const weekHours = hoursArg > 0 ? Number(process.argv[hoursArg + 1]) : WEEK_HOURS;
  const ctx = loadContext(dataDir);
  mkdirSync(join(dataDir, "weekly"), { recursive: true });
  for (const { id: house, faction } of ctx.houses) {
    const started = Date.now();
    const file = buildWeekly(loadHouse(dataDir, ctx, house, faction), weekHours);
    if (!file) continue;
    writeFileSync(join(dataDir, "weekly", `${house}.json`), JSON.stringify(file));
    console.log(`weekly ${house}: ${weeklyLog(file)} (${Date.now() - started} ms)`);
  }
}

if (process.argv[1]?.endsWith("weekly.ts")) main();
