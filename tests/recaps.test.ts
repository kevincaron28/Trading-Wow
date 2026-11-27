import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { addToList, finishRecap, periods, type RecapList } from "../collector/recaps";
import { buildRecap, type WeeklyInput } from "../collector/weekly";
import { INDEXES, basketChanges, chooseBasket, isQuarterly, lastRebalance, nextRebalance, type Period, type Series } from "../collector/indexes";
import { PLAY_URL, appLink, buildMessage, due, linkItems, periodLabel, validWebhook, webLink } from "../collector/discord-recap";
import { crc32, lineChartPng } from "../collector/png-chart";
import { recapSummary, type RecapFile } from "../src/lib/weekly";
import type { HourRow } from "../collector/store";

const H = 3_600;
const iso = (h: number) => new Date(h * H * 1000).toISOString();

describe("recap periods", () => {
  const now = Date.UTC(2026, 10, 26, 14) / 1000 / H; // Thursday 26 Nov 2026, 14:00 UTC

  it("ends every period at 13:00 UTC: the day, the week to Monday, the month to the 1st", () => {
    const [d] = periods("daily", now, 1);
    expect([iso(d![0]), iso(d![1]), d![2]]).toEqual(["2026-11-25T13:00:00.000Z", "2026-11-26T13:00:00.000Z", "2026-11-26"]);
    const [w] = periods("weekly", now, 1);
    expect([iso(w![0]), iso(w![1]), w![2]]).toEqual(["2026-11-16T13:00:00.000Z", "2026-11-23T13:00:00.000Z", "2026-11-23"]);
    const [m] = periods("monthly", now, 1);
    expect([iso(m![0]), iso(m![1]), m![2]]).toEqual(["2026-10-01T13:00:00.000Z", "2026-11-01T13:00:00.000Z", "2026-10"]);
  });

  it("waits for 13:00 UTC before a day is over", () => {
    const before = Date.UTC(2026, 10, 26, 12) / 1000 / H;
    expect(periods("daily", before, 1)[0]![2]).toBe("2026-11-25");
    expect(periods("monthly", Date.UTC(2026, 11, 1, 13) / 1000 / H, 1)[0]![2]).toBe("2026-11");
  });

  it("keeps the newest periods in the list and returns the ones dropped", () => {
    const list: RecapList = { v: 1, daily: [], weekly: [], monthly: [] };
    for (let i = 0; i < 62; i++) addToList(list, "daily", [`d${i}`, i, i + 1]);
    expect(list.daily).toHaveLength(60);
    expect(list.daily[0]![0]).toBe("d61");
    expect(addToList(list, "daily", ["d62", 62, 63])).toEqual(["d2"]);
  });
});

describe("recap contents", () => {
  const END = 500_000;
  const hours = (from: number, price: (h: number) => number, sold: number): HourRow[] => {
    const out: HourRow[] = [];
    for (let h = from; h <= END; h++) out.push([h, price(h), price(h), 50, 10, sold]);
    return out;
  };

  it("ranks the most traded items by gold a day and compares raid consumable sales with the period before", () => {
    const input: WeeklyInput = {
      house: 113,
      faction: "horde",
      histories: new Map([
        [1, { h: hours(END - 60, () => 10_000, 1), d: [] }], // 24 a day x 1g
        [2, { h: hours(END - 60, () => 1_000, 5), d: [] }], // 120 a day x 10s
        [3, { h: hours(END - 60, () => 50_000, 2), d: [] }], // flask: 48 a day x 5g
        [4, { h: hours(END - 60, (h) => (h > END - 24 ? 30_000 : 30_000), (0)), d: [] }],
      ]),
      early: new Map(),
      classOf: () => 7,
      indexes: {},
      book: null,
      raidItem: (id) => id === 3,
    };
    const r = buildRecap(input, END - 24, END)!;
    expect(r.traded!.map((x) => x[0])).toEqual([3, 1, 2]);
    expect(r.traded![0]![2]).toBe(48);
    expect(r.raid!.soldPerDay).toBe(48);
    expect(r.raid!.prevSoldPerDay).toBe(48);
    expect(r.raid!.change).toBeCloseTo(0);
    expect(r.raid!.rows.map((x) => x[0])).toEqual([3]);
  });

  it("speaks of the day, the week or the month, and announces a rebalance coming within a week", () => {
    const base = { v: 1 as const, house: 113, start: 0, end: Date.UTC(2026, 10, 26, 13) / 1000, ownSince: 0, indexes: [["gl100", 100, 102, 2]] as [string, number, number, number][], risers: null, fallers: null, highs: null, lows: null, flips: null, crafts: null };
    const r = finishRecap(base, "daily", "2026-11-26");
    expect(r.rebalance).toEqual({ last: null, next: Date.UTC(2026, 11, 1, 15) / 1000, quarterly: false });
    const now = Date.UTC(2026, 10, 26, 14) / 1000;
    const en = recapSummary(r, "daily", "en", String, String, now);
    expect(en[0]).toBe("The Ledger 100 rose 2.0% over the day.");
    expect(en).toContain("The indexes rebalance on December 1 at 15:00 UTC (monthly).");
    expect(recapSummary(r, "monthly", "fr", String, String, now)[0]).toBe("Le Ledger 100 a monté de 2,0 % ce mois-ci.");
  });
});

describe("index rebalancing", () => {
  const herbs = INDEXES.find((d) => d.id === "herbs")!;
  const t = 1000 * H;
  // 40 herbs; item i trades (41 - i) units an hour at 100 copper: item 1 is the busiest.
  const items = new Map<number, Series>();
  const catalog = new Map<number, { itemClass: number; subclass: number }>();
  for (let i = 1; i <= 40; i++) {
    const s: Series = { price: new Map(), sold: new Map() };
    for (let h = 1000 - 167; h <= 1000; h++) { s.price.set(h, 100); s.sold.set(h, 41 - i); }
    items.set(i, s);
    catalog.set(i, { itemClass: 7, subclass: 9 });
  }

  it("keeps constituents ranked within 1.2 x the basket size and fills the rest by rank", () => {
    const plain = chooseBasket(herbs, items, catalog, t, 168).map(([id]) => id);
    expect(plain).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    // Incumbents 31..36 rank within 36 (1.2 x 30): they stay, and only the top 24 newcomers join.
    const incumbents = [31, 32, 33, 34, 35, 36, 37, 38];
    const buffered = chooseBasket(herbs, items, catalog, t, 168, { incumbents, buffer: 1.2 }).map(([id]) => id).sort((a, b) => a - b);
    expect(buffered).toEqual([...Array.from({ length: 24 }, (_, i) => i + 1), 31, 32, 33, 34, 35, 36]);
  });

  it("drops items below the liquidity and value thresholds", () => {
    // 100 copper x (41 - i) units an hour x 24 = gold a day; a 1 gold floor keeps items selling 5+ an hour.
    const basket = chooseBasket(herbs, items, catalog, t, 168, { minSoldPerDay: 1, minDailyValue: 100 * 24 * 36 }).map(([id]) => id);
    expect(Math.max(...basket)).toBe(5);
  });

  it("schedules a quarterly review in January, April, July and October", () => {
    expect(isQuarterly(Date.UTC(2027, 0, 5, 15) / 1000)).toBe(true);
    expect(isQuarterly(Date.UTC(2026, 11, 1, 15) / 1000)).toBe(false);
    expect(nextRebalance(Date.UTC(2026, 11, 2) / 1000)).toEqual({ at: Date.UTC(2027, 0, 5, 15) / 1000, quarterly: true });
    expect(lastRebalance(Date.UTC(2026, 11, 2) / 1000)).toBe(Date.UTC(2026, 11, 1, 15) / 1000);
  });

  it("lists what came in and went out at each rebalance", () => {
    const periodsList: Period[] = [
      { start: 1, level: 100, basket: [[1, 0.5, 10], [2, 0.5, 10]] },
      { start: Date.UTC(2026, 11, 1, 15) / 1000, level: 104, kind: "monthly", basket: [[1, 0.6, 11], [3, 0.4, 5]] },
    ];
    expect(basketChanges(periodsList)).toEqual([{ at: Date.UTC(2026, 11, 1, 15) / 1000, kind: "monthly", added: [[3, 0.4]], removed: [[2, 0.5]], kept: 1, level: 104 }]);
  });
});

describe("Discord recap post", () => {
  const recap: RecapFile = {
    v: 1, house: 113, kind: "weekly", key: "2026-11-30",
    start: Date.UTC(2026, 10, 23, 13) / 1000, end: Date.UTC(2026, 10, 30, 13) / 1000, ownSince: 0,
    indexes: [["gl100", 100, 103, 3], ["herbs", 80, 70, -12.5]],
    risers: [[7, 10_000, 15_000, 50, 30]], fallers: [], highs: [], lows: [],
    flips: { found: 1, paid: 1, reached: 1, rows: [[7, 0, 6_000, 10_000, 3_500, 10_000, 58, 1, 12]] },
    crafts: null, traded: [[7, 300_000, 30, 10_000, 5]], raid: { soldPerDay: 100, prevSoldPerDay: 80, change: 25, rows: [[9, 50, 20_000, null]] },
    rebalance: { last: null, next: Date.UTC(2026, 11, 1, 15) / 1000, quarterly: false },
  };
  const names = { item: (id: number) => (id === 7 ? "Black Lotus" : `Item ${id}`), index: (id: string) => (id === "gl100" ? "Ledger 100" : "Herbs"), house: "PvP Horde" };

  it("posts a short message as Goblin Ledger only: summary, four numbers, links, then the images", () => {
    const images = ["1-overview.png", "2-movers.png", "3-raid.png", "4-desk.png"];
    type Msg = { username: string; embeds: { title?: string; url?: string; image?: { url: string }; fields?: { name: string; value: string; inline: boolean }[]; description?: string }[] };
    const msg = buildMessage(recap, "en", names, images, recap.end + 1800, undefined, { web: "https://example.com/ledger/" }) as Msg;
    expect(msg.username).toBe("Goblin Ledger");
    const embed = msg.embeds[0]!;
    expect(embed.title).toBe("Weekly recap · 23 Nov – 30 Nov 2026 · PvP Horde");
    expect(embed.image?.url).toBe("attachment://1-overview.png");
    // The other images share the main embed's URL: Discord shows them as one gallery.
    expect(msg.embeds.slice(1).map((e) => [e.url, e.image?.url])).toEqual(images.slice(1).map((f) => [embed.url, `attachment://${f}`]));
    expect(embed.url).toBe("https://example.com/ledger/?house=113&tab=overview");
    expect(embed.fields!.every((f) => f.inline)).toBe(true);
    expect(embed.fields!.map((f) => f.name).filter((n) => n !== "\u200b")).toEqual(["Ledger 100", "Biggest sector move", "Raid consumables"]);
    expect(embed.description).toContain("[Goblin Ledger on Google Play](https://play.google.com/store/apps/details?id=top.kcaron.goldline)");
    expect(embed.description).toContain("[Open the market](https://example.com/ledger/?house=113&tab=overview)");
    const text = JSON.stringify(msg);
    expect(text).not.toMatch(/guilded/i);
    // Without a web address: no market link, no item links, the images one per embed.
    const plain = buildMessage(recap, "fr", names, images, recap.end) as Msg;
    expect(plain.embeds[0]!.description).not.toContain("Ouvrir le marché");
    expect(plain.embeds).toHaveLength(4);
    expect(JSON.stringify(plain)).not.toMatch(/guilded/i);
  });

  it("links the app as the Play listing, or as the tester page during the closed test", () => {
    expect(appLink(undefined, "fr")).toEqual({ label: "Goblin Ledger sur Google Play", url: PLAY_URL });
    expect(appLink("https://example.com/testers/", "fr")).toEqual({ label: "Tester Goblin Ledger (Android)", url: "https://example.com/testers/" });
    expect(appLink("javascript:alert(1)", "en").url).toBe(PLAY_URL);
    const msg = buildMessage(recap, "fr", names, [], recap.end, undefined, { app: "https://example.com/testers/" }) as { embeds: { description: string }[] };
    expect(msg.embeds[0]!.description).toContain("📱 [Tester Goblin Ledger (Android)](https://example.com/testers/)");
  });

  it("links item names in the summary to their page, longest names first", () => {
    const link = (id: number) => webLink("https://example.com/", 113, id);
    const out = linkItems("Elixir of the Mongoose rose; Mongoose fell.", [{ id: 2, name: "Mongoose" }, { id: 1, name: "Elixir of the Mongoose" }], link);
    expect(out).toBe("[Elixir of the Mongoose](https://example.com/?house=113&item=1) rose; [Mongoose](https://example.com/?house=113&item=2) fell.");
    expect(webLink("javascript:alert(1)", 113, 1)).toBeNull();
    expect(webLink(undefined, 113)).toBeNull();
  });

  it("labels the month by name", () => {
    expect(periodLabel({ kind: "monthly", start: Date.UTC(2026, 10, 1, 13) / 1000, end: Date.UTC(2026, 11, 1, 13) / 1000 }, "fr")).toBe("Novembre 2026");
  });

  it("accepts only Discord webhook URLs", () => {
    expect(validWebhook("https://discord.com/api/webhooks/123/abc-DEF_9")).toBe(true);
    expect(validWebhook("https://example.com/api/webhooks/123/abc")).toBe(false);
    expect(validWebhook("http://discord.com/api/webhooks/123/abc")).toBe(false);
    expect(validWebhook(undefined)).toBe(false);
  });

  it("posts each recap once, only while it is fresh", () => {
    const list: RecapList = { v: 1, daily: [["2026-11-26", 0, 1000 * H]], weekly: [["2026-11-23", 0, 900 * H]], monthly: [] };
    expect(due(list, 113, {}, 1000 * H + 1800)).toEqual([{ kind: "daily", key: "2026-11-26" }]);
    expect(due(list, 113, { "113:daily": "2026-11-26" }, 1000 * H + 1800)).toEqual([]);
    expect(due(list, 113, {}, 1000 * H + 13 * H)).toEqual([]);
  });

  it("draws a valid PNG chart", () => {
    const png = lineChartPng([100, 101, 99, 103, 104], 200, 80, 100)!;
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(200);
    expect(png.readUInt32BE(20)).toBe(80);
    const idatLen = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString("ascii")).toBe("IDAT");
    expect(inflateSync(png.subarray(41, 41 + idatLen)).length).toBe((200 * 3 + 1) * 80);
    expect(png.readUInt32BE(41 + idatLen)).toBe(crc32(png.subarray(37, 41 + idatLen)));
    expect(lineChartPng([1])).toBeNull();
  });
});
