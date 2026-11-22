import { describe, expect, it } from "vitest";
import { parseCatalog, parseHistory, parseLatest, iconUrl, houseUpdated } from "../src/data/live";
import { candlesFor } from "../src/data/series";
import { BUILT_IN_WATCHLISTS, CATEGORIES } from "../src/data/watchlists";
import { REALM_GROUPS, houseId } from "../src/app/store";
import { MESSAGES, detectLang } from "../src/lib/i18n";
import { searchCatalog } from "../src/lib/search";
import { change24h, houseCut, toQuote } from "../src/lib/quotes";
import { normalize } from "../src/lib/text";
import { cleanWatchlist, readJson, toggleWatch, writeJson, type KeyValueStore } from "../src/lib/storage";

const HOUR = 3600;
const T0 = Date.UTC(2026, 10, 18, 0) / 1000;

describe("data files", () => {
  it("parses the catalog, latest and history files", () => {
    const catalog = parseCatalog({ "13468": ["Black Lotus", "Lotus noir", 2, 7, 9, "134202"], "2589": ["Linen Cloth", "", 1, 7, 5, ""] });
    expect(catalog.get(13468)).toEqual({ id: 13468, name: { en: "Black Lotus", fr: "Lotus noir" }, quality: 2, itemClass: 7, subclass: 9, icon: "134202" });
    expect(catalog.get(2589)!.name.fr).toBe("Linen Cloth");

    const quotes = parseLatest({ "13468": [120000, 122577, 213, 39, 0, 122577] });
    expect(quotes.get(13468)).toEqual({ id: 13468, min: 120000, market: 122577, listed: 213, auctions: 39, prev24h: null, avg7d: 122577, soldPerDay: null, prev1h: null, soldAvg7d: null });

    const history = parseHistory({ h: [[T0 / HOUR, 90, 100, 5, 2]], d: [[T0 / 86400, 100, 110, 95, 105, 6, 90]] });
    expect(history.hourly[0]).toEqual({ time: T0, minBuyout: 90, market: 100, listed: 5, auctions: 2 });
    expect(history.daily[0]).toEqual({ time: T0, open: 100, high: 110, low: 95, close: 105, volume: 6 });
    expect(parseHistory(undefined)).toEqual({ hourly: [], daily: [] });
  });

  it("builds icon URLs and update times", () => {
    expect(iconUrl({ updated: 0, iconBase: "https://x/icons/56/", houses: [] }, "134202")).toBe("https://x/icons/56/134202.jpg");
    expect(iconUrl(null, "")).toBe("");
    expect(houseUpdated({ id: 113, realm: "pvp", faction: "horde", snapshot: T0, lastModified: "Wed, 18 Nov 2026 00:25:00 GMT", items: 1 })).toBe(T0 + 1500);
    expect(houseUpdated({ id: 113, realm: "pvp", faction: "horde", snapshot: T0, lastModified: null, items: 1 })).toBe(T0);
  });
});

describe("quotes", () => {
  it("computes 24h change and house cuts", () => {
    expect(change24h(toQuote(1, [90, 110, 5, 2, 100, 105]))).toBeCloseTo(10);
    expect(change24h(toQuote(1, [90, 110, 5, 2, 0, 105]))).toBeNull();
    expect(houseCut("blackwater")).toBe(0.15);
    expect(houseCut("horde")).toBe(0.05);
  });
});

describe("chart series", () => {
  const history = parseHistory({
    h: Array.from({ length: 30 }, (_, i) => [T0 / HOUR + i, 80 + i, 100 + i, 5, 2] as [number, number, number, number, number]),
    d: [[T0 / 86400, 100, 123, 100, 123, 5, 80], [T0 / 86400 + 1, 124, 129, 124, 129, 5, 104]],
  });
  it("uses hourly points for 1H and 4H and daily candles for 1D and 1W", () => {
    expect(candlesFor(history, "1h", "market")).toHaveLength(30);
    expect(candlesFor(history, "4h", "market")).toHaveLength(8);
    expect(candlesFor(history, "1d", "market").map((c) => c.close)).toEqual([123, 129]);
    expect(candlesFor(history, "1w", "market")).toHaveLength(1);
  });
  it("fills 1H and 4H before our own prices: real early hours as candles, else a straight estimated line, evenly spaced", () => {
    const D1 = T0 - 86_400;
    const early = [{ time: T0 - 2 * 86_400, market: 80, min: 70, quantity: 4 }, { time: D1, market: 90, min: 85, quantity: 5 }];
    // 14 known hours on the day before our collection (00:00-13:00) at 95, lowest 88; 05:00 is a lone spike to 300.
    const earlyHourly = Array.from({ length: 14 }, (_, i) => ({ time: D1 + i * HOUR, market: i === 5 ? 300 : 95, min: 88, quantity: 6 }));
    const h = candlesFor({ ...history, early, earlyHourly }, "1h", "market");
    expect(h).toHaveLength(48 + 30);
    for (let i = 1; i < h.length; i++) expect(h[i]!.time - h[i - 1]!.time).toBe(HOUR);
    // Flat before the first day's noon, then a straight line to the first real hour.
    expect(h[0]).toEqual({ time: T0 - 2 * 86_400, open: 80, high: 80, low: 80, close: 80, volume: 0, estimated: true });
    expect(h[12]).toMatchObject({ close: 80, estimated: true });
    expect(h[18]).toMatchObject({ close: 88, estimated: true });
    expect(h[24]).toEqual({ time: D1, open: 94, high: 95, low: 88, close: 95, volume: 6 });
    // The spike is smoothed away (median of neighbouring hours): no wick to 300.
    expect(h[29]).toEqual({ time: D1 + 5 * HOUR, open: 95, high: 95, low: 88, close: 95, volume: 6 });
    expect(h[37]!.estimated).toBeUndefined();
    expect(h[38]).toMatchObject({ close: 95, estimated: true });
    expect(h[48]!.estimated).toBeUndefined();
    // A lone scanned hour does not make a candle: the day stays on the estimated line.
    const sparse = candlesFor({ ...history, early, earlyHourly: [earlyHourly[3]!] }, "1h", "market");
    expect(sparse.slice(0, 48).every((c) => c.estimated)).toBe(true);
    const four = candlesFor({ ...history, early }, "4h", "min");
    expect(four.slice(0, 12).map((c) => c.close)).toEqual([70, 70, 70, 70, 73, 75, 78, 80, 83, 85, 85, 85]);
    expect(four.slice(0, 12).every((c) => c.estimated)).toBe(true);
  });
  it("draws hourly candles in the chosen time zone (wall time)", () => {
    const ny = candlesFor(history, "1h", "market", "America/New_York");
    expect(ny.at(-1)!.time).toBe(T0 + 29 * HOUR - 5 * HOUR);
    const day = candlesFor(history, "1d", "market", "America/New_York");
    // 00:00-04:00 UTC on 18 Nov is the evening of 17 Nov in New York, and 05:00 UTC on 19 Nov is midnight there.
    expect(day.map((c) => new Date(c.time * 1000).toISOString().slice(0, 10))).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
  });
  it("charts the lowest buyout from hourly points", () => {
    expect(candlesFor(history, "1h", "min").at(-1)!.close).toBe(109);
    expect(candlesFor(history, "1d", "min").map((c) => c.close)).toEqual([103, 109]);
  });
});

describe("watchlists and houses", () => {
  it("ships the prebuilt lists with unique, valid item IDs", () => {
    const ids = BUILT_IN_WATCHLISTS.map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining(["flipping", "alchemy", "mining", "tailoring", "leather", "enchanting", "engineering", "cooking", "raid"]));
    for (const list of BUILT_IN_WATCHLISTS) {
      expect(list.items.length, list.id).toBeGreaterThan(10);
      expect(new Set(list.items).size, list.id).toBe(list.items.length);
      for (const id of list.items) expect(Number.isInteger(id) && id > 0).toBe(true);
      expect(list.name.fr).not.toBe("");
    }
  });
  it("maps realm and faction to a distinct Blizzard house", () => {
    expect(houseId({ realm: "pvp", faction: "horde" })).toBe(113);
    expect(houseId({ realm: "pvp", faction: "blackwater" })).toBe(116);
    expect(houseId({ realm: "nowhere", faction: "alliance" })).toBe(110);
    const all = REALM_GROUPS.flatMap((g) => Object.values(g.houses));
    expect(new Set(all).size).toBe(12);
  });
});

describe("search", () => {
  const catalog = parseCatalog({
    "14047": ["Runecloth", "Étoffe runique", 1, 7, 5, ""],
    "14048": ["Bolt of Runecloth", "Rouleau d'étoffe runique", 1, 7, 5, ""],
    "13468": ["Black Lotus", "Lotus noir", 2, 7, 9, ""],
    "12360": ["Arcanite Bar", "Barre d'arcanite", 2, 7, 7, ""],
  });
  const listed = (id: number) => id !== 14048;
  it("ranks prefix matches first, ignores accents and matches either language and IDs", () => {
    expect(searchCatalog(catalog.values(), "rune", "en", listed, null).map((i) => i.id)).toEqual([14047, 14048]);
    expect(searchCatalog(catalog.values(), "etoffe", "fr", listed, null).map((i) => i.id)).toEqual([14047, 14048]);
    expect(searchCatalog(catalog.values(), "lotus noir", "en", listed, null)[0]!.id).toBe(13468);
    expect(searchCatalog(catalog.values(), "12360", "en", listed, null)[0]!.id).toBe(12360);
    expect(normalize(" Étoffe ")).toBe("etoffe");
  });
  it("filters by category", () => {
    expect(searchCatalog(catalog.values(), "", "en", listed, "herb").map((i) => i.id)).toEqual([13468]);
    expect(CATEGORIES.find((c) => c.id === "metal")!.match(7, 7)).toBe(true);
  });
});

describe("storage and i18n", () => {
  it("survives a broken store and cleans IDs", () => {
    const broken: KeyValueStore = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(readJson("k", [1], broken)).toEqual([1]);
    expect(() => writeJson("k", 1, broken)).not.toThrow();
    expect(toggleWatch([1, 2], 2)).toEqual([1]);
    expect(cleanWatchlist([3, 3, -1, "x", 7])).toEqual([3, 7]);
  });
  it("has every English text in French", () => {
    expect(Object.keys(MESSAGES.fr).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    for (const key of Object.keys(MESSAGES.en)) if (key !== "ago") expect(MESSAGES.fr[key as keyof typeof MESSAGES.fr].trim(), key).not.toBe("");
    expect(detectLang(["fr-CA"])).toBe("fr");
  });
});

