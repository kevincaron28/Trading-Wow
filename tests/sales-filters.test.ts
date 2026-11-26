import { describe, expect, it } from "vitest";
import { loadFilters } from "../src/app/filters";
import { profitableCrafts, parseRecipes, type RecipeRow } from "../src/lib/crafting";
import { deals, findFlips } from "../src/lib/explore";
import { salesPerDay, sellsAtLeast, type Quote } from "../src/lib/quotes";

const q = (id: number, o: Partial<Quote> = {}): Quote => ({
  id, min: 10_000, market: 10_000, listed: 10, auctions: 5, prev24h: 10_000, avg7d: 10_000, soldPerDay: null, prev1h: null, soldAvg7d: null, ...o,
});
const map = (...quotes: Quote[]) => new Map(quotes.map((x) => [x.id, x]));

describe("salesPerDay", () => {
  it("prefers the 7-day average, falls back to 24 hours, and keeps unknown as null", () => {
    expect(salesPerDay(q(1, { soldAvg7d: 4, soldPerDay: 9 }))).toBe(4);
    expect(salesPerDay(q(1, { soldPerDay: 9 }))).toBe(9);
    expect(salesPerDay(q(1))).toBeNull();
    expect(sellsAtLeast(q(1), 0)).toBe(true);
    expect(sellsAtLeast(q(1), 1)).toBe(false);
    expect(sellsAtLeast(q(1, { soldAvg7d: 5 }), 5)).toBe(true);
  });
});

describe("findFlips", () => {
  const buy = map(q(1), q(2), q(3));
  const sell = map(q(1, { market: 20_000, soldAvg7d: 0 }), q(2, { market: 18_000, soldAvg7d: 3 }), q(3, { market: 30_000, soldAvg7d: 30 }));
  const ids = (o: Parameters<typeof findFlips>[2]) => findFlips(buy, sell, o).map((f) => f.id);
  it("ranks by profit and filters on sales in the house you sell in", () => {
    expect(ids({ sellCut: 0.05 })).toEqual([3, 1, 2]);
    expect(ids({ sellCut: 0.05, minSales: 1 })).toEqual([3, 2]);
    expect(ids({ sellCut: 0.05, minSales: 20 })).toEqual([3]);
  });
  it("leaves out skipped items", () => {
    expect(ids({ sellCut: 0.05, skip: (id) => id === 3 })).toEqual([1, 2]);
  });
});

describe("sales filter on deals and crafts", () => {
  it("drops deals that do not sell enough", () => {
    const quotes = [q(1, { min: 1_000 }), q(2, { min: 1_000, soldAvg7d: 6 })];
    expect(deals(quotes).map((d) => d.quote.id).sort()).toEqual([1, 2]);
    expect(deals(quotes, { minSales: 5 }).map((d) => d.quote.id)).toEqual([2]);
  });
  it("drops crafts whose product does not sell enough", () => {
    const book = parseRecipes({ recipes: [[1, 171, 10, 1, 1, [[1, 1]]], [2, 171, 11, 1, 1, [[1, 1]]]] as RecipeRow[], vendor: {} });
    const quotes = map(q(1, { market: 100 }), q(10, { soldAvg7d: 0 }), q(11, { soldAvg7d: 2 }));
    expect(profitableCrafts(book, quotes, "market", 0.05, { maxPct: 100_000 }).map((c) => c.item).sort()).toEqual([10, 11]);
    expect(profitableCrafts(book, quotes, "market", 0.05, { maxPct: 100_000, minSales: 1 }).map((c) => c.item)).toEqual([11]);
  });
});

describe("loadFilters", () => {
  it("starts at one sale a day with recipes shown", () => {
    expect(loadFilters()).toEqual({ minSales: 1, recipes: true });
  });
});
