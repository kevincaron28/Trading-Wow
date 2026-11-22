/**
 * Price history coverage since WoW Forever's launch (4 Nov 2026): for every house and every item, which days have a
 * real price from any source, the first and last of them, and the missing days in between.
 *
 *   node collector/coverage.ts <dataDir>
 *
 * Sources: Goldline's own snapshots (h2/: hourly and daily rows), the Auctionator seed (seed/, owner and guildmate, house
 * 113 only) and ahprice.com's shared addon scans (ext/ahprice/, eight faction houses). Writes audit/coverage.json:
 * { generated, launchDay, today, houses: { [house]: summary }, items: { [house]: { [itemId]: [first, last, days, gaps, sources] } } }
 * where days are unix day indexes and sources is a bit mask (1 = Goldline, 2 = Auctionator scans, 4 = ahprice.com).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FOREVER_LAUNCH_DAY } from "./import-auctionator.ts";

export const SRC = { goldline: 1, auctionator: 2, ahprice: 4 } as const;
export type ItemCoverage = [first: number, last: number, days: number, gaps: number, sources: number];

/** Coverage of one item from its set of days (day index -> source bits): first, last, covered days, missing days between. */
export function coverageOf(days: ReadonlyMap<number, number>): ItemCoverage | null {
  const list = [...days.keys()].filter((d) => d >= FOREVER_LAUNCH_DAY).sort((a, b) => a - b);
  if (!list.length) return null;
  let sources = 0;
  for (const d of list) sources |= days.get(d)!;
  const first = list[0]!;
  const last = list[list.length - 1]!;
  return [first, last, list.length, last - first + 1 - list.length, sources];
}

const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null);

function addDays(target: Map<number, Map<number, number>>, dir: string, source: number, dayOf: (row: number[]) => number[]): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const file = readJson<{ items: Record<string, unknown> }>(join(dir, f));
    for (const [id, value] of Object.entries(file?.items ?? {})) {
      const days = target.get(Number(id)) ?? new Map<number, number>();
      const rows = Array.isArray(value) ? (value as number[][]) : [...((value as { h?: number[][] }).h ?? []).map((r) => [Math.floor(r[0]! / 24)]), ...((value as { d?: number[][] }).d ?? [])];
      for (const row of rows) for (const d of dayOf(row)) days.set(d, (days.get(d) ?? 0) | source);
      if (days.size) target.set(Number(id), days);
    }
  }
}

function main(): void {
  const dataDir = process.argv[2]!;
  const meta = readJson<{ houses: { id: number; realm: string; faction: string }[] }>(join(dataDir, "meta.json"));
  const today = Math.floor(Date.now() / 86_400_000);
  const houses: Record<string, unknown> = {};
  const items: Record<string, Record<string, ItemCoverage>> = {};
  for (const h of meta?.houses ?? []) {
    const byItem = new Map<number, Map<number, number>>();
    addDays(byItem, join(dataDir, "h2", String(h.id)), SRC.goldline, (r) => [r[0]!]);
    addDays(byItem, join(dataDir, "seed", String(h.id)), SRC.auctionator, (r) => [r[0]!]);
    addDays(byItem, join(dataDir, "ext", "ahprice", String(h.id)), SRC.ahprice, (r) => [r[0]!]);
    const rows: Record<string, ItemCoverage> = {};
    for (const [id, days] of byItem) { const c = coverageOf(days); if (c) rows[id] = c; }
    items[h.id] = rows;
    const all = Object.values(rows);
    const firstHist = new Map<number, number>();
    for (const c of all) firstHist.set(c[0], (firstHist.get(c[0]) ?? 0) + 1);
    const fromBefore18 = all.filter((c) => c[0] < FOREVER_LAUNCH_DAY + 14).length;
    houses[h.id] = {
      realm: h.realm,
      faction: h.faction,
      items: all.length,
      earliest: all.length ? Math.min(...all.map((c) => c[0])) : null,
      itemsWithEarlierHistory: fromBefore18,
      itemsFromLaunchWeek: all.filter((c) => c[0] <= FOREVER_LAUNCH_DAY + 3).length,
      withAuctionator: all.filter((c) => c[4] & SRC.auctionator).length,
      withAhprice: all.filter((c) => c[4] & SRC.ahprice).length,
      medianDays: all.length ? [...all.map((c) => c[2])].sort((a, b) => a - b)[Math.floor(all.length / 2)] : 0,
      itemsWithGaps: all.filter((c) => c[3] > 0).length,
      firstDayHistogram: Object.fromEntries([...firstHist].sort((a, b) => a[0] - b[0]).map(([d, n]) => [new Date(d * 86_400_000).toISOString().slice(0, 10), n])),
    };
  }
  mkdirSync(join(dataDir, "audit"), { recursive: true });
  writeFileSync(join(dataDir, "audit", "coverage.json"), JSON.stringify({ generated: new Date().toISOString(), launchDay: FOREVER_LAUNCH_DAY, today, houses, items }));
  for (const [id, s] of Object.entries(houses)) {
    const x = s as { realm: string; faction: string; items: number; earliest: number | null; itemsWithEarlierHistory: number; itemsFromLaunchWeek: number; withAuctionator: number; withAhprice: number; medianDays: number; itemsWithGaps: number };
    console.log(`${id} ${x.realm}/${x.faction}: ${x.items} items, earliest ${x.earliest ? new Date(x.earliest * 86_400_000).toISOString().slice(0, 10) : "-"}, before 18 Nov ${x.itemsWithEarlierHistory}, launch week ${x.itemsFromLaunchWeek}, auctionator ${x.withAuctionator}, ahprice ${x.withAhprice}, median ${x.medianDays} days, with gaps ${x.itemsWithGaps}`);
  }
}

if (process.argv[1]?.endsWith("coverage.ts")) main();
