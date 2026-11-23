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
  /** Flips found during the week: [item, found at, buy, resale target, profit then, market now | 0, result now % | null, reached target 0/1]. */
  flips: { found: number; paid: number; reached: number; rows: [number, number, number, number, number, number, number | null, number][] } | null;
  /** Crafts found during the week: [item, found at, best profit then, % then, profit now | null, % now | null]. */
  crafts: { found: number; stillProfitable: number; rows: [number, number, number, number, number | null, number | null][] } | null;
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

export function buildWeekly(input: WeeklyInput, weekHours: number = WEEK_HOURS): WeeklyFile | null {
  let endH = -Infinity;
  let ownSinceH = Infinity;
  for (const h of input.histories.values()) {
    if (!h.h.length) continue;
    endH = Math.max(endH, h.h.at(-1)![0]);
    ownSinceH = Math.min(ownSinceH, h.h[0]![0]);
  }
  if (!Number.isFinite(endH)) return null;
  const startH = endH - weekHours;
  const fullWeek = ownSinceH <= startH;
  const cut = houseCut(input.faction);

  // Current quotes of every item listed at the latest snapshot.
  const now = new Map<number, Quote>();
  for (const [id, h] of input.histories) {
    const q = quoteAt(id, h, endH);
    if (q) now.set(id, q);
  }
  const liquidNow = (id: number) => {
    const q = now.get(id);
    return q != null && isLiquid(q, input.classOf(id)) ? q : null;
  };

  // Indexes: value now against the value at or before a week ago.
  let indexes: WeeklyFile["indexes"] = [];
  for (const [id, s] of Object.entries(input.indexes)) {
    const last = s.hourly.at(-1);
    if (!last) continue;
    const before = [...s.hourly].reverse().find(([x]) => x <= last[0] - weekHours);
    if (!before || before[1] <= 0) continue;
    indexes.push([id, before[1], last[1], ((last[1] - before[1]) / before[1]) * 100]);
  }
  if (!indexes.length) indexes = null;

  // Risers and fallers over the week.
  let risers: WeeklyFile["risers"] = null;
  let fallers: WeeklyFile["fallers"] = null;
  if (fullWeek) {
    const moves: [number, number, number, number, number][] = [];
    for (const [id, h] of input.histories) {
      const q = liquidNow(id);
      if (!q || q.listed < MIN_LISTED || traded(q) < MIN_SOLD || traded(q) * q.market < MIN_VALUE) continue;
      const a = smoothAt(h, startH);
      const b = smoothAt(h, endH);
      if (a == null || b == null || a <= 0) continue;
      const ratio = b / a;
      if (ratio > MAX_RATIO || ratio < 1 / MAX_RATIO) continue;
      moves.push([id, a, b, (ratio - 1) * 100, Math.round(traded(q))]);
    }
    risers = moves.filter((m) => m[3] > 0).sort((x, y) => y[3] - x[3]).slice(0, LIMIT);
    fallers = moves.filter((m) => m[3] < 0).sort((x, y) => x[3] - y[3]).slice(0, LIMIT);
  }

  // New highs and lows: a daily close this week beyond every earlier close (at least MIN_PRIOR_DAYS of them).
  const weekStartDay = Math.floor(((startH + 1) * HOUR) / DAY);
  const highs: [number, number, number, number, number, number][] = [];
  const lows: [number, number, number, number, number, number][] = [];
  let anyPrior = false;
  for (const [id, h] of input.histories) {
    const q = liquidNow(id);
    if (!q || q.listed < MIN_LISTED || traded(q) < MIN_SOLD || traded(q) * q.market < MIN_VALUE) continue;
    const closes = [...dailyCloses(h, input.early.get(id))].filter(([, v]) => v > 0).sort((a, b) => a[0] - b[0]);
    const prior = closes.filter(([d]) => d < weekStartDay);
    const week = closes.filter(([d]) => d >= weekStartDay);
    if (prior.length < MIN_PRIOR_DAYS || !week.length) continue;
    anyPrior = true;
    const pMax = Math.max(...prior.map(([, v]) => v));
    const pMin = Math.min(...prior.map(([, v]) => v));
    const top = week.reduce((a, b) => (b[1] > a[1] ? b : a));
    const bottom = week.reduce((a, b) => (b[1] < a[1] ? b : a));
    const sold = Math.round(traded(q));
    // A record more than x3 beyond the old one is a relisted stack, not a market move.
    if (top[1] > pMax * (1 + RECORD_MARGIN) && top[1] <= pMax * MAX_RATIO) highs.push([id, top[1], top[0] * DAY, pMax, prior.length, sold]);
    if (bottom[1] < pMin * (1 - RECORD_MARGIN) && bottom[1] >= pMin / MAX_RATIO) lows.push([id, bottom[1], bottom[0] * DAY, pMin, prior.length, sold]);
  }
  // The most traded items first: a record on a busy market matters more than one on a quiet one.
  const value = (r: [number, number, number, number, number, number]) => r[5] * (now.get(r[0])?.market ?? 0);
  const recordHighs = anyPrior ? highs.sort((a, b) => value(b) - value(a)).slice(0, LIMIT) : null;
  const recordLows = anyPrior ? lows.sort((a, b) => value(b) - value(a)).slice(0, LIMIT) : null;

  // Flips the Market tab would have shown during the week, and how they turned out.
  let flips: WeeklyFile["flips"] = null;
  if (fullWeek) {
    // Only items that trade at all (the rules ask 3+ sold a day): replaying every item every 6 hours is wasted work.
    const candidates = [...input.histories].filter(([id, h]) => {
      const sold = h.h.filter((r) => r[0] > startH).reduce((s, r) => s + (r[5] ?? 0), 0);
      const cls = input.classOf(id);
      return sold >= 21 && !isGear(cls) && !NOISY_CLASSES.includes(cls!);
    });
    const found = new Map<number, { at: number; buy: number; sell: number; profit: number }>();
    for (let s = startH + FLIP_EVERY_HOURS; s <= endH - FLIP_EVERY_HOURS; s += FLIP_EVERY_HOURS) {
      if (s - ownSinceH < FLIP_MIN_HISTORY_HOURS) continue;
      const quotes: Quote[] = [];
      for (const [id, h] of candidates) {
        const q = quoteAt(id, h, s);
        if (q) quotes.push(q);
      }
      for (const f of quickFlips(quotes, input.classOf, cut, { limit: 20 })) {
        if (!found.has(f.quote.id)) found.set(f.quote.id, { at: s, buy: f.buy, sell: f.sell, profit: f.profit });
      }
    }
    const rows: [number, number, number, number, number, number, number | null, number][] = [];
    for (const [id, f] of found) {
      const h = input.histories.get(id)!;
      const market = smoothAt(h, endH);
      const result = market != null ? ((market * (1 - cut) - f.buy) / f.buy) * 100 : null;
      const reached = h.h.some((r) => r[0] > f.at && r[2] >= f.sell) ? 1 : 0;
      rows.push([id, f.at * HOUR, f.buy, f.sell, f.profit, market ?? 0, result, reached]);
    }
    rows.sort((a, b) => b[4] - a[4]);
    flips = {
      found: rows.length,
      paid: rows.filter((r) => r[6] != null && r[6] > 0).length,
      reached: rows.filter((r) => r[7] === 1).length,
      rows: rows.slice(0, LIMIT),
    };
  }

  // Crafts the Market tab would have shown, once a day, and their profit now.
  let crafts: WeeklyFile["crafts"] = null;
  if (fullWeek && input.book) {
    const book = input.book;
    const ids = new Set<number>();
    for (const r of book.all) {
      ids.add(r.item);
      for (const g of r.reagents) ids.add(g.id);
    }
    const best = new Map<number, { at: number; profit: number; pct: number }>();
    for (let s = startH + 24; s <= endH; s += 24) {
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
  };
}

function readJson<T>(path: string): T {
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

function main(): void {
  const dataDir = process.argv[2]!;
  // `--hours N` shortens the week for a local preview of a house with less than 7 days of hourly prices. The collector
  // never passes it: published files always cover 168 hours.
  const hoursArg = process.argv.indexOf("--hours");
  const weekHours = hoursArg > 0 ? Number(process.argv[hoursArg + 1]) : WEEK_HOURS;
  const meta = readJson<{ houses: { id: number; faction: string }[] }>(join(dataDir, "meta.json"));
  const rows = readJson<Record<string, [string, string, number, number, number, string]>>(join(dataDir, "items.json"));
  const classOf: ClassOf = (id) => {
    const r = rows[id];
    return r ? overviewClass({ itemClass: r[3], name: { en: r[0] } }) : undefined;
  };
  const recipeFile = new URL("../src/data/recipes.json", import.meta.url);
  const book = existsSync(recipeFile) ? parseRecipes(JSON.parse(readFileSync(recipeFile, "utf8")) as { recipes: RecipeRow[]; vendor: Record<string, number> }) : null;
  mkdirSync(join(dataDir, "weekly"), { recursive: true });
  for (const { id: house, faction } of meta.houses) {
    const started = Date.now();
    const histories = readShards<ItemHistory>(join(dataDir, "h2", String(house)));
    const early = new Map([...readShards<number[][]>(join(dataDir, "early", String(house)))].map(([id, r]) => [id, new Map(r.map((x) => [x[0]!, x[1]!]))]));
    const indexFile = join(dataDir, "index", `${house}.json`);
    const indexes = existsSync(indexFile) ? readJson<{ indexes: Record<string, { hourly: [number, number][] }> }>(indexFile).indexes : {};
    const file = buildWeekly({ house, faction, histories, early, classOf, indexes, book }, weekHours);
    if (!file) continue;
    writeFileSync(join(dataDir, "weekly", `${house}.json`), JSON.stringify(file));
    console.log(`weekly ${house}: ${new Date(file.start * 1000).toISOString().slice(0, 13)}..${new Date(file.end * 1000).toISOString().slice(0, 13)}, movers ${file.risers ? `${file.risers.length}/${file.fallers!.length}` : "n/a (less than a week)"}, records ${file.highs ? `${file.highs.length}/${file.lows!.length}` : "n/a"}, flips ${file.flips?.found ?? "n/a"}, crafts ${file.crafts?.found ?? "n/a"} (${Date.now() - started} ms)`);
  }
}

if (process.argv[1]?.endsWith("weekly.ts")) main();
