import { describe, expect, it } from "vitest";
import { WEEK_HOURS, buildWeekly, dailyCloses, quoteAt, smoothAt, type WeeklyInput } from "../collector/weekly";
import type { HourRow, ItemHistory } from "../collector/store";
import { parseRecipes } from "../src/lib/crafting";
import { pctText, weeklyEmpty, weeklySummary, type WeeklyRecap } from "../src/lib/weekly";

const END = 500_000; // hour index of the latest snapshot
const DAY_H = 24;

/** Hourly rows from `from` to END: price(h) for market (min = market), listed 50, auctions 10, `sold` per hour. */
function hours(from: number, price: (h: number) => number, sold = 2, min?: (h: number) => number): HourRow[] {
  const out: HourRow[] = [];
  for (let h = from; h <= END; h++) out.push([h, min ? min(h) : price(h), price(h), 50, 10, sold]);
  return out;
}

function input(histories: [number, ItemHistory][], over: Partial<WeeklyInput> = {}): WeeklyInput {
  return { house: 113, faction: "horde", histories: new Map(histories), early: new Map(), classOf: () => 7, indexes: {}, book: null, ...over };
}

describe("weekly recap (collector)", () => {
  it("reads a quote as of an hour and smooths prices over 7 hours", () => {
    const h: ItemHistory = { h: hours(END - 300, (x) => (x < END - 100 ? 1_000 : 2_000)), d: [] };
    expect(quoteAt(1, h, END - 150)!.market).toBe(1_000);
    expect(quoteAt(1, h, END)!.market).toBe(2_000);
    expect(quoteAt(1, { h: h.h.filter((r) => r[0] < END - 10), d: [] }, END)).toBeNull();
    const spike: ItemHistory = { h: hours(END - 10, (x) => (x === END ? 9_000 : 1_000)), d: [] };
    expect(smoothAt(spike, END)).toBe(1_000);
  });

  it("takes the median hourly price of a day over its candle and early values", () => {
    const day = Math.floor((END * 3_600) / 86_400);
    const h: ItemHistory = { h: hours(END - 5, (x) => (x === END ? 9_000 : 1_000)), d: [[day, 1, 1, 1, 9_000, 1, 1], [day - 1, 1, 1, 1, 700, 1, 1]] };
    const closes = dailyCloses(h, new Map([[day - 2, 500], [day - 1, 600]]));
    expect(closes.get(day)).toBe(1_000);
    expect(closes.get(day - 1)).toBe(700);
    expect(closes.get(day - 2)).toBe(500);
  });

  it("needs a full week of hourly prices for movers, flips and crafts", () => {
    const short = buildWeekly(input([[1, { h: hours(END - 100, () => 1_000, 10), d: [] }]]))!;
    expect(short.end).toBe(END * 3_600);
    expect(short.start).toBe((END - WEEK_HOURS) * 3_600);
    expect(short.risers).toBeNull();
    expect(short.flips).toBeNull();
    expect(short.crafts).toBeNull();
    expect(short.highs).toBeNull();
  });

  it("ranks risers and fallers by their 7-day change, leaving out thin, cheap and small markets and relisted stacks", () => {
    const from = END - WEEK_HOURS - 30;
    const w = buildWeekly(input([
      [1, { h: hours(from, (x) => (x <= END - WEEK_HOURS ? 100_000 : 150_000), 10), d: [] }],
      [2, { h: hours(from, (x) => (x <= END - WEEK_HOURS ? 100_000 : 80_000), 10), d: [] }],
      [3, { h: hours(from, (x) => (x <= END - WEEK_HOURS ? 100_000 : 400_000), 10), d: [] }],
      [4, { h: hours(from, (x) => (x <= END - WEEK_HOURS ? 100_000 : 120_000), 0), d: [] }],
      // Cheap food: 2,400 sold a day, but under 1 gold, so a +150% move is worth a few gold.
      [5, { h: hours(from, (x) => (x <= END - WEEK_HOURS ? 2_000 : 5_000), 100), d: [] }],
      // 1 gold, but 240 sold a day is 240 gold traded: under the 500 gold a day bar.
      [6, { h: hours(from, (x) => (x <= END - WEEK_HOURS ? 10_000 : 15_000), 10), d: [] }],
    ]))!;
    expect(w.risers!.map((r) => r[0])).toEqual([1]);
    expect(w.risers![0]![3]).toBeCloseTo(50);
    expect(w.fallers!.map((r) => r[0])).toEqual([2]);
    expect(w.fallers![0]![3]).toBeCloseTo(-20);
  });

  it("finds new highs and lows against at least 7 earlier days, early history included", () => {
    const startDay = Math.floor(((END - WEEK_HOURS + 1) * 3_600) / 86_400);
    const early = new Map<number, number>();
    for (let d = startDay - 10; d < startDay; d++) early.set(d, 100_000);
    const w = buildWeekly(input([
      [1, { h: hours(END - 3 * DAY_H, () => 130_000, 10), d: [] }],
      [2, { h: hours(END - 3 * DAY_H, () => 70_000, 10), d: [] }],
      [3, { h: hours(END - 3 * DAY_H, () => 101_000, 10), d: [] }],
    ], { early: new Map([[1, early], [2, early], [3, early]]) }))!;
    expect(w.highs!.map((r) => r[0])).toEqual([1]);
    expect(w.highs![0]![3]).toBe(100_000);
    expect(w.highs![0]![4]).toBe(10);
    expect(w.lows!.map((r) => r[0])).toEqual([2]);
  });

  it("replays the flip rule over the week and reports how each flip turned out", () => {
    const from = END - WEEK_HOURS - 30;
    // Usual price 10,000; a dip of the lowest buyout to 6,000 around 3 days ago; market back to 10,000 now.
    const dip = (h: number) => h > END - 80 && h < END - 70;
    const w = buildWeekly(input([[1, { h: hours(from, () => 10_000, 5, (h) => (dip(h) ? 6_000 : 10_000)), d: [] }]]))!;
    expect(w.flips!.found).toBe(1);
    const [id, at, buy, target, , now, result, reached] = w.flips!.rows[0]!;
    expect(id).toBe(1);
    expect(at).toBeGreaterThan((END - 80) * 3_600);
    expect(buy).toBe(6_000);
    expect(target).toBe(10_000);
    expect(now).toBe(10_000);
    expect(result).toBeCloseTo(((10_000 * 0.95 - 6_000) / 6_000) * 100);
    expect(reached).toBe(1);
    expect(w.flips!.paid).toBe(1);
  });

  it("replays profitable crafts once a day and gives their profit now", () => {
    const from = END - WEEK_HOURS - 30;
    const book = parseRecipes({ recipes: [[1, 171, 500, 1, 1, [[10, 2]]]], vendor: {} });
    const w = buildWeekly(input([
      [10, { h: hours(from, (h) => (h < END - 48 ? 1_000 : 2_000), 10), d: [] }],
      [500, { h: hours(from, () => 5_000, 10), d: [] }],
    ], { book }))!;
    expect(w.crafts!.found).toBe(1);
    const [item, , then, , now] = w.crafts!.rows[0]!;
    expect(item).toBe(500);
    expect(then).toBe(Math.round(5_000 * 0.95 - 2_000));
    expect(now).toBe(Math.round(5_000 * 0.95 - 4_000));
    expect(w.crafts!.stillProfitable).toBe(1);
  });

  it("reports each index's change over the week", () => {
    const w = buildWeekly(input([[1, { h: hours(END - 10, () => 1_000), d: [] }]], {
      indexes: { gl100: { hourly: [[END - 200, 90], [END - WEEK_HOURS, 100], [END, 112]] } },
    }))!;
    expect(w.indexes!.map(([id, a, b]) => [id, a, b])).toEqual([["gl100", 100, 112]]);
    expect(w.indexes![0]![3]).toBeCloseTo(12);
  });
});

describe("weekly summary (app)", () => {
  const recap: WeeklyRecap = {
    v: 1, house: 113, start: 0, end: 604_800, ownSince: 0,
    indexes: [["gl100", 100, 104.2, 4.2], ["herbs", 50, 44, -12], ["raidprep", 50, 54, 8], ["cloth", 50, 51, 2]],
    risers: [[7, 100, 145, 45, 30]],
    fallers: null, highs: [], lows: [],
    flips: { found: 12, paid: 8, reached: 9, rows: [] },
    crafts: null,
  };
  const names = { 7: "Black Lotus" } as Record<number, string>;
  const idx = { herbs: { en: "Herbs", fr: "Herbes" }, raidprep: { en: "Raid prep", fr: "Préparation de raid" } } as Record<string, { en: string; fr: string }>;

  it("says what the numbers say, in English and French", () => {
    const now = Date.UTC(2026, 10, 24) / 1000;
    expect(weeklySummary(recap, "en", (id) => names[id]!, (id) => idx[id]!.en, now)).toEqual([
      "The Ledger 100 rose 4.2% this week.",
      "Herbs fell 12%; Raid prep rose 8.0%.",
      "Biggest riser: Black Lotus (+45%).",
      "Of 12 flips spotted, 8 pay off at today's prices.",
      "The first raids open 9 December, in 15 days.",
    ]);
    expect(weeklySummary(recap, "fr", (id) => names[id]!, (id) => idx[id]!.fr, now)).toEqual([
      "Le Ledger 100 a monté de 4,2 % cette semaine.",
      "Herbes : -12 % ; Préparation de raid : +8,0 %.",
      "Plus forte hausse : Black Lotus (+45 %).",
      "Sur 12 reventes repérées, 8 rapportent aux prix d'aujourd'hui.",
      "Les premiers raids ouvrent le 9 décembre, dans 15 jours.",
    ]);
  });

  it("calls a small move steady and stops counting days after the raids open", () => {
    const flat = { ...recap, indexes: [["gl100", 100, 100.3, 0.3]] as [string, number, number, number][], risers: null, flips: null };
    expect(weeklySummary(flat, "en", String, String, Date.UTC(2026, 11, 10) / 1000)).toEqual(["The Ledger 100 held steady this week (+0.3%)."]);
  });

  it("formats percentages and knows when there is nothing to show", () => {
    expect(pctText(-12.4, "en", true)).toBe("-12%");
    expect(pctText(4.25, "fr")).toBe("4,3 %");
    expect(weeklyEmpty(null)).toBe(true);
    expect(weeklyEmpty({ ...recap, indexes: null, risers: null, highs: null, lows: null, flips: null })).toBe(true);
    expect(weeklyEmpty(recap)).toBe(false);
  });
});
