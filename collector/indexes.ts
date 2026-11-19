/**
 * Goldline market indexes, computed from our own hourly data for every house.
 *
 *   node collector/indexes.ts <dataDir>        writes index/<house>.json and index/meta.json
 *
 * Method (docs/INDEXES.md):
 * - Each index has a fixed basket and fixed weights per period. Weights follow each item's daily gold volume
 *   (estimated quantity sold x market value over the selection window), capped per item, renormalised to 1.
 * - Value = level at the period start x sum(weight x price now / price at the period start). A price older than
 *   72 hours is left out for that hour and the remaining weights are renormalised. Nothing is interpolated.
 * - The basket is chosen from the first full day of our own hourly data (19 Nov 2026, fixed at 20 Nov 00:00 UTC;
 *   provisional before). Rebalanced on the first weekly reset (Tuesday 15:00 UTC) of each month, chain-linked so the
 *   level does not jump; baskets once set are never changed afterwards.
 * - Base 100 = WoW Forever's launch: the first UTC day on or after 4 Nov 2026 where the merged early history
 *   (early/, collector/merge-history.ts) prices at least 10 basket items (or the whole basket when smaller). Launch
 *   week markets were thin (on 5 Nov only about a fifth of today's busiest items were listed), so the early days are
 *   chain-linked: each day moves the level by the weighted price change of the basket items priced that day and on
 *   an earlier day (at most 3 days before), re-weighted among them; one item's daily move counts as at most x2 or /2,
 *   and a day with fewer than 5 linked items leaves the level unchanged. Items that start trading later join without
 *   moving the level. The hourly series is chain-linked to the last early day; everything is recomputed as the
 *   backfill fills in.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { categoryOf } from "../src/lib/categories.ts";

const HOUR = 3_600;
export const BASE_END = Date.UTC(2026, 10, 20) / 1000; // close of 19 Nov 2026 (first full day)
const STALE_HOURS = 72;
export const MIN_SOLD = 5;

export interface IndexDef {
  id: string;
  name: { en: string; fr: string };
  about: { en: string; fr: string };
  size: number;
  cap: number;
  /** [itemClass, subclass] -> in the basket universe. */
  select: (item: { itemClass: number; subclass: number }) => boolean;
}

const cat = (c: string, ...subs: string[]) => (item: { itemClass: number; subclass: number }) => {
  const [a, b] = categoryOf(item);
  return a === c && (subs.length === 0 || subs.includes(b));
};

export const INDEXES: readonly IndexDef[] = [
  { id: "gl100", name: { en: "Goldline 100", fr: "Goldline 100" }, about: { en: "The 100 most traded items by daily gold volume. Weapons and armour are left out (random suffixes share one item ID), and so are recipes (rare one-off purchases whose estimated sales are too noisy).", fr: "Les 100 objets les plus échangés selon le volume quotidien en or. Armes et armures exclues (les suffixes aléatoires partagent un même identifiant), ainsi que les recettes (achats ponctuels dont les ventes estimées sont trop incertaines)." }, size: 100, cap: 0.1, select: (i) => !["weapon", "armor", "recipe"].includes(categoryOf(i)[0]) },
  { id: "herbs", name: { en: "Herbs", fr: "Herbes" }, about: { en: "Up to 30 herbs.", fr: "Jusqu’à 30 herbes." }, size: 30, cap: 0.25, select: cat("trade", "herb") },
  { id: "ores", name: { en: "Ores & Bars", fr: "Minerais et lingots" }, about: { en: "Up to 30 ores, bars and stones.", fr: "Jusqu’à 30 minerais, lingots et pierres." }, size: 30, cap: 0.25, select: cat("trade", "metal") },
  { id: "cloth", name: { en: "Cloth", fr: "Tissu" }, about: { en: "Up to 30 cloth items.", fr: "Jusqu’à 30 tissus." }, size: 30, cap: 0.25, select: cat("trade", "cloth") },
  { id: "leather", name: { en: "Leather", fr: "Cuir" }, about: { en: "Up to 30 leathers and hides.", fr: "Jusqu’à 30 cuirs et peaux." }, size: 30, cap: 0.25, select: cat("trade", "leather") },
  { id: "enchanting", name: { en: "Enchanting mats", fr: "Composants d’enchantement" }, about: { en: "Up to 30 dusts, essences and shards.", fr: "Jusqu’à 30 poussières, essences et éclats." }, size: 30, cap: 0.25, select: cat("trade", "ench") },
  { id: "elemental", name: { en: "Elementals", fr: "Éléments" }, about: { en: "Up to 30 elemental trade goods (WoW Forever has no gem category).", fr: "Jusqu’à 30 composants élémentaires (WoW Forever n’a pas de catégorie de gemmes)." }, size: 30, cap: 0.25, select: cat("trade", "elemental") },
  { id: "consumables", name: { en: "Consumables", fr: "Consommables" }, about: { en: "Up to 50 potions, elixirs, flasks, food, scrolls and bandages.", fr: "Jusqu’à 50 potions, élixirs, flacons, nourritures, parchemins et bandages." }, size: 50, cap: 0.15, select: cat("consumable", "potion", "elixir", "flask", "food", "scroll", "bandage") },
  { id: "raidprep", name: { en: "Raid prep", fr: "Préparation de raid" }, about: { en: "Up to 30 flasks, elixirs and potions: what raiders buy before raid night (raids open 9 Dec).", fr: "Jusqu’à 30 flacons, élixirs et potions : ce que les raideurs achètent avant le raid (ouverture le 9 déc.)." }, size: 30, cap: 0.2, select: cat("consumable", "flask", "elixir", "potion") },
];

/** Per item: market value by hour index and estimated sold by hour index. */
export interface Series { price: Map<number, number>; sold: Map<number, number> }

export interface Period { start: number; level: number; provisional?: boolean; basket: [id: number, weight: number, p0: number][] }

/** Rebalance times after the base: the first Tuesday of each month, 15:00 UTC. */
export function rebalanceTimes(after: number, until: number): number[] {
  const out: number[] = [];
  const d = new Date(after * 1000);
  for (let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; ; m++) {
    const first = new Date(Date.UTC(y, m, 1));
    const tuesday = 1 + ((2 - first.getUTCDay() + 7) % 7);
    const t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), tuesday, 15) / 1000;
    if (t > until) break;
    if (t > after) out.push(t);
  }
  return out;
}

/** Last price at or before hour h, if not older than STALE_HOURS. */
export function priceAt(s: Series | undefined, h: number): number | null {
  if (!s) return null;
  for (let k = h; k > h - STALE_HOURS; k--) {
    const p = s.price.get(k);
    if (p != null) return p;
  }
  return null;
}

/** Cap each weight at `cap`, spreading the excess over the others in proportion (repeated until stable). */
export function capWeights(raw: number[], cap: number): number[] {
  let w = raw.map((x) => Math.max(0, x));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  w = w.map((x) => x / sum);
  if (cap * w.length < 1) return w.map(() => 1 / w.length);
  for (let i = 0; i < 50; i++) {
    const over = w.map((x) => x > cap);
    if (!over.some(Boolean)) break;
    const excess = w.reduce((s, x, j) => s + (over[j] ? x - cap : 0), 0);
    const freeSum = w.reduce((s, x, j) => s + (over[j] ? 0 : x), 0);
    w = w.map((x, j) => (over[j] ? cap : freeSum > 0 ? x + (excess * x) / freeSum : x));
  }
  return w;
}

/** Choose a basket at time t from the gold volume over the `windowHours` before it. */
export function chooseBasket(def: IndexDef, items: Map<number, Series>, catalog: Map<number, { itemClass: number; subclass: number }>, t: number, windowHours: number): Period["basket"] {
  const h = Math.floor(t / HOUR);
  const scored: { id: number; volume: number; p0: number }[] = [];
  for (const [id, s] of items) {
    const info = catalog.get(id);
    if (!info || !def.select(info)) continue;
    const p0 = priceAt(s, h);
    if (p0 == null || p0 <= 0) continue;
    let sold = 0;
    const prices: number[] = [];
    for (let k = h - windowHours + 1; k <= h; k++) {
      sold += Math.max(0, s.sold.get(k) ?? 0);
      const p = s.price.get(k);
      if (p != null) prices.push(p);
    }
    // Liquid items only: at least 5 units sold in the window and listed in at least half of its hours, so one rare,
    // expensive listing cannot dominate an index.
    if (sold < MIN_SOLD || prices.length < Math.max(1, Math.floor(windowHours / 2))) continue;
    prices.sort((a, b) => a - b);
    scored.push({ id, volume: sold * prices[Math.floor(prices.length / 2)]!, p0 });
  }
  scored.sort((a, b) => b.volume - a.volume || a.id - b.id);
  const top = scored.slice(0, def.size);
  const weights = capWeights(top.map((x) => x.volume), def.cap);
  return top.map((x, i) => [x.id, Math.round(weights[i]! * 1e6) / 1e6, x.p0]);
}

/** Index value at hour h for a period; null when no basket item has a recent price. */
export function valueAt(period: Period, items: Map<number, Series>, h: number): number | null {
  let num = 0;
  let wsum = 0;
  for (const [id, w, p0] of period.basket) {
    const p = priceAt(items.get(id), h);
    if (p == null || p0 <= 0) continue;
    num += w * (p / p0);
    wsum += w;
  }
  return wsum > 0 ? (period.level * num) / wsum : null;
}

export interface IndexFile {
  id: string;
  periods: Period[];
  hourly: [hour: number, value: number][];
  /** Chain link applied to the hourly segment (scaled = raw x link); absent when there is no early segment. */
  link?: number;
  /** Hours below this are early daily points (one per day, at the day's last hour). */
  earlyUntil?: number;
}

const DAY_H = 24;
export const LAUNCH_DAY = Date.UTC(2026, 10, 4) / 86_400_000;
const BASE_MIN_ITEMS = 10;
const CARRY_DAYS = 3;
/** A day moves the level only when this many items link to an earlier price (fewer: the level carries). */
const MIN_LINKS = 5;
/** Outlier treatment for thin launch-week markets: one item's daily move counts as at most x2 or /2. */
const MAX_DAILY_RATIO = 2;

/** Early daily market value per item: day index -> price (from early/{house}). */
export type EarlySeries = Map<number, Map<number, number>>;

/** Undo the early segment and the chain link, giving the raw hourly file updateIndex works on. */
export function rawIndex(stored: IndexFile | null): IndexFile | null {
  if (!stored) return null;
  const k = stored.link ?? 1;
  const until = stored.earlyUntil ?? -Infinity;
  return {
    id: stored.id,
    periods: stored.periods.filter((p) => !(p as Period & { early?: boolean }).early).map((p) => ({ ...p, level: Math.round((p.level / k) * 1e4) / 1e4 })),
    hourly: stored.hourly.filter(([h]) => h >= until).map(([h, v]) => [h, Math.round((v / k) * 100) / 100] as [number, number]),
  };
}

/**
 * Prepend the early daily segment (base 100 at launch) and chain-link the hourly segment to it.
 * Returns the file unchanged (no link) when the early history cannot price half the basket on any day.
 */
export function withEarly(file: IndexFile, early: EarlySeries): IndexFile {
  const firstHourly = file.hourly[0];
  const hourlyPeriod = file.periods[0];
  if (!firstHourly || !hourlyPeriod) return file;
  const dayH0 = Math.floor(firstHourly[0] / DAY_H);
  const basket = hourlyPeriod.basket.map(([id, w]) => [id, w] as const);
  const pricedCount = (d: number) => basket.filter(([id]) => early.get(id)?.has(d)).length;
  const need = Math.min(BASE_MIN_ITEMS, Math.ceil(basket.length / 2));
  const minLinks = Math.min(MIN_LINKS, need);
  let base = -1;
  for (let d = LAUNCH_DAY; d < dayH0; d++) if (pricedCount(d) >= need) { base = d; break; }
  if (base < 0) return file;
  const p0 = new Map<number, number>();
  for (const [id] of basket) {
    const days = early.get(id);
    if (!days) continue;
    for (let d = base; d < dayH0; d++) { const p = days.get(d); if (p != null && p > 0) { p0.set(id, p); break; } }
  }
  // Chain-linked daily level: level(d) = level(prev) x weighted mean of p(d) / p(last seen, within CARRY_DAYS).
  const last = new Map<number, [day: number, price: number]>();
  for (const [id] of basket) { const p = early.get(id)?.get(base); if (p != null && p > 0) last.set(id, [base, p]); }
  let level = 100;
  const points: [number, number][] = [[base * DAY_H + DAY_H - 1, 100]];
  for (let d = base + 1; d < dayH0; d++) {
    let num = 0;
    let wsum = 0;
    let links = 0;
    const seen: [number, number][] = [];
    for (const [id, w] of basket) {
      const p = early.get(id)?.get(d);
      if (p == null || p <= 0) continue;
      seen.push([id, p]);
      const prev = last.get(id);
      if (prev && d - prev[0] <= CARRY_DAYS) {
        num += w * Math.min(MAX_DAILY_RATIO, Math.max(1 / MAX_DAILY_RATIO, p / prev[1]));
        wsum += w;
        links++;
      }
    }
    for (const [id, p] of seen) last.set(id, [d, p]);
    if (wsum === 0 || links < minLinks) continue;
    level = (level * num) / wsum;
    points.push([d * DAY_H + DAY_H - 1, Math.round(level * 100) / 100]);
  }
  const k = points.at(-1)![1] / firstHourly[1];
  const earlyPeriod: Period & { early: true } = { start: base * 86_400, level: 100, early: true, basket: hourlyPeriod.basket.filter(([id]) => p0.has(id)).map(([id, w]) => [id, w, p0.get(id)!]) };
  return {
    id: file.id,
    periods: [earlyPeriod, ...file.periods.map((p) => ({ ...p, level: Math.round(p.level * k * 1e4) / 1e4 }))],
    hourly: [...points, ...file.hourly.map(([h, v]) => [h, Math.round(v * k * 100) / 100] as [number, number])],
    link: Math.round(k * 1e6) / 1e6,
    earlyUntil: firstHourly[0],
  };
}

/**
 * Bring one index of one house up to date: keep fixed periods, add due rebalances (chain-linked), and recompute the
 * hourly values for every hour we have prices for. Hours older than the price history are kept from the stored file.
 */
export function updateIndex(def: IndexDef, stored: IndexFile | null, items: Map<number, Series>, catalog: Map<number, { itemClass: number; subclass: number }>, now: number): IndexFile | null {
  const hours = new Set<number>();
  for (const s of items.values()) for (const h of s.price.keys()) hours.add(h);
  const allHours = [...hours].sort((a, b) => a - b);
  if (!allHours.length) return stored;
  const lastHour = allHours.at(-1)!;
  let periods = (stored?.periods ?? []).filter((p) => !p.provisional);
  if (!periods.length) {
    if (now >= BASE_END) {
      const basket = chooseBasket(def, items, catalog, BASE_END - HOUR, 24);
      if (!basket.length) return stored;
      periods = [{ start: BASE_END, level: 100, basket }];
    } else {
      // Before the base day closes: a provisional basket from the latest 24 hours, base 100 at the latest hour.
      const basket = chooseBasket(def, items, catalog, lastHour * HOUR, 24);
      if (!basket.length) return stored;
      periods = [{ start: lastHour * HOUR, level: 100, provisional: true, basket }];
    }
  }
  if (!periods[0]!.provisional) {
    for (const t of rebalanceTimes(periods.at(-1)!.start, now)) {
      const prev = periods.at(-1)!;
      const level = valueAt(prev, items, Math.floor(t / HOUR) - 1);
      const basket = chooseBasket(def, items, catalog, t - HOUR, 24 * 7);
      if (level == null || !basket.length) continue;
      periods.push({ start: t, level: Math.round(level * 1e4) / 1e4, basket });
    }
  }
  const periodFor = (h: number) => {
    let p = periods[0]!;
    for (const x of periods) if (x.start <= h * HOUR) p = x;
    return p;
  };
  const first = allHours[0]!;
  const keep = (stored?.hourly ?? []).filter(([h]) => h < first);
  const fresh: [number, number][] = [];
  for (let h = first; h <= lastHour; h++) {
    const v = valueAt(periodFor(h), items, h);
    if (v != null) fresh.push([h, Math.round(v * 100) / 100]);
  }
  return { id: def.id, periods, hourly: [...keep, ...fresh] };
}

function readSeries(dataDir: string, house: number): Map<number, Series> {
  const out = new Map<number, Series>();
  const dir = join(dataDir, "h2", String(house));
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const shard = JSON.parse(readFileSync(join(dir, f), "utf8")) as { items: Record<string, { h: (number | null)[][] }> };
    for (const [id, v] of Object.entries(shard.items)) {
      const s: Series = { price: new Map(), sold: new Map() };
      for (const r of v.h) {
        s.price.set(r[0]!, r[2]!);
        if (r[5] != null && r[5] >= 0) s.sold.set(r[0]!, r[5]);
      }
      out.set(Number(id), s);
    }
  }
  return out;
}

function readEarly(dataDir: string, house: number): EarlySeries {
  const out: EarlySeries = new Map();
  const dir = join(dataDir, "early", String(house));
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const shard = JSON.parse(readFileSync(join(dir, f), "utf8")) as { items: Record<string, number[][]> };
    for (const [id, rows] of Object.entries(shard.items)) out.set(Number(id), new Map(rows.map((r) => [r[0]!, r[1]!])));
  }
  return out;
}

function main(): void {
  const dataDir = process.argv[2]!;
  const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8")) as { houses: { id: number }[] };
  const rows = JSON.parse(readFileSync(join(dataDir, "items.json"), "utf8")) as Record<string, [string, string, number, number, number, string]>;
  const catalog = new Map(Object.entries(rows).map(([id, r]) => [Number(id), { itemClass: r[3], subclass: r[4] }]));
  const now = Math.floor(Date.now() / 1000);
  mkdirSync(join(dataDir, "index"), { recursive: true });
  for (const { id: house } of meta.houses) {
    const items = readSeries(dataDir, house);
    const early = readEarly(dataDir, house);
    const file = join(dataDir, "index", `${house}.json`);
    const stored = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { indexes: Record<string, IndexFile> }) : { indexes: {} };
    const indexes: Record<string, IndexFile> = {};
    for (const def of INDEXES) {
      const next = updateIndex(def, rawIndex(stored.indexes[def.id] ?? null), items, catalog, now);
      if (next) indexes[def.id] = withEarly(next, early);
    }
    writeFileSync(file, JSON.stringify({ house, updated: now, indexes }));
    const g = indexes.gl100;
    console.log(`index ${house}: ${Object.keys(indexes).length} indexes; Goldline 100 ${g ? `${g.periods.at(-1)!.basket.length} items, ${g.hourly.length} hours, last ${g.hourly.at(-1)?.[1]}${g.link ? ` (from ${new Date(g.periods[0]!.start * 1000).toISOString().slice(0, 10)})` : " (no early history yet)"}` : "n/a"}`);
  }
  writeFileSync(join(dataDir, "index", "meta.json"), JSON.stringify({
    baseEnd: BASE_END,
    launchDay: LAUNCH_DAY * 86_400,
    indexes: INDEXES.map(({ id, name, about, size, cap }) => ({ id, name, about, size, cap })),
  }));
}

if (process.argv[1]?.endsWith("indexes.ts")) main();
