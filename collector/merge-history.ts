/**
 * One Goldline price history per item and house: merges every earlier source into daily rows for the days before
 * Goldline's own hourly collection covers the item.
 *
 *   node collector/merge-history.ts <dataDir>     writes early/{house}/{itemId % 256}.json and early/meta.json
 *
 * For each item, house and UTC day:
 * - Goldline's own snapshots always win: days the collector covers are not written here (the app builds them from h2/).
 * - Otherwise the day's value is the median of the sources that have it, so one odd source cannot skew it:
 *   market = median of market-type values (AHledger daily median, TSM market value), or of the lowest buyouts when
 *   no source has a market value; min = median of lowest buyouts (AHledger, ahprice.com, Auctionator scans, TSM).
 * - Nothing is interpolated: a day no source saw has no row.
 * Row: [dayIndex, market, minBuyout, quantity, sources]. `sources` is an internal bit mask (1 AHledger, 2 ahprice.com,
 * 4 Auctionator scans, 8 TSM) for debugging and for honouring a permission change; the app never shows it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SRC = { ahledger: 1, ahprice: 2, seed: 4, tsm: 8 } as const;
const LAUNCH_DAY = Date.UTC(2026, 10, 4) / 86_400_000;
const SHARDS = 256;

export type EarlyRow = [day: number, market: number, min: number, quantity: number, sources: number];

/** One day's observations from every source. */
export interface DayObs { market: number[]; min: number[]; qty: number[]; sources: number }

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

export function mergeDay(day: number, o: DayObs): EarlyRow | null {
  if (!o.market.length && !o.min.length) return null;
  const min = o.min.length ? median(o.min) : median(o.market);
  const market = o.market.length ? median(o.market) : min;
  return [day, market, Math.min(min, market), o.qty.length ? Math.max(...o.qty) : 0, o.sources];
}

type Shard = { items: Record<string, unknown> };
const readShard = (file: string): Shard["items"] => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Shard).items : {});

/** First UTC day of Goldline's own hourly data per item, from h2/{house}. */
function ownFirstDay(dataDir: string, house: number): Map<number, number> {
  const out = new Map<number, number>();
  const dir = join(dataDir, "h2", String(house));
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    for (const [id, v] of Object.entries(readShard(join(dir, f)) as Record<string, { h: number[][]; d: number[][] }>)) {
      const firstHour = v.h[0]?.[0];
      const firstDay = v.d[0]?.[0];
      const days = [firstHour != null ? Math.floor(firstHour / 24) : Infinity, firstDay ?? Infinity];
      out.set(Number(id), Math.min(...days));
    }
  }
  return out;
}

export function mergeHouse(dataDir: string, house: number): { shards: Map<number, Record<string, EarlyRow[]>>; items: number; firstDay: number | null } {
  const own = ownFirstDay(dataDir, house);
  const obs = new Map<number, Map<number, DayObs>>();
  const add = (id: number, day: number, src: number, market: number | null, min: number | null, qty: number | null) => {
    if (day < LAUNCH_DAY) return;
    if (day >= (own.get(id) ?? Infinity)) return;
    if (!obs.has(id)) obs.set(id, new Map());
    const m = obs.get(id)!;
    if (!m.has(day)) m.set(day, { market: [], min: [], qty: [], sources: 0 });
    const o = m.get(day)!;
    if (market != null && market > 0) o.market.push(market);
    if (min != null && min > 0) o.min.push(min);
    if (qty != null && qty > 0) o.qty.push(qty);
    o.sources |= src;
  };
  for (let s = 0; s < SHARDS; s++) {
    for (const [id, rows] of Object.entries(readShard(join(dataDir, "ext", "ahledger", String(house), `${s}.json`)) as Record<string, number[][]>)) for (const r of rows) add(Number(id), r[0]!, SRC.ahledger, r[1]!, r[2]!, r[3]!);
    for (const [id, rows] of Object.entries(readShard(join(dataDir, "ext", "ahprice", String(house), `${s}.json`)) as Record<string, number[][]>)) for (const r of rows) add(Number(id), r[0]!, SRC.ahprice, null, r[1]!, r[2]!);
    for (const [id, rows] of Object.entries(readShard(join(dataDir, "seed", String(house), `${s}.json`)) as Record<string, number[][]>)) for (const r of rows) add(Number(id), r[0]!, SRC.seed, null, r[1]!, r[3]! >= 0 ? r[3]! : null);
    for (const [id, v] of Object.entries(readShard(join(dataDir, "tsm", String(house), `${s}.json`)) as Record<string, { d: number[][] }>)) for (const r of v.d) add(Number(id), r[0]!, SRC.tsm, r[1]!, r[2]!, null);
  }
  const shards = new Map<number, Record<string, EarlyRow[]>>();
  let first = Infinity;
  for (const [id, days] of obs) {
    const rows = [...days].sort((a, b) => a[0] - b[0]).map(([d, o]) => mergeDay(d, o)).filter((r): r is EarlyRow => r != null);
    if (!rows.length) continue;
    if (!shards.has(id % SHARDS)) shards.set(id % SHARDS, {});
    shards.get(id % SHARDS)![id] = rows;
    first = Math.min(first, rows[0]![0]);
  }
  let items = 0;
  for (const s of shards.values()) items += Object.keys(s).length;
  return { shards, items, firstDay: Number.isFinite(first) ? first : null };
}

function main(): void {
  const dataDir = process.argv[2]!;
  const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8")) as { houses: { id: number }[] };
  const coverage: Record<number, { items: number; firstDay: string | null }> = {};
  for (const { id: house } of meta.houses) {
    const { shards, items, firstDay } = mergeHouse(dataDir, house);
    mkdirSync(join(dataDir, "early", String(house)), { recursive: true });
    for (let s = 0; s < SHARDS; s++) writeFileSync(join(dataDir, "early", String(house), `${s}.json`), JSON.stringify({ items: shards.get(s) ?? {} }));
    coverage[house] = { items, firstDay: firstDay != null ? new Date(firstDay * 86_400_000).toISOString().slice(0, 10) : null };
  }
  writeFileSync(join(dataDir, "early", "meta.json"), JSON.stringify({ merged: new Date().toISOString(), sourceBits: SRC, coverage }));
  console.log("early history: " + Object.entries(coverage).map(([h, c]) => `${h} ${c.items} items from ${c.firstDay}`).join("; "));
}

if (process.argv[1]?.endsWith("merge-history.ts")) main();
