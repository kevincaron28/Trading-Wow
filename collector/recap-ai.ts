/**
 * Market-close summaries of the recaps, written by a language model and checked against the recap's own numbers.
 *
 * - Only with RECAP_AI_BASE_URL, RECAP_AI_MODEL and RECAP_AI_API_KEY set (an OpenAI-compatible chat endpoint, e.g.
 *   Google's Gemini at https://generativelanguage.googleapis.com/v1beta/openai). Without them, nothing changes.
 * - The model sees only the recap's facts (factsFor: index moves, risers and fallers, volume, flips, crafts, raid
 *   consumables, records, rebalancing) and the reviewed WoW Forever notes in docs/WOW_FOREVER_CONTEXT.md, at a low
 *   temperature, with the instruction to use nothing else.
 * - Accuracy guard (checkSummary): every amount of gold, percentage and other number must be in the facts, every item
 *   named must be one the recap lists, a percentage next to an item or index must be that one's own figure, and "rose"
 *   or "fell" must match the sign of the move. A failed text is regenerated once; if it fails again (or the model is
 *   down, slow or out of quota) the summary is the template one, built from the same numbers by recapSummary. An
 *   unchecked text is never returned.
 * - One request per recap (two when the first text fails the guard; a 429 or 5xx is retried once after a pause).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Lang } from "../src/lib/i18n.ts";
import { recapSummary, type RecapFile } from "../src/lib/weekly.ts";

const RAID_LAUNCH = Date.UTC(2026, 11, 9) / 1000;

export interface AiConfig { baseUrl: string; model: string; apiKey: string; timeoutMs: number }

/** The model endpoint from the environment, or null when any of the three settings is missing. */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const baseUrl = env.RECAP_AI_BASE_URL?.trim();
  const model = env.RECAP_AI_MODEL?.trim();
  const apiKey = env.RECAP_AI_API_KEY?.trim();
  if (!baseUrl || !model || !apiKey || !/^https:\/\//.test(baseUrl)) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), model, apiKey, timeoutMs: 30_000 };
}

export interface SummaryNames {
  item: (id: number) => string;
  index: (id: string) => string;
  house: string;
  /** Every item name of the catalog in the summary's language: a name the recap does not list is rejected. */
  catalog: Iterable<string>;
}

export interface CardChangeLike { index: string; at: number; kind: "monthly" | "quarterly"; added: number[]; removed: number[] }

/** What the guard accepts: numbers, amounts, percentages by entity, and the entities with the sign of their move. */
export interface Allowed {
  numbers: number[];
  coppers: number[];
  /** Absolute percentages, each with the entity (lower-case name) it belongs to, or "" for a general one. */
  pcts: { v: number; who: string }[];
  /** Entity (lower-case name) -> sign of its move (1 up, -1 down, 0 flat or unknown). */
  entities: Map<string, number>;
  /** Item names the recap lists (lower case). */
  items: Set<string>;
  /** Every catalog item name of 6+ letters (lower case): one the recap does not list is rejected. */
  catalog: string[];
}

export interface Facts { json: Record<string, unknown>; allowed: Allowed }

const round1 = (v: number) => Math.round(v * 10) / 10;
/** Gold, silver and copper as the summary writes them: 18g 49s / 87s 94c / 12c (po/pa/pc in French); from 1,000 gold, gold only. */
export function coinText(copper: number, lang: Lang): string {
  const suf = lang === "fr" ? { g: "po", s: "pa", c: "pc" } : { g: "g", s: "s", c: "c" };
  const v = Math.round(Math.abs(copper));
  const g = Math.floor(v / 10_000);
  const s = Math.floor((v % 10_000) / 100);
  const c = v % 100;
  const sign = copper < 0 ? "-" : "";
  const grp = (n: number) => n.toLocaleString(lang === "fr" ? "fr-CA" : "en-US").replace(/[\u00a0\u202f]/g, " ");
  if (g >= 1_000) return `${sign}${grp(g)}${suf.g}`;
  if (g > 0) return `${sign}${g}${suf.g}${s ? ` ${s}${suf.s}` : ""}`;
  if (s > 0) return `${sign}${s}${suf.s}${c ? ` ${c}${suf.c}` : ""}`;
  return `${sign}${c}${suf.c}`;
}
const money = (c: number, lang: Lang) => coinText(c, lang);
const day = (t: number, lang: Lang) => new Date(t * 1000).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The recap's facts for the prompt, and the guard's allowed values built from the very same numbers. */
export function factsFor(r: RecapFile, names: SummaryNames, lang: Lang, changes: CardChangeLike[], contextNumbers: number[], now: number = r.end): Facts {
  const numbers: number[] = [...contextNumbers];
  const coppers: number[] = [];
  const pcts: Allowed["pcts"] = [];
  const entities = new Map<string, number>();
  const items = new Set<string>();
  const sign = (v: number | null | undefined) => (v == null ? 0 : v > 0.05 ? 1 : v < -0.05 ? -1 : 0);
  const pct = (v: number | null | undefined, who: string) => {
    if (v == null || !Number.isFinite(v)) return null;
    pcts.push({ v: Math.abs(round1(v)), who });
    return round1(v);
  };
  const price = (c: number) => {
    const shown = money(c, lang);
    // The exact amount and the amount as written (gold from 1,000 up drops silver and copper).
    coppers.push(c, ...moneyTokens(shown, lang).map((m) => m.copper));
    return shown;
  };
  const item = (id: number, change?: number | null) => {
    const n = names.item(id);
    items.add(n.toLowerCase());
    if (change != null && !entities.has(n.toLowerCase())) entities.set(n.toLowerCase(), sign(change));
    return n;
  };
  const count = (n: number) => {
    numbers.push(n);
    return n;
  };
  const daysToRaids = Math.ceil((RAID_LAUNCH - now) / 86_400);
  for (const t of [r.start, r.end, r.rebalance?.next ?? 0, RAID_LAUNCH]) {
    if (!t) continue;
    const d = new Date(t * 1000);
    numbers.push(d.getUTCDate(), d.getUTCFullYear(), d.getUTCHours());
  }
  if (daysToRaids > 0) numbers.push(daysToRaids);

  const json: Record<string, unknown> = {
    period: { kind: r.kind, from: day(r.start, lang), to: day(r.end, lang), endsAt: "13:00 UTC" },
    auctionHouse: names.house,
    daysUntilRaidsOpen: daysToRaids > 0 ? daysToRaids : 0,
  };
  if (r.indexes) {
    json.indexes = r.indexes.map(([id, a, b, c]) => {
      const n = names.index(id);
      entities.set(n.toLowerCase(), sign(c));
      numbers.push(round1(a), round1(b), Math.round(a * 100) / 100, Math.round(b * 100) / 100);
      return { index: n, atStart: Math.round(a * 100) / 100, atEnd: Math.round(b * 100) / 100, changePct: pct(c, n.toLowerCase()) };
    });
  }
  const mover = (x: [number, number, number, number, number]) => ({ item: item(x[0], x[3]), priceAtStart: price(x[1]), priceAtEnd: price(x[2]), changePct: pct(x[3], names.item(x[0]).toLowerCase()), soldPerDay: count(x[4]) });
  if (r.risers) json.topRisers = r.risers.map(mover);
  if (r.fallers) json.topFallers = r.fallers.map(mover);
  if (r.traded) json.mostTraded = r.traded.map(([id, gold, sold, market, ch]) => ({ item: item(id, ch), goldTradedPerDay: price(gold), soldPerDay: count(sold), price: price(market), priceChangePct: pct(ch, names.item(id).toLowerCase()) }));
  if (r.raid) {
    const aliases = lang === "fr" ? ["consommables de raid", "consommable de raid", "consommables"] : ["raid consumables", "raid consumable", "consumables"];
    for (const alias of aliases) entities.set(alias, sign(r.raid.change));
    if (r.raid.change != null) for (const alias of aliases.slice(1)) pcts.push({ v: Math.abs(round1(r.raid.change)), who: alias });
    json.raidConsumables = {
      note: "flasks, elixirs and potions",
      soldPerDay: count(r.raid.soldPerDay),
      soldPerDayPeriodBefore: r.raid.prevSoldPerDay != null ? count(r.raid.prevSoldPerDay) : null,
      changePct: pct(r.raid.change, lang === "fr" ? "consommables de raid" : "raid consumables"),
      busiest: r.raid.rows.map(([id, sold, market, ch]) => ({ item: item(id, ch), soldPerDay: count(sold), price: price(market), priceChangePct: pct(ch, names.item(id).toLowerCase()) })),
    };
  }
  if (r.flips) {
    json.flips = {
      spotted: count(r.flips.found), payingOffAtEnd: count(r.flips.paid), reachedTarget: count(r.flips.reached),
      best: r.flips.rows.map(([id, , buy, sell, profit, , result, , sold]) => ({ item: item(id), buy: price(buy), resale: price(sell), profitPerUnit: price(profit), resultAtEndPct: pct(result, names.item(id).toLowerCase()), soldPerDay: sold != null ? count(sold) : null })),
    };
  }
  if (r.crafts) {
    json.crafts = {
      spotted: count(r.crafts.found), stillProfitable: count(r.crafts.stillProfitable),
      best: r.crafts.rows.map(([id, , then, thenPct, nowProfit, nowPct]) => ({ item: item(id), profitThen: price(then), marginThenPct: pct(thenPct, names.item(id).toLowerCase()), profitAtEnd: nowProfit != null ? price(nowProfit) : null, marginAtEndPct: pct(nowPct, names.item(id).toLowerCase()) })),
    };
  }
  const record = (x: [number, number, number, number, number, number]) => ({ item: item(x[0], x[1] - x[3]), price: price(x[1]), previousRecord: price(x[3]), changePct: pct((x[1] / x[3] - 1) * 100, names.item(x[0]).toLowerCase()), day: day(x[2], lang) });
  if (r.highs?.length) json.newHighs = r.highs.map(record);
  if (r.lows?.length) json.newLows = r.lows.map(record);
  for (const x of [...(r.highs ?? []), ...(r.lows ?? [])]) numbers.push(new Date(x[2] * 1000).getUTCDate());
  if (r.rebalance) {
    json.indexRebalancing = {
      next: `${day(r.rebalance.next, lang)} 15:00 UTC`,
      type: r.rebalance.quarterly ? "quarterly review" : "monthly",
      changesDuringPeriod: changes.filter((c) => c.at > r.start && c.at <= r.end).map((c) => {
        numbers.push(new Date(c.at * 1000).getUTCDate(), count(c.added.length), count(c.removed.length));
        return { index: names.index(c.index), day: day(c.at, lang), added: c.added.map((id) => item(id)), removed: c.removed.map((id) => item(id)) };
      }),
    };
  }
  const catalog = [...new Set([...names.catalog].map((n) => n.toLowerCase()).filter((n) => n.length >= 6))];
  return { json, allowed: { numbers, coppers, pcts, entities, items, catalog } };
}

/** The WoW Forever notes the model may use: the "Facts for the summaries" list of docs/WOW_FOREVER_CONTEXT.md. */
export function loadContext(path: string = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "WOW_FOREVER_CONTEXT.md")): { text: string; numbers: number[] } {
  if (!existsSync(path)) return { text: "", numbers: [] };
  const md = readFileSync(path, "utf8");
  const m = /<!-- facts:start -->([\s\S]*?)<!-- facts:end -->/.exec(md);
  const text = (m?.[1] ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).join("\n");
  const numbers = [...text.matchAll(/\d+/g)].map((x) => Number(x[0]));
  return { text, numbers };
}

/** The chat messages: a strict system prompt and the facts as JSON. */
export function buildMessages(facts: Facts, kind: RecapFile["kind"], lang: Lang, context: string, retryNote?: string): { role: "system" | "user"; content: string }[] {
  const language = lang === "fr" ? "Canadian French (Québec), with prices in po/pa/pc as given" : "English, with prices in g/s/c as given";
  const period = kind === "daily" ? "day" : kind === "weekly" ? "week" : "month";
  const system = [
    `You write the market-close summary of a World of Warcraft: Forever auction house recap for the Goblin Ledger newsletter, in ${language}.`,
    `Write 2 or 3 short sentences (at most 60 words), in the style of a market-close news wire: what the Ledger 100 index did over the ${period}, then the one or two most notable things among the sectors, the biggest movers, raid consumable demand and an index rebalance if one is listed. The detailed lists are shown in images next to your text, so do not list items.`,
    "Item names are in English: write them exactly as given, never translated.",
    "Use ONLY the numbers, names and facts in the JSON and in the WoW Forever notes below. Copy every number, percentage and price exactly as written there (you may round a percentage to a whole number). Never compute new numbers, never add a cause, prediction, advice or event that is not stated. Say 'rose' only for a positive change and 'fell' only for a negative one.",
    "No headline, no lists, no emoji, no markdown. Plain sentences only.",
    context ? `WoW Forever notes (reviewed facts, the only outside facts you may use):\n${context}` : "",
    retryNote ? `Your previous answer was rejected: ${retryNote}. Write it again, sticking to the data.` : "",
  ].filter(Boolean).join("\n\n");
  return [{ role: "system", content: system }, { role: "user", content: JSON.stringify(facts.json) }];
}

// ---- The guard ----

const UP = /\b(rose|rise[sn]?|rising|gain(?:ed|s)?|climb(?:ed|s)?|jump(?:ed|s)?|rall(?:ied|y)|surg(?:ed|es)|advanc(?:ed|es)|up|higher|increas(?:ed|es)|hausse|mont[ée]e?s?|grimp|progress|bondi|augment|gagn)/i;
const DOWN = /\b(fell|fall(?:s|en)?|drop(?:ped|s)?|slid|slip(?:ped|s)?|declin(?:ed|es)|los[st]|lower|down|decreas(?:ed|es)|sank|tumbl|baisse|recul|chut|gliss|perdu|dimin|repli)/i;

/** A number written in the text and the precision it was written with (half its last unit). */
interface Written { value: number; half: number }

function parseNumber(raw: string, lang: Lang): Written | null {
  let s = raw.replace(/[   ]/g, lang === "fr" ? "" : " ").trim();
  if (lang === "fr") s = s.replace(/,/g, ".");
  else s = s.replace(/,(?=\d{3}\b)/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = Number(s);
  const dec = s.split(".")[1]?.length ?? 0;
  if (dec) return { value, half: 0.5 * 10 ** -dec + 1e-9 };
  const zeros = /0*$/.exec(s)![0].length;
  return { value, half: zeros && value >= 1000 ? 0.5 * 10 ** zeros : 0.5 };
}

const NUM = String.raw`\d{1,3}(?:[,   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;

/** Gold amounts such as "18g 49s", "21,219g", "87s 94c" (po/pa/pc in French), in copper with their precision. */
function moneyTokens(text: string, lang: Lang): { copper: number; half: number; span: [number, number] }[] {
  const [g, s, c] = lang === "fr" ? ["po", "pa", "pc"] : ["g", "s", "c"];
  const re = new RegExp(String.raw`(?:(${NUM})\s?${g}\b)?\s?(?:(\d{1,2})\s?${s}\b)?\s?(?:(\d{1,2})\s?${c}\b)?`, "g");
  const out: { copper: number; half: number; span: [number, number] }[] = [];
  for (const m of text.matchAll(re)) {
    if (!m[0].trim() || (!m[1] && !m[2] && !m[3])) continue;
    const gold = m[1] ? parseNumber(m[1], lang) : null;
    if (m[1] && !gold) continue;
    const copper = (gold?.value ?? 0) * 10_000 + Number(m[2] ?? 0) * 100 + Number(m[3] ?? 0);
    const half = m[3] ? 0.5 : m[2] ? 50 : (gold?.half ?? 0.5) * 10_000;
    out.push({ copper, half, span: [m.index!, m.index! + m[0].length] });
  }
  return out;
}

export interface Check { ok: boolean; problems: string[] }

/** Check a summary against the facts it was written from. */
export function checkSummary(text: string, facts: Facts, lang: Lang): Check {
  const a = facts.allowed;
  const problems: string[] = [];
  const t = text.trim();
  if (!t) return { ok: false, problems: ["empty"] };
  const sentences = t.split(/(?<=[.!?])\s+/).filter((x) => x.trim());
  if (sentences.length < 2 || sentences.length > 4 || t.length > 520) problems.push(`length (${sentences.length} sentences, ${t.length} characters)`);
  if (/[*#_`|]|https?:/.test(t)) problems.push("markup or link");

  // Amounts of gold.
  let rest = t;
  for (const m of moneyTokens(t, lang).reverse()) {
    if (!a.coppers.some((c) => Math.abs(c - m.copper) <= m.half)) problems.push(`amount ${t.slice(m.span[0], m.span[1]).trim()} is not in the data`);
    rest = rest.slice(0, m.span[0]) + " ".repeat(m.span[1] - m.span[0]) + rest.slice(m.span[1]);
  }

  // Clauses: percentages belong to the entities named in the same clause, and the direction words must agree.
  const lower = (s: string) => s.toLowerCase();
  const entityNames = [...a.entities.keys()].sort((x, y) => y.length - x.length);
  // A clause without a name ("…at 41.12, down 0.4%") speaks of the last one named in its sentence.
  const clauses: { text: string; carry: boolean }[] = [];
  for (const sentence of rest.split(/[.;:!?](?=\s|$)/)) {
    // "and", "while"... start a new subject; a comma or a dash usually goes on about the same one.
    for (const part of sentence.split(/\b(?:while|whereas|but|and|as|alors que|tandis que|mais|et)\b/i)) {
      part.split(/,\s|\s[–—-]\s/).forEach((c, i) => clauses.push({ text: c, carry: i > 0 }));
    }
  }
  let last: string[] = [];
  for (const { text: clause, carry } of clauses) {
    const lc = lower(clause);
    let scan = lc;
    let named: string[] = [];
    for (const n of entityNames) {
      const i = scan.indexOf(n);
      if (i < 0) continue;
      named.push(n);
      scan = scan.slice(0, i) + " ".repeat(n.length) + scan.slice(i + n.length);
    }
    if (named.length) last = named;
    else if (carry) named = last;
    else last = [];
    const pctRe = new RegExp(String.raw`([+\-−]?)\s?(${NUM})\s?%`, "g");
    for (const m of clause.matchAll(pctRe)) {
      const w = parseNumber(m[2]!, lang);
      if (!w) { problems.push(`unreadable percentage ${m[0].trim()}`); continue; }
      const tol = Math.max(w.half, 0.06);
      const fits = (p: { v: number; who: string }) => Math.abs(p.v - w.value) <= tol;
      const own = named.length ? a.pcts.filter((p) => named.includes(p.who)) : a.pcts;
      if (!own.some(fits)) problems.push(`${m[0].trim()} does not match ${named.length ? named.join(", ") : "any change in the data"}`);
      const s = m[1] === "+" ? 1 : m[1] === "-" || m[1] === "−" ? -1 : 0;
      if (s && named.length === 1 && a.entities.get(named[0]!) && a.entities.get(named[0]!) !== s) problems.push(`${m[0].trim()} has the wrong sign for ${named[0]}`);
    }
    const up = UP.test(clause);
    const down = DOWN.test(clause);
    if (up !== down) for (const n of named) {
      const s = a.entities.get(n) ?? 0;
      if (s && s !== (up ? 1 : -1)) problems.push(`"${n}" is said to ${up ? "rise" : "fall"} but it moved ${s > 0 ? "up" : "down"}`);
    }
  }

  // Every other number.
  let noPct = rest.replace(new RegExp(String.raw`[+\-−]?\s?(?:${NUM})\s?%`, "g"), " ");
  // Names may hold digits ("Ledger 100"): they are not numbers to check.
  for (const n of [...entityNames, ...a.items]) {
    for (let i = lower(noPct).indexOf(n); i >= 0; i = lower(noPct).indexOf(n, i + n.length)) noPct = noPct.slice(0, i) + " ".repeat(n.length) + noPct.slice(i + n.length);
  }
  for (const m of noPct.matchAll(new RegExp(NUM, "g"))) {
    const w = parseNumber(m[0], lang);
    if (!w) continue;
    if (!a.numbers.some((n) => Math.abs(n - w.value) <= w.half)) problems.push(`number ${m[0].trim()} is not in the data`);
  }

  // Item names: any catalog item named must be one the recap lists.
  const lt = lower(t);
  for (const name of a.catalog) {
    if (a.items.has(name)) continue;
    const i = lt.indexOf(name);
    if (i >= 0 && !/\p{L}/u.test(lt[i - 1] ?? " ") && !/\p{L}/u.test(lt[i + name.length] ?? " ")) problems.push(`item "${name}" is not in the recap`);
  }
  return { ok: problems.length === 0, problems };
}

/** One chat completion, with a timeout; a 429 or 5xx is retried once after a pause. */
export async function complete(cfg: AiConfig, messages: { role: string; content: string }[], fetchImpl: typeof fetch = fetch): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, max_tokens: 400 }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (res.ok) {
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return (body.choices?.[0]?.message?.content ?? "").trim();
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      const after = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Math.min(20_000, Number.isFinite(after) && after > 0 ? after * 1000 : 5_000)));
      continue;
    }
    throw new Error(`model answered HTTP ${res.status}`);
  }
}

export interface Summary { text: string; source: "ai" | "ai-retry" | "template"; problems: string[] }

/** The template summary: the deterministic notes (the first 3), as sentences. */
export function templateSummary(r: RecapFile, names: SummaryNames, lang: Lang, now: number): string {
  return recapSummary(r, r.kind, lang, names.item, names.index, now).slice(0, 3).join(" ");
}

/** The checked summary of a recap: the model's text when it passes the guard (once retried), else the template. */
export async function summarize(r: RecapFile, names: SummaryNames, lang: Lang, changes: CardChangeLike[], cfg: AiConfig | null, opts: { fetch?: typeof fetch; now?: number; context?: { text: string; numbers: number[] } } = {}): Promise<Summary> {
  const now = opts.now ?? Date.now() / 1000;
  const template = { text: templateSummary(r, names, lang, now), source: "template" as const };
  if (!cfg) return { ...template, problems: [] };
  const context = opts.context ?? loadContext();
  const facts = factsFor(r, names, lang, changes, context.numbers, now);
  const problems: string[] = [];
  let retryNote: string | undefined;
  for (const source of ["ai", "ai-retry"] as const) {
    let text: string;
    try {
      text = await complete(cfg, buildMessages(facts, r.kind, lang, context.text, retryNote), opts.fetch);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "model error");
      break; // down, slow or out of quota: no second call
    }
    const check = checkSummary(text, facts, lang);
    if (check.ok) return { text, source, problems };
    problems.push(...check.problems.map((p) => `${source}: ${p}`));
    retryNote = check.problems.slice(0, 3).join("; ");
  }
  return { ...template, problems };
}
