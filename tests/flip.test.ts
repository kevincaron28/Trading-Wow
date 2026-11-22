import { describe, expect, it } from "vitest";
import { flipStats } from "../src/lib/flip";
import { changeOver, toQuote } from "../src/lib/quotes";
import { zoneOffset } from "../src/lib/time";

describe("flipper numbers", () => {
  const q = toQuote(1, [1000, 1100, 90, 12, 1000, 1000, 30, 1050, 20]);
  it("works out sales, supply and margin only from known data", () => {
    const f = flipStats(q, 0.05);
    expect(f.sold24h).toBe(30);
    expect(f.salesTrend).toBeCloseTo(50);
    expect(f.sellThrough).toBeCloseTo(25);
    expect(f.daysSupply).toBeCloseTo(4.5);
    expect(f.margin).toBe(Math.round(1100 * 0.95 - 1000));
    expect(f.spreadPct).toBeCloseTo(10);
    expect(f.vsAvg7d).toBeCloseTo(10);
    const none = flipStats(toQuote(2, [1000, 1100, 90, 12, 0, 1100]), 0.15);
    expect([none.sold24h, none.salesTrend, none.sellThrough, none.daysSupply]).toEqual([null, null, null, null]);
  });
  it("gives the change over 24 hours or the last hour", () => {
    expect(changeOver(q, "1d").pct).toBeCloseTo(10);
    expect(changeOver(q, "1h").abs).toBe(50);
    expect(changeOver(toQuote(3, [1, 2, 3, 4, 0, 2]), "1h")).toEqual({ pct: null, abs: null });
  });
  it("reads zone offsets, daylight time included", () => {
    expect(zoneOffset(Date.UTC(2026, 10, 20) / 1000, "America/New_York")).toBe(-5 * 3600);
    expect(zoneOffset(Date.UTC(2026, 6, 1) / 1000, "America/New_York")).toBe(-4 * 3600);
    expect(zoneOffset(Date.UTC(2026, 10, 20) / 1000, "UTC")).toBe(0);
  });
});
