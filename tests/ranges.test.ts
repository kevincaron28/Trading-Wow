import { describe, expect, it } from "vitest";
import { addLine, alertOpFor, MAX_LINES, removeLine, visibleRange } from "../src/lib/ranges";

describe("visibleRange", () => {
  it("returns null for all or missing data", () => {
    expect(visibleRange("all", 1000)).toBeNull();
    expect(visibleRange("1w", null)).toBeNull();
  });
  it("ends at the last candle", () => {
    expect(visibleRange("1d", 200_000)).toEqual({ from: 200_000 - 86_400, to: 200_000 });
    expect(visibleRange("1y", 40_000_000)).toEqual({ from: 40_000_000 - 365 * 86_400, to: 40_000_000 });
  });
});

describe("lines", () => {
  it("rounds, sorts, dedupes", () => {
    expect(addLine([500], 120.4)).toEqual([120, 500]);
    expect(addLine([120], 120.2)).toEqual([120]);
    expect(addLine([], -5)).toEqual([]);
  });
  it("caps at the maximum", () => {
    const full = Array.from({ length: MAX_LINES }, (_, i) => (i + 1) * 100);
    expect(addLine(full, 99_999)).toEqual(full);
  });
  it("removes", () => {
    expect(removeLine([1, 2, 3], 2)).toEqual([1, 3]);
  });
  it("picks alert op", () => {
    expect(alertOpFor(200, 100)).toBe("above");
    expect(alertOpFor(50, 100)).toBe("below");
  });
});
