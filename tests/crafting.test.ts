import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bestCost, craftCost, craftProfit, materialSeries, parseRecipes, profitableCrafts, reagentUnit, type RecipeRow } from "../src/lib/crafting";
import { toQuote } from "../src/lib/quotes";
import type { Candle } from "../src/lib/candles";

const book = parseRecipes({
  recipes: [
    [9840, 171, 12360, 1, 1, [[12359, 1], [12363, 1]]], // Arcanite Bar = Thorium Bar + Arcane Crystal
    [9961, 171, 13444, 1, 1, [[13463, 3], [13467, 2], [8925, 1]]], // Major Mana Potion (Crystal Vial from a merchant)
    [100, 185, 500, 2, 4, [[600, 2]]], // makes 2-4
    [101, 185, 500, 1, 1, [[601, 1]]], // a dearer second recipe for the same item
  ] as RecipeRow[],
  vendor: { 8925: 500 },
});

const q = (id: number, price: number, auctions = 5) => toQuote(id, [price, price, 10, auctions, 0, price, 3]);

describe("crafting", () => {
  it("adds up reagent prices and finds the break-even", () => {
    const prices = new Map([[12359, 20_000], [12363, 300_000], [12360, 400_000]]);
    const c = craftCost(book.byItem.get(12360)![0]!, (id) => prices.get(id), book.vendor);
    expect(c.perItem).toBe(320_000);
    expect(craftProfit(c.perItem, 400_000, 0.05)).toEqual({ profit: 60_000, pct: 18.75 });
  });

  it("prices merchant reagents at the merchant price unless the auction is cheaper, and flags unpriced ones", () => {
    expect(reagentUnit(8925, null, book.vendor)).toEqual({ unit: 500, source: "vendor" });
    expect(reagentUnit(8925, 400, book.vendor)).toEqual({ unit: 400, source: "ah" });
    const c = craftCost(book.byItem.get(13444)![0]!, (id) => (id === 13463 ? 1000 : null), book.vendor);
    expect(c.missing).toEqual([13467]);
    expect(c.perCraft).toBeNull();
  });

  it("divides by the average number made and picks the cheapest recipe", () => {
    const c = bestCost(book.byItem.get(500), (id) => (id === 600 ? 300 : 5000), book.vendor)!;
    expect(c.recipe.id).toBe(100);
    expect(c.perItem).toBe(200); // 2 × 300 / 3
  });

  it("draws the material cost per candle with each reagent's last close", () => {
    const candle = (time: number, close: number): Candle => ({ time, open: close, high: close, low: close, close, volume: 1 });
    const recipe = book.byItem.get(13444)![0]!;
    const reagents = new Map<number, Candle[]>([
      [13463, [candle(100, 10), candle(200, 20)]],
      [13467, [candle(200, 5)]],
    ]);
    expect(materialSeries([100, 200, 300], recipe, reagents, book.vendor)).toEqual([
      { time: 200, value: 3 * 20 + 2 * 5 + 500 },
      { time: 300, value: 3 * 20 + 2 * 5 + 500 },
    ]);
  });

  it("ranks profitable crafts and skips unlisted items and missing reagents", () => {
    const quotes = new Map([
      [12360, q(12360, 400_000)],
      [12359, q(12359, 20_000)],
      [12363, q(12363, 300_000)],
      [13444, q(13444, 50_000)], // reagents unpriced
      [500, q(500, 1000, 1)], // too few auctions
      [600, q(600, 300)],
    ]);
    const rows = profitableCrafts(book, quotes, "market", 0.05);
    expect(rows.map((r) => r.item)).toEqual([12360]);
    expect(rows[0]!.profit).toBe(60_000);
  });

  it("ships a recipe table with Arcanite Bar and merchant prices", () => {
    const raw = JSON.parse(readFileSync(new URL("../src/data/recipes.json", import.meta.url), "utf8"));
    const real = parseRecipes(raw);
    expect(real.all.length).toBeGreaterThan(1000);
    expect(real.byItem.get(12360)?.[0]?.reagents).toEqual([{ id: 12359, qty: 1 }, { id: 12363, qty: 1 }]);
    expect(real.vendor.get(3371)).toBeGreaterThan(0); // Empty Vial
  });
});
