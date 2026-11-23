/**
 * Market overview (the tab the app opens on): the state of one auction house at a glance and the best opportunities
 * right now. Every number comes from the collector's files (latest quotes, the Ledger 100 index, the recipes); when the
 * data is too thin for a section, the function returns null or an empty list and the screen says so. Nothing is guessed.
 */
import { profitableCrafts, type CraftRow, type RecipeBook } from "./crafting";
import { change24h, type Quote } from "./quotes";

/** Item class of a catalog row (2 = weapon, 4 = armour; negative or missing = unknown). */
export type ClassOf = (id: number) => number | null | undefined;

/** Weapons and armour share one ID across random suffixes ("of the Eagle"), so their prices mix items: left out. */
export function isGear(cls: number | null | undefined): boolean {
  return cls === 2 || cls === 4 || cls == null || cls < 0;
}

/**
 * Recipes (9) and quest items such as Craftsman's Writs (12) are one-off buys whose estimated sales and prices swing
 * on a few listings; the Ledger 100 leaves recipes out for the same reason.
 */
export const NOISY_CLASSES: readonly number[] = [9, 12];

/**
 * Craftsman's Writs are WoW Forever quest turn-ins listed as "other" consumables (class 0, subclass 8): their prices
 * follow the quest, not the market. Item class to use for an item: 12 (quest) for a writ, else its own class.
 */
export function overviewClass(item: { itemClass: number; name: { en: string } } | undefined): number | undefined {
  if (!item) return undefined;
  return item.name.en.startsWith("Craftsman's Writ") ? 12 : item.itemClass;
}

/** Below 1 silver, one relisted stack doubles or halves the price: left out. */
export const MIN_PRICE = 100;

/**
 * Items that really trade: a few auctions, at least one sale a day, a price of at least 1 silver, and not gear, recipes
 * or quest items (thin or relisted junk swings wildly).
 */
export function isLiquid(q: Quote, cls: number | null | undefined): boolean {
  return q.auctions >= 3 && (q.soldPerDay ?? 0) >= 1 && q.market >= MIN_PRICE && !isGear(cls) && !NOISY_CLASSES.includes(cls!);
}

/** Change of an hourly [hour, value] series over the last `hours` hours, in percent; null without a value that old. */
export function seriesChange(hourly: readonly (readonly [number, number])[], hours: number): number | null {
  const last = hourly.at(-1);
  if (!last) return null;
  for (let i = hourly.length - 1; i >= 0; i--) {
    const [h, v] = hourly[i]!;
    if (h <= last[0] - hours) return v > 0 ? ((last[1] - v) / v) * 100 : null;
  }
  return null;
}

export interface Breadth {
  up: number;
  down: number;
  flat: number;
}

/** How many liquid items rose, fell or held (within ±1%) over 24 hours; null when fewer than `minItems` have a 24h price. */
export function breadth(quotes: Iterable<Quote>, classOf: ClassOf, minItems = 20): Breadth | null {
  const out: Breadth = { up: 0, down: 0, flat: 0 };
  for (const q of quotes) {
    if (!isLiquid(q, classOf(q.id))) continue;
    const c = change24h(q);
    if (c == null) continue;
    if (c > 1) out.up++;
    else if (c < -1) out.down++;
    else out.flat++;
  }
  return out.up + out.down + out.flat >= minItems ? out : null;
}

export interface Volume {
  /** Estimated gold value sold in the last 24 hours (units sold × market price), copper. */
  today: number;
  /** The same units at the 7-day average daily sales, copper. */
  usual: number;
  /** today against usual, percent. */
  pct: number;
  items: number;
}

/**
 * Trading activity: estimated value sold in the last 24 hours against a usual day (7-day average sales), both at today's
 * market price so only the quantity sold differs. Null when fewer than `minItems` items have both sales numbers.
 */
export function salesVolume(quotes: Iterable<Quote>, classOf: ClassOf, minItems = 20): Volume | null {
  let today = 0;
  let usual = 0;
  let items = 0;
  for (const q of quotes) {
    if (isGear(classOf(q.id)) || q.soldPerDay == null || q.soldAvg7d == null || q.soldAvg7d <= 0 || q.market <= 0) continue;
    today += q.soldPerDay * q.market;
    usual += q.soldAvg7d * q.market;
    items++;
  }
  if (items < minItems || usual <= 0) return null;
  return { today: Math.round(today), usual: Math.round(usual), pct: ((today - usual) / usual) * 100, items };
}

export interface Mover {
  quote: Quote;
  change: number;
}

/**
 * Biggest movers among liquid items with at least `minListed` units on sale, `minSold` sales a day and `minValue` copper
 * traded a day (default 20 gold: the moves that matter to a trader): over 24 hours ("1d") or against the 7-day average price ("7d"). A price more than `maxFactor` times higher or lower (default 3:
 * +200% or -66.7%) is left out: on a real market that is nearly always a relisted stack, not a move.
 */
export function movers(
  quotes: Iterable<Quote>,
  classOf: ClassOf,
  opts: { window: "1d" | "7d"; direction: "up" | "down"; limit?: number; minListed?: number; minSold?: number; minValue?: number; maxFactor?: number },
): Mover[] {
  const rows: Mover[] = [];
  const factor = opts.maxFactor ?? 3;
  for (const q of quotes) {
    const sold = q.soldPerDay ?? 0;
    if (q.listed < (opts.minListed ?? 20) || sold < (opts.minSold ?? 5) || sold * q.market < (opts.minValue ?? 200_000) || !isLiquid(q, classOf(q.id))) continue;
    const before = opts.window === "1d" ? q.prev24h : q.avg7d > 0 ? q.avg7d : null;
    if (!before) continue;
    const ratio = q.market / before;
    if (ratio > factor || ratio < 1 / factor) continue;
    const change = (ratio - 1) * 100;
    if (opts.direction === "up" ? change > 0 : change < 0) rows.push({ quote: q, change });
  }
  rows.sort((a, b) => (opts.direction === "up" ? b.change - a.change : a.change - b.change));
  return rows.slice(0, opts.limit ?? 5);
}

export interface QuickFlip {
  quote: Quote;
  /** Lowest buyout now. */
  buy: number;
  /** Resale price: the market price, but never above the 7-day average (a spike may not last). */
  sell: number;
  /** Per unit after the house cut, copper. */
  profit: number;
  pct: number;
  /** Lowest buyout under the 7-day average, percent. */
  discount: number;
}

/**
 * Same-house flips: the lowest buyout is at least `minDiscount` percent under the usual price (7-day average), and
 * reselling at the market price (capped at the 7-day average) still pays at least `minPct` percent after the house
 * cut. Only items selling at least `minSold` a day. Ranked by profit per unit. Deposits are not included.
 */
export function quickFlips(
  quotes: Iterable<Quote>,
  classOf: ClassOf,
  cut: number,
  opts: { limit?: number; minDiscount?: number; minSold?: number; minProfit?: number; minPct?: number; maxPct?: number } = {},
): QuickFlip[] {
  const rows: QuickFlip[] = [];
  for (const q of quotes) {
    if (!isLiquid(q, classOf(q.id)) || q.min <= 0 || q.avg7d <= 0 || q.market <= 0) continue;
    const sold = q.soldAvg7d ?? q.soldPerDay ?? 0;
    if (sold < (opts.minSold ?? 3)) continue;
    const discount = (1 - q.min / q.avg7d) * 100;
    if (discount < (opts.minDiscount ?? 15)) continue;
    const sell = Math.min(q.market, q.avg7d);
    const profit = Math.round(sell * (1 - cut) - q.min);
    if (profit < (opts.minProfit ?? 1_000)) continue;
    const pct = (profit / q.min) * 100;
    if (pct < (opts.minPct ?? 10) || pct > (opts.maxPct ?? 300)) continue;
    rows.push({ quote: q, buy: q.min, sell, profit, pct, discount });
  }
  return rows.sort((a, b) => b.profit - a.profit).slice(0, opts.limit ?? 5);
}

/** Crafts worth making now: every reagent priced, the item listed and selling at least once a day, a sane margin. */
export function topCrafts(book: RecipeBook, quotes: ReadonlyMap<number, Quote>, field: "market" | "min", cut: number, limit = 5): CraftRow[] {
  return profitableCrafts(book, quotes, field, cut, { minAuctions: 3, maxPct: 300, limit: 500 })
    .filter((c) => c.profit > 0 && (c.soldPerDay ?? 0) >= 1)
    .slice(0, limit);
}

/** Classes worth stocking ahead of raids: consumables (potions, flasks, food) and trade goods (materials). */
export const RAID_CLASSES: readonly number[] = [0, 7];

export interface Investment {
  quote: Quote;
  /** Market price under the 7-day average, percent. */
  discount: number;
  /** Average units sold per day over 7 days. */
  soldPerDay: number;
}

/**
 * Long-term buys ahead of the raids: consumables and materials whose market price is `minDiscount` to `maxDiscount`
 * percent under their 7-day average, that kept selling (7-day average sales of at least `minSold` a day) and held
 * steady over the last 24 hours (no more than `maxDrop24h` percent lower: still sliding is not a buy). Deeper discounts
 * are nearly always prices still settling after launch. Ranked by discount. What the data shows today, not a forecast.
 */
export function investments(
  quotes: Iterable<Quote>,
  classOf: ClassOf,
  opts: { limit?: number; minDiscount?: number; minSold?: number; minListed?: number; maxDiscount?: number; maxDrop24h?: number } = {},
): Investment[] {
  const rows: Investment[] = [];
  for (const q of quotes) {
    const cls = classOf(q.id);
    if (cls == null || !RAID_CLASSES.includes(cls) || !isLiquid(q, cls)) continue;
    if (q.listed < (opts.minListed ?? 20) || q.avg7d <= 0 || q.market <= 0) continue;
    const sold = q.soldAvg7d ?? 0;
    if (sold < (opts.minSold ?? 10)) continue;
    const discount = (1 - q.market / q.avg7d) * 100;
    if (discount < (opts.minDiscount ?? 10) || discount > (opts.maxDiscount ?? 40)) continue;
    const day = change24h(q);
    if (day == null || day < -(opts.maxDrop24h ?? 5)) continue;
    rows.push({ quote: q, discount, soldPerDay: sold });
  }
  return rows.sort((a, b) => b.discount - a.discount).slice(0, opts.limit ?? 5);
}
