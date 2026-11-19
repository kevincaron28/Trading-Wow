import { describe, expect, it } from "vitest";
import { DAY, HOUR, HOURLY_KEEP_SECONDS, addPoint, latestRow, shardOf, snapshotHour, summarizeHouse, type ItemHistory } from "../collector/store";

const T0 = Date.UTC(2026, 10, 18, 2) / 1000; // 18 Nov 2026 02:00 UTC
const point = (time: number, market: number, min = market, listed = 10, auctions = 2) => ({ time, market, minBuyout: min, listed, auctions });

describe("summarizeHouse", () => {
  it("groups item auctions and commodities by item, skipping bid-only and bad rows", () => {
    const out = summarizeHouse(T0, [
      { item: { id: 1 }, quantity: 2, buyout: 200 }, // 100 each
      { item: { id: 1 }, quantity: 1, buyout: 300 },
      { item: { id: 1 }, quantity: 1 }, // bid only
      { item: { id: 2 }, quantity: 20, unit_price: 50 },
      { item: { id: 3 }, quantity: 0, unit_price: 50 },
    ]);
    expect([...out.keys()].sort()).toEqual([1, 2]);
    expect(out.get(1)).toMatchObject({ minBuyout: 100, listed: 3, auctions: 2, time: T0 });
    expect(out.get(2)).toMatchObject({ minBuyout: 50, market: 50, listed: 20 });
  });
});

describe("addPoint", () => {
  it("stores hourly rows, replaces the same hour and builds the day's candle", () => {
    let h: ItemHistory = { h: [], d: [] };
    h = addPoint(h, point(T0, 100, 90));
    h = addPoint(h, point(T0 + HOUR, 140, 120));
    h = addPoint(h, point(T0 + 2 * HOUR, 80, 70));
    h = addPoint(h, point(T0 + 2 * HOUR, 120, 110)); // same hour again: replaced
    expect(h.h.map((r) => r[2])).toEqual([100, 140, 120]);
    // The low wick comes from the lowest buyout (90, within half the market value); no stored high, so the top is the market.
    expect(h.d).toEqual([[Math.floor(T0 / DAY), 100, 140, 90, 120, 10, 90]]);
  });

  it("drops hours older than the hourly window but keeps daily candles", () => {
    let h: ItemHistory = { h: [], d: [] };
    h = addPoint(h, point(T0, 100));
    const later = T0 + HOURLY_KEEP_SECONDS + HOUR;
    h = addPoint(h, point(later, 200));
    expect(h.h).toHaveLength(1);
    expect(h.d.map((r) => r[4])).toEqual([100, 200]);
  });
});

describe("latestRow", () => {
  it("reports the newest point, the market 24h earlier and the 7-day average", () => {
    let h: ItemHistory = { h: [], d: [] };
    for (let i = 0; i <= 24; i++) h = addPoint(h, point(T0 + i * HOUR, i < 24 ? 100 : 130, 95, 7, 3));
    expect(latestRow(h)).toEqual([95, 130, 7, 3, 100, 101, -1]);
    expect(latestRow({ h: [], d: [] })).toBeNull();
  });

  it("has no 24h reference for a new item, and uses the oldest point after 12 hours", () => {
    const h = addPoint({ h: [], d: [] }, point(T0, 100));
    expect(latestRow(h)![4]).toBe(0);
    let g: ItemHistory = { h: [], d: [] };
    for (let i = 0; i <= 11; i++) g = addPoint(g, point(T0 + i * HOUR, 100 + i));
    expect(latestRow(g)![4]).toBe(0);
    g = addPoint(g, point(T0 + 12 * HOUR, 150));
    expect(latestRow(g)![4]).toBe(100);
  });
});

describe("helpers", () => {
  it("rounds Blizzard's Last-Modified down to the hour", () => {
    expect(snapshotHour("Wed, 18 Nov 2026 02:25:00 GMT", 0)).toBe(T0);
    expect(snapshotHour(null, T0 + 1234)).toBe(T0);
    expect(snapshotHour("garbage", T0 + 59)).toBe(T0);
  });

  it("spreads items over shards", () => {
    expect(shardOf(13468)).toBe(13468 % 32);
  });
});

import { auctionState, estimateSold, shardOfV2 } from "../collector/store";
describe("estimated sales", () => {
  const T = 1_800_000_000 - (1_800_000_000 % 3600);
  it("counts long auctions that vanished and partly bought stacks, not short ones", () => {
    const prev = auctionState([
      { id: 1, item: { id: 10 }, quantity: 5, time_left: "LONG" },
      { id: 2, item: { id: 10 }, quantity: 3, time_left: "SHORT" },
      { id: 3, item: { id: 20 }, quantity: 20, time_left: "VERY_LONG" },
      { id: 4, item: { id: 30 }, quantity: 1, time_left: "VERY_LONG" },
    ]);
    const sold = estimateSold(prev, T, [{ id: 3, item: { id: 20 }, quantity: 12 }, { id: 4, item: { id: 30 }, quantity: 1 }], T + 3600)!;
    expect(sold.get(10)).toBe(5);
    expect(sold.get(20)).toBe(8);
    expect(sold.has(30)).toBe(false);
  });
  it("refuses snapshots too far apart and keeps sold in latest rows", () => {
    expect(estimateSold({}, T, [], T + 3 * 3600)).toBeNull();
    // After a missed hour (2h gap) a LONG auction (2-12h left) may simply have expired: only VERY_LONG counts.
    const two = estimateSold(auctionState([{ id: 1, item: { id: 10 }, quantity: 5, time_left: "LONG" }, { id: 2, item: { id: 10 }, quantity: 3, time_left: "VERY_LONG" }]), T, [], T + 2 * 3600)!;
    expect(two.get(10)).toBe(3);
    expect(estimateSold(null, 0, [], T)).toBeNull();
    let h: ItemHistory = { h: [], d: [] };
    h = addPoint(h, point(T0, 100), T0, 4);
    h = addPoint(h, point(T0 + HOUR, 100), T0 + HOUR, 6);
    expect(latestRow(h)![6]).toBe(10);
    expect(shardOfV2(13468)).toBe(13468 % 256);
  });
});
