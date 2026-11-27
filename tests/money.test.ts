import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyShort, percentChange, splitCopper, formatPoints } from "../src/lib/money";

describe("money", () => {
  it("splits copper into coins", () => {
    expect(splitCopper(123_456)).toEqual({ negative: false, gold: 12, silver: 34, copper: 56 });
    expect(splitCopper(-5)).toEqual({ negative: true, gold: 0, silver: 0, copper: 5 });
  });

  it("formats like the game in English and French", () => {
    expect(formatMoney(123_456)).toBe("12g 34s 56c");
    expect(formatMoney(120_000)).toBe("12g");
    expect(formatMoney(10_005)).toBe("1g 5c");
    expect(formatMoney(0)).toBe("0c");
    expect(formatMoney(-250)).toBe("-2s 50c");
    expect(formatMoney(123_456, "fr")).toBe("12g 34s 56c");
    expect(formatMoney(25_000_000)).toBe("2,500g");
    expect(formatMoney(25_000_000, "fr")).toBe("2 500g");
  });

  it("shortens axis labels", () => {
    expect(formatMoneyShort(123_456)).toBe("12.35g");
    expect(formatMoneyShort(123_456, "fr")).toBe("12,35g");
    expect(formatMoneyShort(4_500)).toBe("45s");
    expect(formatMoneyShort(80)).toBe("80c");
    expect(formatMoneyShort(25_000_000)).toBe("2500g");
  });

  it("computes percent change", () => {
    expect(percentChange(100, 110)).toBeCloseTo(10);
    expect(percentChange(0, 10)).toBeNull();
  });
});

import { formatMoneyAxis } from "../src/lib/money";
describe("axis labels", () => {
  it("shows at most two coin units", () => {
    expect(formatMoneyAxis(122_577)).toBe("12g 25s");
    expect(formatMoneyAxis(12_345_678)).toBe("1,234g");
    expect(formatMoneyAxis(2_577, "fr")).toBe("25s 77c");
    expect(formatMoneyAxis(77)).toBe("77c");
    expect(formatMoneyAxis(800_000)).toBe("80g");
    expect(formatMoneyAxis(2_500)).toBe("25s");
    expect(formatMoneyAxis(130_600)).toBe("13g 06s");
    expect(formatMoneyAxis(2_505)).toBe("25s 05c");
  });
});

describe("formatPoints", () => {
  it("writes index points in the reader's language", () => {
    expect(formatPoints(130, "en")).toBe("130.00");
    expect(formatPoints(130, "fr")).toBe("130,00");
    expect(formatPoints(99.456, "fr")).toBe("99,46");
  });
});
