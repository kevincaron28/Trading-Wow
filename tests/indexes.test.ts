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
    const catalog = new Map([[1, { itemClass: 7, subclass: 9 }], [2, { itemClass: 7, subclass: 9 }], [3, { itemClass: 7, subclass: 5 }], [4, { itemClass: 7, subclass: 9 }]]);
    const h = 1000;
    const day = (p: number): [number, number][] => Array.from({ length: 24 }, (_, i) => [h - 23 + i, p]);
    const items = new Map([
      [1, series([...day(100), [h + 1, 110]], [[h, 30]])], // volume 3,000
      [2, series([...day(1000), [h + 1, 1000]], [[h, 5]])], // volume 5,000
      [3, series(day(5), [[h, 999]])], // cloth: not a herb
      [4, series(day(9999), [[h, 2]])], // only 2 sold: not liquid enough
    ]);
    const basket = chooseBasket(herbs, items, catalog, h * H, 24);
    expect(basket.map((b) => b[0])).toEqual([2, 1]);
    const period = { start: h * H, level: 100, basket };
    expect(valueAt(period, items, h)).toBeCloseTo(100);
    // Two items cannot both stay under a 25% cap, so capWeights gives them equal weight; item 1 rises 10%.
    const w1 = basket.find((b) => b[0] === 1)![1];
    expect(valueAt(period, items, h + 1)).toBeCloseTo(100 * (w1 * 1.1 + (1 - w1) * 1));
  });

  it("is provisional before the base day closes and fixed (base 100) after", () => {
    const def = INDEXES.find((d) => d.id === "herbs")!;
    const catalog = new Map([[1, { itemClass: 7, subclass: 9 }]]);
    const baseHour = BASE_END / H;
    const prices: [number, number][] = Array.from({ length: 23 }, (_, i) => [baseHour - 24 + i, 100]);
    const items = new Map([[1, series([...prices, [baseHour - 1, 120], [baseHour + 1, 90]], [[baseHour - 2, 5]])]]);
    const early = updateIndex(def, null, items, catalog, BASE_END - 600)!;
    expect(early.periods[0]!.provisional).toBe(true);
    const fixed = updateIndex(def, early, items, catalog, BASE_END + 3 * H)!;
    expect(fixed.periods[0]).toMatchObject({ start: BASE_END, level: 100 });
    expect(fixed.periods[0]!.provisional).toBeUndefined();
    expect(fixed.hourly.find(([hh]) => hh === baseHour - 1)![1]).toBe(100);
    expect(fixed.hourly.find(([hh]) => hh === baseHour + 1)![1]).toBe(75);
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
