import { describe, expect, it } from "vitest";
import { BASE_END, INDEXES, capWeights, chooseBasket, priceAt, rebalanceTimes, updateIndex, valueAt, type Series } from "../collector/indexes";
import { parseCsv, upsertDay } from "../collector/tsm";

const H = 3_600;
const series = (prices: [number, number][], sold: [number, number][] = []): Series => ({ price: new Map(prices), sold: new Map(sold) });

describe("index maths", () => {
  it("caps weights and spreads the excess", () => {
    const w = capWeights([80, 10, 10], 0.5);
    expect(w[0]).toBeCloseTo(0.5);
    expect(w[1]! + w[2]!).toBeCloseTo(0.5);
    expect(capWeights([1, 1], 0.1)).toEqual([0.5, 0.5]);
  });

  it("uses the last price up to 72 hours old, never older", () => {
    const s = series([[100, 50]]);
    expect(priceAt(s, 171)).toBe(50);
    expect(priceAt(s, 172)).toBeNull();
  });

  it("rebalances on the first Tuesday of each month at 15:00 UTC", () => {
    const times = rebalanceTimes(BASE_END, Date.UTC(2027, 1, 28) / 1000).map((t) => new Date(t * 1000).toISOString());
    expect(times).toEqual(["2026-12-01T15:00:00.000Z", "2027-01-05T15:00:00.000Z", "2027-02-02T15:00:00.000Z"]);
  });

  it("picks liquid items by gold volume and values the basket from price relatives", () => {
    const herbs = INDEXES.find((d) => d.id === "herbs")!;
    const catalog = new Map([1, 2, 3, 4, 5, 6, 7].map((id) => [id, { itemClass: 7, subclass: id === 3 ? 5 : 9 }]));
    const h = 1000;
    const day = (p: number): [number, number][] => Array.from({ length: 24 }, (_, i) => [h - 23 + i, p]);
    const later = (p: number): [number, number][] => Array.from({ length: 7 }, (_, i) => [h + 1 + i, p]);
    const items = new Map([
      [1, series([...day(100), ...later(110)], [[h, 30]])], // volume 3,000; rises 10% for 7 hours
      [2, series([...day(1000), ...later(1000)], [[h, 5]])], // volume 5,000
      [3, series(day(5), [[h, 999]])], // cloth: not a herb
      [4, series(day(9999), [[h, 2]])], // only 2 sold: not liquid enough
      ...[5, 6, 7].map((id) => [id, series([...day(10), ...later(10)], [[h, 5]])] as [number, Series]), // volume 50 each
    ]);
    const basket = chooseBasket(herbs, items, catalog, h * H, 24);
    expect(basket.map((b) => b[0])).toEqual([2, 1, 5, 6, 7]);
    const period = { start: h * H, level: 100, basket };
    expect(valueAt(period, items, h)).toBeCloseTo(100);
    // Hourly prices are a 7-hour median: one hour at +10% does not move the index yet, seven hours do.
    const w1 = basket.find((b) => b[0] === 1)![1];
    expect(valueAt(period, items, h + 1)).toBeCloseTo(100);
    expect(valueAt(period, items, h + 7)).toBeCloseTo(100 * (w1 * 1.1 + (1 - w1) * 1));
  });

  it("uses the window median as base price and needs at least 5 liquid items", () => {
    const herbs = INDEXES.find((d) => d.id === "herbs")!;
    const catalog = new Map([1, 2, 3, 4, 5].map((id) => [id, { itemClass: 7, subclass: 9 }]));
    const h = 1000;
    // Item 1 has one cheap listing in the last hour of the window: it must not become the base price.
    const prices = (p: number, last = p): [number, number][] => Array.from({ length: 24 }, (_, i) => [h - 23 + i, i === 23 ? last : p]);
    const items = new Map([1, 2, 3, 4, 5].map((id) => [id, series(prices(100, id === 1 ? 3 : 100), [[h, 10]])]));
    expect(chooseBasket(herbs, items, catalog, h * H, 24).find((b) => b[0] === 1)![2]).toBe(100);
    items.delete(5);
    expect(chooseBasket(herbs, items, catalog, h * H, 24)).toEqual([]);
  });

  it("is provisional before the base day closes and fixed (base 100) after", () => {
    const def = INDEXES.find((d) => d.id === "herbs")!;
    const ids = [1, 2, 3, 4, 5];
    const catalog = new Map(ids.map((id) => [id, { itemClass: 7, subclass: 9 }]));
    const baseHour = BASE_END / H;
    const prices: [number, number][] = Array.from({ length: 23 }, (_, i) => [baseHour - 24 + i, 100]);
    const after: [number, number][] = Array.from({ length: 7 }, (_, i) => [baseHour + 1 + i, 90]);
    // A one-hour spike to 120 just before the base close is ignored; seven hours at 90 bring the index to 90.
    const items = new Map(ids.map((id) => [id, series([...prices, [baseHour - 1, 120], ...after], [[baseHour - 2, 5]])]));
    const early = updateIndex(def, null, items, catalog, BASE_END - 600)!;
    expect(early.periods[0]!.provisional).toBe(true);
    const fixed = updateIndex(def, early, items, catalog, BASE_END + 8 * H)!;
    expect(fixed.periods[0]).toMatchObject({ start: BASE_END, level: 100 });
    expect(fixed.periods[0]!.provisional).toBeUndefined();
    expect(fixed.hourly.find(([hh]) => hh === baseHour - 1)![1]).toBe(100);
    expect(fixed.hourly.find(([hh]) => hh === baseHour + 7)![1]).toBe(90);
  });
  it("counts one item's move as at most x3 or /3", () => {
    const items = new Map([[1, series([[10, 1000]])], [2, series([[10, 100]])]]);
    const period = { start: 0, level: 100, basket: [[1, 0.5, 100], [2, 0.5, 100]] as [number, number, number][] };
    expect(valueAt(period, items, 10)).toBeCloseTo(100 * (0.5 * 3 + 0.5 * 1));
  });
  it("leaves gear without a catalog class out of Goldline 100", () => {
    const gl = INDEXES.find((d) => d.id === "gl100")!;
    expect(gl.select({ itemClass: -1, subclass: 0 })).toBe(false);
    expect(gl.select({ itemClass: 7, subclass: 9 })).toBe(true);
  });
});

describe("TSM public data", () => {
  it("parses CSV with quoted names", () => {
    const rows = parseCsv('itemId,name,marketValue\n878,"Spinneret, fist-sized",99\r\n1399,Magic Candle,155\n');
    expect(rows).toEqual([{ itemId: "878", name: "Spinneret, fist-sized", marketValue: "99" }, { itemId: "1399", name: "Magic Candle", marketValue: "155" }]);
  });
  it("keeps one daily row per day", () => {
    expect(upsertDay([[1, 10, 9], [2, 11, 10]], 2, 12, 11)).toEqual([[1, 10, 9], [2, 12, 11]]);
  });
});
