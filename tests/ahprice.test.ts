import { describe, expect, it } from "vitest";
import { dailyRows, itemOrder, MARKETS } from "../collector/backfill-ahprice";
import { COLLECTION_START_DAY, FOREVER_LAUNCH_DAY } from "../collector/import-auctionator";
import { BUILT_IN_WATCHLISTS } from "../src/data/watchlists";

describe("ahprice backfill", () => {
  it("keeps one row per day (last scan wins) inside launch..17 Nov, dropping empty prices", () => {
    const L = FOREVER_LAUNCH_DAY * 86_400;
    const rows = dailyRows([
      { t: L - 10, floor_copper: 5, qty: 1 },
      { t: L + 100, floor_copper: 450000, qty: 4 },
      { t: L + 200, floor_copper: 400000, qty: 2 },
      { t: L + 86_400 + 5, floor_copper: 0, qty: 3 },
      { t: L + 2 * 86_400, floor_copper: 199600.4 },
      { t: COLLECTION_START_DAY * 86_400 + 1, floor_copper: 9, qty: 9 },
    ]);
    expect(rows).toEqual([
      [FOREVER_LAUNCH_DAY, 400000, 2],
      [FOREVER_LAUNCH_DAY + 2, 199600, 0],
    ]);
  });

  it("asks for watchlist items first, then the most-listed items, each once", () => {
    const latest = new Map([[113, { "999001": [1, 1, 500], "999002": [1, 1, 5000], "13468": [1, 1, 1] }]]);
    const order = itemOrder(latest);
    expect(order[0]).toBe(BUILT_IN_WATCHLISTS[0]!.items[0]);
    expect(order.slice(-2)).toEqual([999002, 999001]);
    expect(new Set(order).size).toBe(order.length);
  });

  it("maps each ahprice market to a distinct faction house", () => {
    expect(new Set(MARKETS.map((m) => m.house)).size).toBe(8);
    expect(MARKETS.some((m) => [116, 117, 121, 125].includes(m.house))).toBe(false);
  });
});

describe("ahprice daily budget", () => {
  it("keeps counting within a UTC day and starts over the next day", async () => {
    const { budgetFor, DAILY_BUDGET } = await import("../collector/backfill-ahprice");
    const now = new Date("2026-11-19T01:00:00Z");
    expect(budgetFor({ day: "2026-11-19", used: 120 }, now)).toEqual({ day: "2026-11-19", used: 120 });
    expect(budgetFor({ day: "2026-11-18", used: 1900 }, now)).toEqual({ day: "2026-11-19", used: 0 });
    expect(budgetFor(null, now)).toEqual({ day: "2026-11-19", used: 0 });
    expect(DAILY_BUDGET).toBeLessThan(2000);
  });
});
