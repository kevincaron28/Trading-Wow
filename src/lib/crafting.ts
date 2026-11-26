/**
 * Crafting (0.13, 20 Nov 2026): what the materials of a recipe cost right now and over time, and the profit of crafting
 * and selling the result. Recipes and reagents come from Blizzard's WoW Forever profession data
 * (collector/build-recipes.ts → src/data/recipes.json).
 *
 * A reagent costs its auction price (the price field the user picked: market or lowest buyout). Reagents merchants sell
 * cost the merchant price, or the auction price when that is lower. A reagent with neither has no price: the material
 * cost is then incomplete and is never shown as a full cost.
 */
import type { Candle } from "./candles";
import { sellsAtLeast, type Quote } from "./quotes.ts";

/** [recipeId, professionId, craftedItemId, craftedMin, craftedMax, [[reagentId, quantity]...]] */
export type RecipeRow = [number, number, number, number, number, [number, number][]];

export interface Recipe {
  id: number;
  profession: number;
  item: number;
  /** Average number of items one craft makes (some recipes make a range). */
  makes: number;
  reagents: { id: number; qty: number }[];
}

export interface RecipeBook {
  /** Recipes that make each item. */
  byItem: Map<number, Recipe[]>;
  all: Recipe[];
  /** Merchant price per unit, copper. */
  vendor: Map<number, number>;
}

export const PROFESSIONS: Record<number, { en: string; fr: string }> = {
  171: { en: "Alchemy", fr: "Alchimie" },
  164: { en: "Blacksmithing", fr: "Forge" },
  185: { en: "Cooking", fr: "Cuisine" },
  333: { en: "Enchanting", fr: "Enchantement" },
  202: { en: "Engineering", fr: "Ingénierie" },
  129: { en: "First Aid", fr: "Secourisme" },
  356: { en: "Fishing", fr: "Pêche" },
  182: { en: "Herbalism", fr: "Herboristerie" },
  165: { en: "Leatherworking", fr: "Travail du cuir" },
  186: { en: "Mining", fr: "Minage" },
  393: { en: "Skinning", fr: "Dépeçage" },
  197: { en: "Tailoring", fr: "Couture" },
};

export function parseRecipes(raw: { recipes: RecipeRow[]; vendor: Record<string, number> }): RecipeBook {
  const all = raw.recipes.map(([id, profession, item, min, max, reagents]) => ({ id, profession, item, makes: (min + max) / 2 || 1, reagents: reagents.map(([rid, qty]) => ({ id: rid, qty })) }));
  const byItem = new Map<number, Recipe[]>();
  for (const r of all) byItem.set(r.item, [...(byItem.get(r.item) ?? []), r]);
  return { byItem, all, vendor: new Map(Object.entries(raw.vendor).map(([k, v]) => [Number(k), v])) };
}

export interface ReagentCost {
  id: number;
  qty: number;
  /** Price per unit, or null when unknown. */
  unit: number | null;
  /** qty × unit, or null. */
  total: number | null;
  /** Where the unit price comes from. */
  source: "ah" | "vendor" | null;
}

export interface CraftCost {
  recipe: Recipe;
  reagents: ReagentCost[];
  /** Cost of one craft when every reagent has a price, else null. */
  perCraft: number | null;
  /** Cost of one crafted item (perCraft / makes), else null. */
  perItem: number | null;
  /** Reagents with no price. */
  missing: number[];
}

/** Unit price of a reagent: the merchant price (or the auction price when lower) for merchant goods, else the auction price. */
export function reagentUnit(id: number, ah: number | null | undefined, vendor: ReadonlyMap<number, number>): { unit: number | null; source: ReagentCost["source"] } {
  const v = vendor.get(id);
  const a = ah != null && ah > 0 ? ah : null;
  if (v != null) return a != null && a < v ? { unit: a, source: "ah" } : { unit: v, source: "vendor" };
  return { unit: a, source: a == null ? null : "ah" };
}

export function craftCost(recipe: Recipe, price: (id: number) => number | null | undefined, vendor: ReadonlyMap<number, number>): CraftCost {
  const reagents = recipe.reagents.map(({ id, qty }) => {
    const { unit, source } = reagentUnit(id, price(id), vendor);
    return { id, qty, unit, total: unit == null ? null : unit * qty, source };
  });
  const missing = reagents.filter((r) => r.unit == null).map((r) => r.id);
  const perCraft = missing.length ? null : reagents.reduce((sum, r) => sum + r.total!, 0);
  return { recipe, reagents, perCraft, perItem: perCraft == null ? null : Math.round(perCraft / recipe.makes), missing };
}

/** The cheapest complete way to make an item (or the first recipe when none has every price). */
export function bestCost(recipes: readonly Recipe[] | undefined, price: (id: number) => number | null | undefined, vendor: ReadonlyMap<number, number>): CraftCost | null {
  if (!recipes?.length) return null;
  const costs = recipes.map((r) => craftCost(r, price, vendor));
  const complete = costs.filter((c) => c.perItem != null).sort((a, b) => a.perItem! - b.perItem!);
  return complete[0] ?? costs[0]!;
}

/** Profit of crafting one item and selling it at `sell` after the house cut: copper and percent of the material cost. */
export function craftProfit(perItem: number | null, sell: number | null | undefined, cut: number): { profit: number | null; pct: number | null } {
  if (perItem == null || sell == null || sell <= 0) return { profit: null, pct: null };
  const profit = Math.round(sell * (1 - cut) - perItem);
  return { profit, pct: perItem > 0 ? (profit / perItem) * 100 : null };
}

/**
 * Material cost per crafted item over time, one value per candle of the crafted item: each reagent's close at that
 * candle (its last close within `stale` seconds before, when it has no candle then). Candles where any auction-priced
 * reagent has no price are left out.
 */
export function materialSeries(
  times: readonly number[],
  recipe: Recipe,
  reagentCandles: ReadonlyMap<number, readonly Candle[]>,
  vendor: ReadonlyMap<number, number>,
  stale = 3 * 86_400,
): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = [];
  const idx = new Map<number, number>();
  for (const t of times) {
    let sum = 0;
    let ok = true;
    for (const { id, qty } of recipe.reagents) {
      const cs = reagentCandles.get(id) ?? [];
      let i = idx.get(id) ?? -1;
      while (i + 1 < cs.length && cs[i + 1]!.time <= t) i++;
      idx.set(id, i);
      const c = i >= 0 && t - cs[i]!.time <= stale ? cs[i]! : null;
      const { unit } = reagentUnit(id, c?.close ?? null, vendor);
      if (unit == null) { ok = false; break; }
      sum += unit * qty;
    }
    if (ok) out.push({ time: t, value: Math.round(sum / recipe.makes) });
  }
  return out;
}

export interface CraftRow {
  item: number;
  cost: CraftCost;
  sell: number;
  profit: number;
  pct: number;
  soldPerDay: number | null;
}

/**
 * Recipes ranked by profit per crafted item in one house: the crafted item must be listed (at least `minAuctions`
 * auctions) and every reagent priced. Absurd margins from near-empty markets (over `maxPct`) are left out.
 */
export function profitableCrafts(
  book: RecipeBook,
  quotes: ReadonlyMap<number, Quote>,
  field: "market" | "min",
  cut: number,
  opts: { profession?: number | null; minAuctions?: number; maxPct?: number; limit?: number; minSales?: number } = {},
): CraftRow[] {
  const price = (id: number) => quotes.get(id)?.[field];
  const rows: CraftRow[] = [];
  for (const [item, recipes] of book.byItem) {
    const q = quotes.get(item);
    if (!q || q.auctions < (opts.minAuctions ?? 2) || !(q[field] > 0) || !sellsAtLeast(q, opts.minSales ?? 0)) continue;
    const forProf = opts.profession ? recipes.filter((r) => r.profession === opts.profession) : recipes;
    const cost = bestCost(forProf, price, book.vendor);
    if (!cost || cost.perItem == null || cost.perItem <= 0) continue;
    const { profit, pct } = craftProfit(cost.perItem, q[field], cut);
    if (profit == null || pct == null || pct > (opts.maxPct ?? 1000)) continue;
    rows.push({ item, cost, sell: q[field], profit, pct, soldPerDay: q.soldPerDay });
  }
  return rows.sort((a, b) => b.profit - a.profit).slice(0, opts.limit ?? 100);
}
