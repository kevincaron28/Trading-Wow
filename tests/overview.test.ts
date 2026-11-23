import { describe, expect, it } from "vitest";
import { breadth, investments, isGear, movers, overviewClass, quickFlips, salesVolume, seriesChange, topCrafts } from "../src/lib/overview";
import { parseRecipes } from "../src/lib/crafting";
import type { Quote } from "../src/lib/quotes";

function q(id: number, over: Partial<Quote> = {}): Quote {
  return { id, min: 10_000, market: 10_000, listed: 50, auctions: 10, prev24h: 10_000, avg7d: 10_000, soldPerDay: 40, prev1h: null, soldAvg7d: 20, ...over };
}
const trade = () => 7;

describe("overview", () => {
  it("leaves gear and unknown items out", () => {
    expect(isGear(2)).toBe(true);
    expect(isGear(4)).toBe(true);
    expect(isGear(undefined)).toBe(true);
    expect(isGear(7)).toBe(false);
  });

  it("treats Craftsman's Writs as quest items", () => {
    expect(overviewClass({ itemClass: 0, name: { en: "Craftsman's Writ: Dusky Bracers" } })).toBe(12);
    expect(overviewClass({ itemClass: 0, name: { en: "Repair Bot" } })).toBe(0);
    expect(overviewClass(undefined)).toBeUndefined();
  });

  it("keeps movers to items with at least 20 gold traded a day", () => {
    const rows = [q(1, { market: 15_000 }), q(2, { market: 1_500, prev24h: 1_000, soldPerDay: 50 })];
    expect(movers(rows, trade, { window: "1d", direction: "up" }).map((m) => m.quote.id)).toEqual([1]);
  });

  it("measures an hourly series over a window, null without a value that old", () => {
    const h: [number, number][] = [[100, 80], [110, 90], [124, 100]];
    expect(seriesChange(h, 24)).toBeCloseTo(25);
    expect(seriesChange(h, 14)).toBeCloseTo(11.11, 1);
    expect(seriesChange(h, 48)).toBeNull();
    expect(seriesChange([], 24)).toBeNull();
  });

  it("counts rising and falling items only when enough have a 24h price", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => q(i, { market: 12_000 })),
      ...Array.from({ length: 6 }, (_, i) => q(100 + i, { market: 8_000 })),
      ...Array.from({ length: 2 }, (_, i) => q(200 + i)),
      q(300, { prev24h: null }),
      q(301, { market: 50_000, soldPerDay: 0 }),
    ];
    expect(breadth(rows, trade)).toEqual({ up: 12, down: 6, flat: 2 });
    expect(breadth(rows.slice(0, 5), trade)).toBeNull();
    expect(breadth(rows, () => 2)).toBeNull();
  });

  it("compares 24h sales with a usual day at today's prices", () => {
    const rows = Array.from({ length: 20 }, (_, i) => q(i, { soldPerDay: 30, soldAvg7d: 20 }));
    const v = salesVolume(rows, trade)!;
    expect(v.items).toBe(20);
    expect(v.today).toBe(20 * 30 * 10_000);
    expect(v.pct).toBeCloseTo(50);
    expect(salesVolume(rows.slice(0, 3), trade)).toBeNull();
    expect(salesVolume(rows.map((r) => ({ ...r, soldAvg7d: null })), trade)).toBeNull();
  });

  it("ranks movers over 24 hours and against the 7-day average, without thin or absurd markets", () => {
    const rows = [
      q(1, { market: 15_000 }),
      q(2, { market: 12_000 }),
      q(3, { market: 7_000 }),
      q(4, { market: 90_000 }),
      q(5, { market: 20_000, listed: 3 }),
      q(6, { market: 11_000, prev24h: 11_000, avg7d: 5_000 }),
    ];
    expect(movers(rows, trade, { window: "1d", direction: "up" }).map((m) => m.quote.id)).toEqual([1, 2]);
    expect(movers(rows, trade, { window: "1d", direction: "down" }).map((m) => m.quote.id)).toEqual([3]);
    expect(movers(rows, trade, { window: "7d", direction: "up" })[0]!.quote.id).toBe(6);
  });

  it("drops relisted stacks, recipes, quest items and near-free junk from the movers", () => {
    const cls: Record<number, number> = { 1: 7, 2: 9, 3: 12, 4: 7, 5: 7, 6: 7, 7: 7 };
    const rows = [
      q(1, { market: 25_000 }),
      q(2, { market: 15_000 }),
      q(3, { market: 15_000 }),
      q(4, { market: 40_000 }),
      q(5, { market: 90, prev24h: 30, min: 90, avg7d: 90 }),
      q(6, { market: 4_000, soldPerDay: 100 }),
      q(7, { market: 2_000 }),
    ];
    expect(movers(rows, (id) => cls[id], { window: "1d", direction: "up" }).map((m) => m.quote.id)).toEqual([1]);
    expect(movers(rows, (id) => cls[id], { window: "1d", direction: "down" }).map((m) => m.quote.id)).toEqual([6]);
  });

  it("finds flips under the usual price that pay after the cut, resold no higher than the 7-day average", () => {
    const rows = [
      q(1, { min: 6_000, market: 12_000, avg7d: 10_000 }),
      q(2, { min: 9_500, market: 10_000, avg7d: 10_000 }),
      q(3, { min: 6_000, market: 10_000, avg7d: 10_000, soldAvg7d: 1, soldPerDay: 1 }),
      q(4, { min: 200, market: 300, avg7d: 300 }),
    ];
    const f = quickFlips(rows, trade, 0.05);
    expect(f.map((x) => x.quote.id)).toEqual([1]);
    expect(f[0]!.sell).toBe(10_000);
    expect(f[0]!.profit).toBe(3_500);
    expect(f[0]!.discount).toBeCloseTo(40);
  });

  it("suggests raid stock: consumables and materials under their 7-day average that still sell", () => {
    const cls: Record<number, number> = { 1: 0, 2: 7, 3: 15, 4: 0, 5: 0, 6: 0, 7: 7 };
    const rows = [
      q(1, { market: 8_000, prev24h: 8_100, avg7d: 10_000 }),
      q(2, { market: 7_000, prev24h: 7_000, avg7d: 10_000 }),
      q(3, { market: 5_000, prev24h: 5_000, avg7d: 10_000 }),
      q(4, { market: 8_000, prev24h: 8_000, avg7d: 10_000, soldAvg7d: 2 }),
      q(5, { market: 9_800, prev24h: 9_800, avg7d: 10_000 }),
      q(6, { market: 7_000, prev24h: 9_000, avg7d: 10_000 }),
      q(7, { market: 2_000, prev24h: 2_000, avg7d: 10_000 }),
    ];
    const out = investments(rows, (id) => cls[id]);
    expect(out.map((r) => r.quote.id)).toEqual([2, 1]);
    expect(out[0]!.discount).toBeCloseTo(30);
  });

  it("lists crafts that sell and make a profit", () => {
    const book = parseRecipes({ recipes: [[1, 171, 500, 1, 1, [[10, 2]]], [2, 171, 501, 1, 1, [[10, 1]]]], vendor: {} });
    const quotes = new Map<number, Quote>([
      [10, q(10, { market: 1_000 })],
      [500, q(500, { market: 5_000 })],
      [501, q(501, { market: 900, soldPerDay: 5 })],
    ]);
    const rows = topCrafts(book, quotes, "market", 0.05);
    expect(rows.map((r) => r.item)).toEqual([500]);
    expect(rows[0]!.profit).toBe(Math.round(5_000 * 0.95 - 2_000));
  });
});
