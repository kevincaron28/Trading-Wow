import { describe, expect, it } from "vitest";
import { bucketStart, summarizeSnapshot, toCandles, type PricePoint } from "../src/lib/candles";

const H = 3_600;
const point = (time: number, market: number, listed = 10): PricePoint => ({ time, market, minBuyout: market, listed, auctions: 1 });

describe("summarizeSnapshot", () => {
  it("prices the cheapest 15% of listed quantity and ignores bad rows", () => {
    const p = summarizeSnapshot(0, [
      { unitPrice: 100, quantity: 10 },
      { unitPrice: 200, quantity: 10 },
      { unitPrice: 9_999, quantity: 80 },
      { unitPrice: 0, quantity: 5 },
      { unitPrice: 50, quantity: 0 },
    ]);
    // 100 listed -> cheapest 15 units: 10 at 100 + 5 at 200.
    expect(p).toEqual({ time: 0, minBuyout: 100, market: 133, listed: 100, auctions: 3 });
  });

  it("returns null for an empty snapshot", () => {
    expect(summarizeSnapshot(0, [])).toBeNull();
  });
});

describe("bucketStart", () => {
  it("aligns hours, days and Tuesday-reset weeks", () => {
    const t = Date.UTC(2026, 10, 17, 13, 45) / 1000; // Tue 17 Nov 2026 13:45 UTC
    expect(bucketStart(t, "1h")).toBe(Date.UTC(2026, 10, 17, 13) / 1000);
    expect(bucketStart(t, "4h")).toBe(Date.UTC(2026, 10, 17, 12) / 1000);
    expect(bucketStart(t, "1d")).toBe(Date.UTC(2026, 10, 17) / 1000);
    // Before 15:00 on Tuesday still belongs to the previous week.
    expect(bucketStart(t, "1w")).toBe(Date.UTC(2026, 10, 10, 15) / 1000);
    expect(bucketStart(Date.UTC(2026, 10, 17, 15) / 1000, "1w")).toBe(Date.UTC(2026, 10, 17, 15) / 1000);
  });
});

describe("toCandles", () => {
  it("makes continuous hourly candles that open at the previous close", () => {
    const candles = toCandles([point(0, 100), point(H, 120), point(2 * H, 90)], "1h");
    expect(candles.map((c) => [c.open, c.high, c.low, c.close])).toEqual([
      [100, 100, 100, 100],
      [100, 120, 100, 120],
      [120, 120, 90, 90],
    ]);
  });

  it("aggregates into 4h candles with average listed quantity, in time order", () => {
    const pts = [point(5 * H, 80, 30), point(0, 100, 10), point(H, 150, 20), point(2 * H, 70, 30), point(3 * H, 110, 40), point(4 * H, 90, 10)];
    const candles = toCandles(pts, "4h");
    expect(candles).toEqual([
      { time: 0, open: 100, high: 150, low: 70, close: 110, volume: 25 },
      { time: 4 * H, open: 110, high: 110, low: 80, close: 80, volume: 20 },
    ]);
  });

  it("handles no data", () => {
    expect(toCandles([], "1d")).toEqual([]);
  });
});
