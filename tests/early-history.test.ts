import { describe, expect, it } from "vitest";
import { median, mergeDay, SRC } from "../collector/merge-history";
import { dailyRows, pricetableIds } from "../collector/backfill-ahledger";
import { earlyCandles } from "../src/data/series";
import { parseEarly } from "../src/data/live";
import { LAUNCH_DAY, rawIndex, withEarly, type IndexFile } from "../collector/indexes";

const D = 86_400;

describe("merged early history", () => {
  it("takes the median of the sources, so one odd source cannot skew a day", () => {
    expect(median([10, 1000, 12])).toBe(12);
    expect(median([10, 20])).toBe(15);
    expect(mergeDay(20765, { market: [100, 140], min: [80, 90, 5000], qty: [3, 7], sources: SRC.ahledger | SRC.ahprice })).toEqual([20765, 120, 90, 7, 3]);
  });
  it("uses the lowest buyouts as the market value when no source has one, and keeps min <= market", () => {
    expect(mergeDay(1, { market: [], min: [50, 70], qty: [], sources: SRC.seed })).toEqual([1, 60, 60, 0, 4]);
    expect(mergeDay(1, { market: [40], min: [90], qty: [], sources: 1 })).toEqual([1, 40, 40, 0, 1]);
    expect(mergeDay(1, { market: [], min: [], qty: [], sources: 0 })).toBeNull();
  });
  it("drops the internal source mask in the app", () => {
    expect(parseEarly([[20765, 120, 90, 7, 3]])).toEqual([{ time: 20765 * D, market: 120, min: 90, quantity: 7 }]);
  });
});

describe("early candles", () => {
  const early = [
    { time: 1 * D, market: 100, min: 80, quantity: 5 },
    { time: 2 * D, market: 120, min: 110, quantity: 6 },
    { time: 9 * D, market: 999, min: 999, quantity: 1 },
  ];
  it("open at the previous close, low wick at the real lowest buyout, and stop where our own data starts", () => {
    expect(earlyCandles(early, 9 * D, "market")).toEqual([
      { time: D, open: 100, high: 100, low: 80, close: 100, volume: 5 },
      { time: 2 * D, open: 100, high: 120, low: 100, close: 120, volume: 6 },
    ]);
  });
  it("draws lowest-buyout charts from the lowest buyouts, without wicks", () => {
    expect(earlyCandles(early, 9 * D, "min")[1]).toEqual({ time: 2 * D, open: 80, high: 110, low: 80, close: 110, volume: 6 });
  });
});

describe("AHledger backfill parsing", () => {
  it("keeps one row per day from launch, skipping empty days", () => {
    expect(dailyRows([
      { t: "2026-11-03T00:00:00.000Z", min: 1, median: 1 },
      { t: "2026-11-05T00:00:00.000Z", min: 10, median: 35, quantity: 5874 },
      { t: "2026-11-06T00:00:00.000Z", min: null, median: null },
    ])).toEqual([[Date.UTC(2026, 10, 5) / 864e5, 35, 10, 5874]]);
  });
  it("reads item ids from a price table", () => {
    expect(pricetableIds("AHL1|forever/pvp/horde/us|1793000000|2\n2589:20:18\n12784:1500000:1\n")).toEqual([2589, 12784]);
  });
});

describe("indexes from launch", () => {
  const H0 = (LAUNCH_DAY + 14) * 24 + 2; // 18 Nov 02:00
  const hourly: IndexFile = { id: "x", periods: [{ start: H0 * 3600, level: 100, basket: [[1, 0.5, 10], [2, 0.5, 20]] }], hourly: [[H0, 100], [H0 + 1, 110]] };
  const early = new Map([
    [1, new Map([[LAUNCH_DAY + 1, 20], [LAUNCH_DAY + 2, 10]])],
    [2, new Map([[LAUNCH_DAY + 2, 40]])],
  ]);
  it("starts at 100 on the first day with half the basket priced, re-weights missing items and chain-links the hourly part", () => {
    const f = withEarly(hourly, early);
    expect(f.periods[0]).toMatchObject({ start: (LAUNCH_DAY + 1) * D, level: 100 });
    // day 1: item 1 at its base (20) -> 100; day 2: item 1 at half (10/20), item 2 at its first price (40/40) -> 75.
    expect(f.hourly.slice(0, 2)).toEqual([[(LAUNCH_DAY + 1) * 24 + 23, 100], [(LAUNCH_DAY + 2) * 24 + 23, 75]]);
    expect(f.link).toBe(0.75);
    expect(f.hourly.slice(2)).toEqual([[H0, 75], [H0 + 1, 82.5]]);
    expect(f.periods[1]!.level).toBe(75);
  });
  it("undoes the link exactly, so the next run can recompute it", () => {
    const f = withEarly(hourly, early);
    expect(rawIndex(f)).toEqual({ id: "x", periods: hourly.periods, hourly: hourly.hourly });
  });
  it("leaves a house without early prices on its own base", () => {
    expect(withEarly(hourly, new Map())).toBe(hourly);
  });
});
