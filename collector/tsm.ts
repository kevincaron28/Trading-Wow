/**
 * TradeSkillMaster public pricing data for WoW Forever (US), used with permission (owner, 19 Nov 2026) and TSM's public
 * data terms: "Pricing data from TradeSkillMaster" with a link, no claim that it is ours. https://tradeskillmaster.com/public-data
 *
 *   node collector/tsm.ts <dataDir>
 *
 * Downloads each file at most once every 3 hours (TSM asks for at most once per update; realm files change every few
 * hours, region files daily). No key needed. Writes a separate series, never mixed into Goldline's own prices:
 * - tsm/<house>/<itemId % 256>.json  { items: { [id]: { v: [marketValue, minBuyout, recent, historical], d: [[day, marketValue, minBuyout]] } } }
 * - tsm/region/<itemId % 256>.json   { items: { [id]: [marketValue, historical, avgSalePrice, saleRate, soldPerDay] } }
 * - tsm/meta.json                    { fetched, realms: { [house]: updatedAt }, regionUpdated, source, link }
 * The daily history only starts when this runs (TSM's files hold current values plus a 60-day "historical" average).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://public-data.tradeskillmaster.com/forever/us";
const UA = "Mozilla/5.0 (compatible; goldline-price-app/1.0)";
const MIN_GAP_SECONDS = 3 * 3_600;
const SHARDS = 256;

/** TSM's WoW Forever realm slugs (one per faction) -> Goldline house IDs. Blackwater (neutral) houses are not in TSM. */
export const TSM_REALMS: Record<string, number> = {
  "pvp-alliance": 110,
  "pvp-horde": 113,
  "normal-alliance": 111,
  "normal-horde": 114,
  "roleplay-alliance": 119,
  "roleplay-horde": 120,
  "roleplay-pvp-alliance": 123,
  "roleplay-pvp-horde": 124,
};

/** Parse a TSM CSV (header row, quoted fields allowed) into objects keyed by header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const num = (s: string | undefined) => (s == null || s === "" ? 0 : Number(s));

/** Update today's daily row of an item's TSM history (one row per UTC day, latest values win). */
export function upsertDay(rows: [number, number, number][], day: number, marketValue: number, minBuyout: number): [number, number, number][] {
  const out = rows.filter((r) => r[0] !== day);
  out.push([day, marketValue, minBuyout]);
  return out.sort((a, b) => a[0] - b[0]);
}

async function download(path: string): Promise<string | null> {
  const res = await fetch(`${BASE}/${path}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  return res.ok ? res.text() : null;
}

async function main(): Promise<void> {
  const dataDir = process.argv[2]!;
  const root = join(dataDir, "tsm");
  const metaFile = join(root, "meta.json");
  const meta = existsSync(metaFile) ? (JSON.parse(readFileSync(metaFile, "utf8")) as { fetched: number; realms: Record<string, string>; regionUpdated?: string }) : { fetched: 0, realms: {} };
  const now = Math.floor(Date.now() / 1000);
  if (now - meta.fetched < MIN_GAP_SECONDS) {
    console.log(`tsm: fetched ${Math.round((now - meta.fetched) / 60)} min ago; next after 3 hours`);
    return;
  }
  const day = Math.floor(now / 86_400);
  for (const [slug, house] of Object.entries(TSM_REALMS)) {
    const text = await download(`realm/${slug}/items.csv`);
    if (!text) { console.log(`tsm ${slug}: not available`); continue; }
    const rows = parseCsv(text);
    const updatedAt = rows[0]?.updatedAt ?? "";
    const shards = new Map<number, { items: Record<string, { v: number[]; d: [number, number, number][] }> }>();
    const shardFile = (s: number) => join(root, String(house), `${s}.json`);
    const load = (s: number) => {
      if (!shards.has(s)) shards.set(s, existsSync(shardFile(s)) ? JSON.parse(readFileSync(shardFile(s), "utf8")) : { items: {} });
      return shards.get(s)!;
    };
    for (const r of rows) {
      const id = Number(r.itemId);
      if (!id) continue;
      const shard = load(id % SHARDS);
      const prev = shard.items[id];
      const mv = num(r.marketValue);
      const min = num(r.minBuyout);
      shard.items[id] = { v: [mv, min, num(r.recent), num(r.historical)], d: mv > 0 ? upsertDay(prev?.d ?? [], day, mv, min) : prev?.d ?? [] };
    }
    mkdirSync(join(root, String(house)), { recursive: true });
    for (let s = 0; s < SHARDS; s++) writeFileSync(shardFile(s), JSON.stringify(load(s)));
    meta.realms[house] = updatedAt;
    console.log(`tsm ${slug} -> ${house}: ${rows.length} items, updated ${updatedAt}`);
  }
  const regionText = await download("region/items.csv");
  if (regionText) {
    const rows = parseCsv(regionText);
    const shards: Record<string, number[]>[] = Array.from({ length: SHARDS }, () => ({}));
    for (const r of rows) {
      const id = Number(r.itemId);
      if (id) shards[id % SHARDS]![id] = [num(r.marketValue), num(r.historical), num(r.avgSalePrice), num(r.saleRate), num(r.soldPerDay)];
    }
    mkdirSync(join(root, "region"), { recursive: true });
    shards.forEach((items, s) => writeFileSync(join(root, "region", `${s}.json`), JSON.stringify({ items })));
    meta.regionUpdated = rows[0]?.updatedAt;
    console.log(`tsm region: ${rows.length} items, updated ${meta.regionUpdated}`);
  }
  meta.fetched = now;
  writeFileSync(metaFile, JSON.stringify({ ...meta, source: "Pricing data from TradeSkillMaster", link: "https://www.tradeskillmaster.com/" }));
}

if (process.argv[1]?.endsWith("tsm.ts")) await main();
