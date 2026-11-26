import { describe, expect, it } from "vitest";
import { CARD_WIDTH, MAX_CARD_BYTES, cardSvgs, coinParts, fit, pct, renderCards, sparkPath, textWidth, type CardInput } from "../collector/recap-card";
import { buildMessage } from "../collector/discord-recap";
import type { RecapFile, RecapKind } from "../src/lib/weekly";

const H = 3_600;
const END = Date.UTC(2026, 10, 30, 13) / 1000;
const LEN: Record<RecapKind, number> = { daily: 24, weekly: 168, monthly: 720 };
const SECTORS = ["herbs", "ores", "cloth", "leather", "enchanting", "elemental", "consumables", "raidprep"];
const NAMES: Record<number, [string, number]> = {
  1: ["Black Lotus", 1], 2: ["Arcanite Bar", 2], 3: ["Flask of Supreme Power", 1], 4: ["Mooncloth", 1],
  5: ["Scroll of Imbue Precision and Unusually Long Names", 1], 6: ["Sageblade", 4], 7: ["Elixir of the Mongoose", 1],
  8: ["Runecloth", 1], 9: ["Greater Eternal Essence", 2], 10: ["Devilsaur Leather", 1],
};

/** A recap with every section full, prices from 1c to 21,000g. */
function fixture(kind: RecapKind): CardInput {
  const end = END;
  const start = end - LEN[kind] * H;
  const wave = (k: number, base: number) => Array.from({ length: 24 }, (_, i) => Math.round(base * (1 + 0.2 * Math.sin(i / 3 + k))));
  const ids = Object.keys(NAMES).map(Number);
  const recap: RecapFile = {
    v: 1, house: 113, kind, key: kind === "monthly" ? "2026-11" : "2026-11-30", start, end, ownSince: start - 30 * 86_400,
    indexes: [["gl100", 100, 104.2, 4.2], ...SECTORS.map((id, i) => [id, 100, 100 + (i - 4) * 3.1, (i - 4) * 3.1] as [string, number, number, number])],
    risers: ids.slice(0, 5).map((id, i) => [id, 10_000 * (i + 1), 15_000 * (i + 1), 50 - i * 7, 30 + i]),
    fallers: ids.slice(5, 10).map((id, i) => [id, 2_000 * (i + 1), 1_200 * (i + 1), -40 + i * 6, 12 + i]),
    highs: ids.slice(0, 5).map((id, i) => [id, 50_000 + i, end - 86_400, 40_000, 14, 20]),
    lows: ids.slice(5, 10).map((id, i) => [id, 99 + i, end - 86_400, 140, 14, 20]),
    flips: { found: 12, paid: 8, reached: 9, rows: ids.slice(0, 5).map((id, i) => [id, end - 7_200, 21_465 + i, 56_948, 32_636, 40_000, 25 - i * 20, 1, 11]) },
    crafts: { found: 19, stillProfitable: 15, rows: ids.slice(5, 10).map((id, i) => [id, end - 7_200, 1_787_241 - i * 100_000, 28, 1_541_882, 26 - i * 10]) },
    traded: ids.slice(0, 5).map((id, i) => [id, 212_195_854 / (i + 1), 923 * (i + 1), 229_898, i === 2 ? null : 5 - i * 3]),
    raid: { soldPerDay: 129_791, prevSoldPerDay: 120_474, change: 7.7, rows: ids.slice(2, 7).map((id, i) => [id, 225 * (i + 1), 184_900 / (i + 1), i % 2 ? -1.6 : 10]) },
    sparks: Object.fromEntries(ids.map((id) => [id, wave(id, 10_000 * id)])),
    rebalance: { last: null, next: Date.UTC(2026, 11, 1, 15) / 1000, quarterly: false },
  };
  const hours = (from: number, to: number, f: (h: number) => number): [number, number][] => {
    const out: [number, number][] = [];
    for (let h = from; h <= to; h++) out.push([h, Math.round(f(h) * 100) / 100]);
    return out;
  };
  const s0 = start / H - 24 * 30;
  const series = Object.fromEntries(["gl100", ...SECTORS].map((id, k) => [id, hours(s0, end / H, (h) => 100 + 8 * Math.sin(h / 40 + k) + (h - s0) * 0.005)]));
  return {
    recap,
    lang: "fr",
    names: { item: (id) => NAMES[id]?.[0] ?? `#${id}`, quality: (id) => NAMES[id]?.[1] ?? 1, index: (id) => (id === "gl100" ? "Ledger 100" : id[0]!.toUpperCase() + id.slice(1)), house: "JcJ Horde" },
    series,
    changes: [{ index: "gl100", at: end - 3 * 86_400, kind: "monthly", added: [1, 2, 3], removed: [9, 10] }],
    now: end + 1_800,
  };
}

describe("recap card helpers", () => {
  it("writes gold, silver and copper the game's way", () => {
    expect(coinParts(184_900, "en").map(([t]) => t).join("")).toBe("18g 49s");
    expect(coinParts(8_794, "fr").map(([t]) => t).join("")).toBe("87pa 94pc");
    expect(coinParts(12, "en").map(([t]) => t).join("")).toBe("12c");
    expect(coinParts(212_195_854, "fr").map(([t]) => t).join("")).toBe("21 219po");
    expect(coinParts(50_000, "en").map(([t]) => t).join("")).toBe("5g");
  });

  it("shortens long names to fit and formats changes per language", () => {
    const s = fit("Scroll of Imbue Precision and Unusually Long Names", 26, 300);
    expect(s.endsWith("…")).toBe(true);
    expect(textWidth(s, 26)).toBeLessThanOrEqual(300);
    expect(pct(7.74, "fr")).toBe("+7,7 %");
    expect(pct(-150, "en")).toBe("-150%");
    expect(pct(null, "en")).toBe("–");
  });

  it("draws sparklines through known prices only", () => {
    expect(sparkPath([1, null, 3], 0, 0, 100, 10)).toBe("M0.0,10.0L100.0,0.0");
    expect(sparkPath([null, 5], 0, 0, 100, 10)).toBeNull();
  });
});

describe("recap cards", () => {
  for (const kind of ["daily", "weekly", "monthly"] as RecapKind[]) {
    it(`renders the ${kind} cards within Discord's limits`, () => {
      const input = fixture(kind);
      const pages = cardSvgs(input);
      expect(pages).toHaveLength(4);
      for (const p of pages) {
        expect(p.width).toBe(CARD_WIDTH);
        // Phone-friendly: no card taller than 1.7 x its width.
        expect(p.height).toBeGreaterThan(500);
        expect(p.height).toBeLessThanOrEqual(1_700);
        expect(p.svg).not.toMatch(/guilded|goldline/i);
        expect(p.svg).not.toMatch(/NaN|undefined|Infinity/);
      }
      const svg = pages.map((p) => p.svg).join("");
      expect(svg).toContain("GOBLIN LEDGER");
      expect(svg).toContain("JCJ HORDE ·");
      if (kind !== "daily") expect(svg).toContain("DEPUIS LE LANCEMENT");
      if (kind === "daily") expect(svg).toContain("Aucun changement de panier");
      else expect(svg).toContain("ENTRÉES : Black Lotus, Arcanite Bar, Flask of Supreme Power");

      const pngs = renderCards(input)!;
      expect(pngs).toHaveLength(4);
      let total = 0;
      pngs.forEach((png, i) => {
        expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        expect(png.readUInt32BE(16)).toBe(CARD_WIDTH);
        expect(png.readUInt32BE(20)).toBe(pages[i]!.height);
        total += png.length;
      });
      expect(total).toBeLessThan(MAX_CARD_BYTES);

      // The message: the notes embed carries card 1, one embed per further card, no text fields, under 6,000 characters.
      const msg = buildMessage(input.recap, "fr", input.names, pngs.map((_, i) => `card-${i + 1}.png`), input.now) as { embeds: { image?: { url: string }; fields?: unknown[] }[] };
      expect(msg.embeds).toHaveLength(4);
      expect(msg.embeds.map((e) => e.image?.url)).toEqual(["attachment://card-1.png", "attachment://card-2.png", "attachment://card-3.png", "attachment://card-4.png"]);
      expect(msg.embeds[0]!.fields).toEqual([]);
      expect(JSON.stringify(msg.embeds).length).toBeLessThan(6_000);
      expect(JSON.stringify(msg)).not.toMatch(/guilded|goldline/i);
    });
  }

  it("leaves out a page with nothing to show", () => {
    const input = fixture("weekly");
    input.recap.raid = null;
    input.recap.flips = null;
    input.recap.crafts = null;
    const pages = cardSvgs(input);
    expect(pages).toHaveLength(3);
    expect(pages[2]!.svg).toContain("3/3");
  });
});
