/**
 * One-time, polite backfill of daily price history from ahprice.com's public API (crowd-sourced scans from its addon),
 * used with the site's permission (owner, 18 Nov 2026). API only, never the HTML pages.
 *
 *   node collector/backfill-ahprice.ts fetch <cacheDir> <dataDir>     resumable; stops near the daily limit
 *   node collector/backfill-ahprice.ts write <cacheDir> <dataDir>     writes ext/ahprice/ into the data checkout
 *
 * One request every 7 seconds with a generic user agent, no personal data sent. It stops when the daily allowance
 * (X-Ratelimit-Remaining-Day) falls under a safety margin, or on any 429, and resumes from its cache the next day.
 * Order: every built-in watchlist item in every mapped market first, then the most-listed items.
 * Output: ext/ahprice/{house}/{itemId % 256}.json = { items: { [itemId]: [[dayIndex, lowestBuyout, quantity]] } } and
 * ext/ahprice/meta.json (label, market map, coverage). Kept as its own series, never mixed with Goldline's own data.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_WATCHLISTS } from "../src/data/watchlists.ts";
import { COLLECTION_START_DAY, FOREVER_LAUNCH_DAY } from "./import-auctionator.ts";

export const LABEL = "ahprice.com (crowd-sourced addon scans)";
const API = "https://ahprice.com/api/v1";
const UA = "Mozilla/5.0 (compatible; price-history-backfill/1.0)";
const GAP_MS = 7000;
const DAY_MARGIN = 60;
const DAYS = 16;

/**
 * ahprice.com US markets → Goldline houses, matched on 18 Nov 2026 by comparing current prices of 50 busy items
 * (median gap 3-14%; RP Horde 29%, still the clear best). ahprice merges US and AU realms; Blackwater has no match.
 */
export const MARKETS: readonly { market: string; house: number }[] = [
  { market: "us-pvp-horde", house: 113 },
  { market: "us-pvp-alliance", house: 110 },
  { market: "us-normal-horde", house: 114 },
  { market: "us-normal-alliance", house: 111 },
  { market: "us-rppvp-horde", house: 124 },
  { market: "us-rppvp-alliance", house: 123 },
  { market: "us-rp-horde", house: 120 },
  { market: "us-rp-alliance", house: 119 },
];

export type ExtRow = [number, number, number];

/** API points → one row per day [unix day index, lowest buyout, quantity], the day's last point winning; launch..17 Nov only. */
export function dailyRows(points: { t: number; floor_copper: number; qty?: number }[]): ExtRow[] {
  const byDay = new Map<number, ExtRow>();
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    const day = Math.floor(p.t / 86_400);
    if (!(p.floor_copper > 0) || day < FOREVER_LAUNCH_DAY || day >= COLLECTION_START_DAY) continue;
    byDay.set(day, [day, Math.round(p.floor_copper), Math.max(0, Math.round(p.qty ?? 0))]);
  }
  return [...byDay.values()].sort((a, b) => a[0] - b[0]);
}

/** Watchlist items first (in list order), then the busiest items by total quantity listed across the mapped houses. */
export function itemOrder(latest: Map<number, Record<string, number[]>>): number[] {
  const order: number[] = [];
  const seen = new Set<number>();
  for (const list of BUILT_IN_WATCHLISTS) for (const id of list.items) if (!seen.has(id)) { seen.add(id); order.push(id); }
  const listed = new Map<number, number>();
  for (const items of latest.values()) for (const [id, row] of Object.entries(items)) listed.set(Number(id), (listed.get(Number(id)) ?? 0) + (row[2] ?? 0));
  for (const [id] of [...listed].sort((a, b) => b[1] - a[1])) if (!seen.has(id)) { seen.add(id); order.push(id); }
  return order;
}

type Cache = Record<string, ExtRow[] | null>; // "market:item" → rows (null = fetched, no data)

async function fetchAll(cacheDir: string, dataDir: string): Promise<void> {
  mkdirSync(cacheDir, { recursive: true });
  const cacheFile = join(cacheDir, "cache.json");
  const cache: Cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const latest = new Map<number, Record<string, number[]>>();
  for (const { house } of MARKETS) latest.set(house, (JSON.parse(readFileSync(join(dataDir, "latest", `${house}.json`), "utf8")) as { items: Record<string, number[]> }).items);
  const order = itemOrder(latest);
  let requests = 0;
  for (const id of order) {
    for (const { market } of MARKETS) {
      const key = `${market}:${id}`;
      if (key in cache) continue;
      await new Promise((r) => setTimeout(r, GAP_MS));
      const res = await fetch(`${API}/items/${id}/history?realm=${market}&days=${DAYS}`, { headers: { "user-agent": UA, accept: "application/json" } });
      requests++;
      const left = Number(res.headers.get("x-ratelimit-remaining-day") ?? "9999");
      if (res.status === 429) { console.log(`429 after ${requests} requests; stopping (resume later)`); return save(); }
      if (res.status === 404) cache[key] = null;
      else if (res.ok) {
        const body = (await res.json()) as { points?: { t: number; floor_copper: number; qty?: number }[] };
        const rows = dailyRows(body.points ?? []);
        cache[key] = rows.length ? rows : null;
      } else console.log(`${key}: HTTP ${res.status} (will retry next run)`);
      if (requests % 25 === 0) { save(); console.log(`${new Date().toISOString().slice(11, 16)} ${requests} requests, ${Object.keys(cache).length} cached, day allowance left ${left}`); }
      if (left < DAY_MARGIN) { console.log(`daily allowance nearly used (${left} left); stopping, resume tomorrow`); return save(); }
    }
  }
  console.log("all items fetched");
  save();
  function save(): void { writeFileSync(cacheFile, JSON.stringify(cache)); }
}

function writeExt(cacheDir: string, dataDir: string): void {
  const cache: Cache = JSON.parse(readFileSync(join(cacheDir, "cache.json"), "utf8"));
  const root = join(dataDir, "ext", "ahprice");
  const coverage: Record<number, { items: number; days: Record<string, number> }> = {};
  for (const { market, house } of MARKETS) {
    const shards = new Map<number, Record<string, ExtRow[]>>();
    const cov = (coverage[house] = { items: 0, days: {} as Record<string, number> });
    for (const [key, rows] of Object.entries(cache)) {
      const [m, idText] = key.split(":");
      if (m !== market || !rows) continue;
      const id = Number(idText);
      if (!shards.has(id % 256)) shards.set(id % 256, {});
      shards.get(id % 256)![id] = rows;
      cov.items++;
      for (const r of rows) { const d = new Date(r[0] * 86_400_000).toISOString().slice(0, 10); cov.days[d] = (cov.days[d] ?? 0) + 1; }
    }
    mkdirSync(join(root, String(house)), { recursive: true });
    for (let s = 0; s < 256; s++) writeFileSync(join(root, String(house), `${s}.json`), JSON.stringify({ items: shards.get(s) ?? {} }));
  }
  writeFileSync(
    join(root, "meta.json"),
    JSON.stringify({
      label: LABEL,
      measure: "lowest buyout seen that day (the day's last scan) and its quantity, from players running the ahprice addon",
      permission: "used with ahprice.com's permission (owner, 18 Nov 2026)",
      fetched: new Date().toISOString(),
      markets: MARKETS,
      coverage,
    }),
  );
  console.log(Object.entries(coverage).map(([h, c]) => `${h}: ${c.items} items, ${Object.keys(c.days).length} days`).join("; "));
}

const [mode, cacheDir, dataDir] = process.argv.slice(2);
if (process.argv[1]?.endsWith("backfill-ahprice.ts")) {
  if (!cacheDir || !dataDir) throw new Error("usage: backfill-ahprice.ts fetch|write <cacheDir> <dataDir>");
  if (mode === "fetch") await fetchAll(cacheDir, dataDir);
  else if (mode === "write") writeExt(cacheDir, dataDir);
  else throw new Error(`unknown mode ${mode}`);
}
