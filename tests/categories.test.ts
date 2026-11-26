import { describe, expect, it } from "vitest";
import { AH_CATEGORIES, browseItems, categoryCounts, categoryOf } from "../src/lib/categories";
import type { CatalogItem } from "../src/data/live";
import type { Quote } from "../src/lib/quotes";

const item = (id: number, en: string, fr: string, itemClass: number, subclass: number): CatalogItem => ({ id, name: { en, fr }, quality: 1, itemClass, subclass, icon: "" });
const quote = (id: number, market: number, listed: number): Quote => ({ id, min: market, market, listed, auctions: 1, prev24h: null, avg7d: market, soldPerDay: null, prev1h: null, soldAvg7d: null });

const items = [
  item(2589, "Linen Cloth", "Étoffe de lin", 7, 5),
  item(4306, "Silk Cloth", "Étoffe de soie", 7, 5),
  item(13468, "Black Lotus", "Lotus noir", 7, 9),
  item(13510, "Flask of the Titans", "Flacon des Titans", 0, 3),
  item(25, "Worn Shortsword", "Vieille épée courte", 2, 7),
  item(99999, "Strange Thing", "Chose étrange", 42, 1),
];
const quotes = new Map([
  [2589, quote(2589, 50, 4000)],
  [4306, quote(4306, 300, 900)],
  [13468, quote(13468, 93538, 329)],
]);
const base = { cat: null, sub: null, query: "", onSale: false, sort: "name" as const, lang: "en" as const, priceField: "market" as const };

describe("auction house categories", () => {
  it("places items by class and subclass, unknown ones under Other", () => {
    expect(categoryOf(items[0]!)).toEqual(["trade", "cloth"]);
    expect(categoryOf(items[2]!)).toEqual(["trade", "herb"]);
    expect(categoryOf(items[3]!)).toEqual(["consumable", "flask"]);
    expect(categoryOf(items[4]!)).toEqual(["weapon", "sword1"]);
    expect(categoryOf(items[5]!)).toEqual(["other", "other"]);
    expect(categoryOf({ itemClass: 11, subclass: 3 })).toEqual(["container", "quiver"]);
  });

  it("has EN and FR names and unique subcategory ids per category", () => {
    for (const c of AH_CATEGORIES) {
      expect(c.name.en && c.name.fr).toBeTruthy();
      expect(new Set(c.subs.map((s) => s.id)).size).toBe(c.subs.length);
      for (const s of c.subs) expect(s.name.en && s.name.fr).toBeTruthy();
    }
  });

  it("filters by category, subcategory, query (either language or ID) and on-sale", () => {
    const names = (rows: ReturnType<typeof browseItems>) => rows.map((r) => r.item.id);
    expect(names(browseItems(items, quotes, { ...base, cat: "trade" }))).toEqual([13468, 2589, 4306]);
    expect(names(browseItems(items, quotes, { ...base, cat: "trade", sub: "cloth" }))).toEqual([2589, 4306]);
    expect(names(browseItems(items, quotes, { ...base, query: "etoffe" }))).toEqual([2589, 4306]);
    expect(names(browseItems(items, quotes, { ...base, query: "13510" }))).toEqual([13510]);
    expect(names(browseItems(items, quotes, { ...base, query: "titans flask" }))).toEqual([13510]);
    expect(names(browseItems(items, quotes, { ...base, onSale: true }))).toEqual([13468, 2589, 4306]);
  });

  it("sorts by name, price (high first) and quantity (high first), unpriced last", () => {
    const ids = (sort: "name" | "price" | "qty") => browseItems(items, quotes, { ...base, cat: "trade", sort }).map((r) => r.item.id);
    expect(ids("price")).toEqual([13468, 4306, 2589]);
    expect(ids("qty")).toEqual([2589, 4306, 13468]);
    expect(browseItems(items, quotes, { ...base, sort: "price" }).at(-1)!.quote).toBeUndefined();
    expect(browseItems(items, quotes, { ...base, lang: "fr", cat: "trade" }).map((r) => r.item.id)).toEqual([2589, 4306, 13468]);
  });

  it("counts items per category and subcategory", () => {
    const all = categoryCounts(items, quotes, false);
    expect(all.get("trade")).toBe(3);
    expect(all.get("trade/cloth")).toBe(2);
    expect(all.get("other")).toBe(1);
    expect(categoryCounts(items, quotes, true).get("weapon")).toBeUndefined();
  });
});
