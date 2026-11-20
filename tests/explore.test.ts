import { describe, expect, it } from "vitest";
import { arbitrage, deals, mostListed, topMovers } from "../src/lib/explore";
import type { Quote } from "../src/lib/quotes";

const q = (id: number, o: Partial<Quote> = {}): Quote => ({
  id, min: 100, market: 100, listed: 10, auctions: 5, prev24h: 100, avg7d: 100, soldPerDay: null, prev1h: null, soldAvg7d: null, ...o,
});

describe("topMovers", () => {
  const quotes = [
    q(1, { market: 150 }), q(2, { market: 120 }), q(3, { market: 50 }),
    q(4, { prev24h: null }), q(5, { market: 500, listed: 2 }), q(6, { market: 100 }),
  ];
  it("sorts up, skips null, thin and flat", () => {
    expect(topMovers(quotes, { direction: "up" }).map((r) => r.quote.id)).toEqual([1, 2]);
    expect(topMovers(quotes, { direction: "up" })[0]!.change).toBeCloseTo(50);
  });
  it("sorts down and respects limit / minListed", () => {
    expect(topMovers(quotes, { direction: "down" }).map((r) => r.quote.id)).toEqual([3]);
    expect(topMovers(quotes, { direction: "up", limit: 1 })).toHaveLength(1);
    expect(topMovers(quotes, { direction: "up", minListed: 1 })[0]!.quote.id).toBe(5);
    expect(topMovers([], { direction: "up" })).toEqual([]);
  });
});

describe("mostListed", () => {
  it("orders by listed then auctions, without mutating", () => {
    const input = [q(1, { listed: 5, auctions: 1 }), q(2, { listed: 9 }), q(3, { listed: 5, auctions: 4 })];
    const copy = [...input];
    expect(mostListed(input).map((x) => x.id)).toEqual([2, 3, 1]);
    expect(input).toEqual(copy);
    expect(mostListed(input, 1)).toHaveLength(1);
    expect(mostListed([])).toEqual([]);
  });
});

describe("deals", () => {
  it("finds items well under the 7d average", () => {
    const quotes = [
      q(1, { min: 50 }), q(2, { min: 70 }), q(3, { min: 71 }), q(4, { min: 10, avg7d: 0 }), q(5, { min: 1, listed: 2 }),
    ];
    const out = deals(quotes);
    expect(out.map((r) => r.quote.id)).toEqual([1, 2]);
    expect(out[0]!.discount).toBeCloseTo(50);
    expect(deals(quotes, { limit: 1 })).toHaveLength(1);
    expect(deals(quotes, { maxRatio: 0.5 }).map((r) => r.quote.id)).toEqual([1]);
    expect(deals([])).toEqual([]);
  });
});

describe("arbitrage", () => {
  const buy = new Map([[1, q(1, { min: 100 })], [2, q(2, { min: 100 })], [3, q(3, { min: 10 })], [9, q(9, { min: 1 })]]);
  const sell = new Map([
    [1, q(1, { market: 200 })], [2, q(2, { market: 400 })], [3, q(3, { market: 10, listed: 1 })], [4, q(4)],
  ]);
  it("ranks by profit percent after the cut", () => {
    const out = arbitrage(buy, sell, { sellCut: 0.05 });
    expect(out.map((r) => r.id)).toEqual([2, 1]);
    expect(out[0]).toEqual({ id: 2, buyPrice: 100, sellPrice: 400, profit: 280, profitPct: 280 });
    expect(out[1]!.profit).toBe(90);
  });
  it("applies minProfit, minSellListed and limit", () => {
    expect(arbitrage(buy, sell, { sellCut: 0.05, minProfit: 100 }).map((r) => r.id)).toEqual([2]);
    expect(arbitrage(buy, sell, { sellCut: 0.05, limit: 1 })).toHaveLength(1);
    expect(arbitrage(buy, sell, { sellCut: 0.15, minSellListed: 20 })).toEqual([]);
    expect(arbitrage(new Map(), sell, { sellCut: 0.05 })).toEqual([]);
  });
});
