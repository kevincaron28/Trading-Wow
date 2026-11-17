import { describe, expect, it } from "vitest";
import { ema, sma } from "../src/lib/indicators";

describe("indicators", () => {
  it("sma waits for a full window", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(sma([5], 1)).toEqual([5]);
  });

  it("ema seeds with the sma then smooths", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 3)).toEqual([null, null, 2]);
    expect(out[3]).toBeCloseTo(3); // 4*0.5 + 2*0.5
    expect(out[4]).toBeCloseTo(4);
  });

  it("rejects a bad period", () => {
    expect(() => sma([1], 0)).toThrow(RangeError);
    expect(() => ema([1], 1.5)).toThrow(RangeError);
  });
});
