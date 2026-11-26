import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backfill, writeBackfill } from "../collector/backfill-indexes";
import { LAUNCH_REVIEWS, PARAMS, buildIndex, prepare, priceDay, priceHour, selectDaily, selectHourly, value, type DailySeries, type IndexFile4 } from "../collector/index-v4";
import { INDEXES, basketChanges, updateIndex, valueAt, type Series } from "../collector/indexes";
import { listFiles } from "../collector/r2-publish";
import { contribution } from "../src/ui/IndexesView";

const H = 3_600;
const D = 86_400;
const day = (d: number) => Date.UTC(2026, 10, d) / 1000 / D;
const herbs = INDEXES.find((x) => x.id === "herbs")!;
const IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const catalog = new Map(IDS.map((id) => [id, { itemClass: 7, subclass: 9 }]));
const FIRST_HOUR = day(18) * 24 + 2;

/** A market that moves: each item has its own level, trend and wobble (deterministic). */
const priceOf = (id: number, hour: number) => Math.round(1_000 * id * (1 + 0.3 * Math.sin(hour / (17 + id))) * (id % 2 ? 1 : Math.exp(-(hour - day(5) * 24) / 900)));

function market(lastHour: number): { hourly: Map<number, Series>; daily: DailySeries } {
  const daily: DailySeries = new Map(IDS.map((id) => [id, new Map()]));
  const hourly = new Map<number, Series>(IDS.map((id) => [id, { price: new Map(), sold: new Map() }]));
  for (const id of IDS) {
    for (let d = day(5); d <= day(17); d++) daily.get(id)!.set(d, [priceOf(id, d * 24 + 12), 100 * id]);
    for (let h = FIRST_HOUR; h <= lastHour; h++) {
      hourly.get(id)!.price.set(h, priceOf(id, h));
      hourly.get(id)!.sold.set(h, 1 + (id % 3));
    }
  }
  return { hourly, daily };
}

const flat = (price: number, from: number, to: number, sold = 1): Series => {
  const s: Series = { price: new Map(), sold: new Map() };
  for (let h = from; h <= to; h++) { s.price.set(h, price); s.sold.set(h, sold); }
  return s;
};

describe("method 4 formula", () => {
  const basket: [number, number, number][] = [[1, 0.2, 10], [2, 0.2, 10], [3, 0.2, 10], [4, 0.2, 10], [5, 0.2, 10]];
  const at = (prices: Record<number, number>) => (id: number) => prices[id] ?? null;

  it("is a weighted geometric mean: a doubling and a halving cancel", () => {
    expect(value({ level: 100, basket }, at({ 1: 20, 2: 5, 3: 10, 4: 10, 5: 10 }))).toBeCloseTo(100);
    // The arithmetic mean, kept only to compare, reads the same prices as a 10% rise.
    expect(value({ level: 100, basket }, at({ 1: 20, 2: 5, 3: 10, 4: 10, 5: 10 }), { ...PARAMS, mean: "arithmetic" })).toBeCloseTo(110);
  });

  it("gives the same level back when prices return (no drift through reviews)", () => {
    const a = { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 };
    const b = { 1: 25, 2: 4, 3: 13, 4: 10, 5: 8 };
    const there = value({ level: 100, basket }, at(b))!;
    const back = value({ level: there, basket: basket.map(([id, w]) => [id, w, b[id as 1]] as [number, number, number]) }, at(a))!;
    expect(back).toBeCloseTo(100, 8);
  });

  it("counts one item as at most x3 or /3, leaves unpriced items out and needs 5 priced ones", () => {
    expect(value({ level: 100, basket }, at({ 1: 10_000, 2: 10, 3: 10, 4: 10, 5: 10 }))).toBeCloseTo(100 * 3 ** 0.2);
    expect(value({ level: 100, basket }, at({ 1: 10, 2: 10, 3: 10, 4: 10 }))).toBeNull();
    const six: [number, number, number][] = [...basket, [6, 0.2, 10]];
    expect(value({ level: 100, basket: six }, at({ 1: 20, 2: 20, 3: 20, 4: 20, 5: 20 }))).toBeCloseTo(200);
  });

  it("uses a 7-hour median held within x2 of the 72 hours before, and drops prices older than 72 hours", () => {
    const s = flat(100, 0, 200);
    for (let h = 180; h <= 200; h++) s.price.set(h, 900);
    expect(priceHour(flat(100, 0, 10), 10)).toBe(100);
    s.price.set(100, 5000);
    expect(priceHour(s, 100)).toBe(100); // one odd hour
    expect(priceHour(s, 186)).toBe(200); // a lasting jump: at most x2 of the recent level...
    expect(priceHour(s, 200, { ...PARAMS, guardHours: 12 })).toBe(900); // ...until the recent level has moved
    expect(priceHour(flat(100, 0, 10), 81)).toBe(100);
    expect(priceHour(flat(100, 0, 10), 82)).toBeNull();
  });

  it("holds a daily price within x2 of the 3 days before", () => {
    const days = new Map<number, [number, number]>([[1, [100, 1]], [2, [100, 1]], [3, [900, 1]]]);
    expect(priceDay(days, 3)).toBe(200);
    expect(priceDay(days, 6)).toBeNull();
  });

  it("adds each item's share to the index by its log price change", () => {
    expect(contribution(4, 100, 80, 0.25, 10, 22, 20)).toBeCloseTo(80 * 0.25 * Math.log(1.1));
    expect(contribution(3, 100, 80, 0.25, 10, 22, 20)).toBeCloseTo((100 * 0.25 * 2) / 10);
  });
});

describe("method 4 baskets", () => {
  const t = day(25) * D;
  const end = t / H - 1;
  const hours = new Set(Array.from({ length: 168 }, (_, i) => end - 167 + i));

  it("weights by the typical day's gold traded, so one busy day does not buy a weight", () => {
    const items = new Map(IDS.map((id) => [id, flat(1_000, end - 167, end, 1)]));
    // Item 1 "sells" 100,000 units in a single hour (posted and cancelled).
    items.get(1)!.sold.set(end - 30, 100_000);
    // Item 2 really trades 3 times as much every day.
    for (const h of hours) items.get(2)!.sold.set(h, 3);
    const basket = selectHourly(herbs, items, catalog, t, 168, hours);
    expect(basket[0]![0]).toBe(2);
    expect(basket.find((b) => b[0] === 1)![1]).toBeCloseTo(basket.find((b) => b[0] === 3)![1], 2);
    expect(basket.reduce((s, b) => s + b[1], 0)).toBeCloseTo(1, 4);
  });

  it("before sales are known, ranks by the typical day's gold listed", () => {
    const daily: DailySeries = new Map(IDS.map((id) => [id, new Map([5, 6, 7, 8, 9].map((d) => [day(d), [1_000, 100 * id] as [number, number]]))]));
    daily.get(1)!.set(day(5), [5_000_000, 50]); // a joke price on launch day
    const days = new Set([5, 6, 7, 8, 9].map(day));
    const basket = selectDaily(herbs, daily, catalog, day(5), day(9), day(9), days);
    expect(basket[0]![0]).toBe(8);
    expect(basket.at(-1)![0]).toBe(1);
  });
});

describe("method 4 series", () => {
  const last = day(31) * 24 + 20; // 1 December, 13.8 days after our first hour
  const data = prepare(market(last));
  const now = last * H + 60;
  const full = buildIndex(herbs, null, data, catalog, now)!;

  it("starts at 100 on launch and reviews on 10, 17 and 24 Nov, then the first Tuesday of December", () => {
    expect(full.periods[0]).toMatchObject({ start: day(5) * D, level: 100 });
    expect(full.hourly[0]).toEqual([day(5) * 24 + 23, 100]);
    // Launch reviews keep the kind the recaps know ("monthly") and carry their own flag.
    expect(basketChanges(full.periods).map((c) => [c.at, c.kind, c.launch])).toEqual([...LAUNCH_REVIEWS.map((t) => [t, "monthly", true]), [Date.UTC(2026, 11, 1, 15) / 1000, "monthly", undefined]]);
    expect(full.earlyUntil).toBe(FIRST_HOUR);
    expect(full.method).toBe(4);
  });

  it("never moves the level at a review or where our hourly prices take over", () => {
    for (let i = 1; i < full.periods.length; i++) {
      const p = full.periods[i]!;
      if (p.splice) {
        expect(full.hourly.find(([h]) => h === data.firstHour)![1]).toBe(Math.round(p.level * 100) / 100);
      } else if (!p.daily) {
        const price = (id: number) => priceHour(data.hourly.get(id), p.start / H - 1);
        expect(value(p, price)).toBeCloseTo(value(full.periods[i - 1]!, price)!, 3);
      } else {
        const lastDay = Math.floor(p.start / D) - 1;
        expect(value(p, (id) => priceDay(data.daily.get(id), lastDay))).toBeCloseTo(p.level, 3);
      }
    }
  });

  it("gives the same series from one rebuild and from hourly runs, even after old hours are dropped", () => {
    expect(buildIndex(herbs, null, data, catalog, now)).toEqual(full);
    const end = day(38) * 24 + 5; // 8 December: a week past the 14 days the collector keeps
    // Item 8 stops being listed on 22 Nov: the collector never drops its old rows.
    const gone = day(22) * 24;
    const at = (h: number, kept: boolean) => {
      const m = market(h);
      for (const [id, s] of m.hourly) {
        for (const k of [...s.price.keys()]) {
          if (id === 8 ? k > gone : kept && k <= h - 24 * 14) { s.price.delete(k); s.sold.delete(k); }
        }
      }
      return prepare(m);
    };
    // The reference: one rebuild that still has every row.
    const every = at(end, false);
    const hours = new Set(Array.from({ length: end - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i));
    const reference = buildIndex(herbs, null, { ...every, firstHour: FIRST_HOUR, hours }, catalog, end * H + 60)!;
    let live: IndexFile4 = buildIndex(herbs, null, at(day(25) * 24, true), catalog, day(25) * D + 60)!;
    for (let h = day(25) * 24 + 7; h < end + 7; h += 7) {
      const x = Math.min(h, end);
      live = buildIndex(herbs, live, at(x, true), catalog, x * H + 60)!;
    }
    expect(at(end, true).firstHour).toBe(end - 24 * 14 + 1);
    expect(live.hourly).toEqual(reference.hourly);
    expect(live.periods).toEqual(reference.periods);
  });

  it("reviews only once a snapshot at or after the review time exists", () => {
    const review = LAUNCH_REVIEWS[2]!;
    const before = buildIndex(herbs, null, prepare(market(review / H - 1)), catalog, review + 10 * H)!;
    expect(before.periods.some((p) => p.start === review)).toBe(false);
    const after = buildIndex(herbs, before, prepare(market(review / H + 3)), catalog, review + 10 * H)!;
    expect(after.periods.find((p) => p.start === review)).toEqual(full.periods.find((p) => p.start === review));
  });

  it("starts a house without earlier prices at the close of its first day, with no look-ahead", () => {
    const only = prepare({ hourly: market(day(22) * 24).hourly, daily: new Map() });
    const f = buildIndex(herbs, null, only, catalog, day(22) * D + 60)!;
    expect(f.periods[0]).toMatchObject({ start: day(19) * D - H, level: 100 });
    expect(f.hourly[0]).toEqual([day(19) * 24 - 1, 100]);
    expect(f.link).toBeUndefined();
  });
});

describe("backfill", () => {
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), "backfill-"));
    const put = (rel: string, v: unknown) => {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), JSON.stringify(v));
    };
    const m = market(day(22) * 24);
    put("meta.json", { updated: day(22) * D + 60, houses: [{ id: 113 }] });
    put("items.json", Object.fromEntries(IDS.map((id) => [id, ["Herb", "Herbe", 1, 7, 9, ""]])));
    put("h2/113/0.json", { v: 1, items: Object.fromEntries(IDS.map((id) => [id, { h: [...m.hourly.get(id)!.price].map(([h, p]) => [h, p, p, 10, 1, m.hourly.get(id)!.sold.get(h)]), d: [] }])) });
    put("early/113/0.json", { items: Object.fromEntries(IDS.map((id) => [id, [...m.daily.get(id)!].map(([d, [p, q]]) => [d, p, p, q, 1])])) });
    put("index/113.json", { house: 113, updated: 1, indexes: { herbs: { id: "herbs", method: 3, periods: [], hourly: [[1, 100]] } } });
    put("index/meta.json", { baseEnd: 1 });
    return { dir, put };
  };
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

  it("rebuilds from the first day, keeps the old files in index/legacy/ once, and reruns to the same files", () => {
    const { dir } = folder();
    const old = readFileSync(join(dir, "index/113.json"), "utf8");
    const first = backfill(dir);
    expect(writeBackfill(dir, first.files).sort()).toEqual(["index/113.json", "index/meta.json"]);
    const file = read(join(dir, "index/113.json"));
    expect(file.indexes.herbs.method).toBe(4);
    expect(file.indexes.herbs.hourly[0]).toEqual([day(5) * 24 + 23, 100]);
    expect(read(join(dir, "index/meta.json"))).toMatchObject({ method: 4, baseEnd: day(19) * D });
    expect(readFileSync(join(dir, "index/legacy/113.json"), "utf8")).toBe(old);
    const again = backfill(dir);
    expect([...again.files]).toEqual([...first.files]);
    expect(writeBackfill(dir, again.files)).toEqual([]);
    expect(readFileSync(join(dir, "index/legacy/113.json"), "utf8")).toBe(old);
    // The publisher sends the archive to R2 with the new files.
    expect(listFiles(dir).map((f) => f.key)).toContain("index/legacy/113.json");
  });

  it("writes a preview elsewhere without touching the data folder", () => {
    const { dir } = folder();
    const out = mkdtempSync(join(tmpdir(), "preview-"));
    writeBackfill(out, backfill(dir).files);
    expect(existsSync(join(out, "index/113.json"))).toBe(true);
    expect(existsSync(join(dir, "index/legacy"))).toBe(false);
    expect(read(join(dir, "index/113.json")).indexes.herbs.method).toBe(3);
  });

  it("refuses once the hourly history no longer reaches our first hours", () => {
    const { dir, put } = folder();
    const h2 = read(join(dir, "h2/113/0.json")) as { items: Record<string, { h: number[][] }> };
    for (const v of Object.values(h2.items)) v.h = v.h.filter((r) => r[0]! >= FIRST_HOUR + 30);
    put("h2/113/0.json", h2);
    expect(() => backfill(dir)).toThrow(/nothing was written/);
  });
});

describe("method 3", () => {
  it("keeps published hours when a vanished item still has rows older than the 14 days kept", () => {
    const ids = [1, 2, 3, 4, 5, 6];
    const from = day(20) * 24 - 24;
    const to = day(31) * 24; // 1 December 00:00
    const items = new Map(ids.map((id) => [id, flat(1_000, from, to)]));
    const stored = updateIndex(herbs, null, items, catalog, to * H)!;
    // Eight days later: listed items have lost their first rows; item 6 vanished long ago, kept them, and was cheap.
    const later = new Map(ids.slice(0, 5).map((id) => [id, flat(1_000, to + 8 * 24 - 24 * 14, to + 8 * 24)]));
    later.set(6, flat(500, from, from + 48));
    const next = updateIndex(herbs, stored, later, catalog, (to + 8 * 24) * H)!;
    const old = new Map(next.hourly);
    for (const [h, v] of stored.hourly) expect(old.get(h)).toBe(v);
  });


  it("starts the new basket at the old one's level even when prices have left the week's median", () => {
    const ids = [1, 2, 3, 4, 5];
    const base = day(20) * 24;
    const review = Date.UTC(2026, 11, 1, 15) / 1000 / H;
    // Flat at 1,000, then every price is 800 for the last two days before the review: the window median stays 1,000.
    const items = new Map(ids.map((id) => {
      const s = flat(1_000, base - 24, review + 5);
      for (let h = review - 48; h <= review + 5; h++) s.price.set(h, 800);
      return [id, s] as [number, Series];
    }));
    const f = updateIndex(herbs, null, items, catalog, (review + 5) * H)!;
    expect(f.periods).toHaveLength(2);
    expect(valueAt(f.periods[1]!, items, review)).toBeCloseTo(f.periods[1]!.level);
    expect(f.hourly.find(([h]) => h === review)![1]).toBeCloseTo(80);
  });
});
