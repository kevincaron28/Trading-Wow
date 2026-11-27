import { describe, expect, it, vi } from "vitest";
import { aiConfigFromEnv, buildMessages, checkSummary, factsFor, loadContext, summarize, type AiConfig } from "../collector/recap-ai";
import type { RecapFile } from "../src/lib/weekly";

const END = Date.UTC(2026, 10, 26, 13) / 1000;
const recap: RecapFile = {
  v: 1, house: 113, kind: "daily", key: "2026-11-26", start: END - 86_400, end: END, ownSince: END - 10 * 86_400,
  indexes: [["gl100", 41.29, 41.12, -0.41], ["herbs", 53.95, 56.89, 5.45], ["elemental", 116.44, 130.63, 12.19], ["leather", 46.34, 44.21, -4.6]],
  risers: [[4407, 3_043, 8_574, 181.76, 313]],
  fallers: [[20750, 6_876, 2_321, -66.24, 463]],
  highs: [], lows: [],
  flips: { found: 19, paid: 12, reached: 13, rows: [[11197, END - 7_200, 21_465, 56_948, 32_636, 7_762, -65.6, 0, 11]] },
  crafts: null,
  traded: [[15407, 212_195_854, 923, 229_898, -12.57]],
  raid: { soldPerDay: 129_791, prevSoldPerDay: 120_474, change: 7.73, rows: [[13512, 225, 184_900, -1.65]] },
  rebalance: { last: null, next: Date.UTC(2026, 11, 1, 15) / 1000, quarterly: false },
};
const ITEMS: Record<number, string> = { 4407: "Accurate Scope", 20750: "Wizard Oil", 11197: "Dark Keeper Key", 15407: "Cured Rugged Hide", 13512: "Flask of Supreme Power" };
const INDEX: Record<string, string> = { gl100: "Ledger 100", herbs: "Herbs", elemental: "Elementals", leather: "Leather" };
const names = {
  item: (id: number) => ITEMS[id] ?? `#${id}`,
  index: (id: string) => INDEX[id] ?? id,
  house: "PvP Horde",
  catalog: [...Object.values(ITEMS), "Black Lotus", "Arcanite Bar"],
};
const context = loadContext();
const facts = factsFor(recap, names, "en", [], context.numbers, END + 1_800);

const GOOD = "The Ledger 100 held near flat over the day at 41.12, down 0.4%. Elementals led the sectors with a 12.2% gain while Leather fell 4.6%. Accurate Scope jumped 181.8% to 85s 74c, and Wizard Oil dropped 66.2%. Cured Rugged Hide was the most traded item at 21,219g a day, and raid consumable sales rose 7.7% to 129,791 a day ahead of the 9 December raids.";

describe("recap summary guard", () => {
  it("passes a summary that sticks to the data", () => {
    expect(checkSummary(GOOD, facts, "en")).toEqual({ ok: true, problems: [] });
  });

  it("rejects a number that is not in the data", () => {
    const bad = GOOD.replace("129,791 a day", "150,000 a day");
    const r = checkSummary(bad, facts, "en");
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("150,000");
  });

  it("rejects a percentage given to the wrong item", () => {
    const r = checkSummary(GOOD.replace("Wizard Oil dropped 66.2%", "Wizard Oil dropped 12.2%"), facts, "en");
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("wizard oil");
  });

  it("rejects a wrong direction", () => {
    const r = checkSummary(GOOD.replace("Leather fell 4.6%", "Leather rose 4.6%"), facts, "en");
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain('"leather" is said to rise');
    expect(checkSummary(GOOD.replace("down 0.4%", "up 0.4%"), facts, "en").ok).toBe(false);
  });

  it("rejects a price, an item or a date the recap does not have", () => {
    expect(checkSummary(GOOD.replace("85s 74c", "92s 10c"), facts, "en").problems.join(" ")).toContain("92s 10c");
    expect(checkSummary(GOOD.replace("Cured Rugged Hide was", "Black Lotus was"), facts, "en").problems.join(" ")).toContain("black lotus");
    expect(checkSummary(GOOD.replace("9 December", "16 December"), facts, "en").ok).toBe(false);
  });

  it("accepts rounded figures written the way people do", () => {
    const rounded = GOOD.replace("181.8%", "182%").replace("129,791 a day", "about 130,000 a day");
    expect(checkSummary(rounded, facts, "en").ok).toBe(true);
  });

  it("reads French numbers and words", () => {
    const fr = factsFor(recap, { ...names, item: (id: number) => ({ 4407: "Lunette de précision", 20750: "Huile de sorcier", 15407: "Peau robuste traitée", 13512: "Flacon de pouvoir suprême", 11197: "Clé du gardien noir" } as Record<number, string>)[id]!, index: (id: string) => ({ gl100: "Ledger 100", herbs: "Herbes", elemental: "Éléments", leather: "Cuir" } as Record<string, string>)[id]! }, "fr", [], context.numbers, END + 1_800);
    const text = "Le Ledger 100 a peu bougé sur la journée, en baisse de 0,4 % à 41,12. Les Éléments ont grimpé de 12,2 % tandis que le Cuir a reculé de 4,6 %. La Lunette de précision a bondi de 181,8 % à 85s 74c, et la Peau robuste traitée a été la plus échangée avec 21 219g par jour.";
    expect(checkSummary(text, fr, "fr")).toEqual({ ok: true, problems: [] });
    expect(checkSummary(text.replace("le Cuir a reculé", "le Cuir a grimpé"), fr, "fr").ok).toBe(false);
    // Money is g, s and c in every language: po/pa/pc is rejected.
    expect(checkSummary(text.replace("21 219g", "21 219po"), fr, "fr").problems).toContain("money must be written in g, s and c");
  });

  it("asks for the data only, at a low temperature, in one request", async () => {
    const msgs = buildMessages(facts, "daily", "en", context.text);
    expect(msgs[0]!.content).toContain("Use ONLY the numbers");
    expect(msgs[0]!.content).toContain("Barrow Deeps");
    expect(JSON.parse(msgs[1]!.content).raidConsumables.soldPerDay).toBe(129_791);
  });
});

describe("recap summary calls", () => {
  const cfg: AiConfig = { baseUrl: "https://example.test/v1", model: "test-model", apiKey: "k", timeoutMs: 1_000 };
  const reply = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
  const run = (fetchImpl: typeof fetch) => summarize(recap, names, "en", [], cfg, { fetch: fetchImpl, now: END + 1_800, context });

  it("uses the model's text when it passes", async () => {
    const f = vi.fn(async () => reply(GOOD));
    const s = await run(f as unknown as typeof fetch);
    expect(s).toEqual({ text: GOOD, source: "ai", problems: [] });
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.temperature).toBeLessThanOrEqual(0.2);
  });

  it("retries once after a rejected text, then falls back to the template", async () => {
    const bad = GOOD.replace("Leather fell", "Leather rose");
    const f1 = vi.fn().mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply(GOOD));
    expect((await run(f1 as unknown as typeof fetch)).source).toBe("ai-retry");
    const f2 = vi.fn(async () => reply(bad));
    const s = await run(f2 as unknown as typeof fetch);
    expect(s.source).toBe("template");
    expect(s.text).toContain("The Ledger 100 held steady over the day");
    expect(f2).toHaveBeenCalledTimes(2);
    expect(s.problems.length).toBeGreaterThan(0);
  });

  it("posts the template when the model is down, without hammering it", async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => new Response("busy", { status: 503 }));
    const p = run(f as unknown as typeof fetch);
    await vi.runAllTimersAsync();
    const s = await p;
    vi.useRealTimers();
    expect(s.source).toBe("template");
    expect(f).toHaveBeenCalledTimes(2); // one request, retried once after a pause
  });

  it("does nothing without the three settings", async () => {
    expect(aiConfigFromEnv({ RECAP_AI_BASE_URL: "https://x.test", RECAP_AI_MODEL: "m" })).toBeNull();
    expect(aiConfigFromEnv({ RECAP_AI_BASE_URL: "http://x.test", RECAP_AI_MODEL: "m", RECAP_AI_API_KEY: "k" })).toBeNull();
    const f = vi.fn();
    expect((await summarize(recap, names, "en", [], null, { fetch: f as unknown as typeof fetch, now: END })).source).toBe("template");
    expect(f).not.toHaveBeenCalled();
  });
});
