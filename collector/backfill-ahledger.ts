/**
 * Backfill of daily price history since WoW Forever's launch from AHledger's public API (api.ahledger.com), used with
 * AHledger's permission (owner, 19 Nov 2026; docs/DATA.md). Official API only.
 *
 *   node collector/backfill-ahledger.ts fetch <stateDir> [--minutes N]   resumable
 *   node collector/backfill-ahledger.ts write <stateDir> <dataDir>       writes ext/ahledger/ into the data checkout
 *
 * Politeness: a generic user agent with no personal data, honours 429/503 Retry-After, never asks again for an
 * (item, market) it already has, and skips items AHledger has no price for on that market. One shared pacer for the
 * whole run: at most one request every 215 ms (about 280 a minute, under AHledger's 300 a minute per address, with
 * or without a key; several keys on one account share that limit), two requests in flight so slow answers do not
 * lower the rate. One runner at a time (workflow concurrency group). An optional key (AHLEDGER_API_KEY) is sent
 * as a bearer token and never printed.
 * Item list per market: AHledger's own price table (/v1/pricetable, one request per market, ETag cached).
 * Output (internal series, never shown with a label in the app): ext/ahledger/{house}/{itemId % 256}.json =
 * { items: { [itemId]: [[dayIndex, median, minBuyout, quantity]] } } plus ext/ahledger/meta.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LABEL = "AHledger (players' addon scans), used with permission (owner, 19 Nov 2026)";
const API = "https://api.ahledger.com/v1";
const UA = "Mozilla/5.0 (compatible; price-history-backfill/1.0)";
const GAP_MS = 400;
const PACE_MS = 215;
const IN_FLIGHT = 2;

/** One pacer shared by every request of a run: request starts are at least `gap` ms apart. */
export function pacer(gap: number, now: () => number = Date.now): () => Promise<void> {
  let next = 0;
  return async () => {
    const t = now();
    const slot = Math.max(t, next);
    next = slot + gap;
    if (slot > t) await sleep(slot - t);
  };
}

/** API keys from the environment, in order; empty or missing ones are skipped. */
export function apiKeys(env: Record<string, string | undefined> = process.env): string[] {
  return ["AHLEDGER_API_KEY", "AHLEDGER_API_KEY_2", "AHLEDGER_API_KEY_3"].map((k) => env[k]?.trim() ?? "").filter((k) => k.length > 0);
}

/** Round-robin share of the work: worker w of n takes items w, w+n, w+2n... */
export function share<T>(items: readonly T[], w: number, n: number): T[] {
  return items.filter((_, i) => i % n === w);
}
const LAUNCH_DAY = Date.UTC(2026, 10, 4) / 86_400_000;

/** Goldline house → AHledger market (US). Blackwater (neutral) has no AHledger market. */
export const MARKETS: readonly { market: string; house: number }[] = [
  { market: "forever.pvp.alliance.us", house: 110 },
  { market: "forever.pvp.horde.us", house: 113 },
  { market: "forever.normal.alliance.us", house: 111 },
  { market: "forever.normal.horde.us", house: 114 },
  { market: "forever.rp.alliance.us", house: 119 },
  { market: "forever.rp.horde.us", house: 120 },
  { market: "forever.rppvp.alliance.us", house: 123 },
  { market: "forever.rppvp.horde.us", house: 124 },
];

export type AhlRow = [day: number, median: number, min: number, quantity: number];

/** /v1/prices series → one row per UTC day from launch on, skipping days without a price. */
export function dailyRows(series: { t: string; min: number | null; median: number | null; quantity?: number | null }[]): AhlRow[] {
  const byDay = new Map<number, AhlRow>();
  for (const p of series) {
    const day = Math.floor(Date.parse(p.t) / 86_400_000);
    if (!Number.isFinite(day) || day < LAUNCH_DAY || !(p.median! > 0) || !(p.min! > 0)) continue;
    byDay.set(day, [day, Math.round(p.median!), Math.round(p.min!), Math.max(0, Math.round(p.quantity ?? 0))]);
  }
  return [...byDay.values()].sort((a, b) => a[0] - b[0]);
}

/** Item ids in an AHledger price table (header line, then "id:median:min:..." rows). */
export function pricetableIds(text: string): number[] {
  return text
    .split("\n")
    .slice(1)
    .map((l) => l.split(":"))
    // id:median:min:quantity:median7d:median30d:low30d:high30d:sold. Items with no price at all are skipped.
    .filter((f) => [f[1], f[2], f[4], f[5], f[6], f[7]].some((x) => x != null && x !== "" && Number(x) > 0))
    .map((f) => Number(f[0]))
    .filter((n) => Number.isInteger(n) && n > 0);
}

type Cache = Record<string, AhlRow[] | null>; // "market:item" → rows (null = asked, no data)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, key?: string): Promise<Response | null> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    let res: Response;
    try {
      const headers: Record<string, string> = { "user-agent": UA, accept: "application/json, text/plain" };
      if (key) headers.authorization = `Bearer ${key}`;
      res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      console.log(`${url.replace(API, "")}: ${error instanceof Error ? error.message : String(error)}; waiting 60 s`);
      await sleep(60_000);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      const wait = Math.min(600, Math.max(5, Number(res.headers.get("retry-after") ?? "60"))) * 1000;
      console.log(`${res.status}: waiting ${wait / 1000} s as asked`);
      await sleep(wait);
      continue;
    }
    return res;
  }
  return null;
}

async function fetchAll(stateDir: string, maxMinutes = Infinity): Promise<void> {
  mkdirSync(stateDir, { recursive: true });
  const cacheFile = join(stateDir, "cache.json");
  const stopAt = Date.now() + maxMinutes * 60_000;
  const cache: Cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  // Which items each market has: AHledger's price table (refreshed once a run).
  const ids = new Map<string, number[]>();
  for (const { market } of MARKETS) {
    const file = join(stateDir, `items-${market}.json`);
    const res = await get(`${API}/pricetable/${market}`);
    if (res?.ok) writeFileSync(file, JSON.stringify(pricetableIds(await res.text())));
    ids.set(market, existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as number[]) : []);
    await sleep(GAP_MS);
  }
  // Interleave markets so every house fills at the same pace.
  const keys: string[] = [];
  const longest = Math.max(...[...ids.values()].map((a) => a.length));
  for (let i = 0; i < longest; i++) for (const { market } of MARKETS) { const id = ids.get(market)![i]; if (id != null && !(`${market}:${id}` in cache)) keys.push(`${market}:${id}`); }
  const key = apiKeys()[0];
  const pace = pacer(PACE_MS);
  const workers = Array.from({ length: IN_FLIGHT }, () => ({ key }));
  console.log(`${new Date().toISOString().slice(0, 16)} ${keys.length} requests to go (${Object.keys(cache).length} done), ${key ? "with an API key" : "without a key"}, about ${Math.ceil((keys.length * PACE_MS) / 60_000)} minutes at ${Math.floor(60_000 / PACE_MS)} a minute`);
  let n = 0;
  let stop = false;
  const run = async (w: number) => {
    const { key } = workers[w]!;
    for (const k of share(keys, w, workers.length)) {
      if (stop) return;
      if (Date.now() >= stopAt) { stop = true; console.log(`time limit after ${n} requests; the next run resumes`); return; }
      const [market, id] = k.split(":");
      await pace();
      const res = await get(`${API}/prices/${market}/${id}?range=90d`, key);
      if (!res) { stop = true; console.log(`worker ${w + 1}: API unreachable; stopping, resume later`); return; }
      n++;
      if (res.status === 404) cache[k] = null;
      else if (res.ok) {
        const body = (await res.json()) as { series?: { t: string; min: number | null; median: number | null; quantity?: number | null }[] };
        const rows = dailyRows(body.series ?? []);
        cache[k] = rows.length ? rows : null;
      } else if (res.status === 403) {
        stop = true; console.log(`worker ${w + 1}: 403, the 90-day range is refused now (AHledger access change); stopping`); return;
      } else if (res.status === 401) {
        console.log(`worker ${w + 1}: 401, its API key was refused; this worker stops`); return;
      } else console.log(`${k}: HTTP ${res.status} (retry next run)`);
      if (n % 500 === 0) { writeFileSync(cacheFile, JSON.stringify(cache)); console.log(`${new Date().toISOString().slice(11, 16)} ${n} requests, ${Object.keys(cache).length} cached`); }
    }
  };
  await Promise.all(workers.map((_, w) => run(w)));
  writeFileSync(cacheFile, JSON.stringify(cache));
  const left = keys.filter((k) => !(k in cache)).length;
  if (left === 0) writeFileSync(join(stateDir, "done.json"), JSON.stringify({ done: new Date().toISOString(), entries: Object.keys(cache).length }));
  console.log(`${n} requests this run; ${left} left`);
}

export function writeExt(stateDir: string, dataDir: string): void {
  const cache: Cache = JSON.parse(readFileSync(join(stateDir, "cache.json"), "utf8"));
  const root = join(dataDir, "ext", "ahledger");
  const coverage: Record<number, { items: number; firstDay: string | null }> = {};
  for (const { market, house } of MARKETS) {
    const shards = new Map<number, Record<string, AhlRow[]>>();
    let items = 0;
    let first = Infinity;
    for (const [key, rows] of Object.entries(cache)) {
      if (!rows || !key.startsWith(`${market}:`)) continue;
      const id = Number(key.slice(market.length + 1));
      if (!shards.has(id % 256)) shards.set(id % 256, {});
      shards.get(id % 256)![id] = rows;
      items++;
      first = Math.min(first, rows[0]![0]);
    }
    coverage[house] = { items, firstDay: Number.isFinite(first) ? new Date(first * 86_400_000).toISOString().slice(0, 10) : null };
    mkdirSync(join(root, String(house)), { recursive: true });
    for (let s = 0; s < 256; s++) writeFileSync(join(root, String(house), `${s}.json`), JSON.stringify({ items: shards.get(s) ?? {} }));
  }
  writeFileSync(join(root, "meta.json"), JSON.stringify({ label: LABEL, measure: "daily median and lowest buyout, and quantity listed", fetched: new Date().toISOString(), markets: MARKETS, coverage }));
  console.log(Object.entries(coverage).map(([h, c]) => `${h}: ${c.items} items from ${c.firstDay}`).join("; "));
}

if (process.argv[1]?.endsWith("backfill-ahledger.ts")) {
  const [mode, stateDir, dataDir] = process.argv.slice(2);
  const minutesArg = process.argv.indexOf("--minutes");
  if (mode === "fetch" && stateDir) await fetchAll(stateDir, minutesArg > 0 ? Number(process.argv[minutesArg + 1]) : Infinity);
  else if (mode === "write" && stateDir && dataDir) writeExt(stateDir, dataDir);
  else throw new Error("usage: backfill-ahledger.ts fetch <stateDir> [--minutes N] | write <stateDir> <dataDir>");
}
