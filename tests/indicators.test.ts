import { describe, expect, it } from "vitest";
import { bollinger, ema, heikinAshi, macd, rsi, sma } from "../src/lib/indicators";

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

describe("bollinger", () => {
  it("uses population standard deviation", () => {
    const b = bollinger([1, 2, 3, 4, 5], 3, 2);
    expect(b.middle).toEqual([null, null, 2, 3, 4]);
    const sd = Math.sqrt(2 / 3);
    expect(b.upper[2]).toBeCloseTo(2 + 2 * sd);
    expect(b.lower[4]).toBeCloseTo(4 - 2 * sd);
    expect(b.upper.slice(0, 2)).toEqual([null, null]);
  });
  it("handles empty input, flat data and bad period", () => {
    expect(bollinger([], 3).middle).toEqual([]);
    expect(bollinger([5, 5, 5], 3).upper[2]).toBe(5);
    expect(() => bollinger([1], 0)).toThrow(RangeError);
  });
});

describe("rsi", () => {
  it("is 100 for all gains, 0 for all losses, 50 for flat", () => {
    expect(rsi([1, 2, 3, 4], 3)).toEqual([null, null, null, 100]);
    expect(rsi([4, 3, 2, 1], 3)[3]).toBe(0);
    expect(rsi([2, 2, 2, 2], 3)[3]).toBe(50);
  });
  it("applies Wilder smoothing", () => {
    const out = rsi([1, 2, 1, 2], 2);
    expect(out[2]).toBeCloseTo(50);
    expect(out[3]).toBeCloseTo(75);
  });
  it("returns nulls when too short and rejects bad period", () => {
    expect(rsi([1, 2], 14)).toEqual([null, null]);
    expect(rsi([])).toEqual([]);
    expect(() => rsi([1], 1.5)).toThrow(RangeError);
  });
});

describe("macd", () => {
  it("lines up with ema difference and signal", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8];
    const m = macd(values, 2, 3, 2);
    const f = ema(values, 2);
    const s = ema(values, 3);
    expect(m.macd[1]).toBeNull();
    expect(m.macd[2]).toBeCloseTo(f[2]! - s[2]!);
    expect(m.signal[2]).toBeNull();
    expect(m.signal[3]).not.toBeNull();
    expect(m.histogram[3]).toBeCloseTo(m.macd[3]! - m.signal[3]!);
    expect(m.macd).toHaveLength(8);
  });
  it("handles short input and bad period", () => {
    expect(macd([1, 2, 3]).signal).toEqual([null, null, null]);
    expect(macd([]).macd).toEqual([]);
    expect(() => macd([1], 0)).toThrow(RangeError);
  });
});

describe("heikinAshi", () => {
  it("computes the standard formula and keeps time/volume", () => {
    const input = [
      { time: 1, open: 10, high: 14, low: 8, close: 12, volume: 5 },
      { time: 2, open: 12, high: 16, low: 11, close: 15, volume: 7 },
    ];
    const copy = JSON.parse(JSON.stringify(input));
    const ha = heikinAshi(input);
    expect(input).toEqual(copy);
    expect(ha[0]).toEqual({ time: 1, open: 11, high: 14, low: 8, close: 11, volume: 5 });
    expect(ha[1]!.open).toBe(11);
    expect(ha[1]!.close).toBe(13.5);
    expect(ha[1]!.high).toBe(16);
    expect(ha[1]!.low).toBe(11);
    expect(ha[1]!.volume).toBe(7);
    expect(heikinAshi([])).toEqual([]);
  });
});
