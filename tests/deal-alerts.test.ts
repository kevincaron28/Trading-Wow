import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { dealOf, evaluateDealWatch, mergeReported, type DealWatch } from "../src/lib/dealAlerts";
import type { Quote } from "../src/lib/quotes";

const NOW = 1_800_000_000;
const HOUR = 3600;

/** A quote 40% under its average that sells daily. */
function quote(id: number, over: Partial<Quote> = {}): Quote {
  return { id, min: 6_000, market: 9_500, listed: 40, auctions: 8, avg7d: 10_000, soldPerDay: 3, soldAvg7d: 4, ...over } as Quote;
}
const quotes = (...list: Quote[]) => new Map(list.map((q) => [q.id, q]));
const watch = (over: Partial<DealWatch> = {}): DealWatch => ({ id: "w1", listId: "mine", house: 113, pct: 30, reported: {}, createdAt: NOW - HOUR, ...over });

describe("dealOf", () => {
  it("finds a lowest buyout under the 7-day average", () => {
    expect(dealOf(quote(1), 30)).toMatchObject({ itemId: 1, price: 6_000, avg: 10_000 });
    expect(dealOf(quote(1), 30)!.discount).toBeCloseTo(40);
    expect(dealOf(quote(1), 50)).toBeNull();
  });

  it("ignores items that do not sell every day", () => {
    expect(dealOf(quote(1, { soldAvg7d: 0.4 }), 30)).toBeNull();
    expect(dealOf(quote(1, { soldAvg7d: undefined, soldPerDay: undefined }), 30)).toBeNull();
    expect(dealOf(quote(1, { soldAvg7d: undefined, soldPerDay: 2 }), 30)).not.toBeNull();
  });

  it("ignores averages inflated by a spike, tiny savings and unlisted items", () => {
    expect(dealOf(quote(1, { avg7d: 40_000 }), 30)).toBeNull();
    expect(dealOf(quote(1, { min: 600, market: 900, avg7d: 1_000 }), 30)).toBeNull();
    expect(dealOf(quote(1, { min: 0 }), 30)).toBeNull();
  });
});

describe("evaluateDealWatch", () => {
  it("reports each deal once, best first", () => {
    const q = quotes(quote(1), quote(2, { min: 4_000 }), quote(3, { min: 9_900 }));
    const first = evaluateDealWatch(watch(), [1, 2, 3], q, NOW);
    expect(first.hits.map((h) => h.itemId)).toEqual([2, 1]);
    expect(first.watch.reported).toEqual({ "1": NOW, "2": NOW });
    const again = evaluateDealWatch(first.watch, [1, 2, 3], q, NOW + HOUR);
    expect(again.hits).toEqual([]);
    expect(again.watch).toBe(first.watch);
  });

  it("reports an item again only after it recovered and some time passed", () => {
    const w = watch({ reported: { "1": NOW } });
    const recovered = quotes(quote(1, { min: 9_000 }));
    // Too soon: the record stays.
    expect(evaluateDealWatch(w, [1], recovered, NOW + HOUR).watch).toBe(w);
    // Still inside the recovery margin (26% under): the record stays.
    expect(evaluateDealWatch(w, [1], quotes(quote(1, { min: 7_400 })), NOW + 24 * HOUR).watch).toBe(w);
    const cleared = evaluateDealWatch(w, [1], recovered, NOW + 24 * HOUR).watch;
    expect(cleared.reported).toEqual({});
    expect(evaluateDealWatch(cleared, [1], quotes(quote(1)), NOW + 25 * HOUR).hits).toHaveLength(1);
  });

  it("keeps the record of an item that is not listed and forgets one removed from the list", () => {
    const w = watch({ reported: { "1": NOW, "2": NOW } });
    expect(evaluateDealWatch(w, [1, 2], quotes(), NOW + 24 * HOUR).watch).toBe(w);
    expect(evaluateDealWatch(w, [1], quotes(), NOW + HOUR).watch.reported).toEqual({ "1": NOW });
  });
});

describe("mergeReported", () => {
  it("adds the background runner's records, keeping the later time", () => {
    const [a, b] = mergeReported([watch({ reported: { "1": NOW } }), watch({ id: "w2" })], { w1: { "1": NOW - 5, "2": NOW + 5 }, gone: { "3": NOW } });
    expect(a!.reported).toEqual({ "1": NOW, "2": NOW + 5 });
    expect(b!.reported).toEqual({});
  });
});

/** The background runner repeats the rules in plain JavaScript: hold both to the same answers. */
describe("runner deal rules", () => {
  const context: Record<string, unknown> = { addEventListener: () => {} };
  runInNewContext(readFileSync("public/runners/alerts.js", "utf8"), context);
  const checkDeals = context.checkDeals as (w: unknown, items: Record<string, number[]>, now: number) => { id: number; price: number; discount: number }[];

  /** The price-file row the runner reads: [min, market, listed, auctions, prev24h, avg7d, sold24h, prev1h, soldAvg7d]. */
  const row = (q: Quote) => [q.min, q.market, q.listed, q.auctions, -1, q.avg7d, q.soldPerDay ?? -1, -1, q.soldAvg7d ?? -1];

  const samples = [
    quote(1),
    quote(2, { min: 4_000 }),
    quote(3, { min: 9_900 }),
    quote(4, { soldAvg7d: 0.4 }),
    quote(5, { soldAvg7d: undefined, soldPerDay: 2 }),
    quote(6, { soldAvg7d: undefined, soldPerDay: undefined }),
    quote(7, { avg7d: 40_000 }),
    quote(8, { min: 600, market: 900, avg7d: 1_000 }),
    quote(9, { min: 0 }),
    quote(10, { min: 7_000 }),
  ];
  const ids = [...samples.map((q) => q.id), 11];
  const cases: [string, Record<string, number>, number][] = [
    ["nothing reported yet", {}, NOW],
    ["reported recently", { "1": NOW - HOUR, "3": NOW - HOUR }, NOW],
    ["reported long ago", { "1": NOW - 24 * HOUR, "3": NOW - 24 * HOUR, "11": NOW - 24 * HOUR, "99": NOW }, NOW],
  ];

  it.each(cases)("%s", (_, reported, now) => {
    for (const pct of [20, 30, 50]) {
      const app = evaluateDealWatch(watch({ pct, reported }), ids, quotes(...samples), now);
      const runnerWatch = { id: "w1", pct, reported: { ...reported }, items: ids };
      const hits = checkDeals(runnerWatch, Object.fromEntries(samples.map((q) => [String(q.id), row(q)])), now);
      expect(hits.map((h) => h.id)).toEqual(app.hits.map((h) => h.itemId));
      expect(runnerWatch.reported).toEqual(app.watch.reported);
    }
  });
});
