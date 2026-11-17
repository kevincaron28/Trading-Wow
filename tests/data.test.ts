import { describe, expect, it } from "vitest";
import { ITEMS, normalize, searchItems } from "../src/data/items";
import { generateSampleSeries } from "../src/data/sample";
import { REALMS, blizzardHouseId, createSampleSource, houseKey } from "../src/data/source";
import { MESSAGES, detectLang } from "../src/lib/i18n";
import { summarize } from "../src/lib/stats";
import { cleanWatchlist, readJson, toggleWatch, writeJson, type KeyValueStore } from "../src/lib/storage";

const END = Date.UTC(2026, 10, 17, 12) / 1000;

describe("sample data", () => {
  it("is deterministic per item and house, hourly and positive", () => {
    const a = generateSampleSeries({ itemId: 14047, house: "us-pvp-horde", end: END, hours: 72 });
    const b = generateSampleSeries({ itemId: 14047, house: "us-pvp-horde", end: END, hours: 72 });
    const other = generateSampleSeries({ itemId: 14047, house: "us-pvp-alliance", end: END, hours: 72 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(other);
    expect(a).toHaveLength(72);
    expect(a.at(-1)!.time).toBe(END);
    a.forEach((p, i) => {
      expect(p.market).toBeGreaterThan(0);
      expect(p.minBuyout).toBeLessThanOrEqual(p.market);
      if (i > 0) expect(p.time - a[i - 1]!.time).toBe(3600);
    });
  });

  it("keeps sample prices near the item's usual price", () => {
    const lotus = generateSampleSeries({ itemId: 13468, house: "us-pvp-horde", end: END });
    const avg = lotus.reduce((s, p) => s + p.market, 0) / lotus.length;
    expect(avg).toBeGreaterThan(150_000);
    expect(avg).toBeLessThan(400_000);
  });

  it("serves sample history through the source and says it is sample", async () => {
    const source = createSampleSource(() => END);
    expect(source.isSample).toBe(true);
    const points = await source.history(2589, { region: "us", realm: "pvp", faction: "horde" });
    expect(points.length).toBeGreaterThan(24 * 30);
    expect(houseKey({ region: "us", realm: "PvP", faction: "horde" })).toBe("us-pvp-horde");
  });

  it("maps realm and faction to the Blizzard house ID found by the probe", () => {
    expect(blizzardHouseId({ region: "us", realm: "pvp", faction: "horde" })).toBe(113);
    expect(blizzardHouseId({ region: "us", realm: "PvP", faction: "alliance" })).toBe(110);
    expect(blizzardHouseId({ region: "us", realm: "nowhere", faction: "horde" })).toBeUndefined();
    const ids = REALMS.flatMap((r) => Object.values(r.houses));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("summary", () => {
  it("reports last price, 24h change and 7-day average", () => {
    const pts = Array.from({ length: 48 }, (_, i) => ({ time: i * 3600, market: i < 24 ? 100 : 110, minBuyout: 90, listed: 5, auctions: 2 }));
    const s = summarize(pts);
    expect(s.last!.market).toBe(110);
    expect(s.change24h).toBeCloseTo(10);
    expect(s.avg7d).toBe(105);
    expect(summarize([])).toEqual({ last: null, change24h: null, avg7d: null });
  });
});

describe("search", () => {
  it("finds by name in either language, ignoring accents, and by ID", () => {
    expect(normalize(" Étoffe ")).toBe("etoffe");
    expect(searchItems(ITEMS, "etoffe", "fr").map((i) => i.id)).toEqual(expect.arrayContaining([2589, 4306, 14047]));
    expect(searchItems(ITEMS, "rune", "en")[0]!.id).toBe(14047);
    expect(searchItems(ITEMS, "lotus noir", "en")[0]!.id).toBe(13468);
    expect(searchItems(ITEMS, "12363", "en")[0]!.id).toBe(12363);
    expect(searchItems(ITEMS, "   ", "en")).toEqual([]);
  });
});

describe("watchlist storage", () => {
  it("toggles and cleans IDs", () => {
    expect(toggleWatch([1, 2], 2)).toEqual([1]);
    expect(toggleWatch([1], 2)).toEqual([1, 2]);
    expect(cleanWatchlist([3, 3, -1, 2.5, "x", 7])).toEqual([3, 7]);
    expect(cleanWatchlist("nope")).toEqual([]);
  });

  it("survives a broken or missing store", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readJson("k", [1], broken)).toEqual([1]);
    expect(() => writeJson("k", [1], broken)).not.toThrow();
    expect(readJson("k", "fallback", null)).toBe("fallback");
    const map = new Map<string, string>();
    const ok: KeyValueStore = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
    writeJson("k", { a: 1 }, ok);
    expect(readJson("k", {}, ok)).toEqual({ a: 1 });
  });
});

describe("i18n", () => {
  it("has every English key in French, none empty", () => {
    expect(Object.keys(MESSAGES.fr).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    for (const value of [...Object.values(MESSAGES.en), ...Object.values(MESSAGES.fr)]) expect(value.trim()).not.toBe("");
  });

  it("detects French browsers", () => {
    expect(detectLang(["fr-CA", "en"])).toBe("fr");
    expect(detectLang(["de-DE", "en-US"])).toBe("en");
    expect(detectLang([])).toBe("en");
  });

  it("names every item in both languages", () => {
    for (const item of ITEMS) {
      expect(item.name.en).not.toBe("");
      expect(item.name.fr).not.toBe("");
    }
  });
});
