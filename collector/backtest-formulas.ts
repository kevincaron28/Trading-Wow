/**
 * Market-value formula backtest on live Blizzard snapshots (Goldline does not store raw auctions).
 *
 *   node --env-file=.env collector/backtest-formulas.ts [houseId ...]
 *
 * For every item in each house it compares the formulas in src/lib/market.ts on:
 * - cheap fool: one extra unit listed at 10% of the formula's own value; fooled when the value drops below 75%;
 * - expensive fool: one extra unit at 10x; fooled when the value rises above 133%;
 * - stability: 30 resamples that each drop 20% of the auctions at random; median coefficient of variation.
 * Results are split by market depth (thin: up to 5 units listed, mid, deep: 100+ units) and commodities vs items.
 */
import { FORMULAS, type Unitlist } from "../src/lib/market.ts";
import { summarizeHouseListings, type RawAuction } from "./store.ts";

const API = "https://us.api.blizzard.com";
const NS = "dynamic-forever-us";

async function token(): Promise<string> {
  const id = process.env.BNET_CLIENT_ID;
  const secret = process.env.BNET_CLIENT_SECRET;
  if (!id || !secret) throw new Error("BNET_CLIENT_ID and BNET_CLIENT_SECRET are required");
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

async function auctions(bearer: string, path: string): Promise<RawAuction[]> {
  const res = await fetch(`${API}${path}?namespace=${NS}`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!res.ok) return [];
  return ((await res.json()) as { auctions?: RawAuction[] }).auctions ?? [];
}

/** Deterministic random numbers, so a rerun gives the same numbers. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

interface Tally { items: number; cheap: number; dear: number; cvs: number[] }

async function main(): Promise<void> {
  const houses = process.argv.slice(2).map(Number).filter(Boolean);
  const list = houses.length ? houses : [113, 110, 120, 116];
  const bearer = await token();
  const tallies = new Map<string, Tally>();
  const tally = (key: string) => tallies.get(key) ?? (tallies.set(key, { items: 0, cheap: 0, dear: 0, cvs: [] }), tallies.get(key)!);
  const random = rng(42);
  for (const house of list) {
    const items = await auctions(bearer, `/data/wow/ruleset/1/auctions/${house}`);
    const commodities = await auctions(bearer, `/data/wow/ruleset/1/auctions/${house}/commodities`);
    const commodityIds = new Set(commodities.map((a) => a.item.id));
    const byItem = summarizeHouseListings([...items, ...commodities]);
    console.log(`house ${house}: ${items.length} item auctions, ${commodities.length} commodity auctions, ${byItem.size} items`);
    for (const [id, listings] of byItem) {
      const units = listings.reduce((s, l) => s + l.quantity, 0);
      const depth = units <= 5 ? "thin" : units >= 100 ? "deep" : "mid";
      const kind = commodityIds.has(id) ? "commodity" : "item";
      for (const [name, f] of Object.entries(FORMULAS)) {
        const base = f(listings);
        if (!(base > 0)) continue;
        for (const key of [`${name}|all`, `${name}|${depth}`, `${name}|${kind}`]) {
          const t = tally(key);
          t.items++;
          const cheap = f([...listings, { unitPrice: Math.max(1, Math.round(base * 0.1)), quantity: 1 }] as Unitlist);
          const dear = f([...listings, { unitPrice: Math.round(base * 10), quantity: 1 }] as Unitlist);
          if (cheap < base * 0.75) t.cheap++;
          if (dear > base * 1.33) t.dear++;
        }
        if (listings.length >= 5) {
          const values: number[] = [];
          for (let i = 0; i < 30; i++) {
            const kept = listings.filter(() => random() >= 0.2);
            if (kept.length) values.push(f(kept));
          }
          const mean = values.reduce((s, v) => s + v, 0) / values.length;
          const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
          for (const key of [`${name}|all`, `${name}|${depth}`, `${name}|${kind}`]) tally(key).cvs.push(mean > 0 ? sd / mean : 0);
        }
      }
    }
  }
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0);
  const p90 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)]! : 0);
  const rows: string[] = ["formula | segment | items | fooled by 1 cheap unit | fooled by 1 dear unit | resample CV median | CV p90"];
  for (const [key, t] of [...tallies].sort()) {
    const [name, seg] = key.split("|");
    rows.push(`${name} | ${seg} | ${t.items} | ${((100 * t.cheap) / t.items).toFixed(1)}% | ${((100 * t.dear) / t.items).toFixed(1)}% | ${(100 * median(t.cvs)).toFixed(2)}% | ${(100 * p90(t.cvs)).toFixed(2)}%`);
  }
  console.log(rows.join("\n"));
}

if (process.argv[1]?.endsWith("backtest-formulas.ts")) await main();
