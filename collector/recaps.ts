/**
 * Daily, weekly and monthly market recaps of every house, and the rolling weekly recap of the Market tab.
 *
 *   node collector/recaps.ts <dataDir>        writes weekly/<house>.json and recap/<house>/ (after collector/indexes.ts)
 *
 * Fixed periods, all ending at 13:00 UTC (the time they are posted to Discord, collector/discord-recap.ts):
 * - daily: the 24 hours up to 13:00 UTC;
 * - weekly: the 7 days up to Monday 13:00 UTC;
 * - monthly: from the 1st of the month 13:00 UTC to the 1st of the next month 13:00 UTC.
 * A period is written once, by the first run whose latest snapshot reaches its end (about 13:30 UTC), and never
 * rewritten. A missing period is backfilled when the history still covers it, at most one per kind and house a run
 * (newest first), so a first run does not hold up the hourly collection. Every number comes from buildRecap
 * (collector/weekly.ts): stored prices only, nothing guessed.
 *
 * recap/<house>/list.json: { v: 1, daily: [key, start, end][], weekly: [...], monthly: [...] }, newest first.
 * recap/<house>/<kind>-<key>.json: one recap (RecapFile). Kept: 60 daily, 52 weekly, 36 monthly.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRecap, buildWeekly, loadContext, loadHouse, readJson, weeklyLog, type WeeklyFile } from "./weekly.ts";
import { lastRebalance, nextRebalance } from "./indexes.ts";

const HOUR = 3_600;
export type RecapKind = "daily" | "weekly" | "monthly";
export const KINDS: readonly RecapKind[] = ["daily", "weekly", "monthly"];
/** Every period ends at this UTC hour. */
export const POST_HOUR_UTC = 13;
export const KEEP: Record<RecapKind, number> = { daily: 60, weekly: 52, monthly: 36 };
/** How many past periods a run may look back for a missing one (hourly rows are kept 14 days). */
const LOOKBACK: Record<RecapKind, number> = { daily: 7, weekly: 2, monthly: 1 };
/** No recap ends before WoW Forever's first full week of prices (the first monthly one is November 2026). */
const FIRST_END = Date.UTC(2026, 10, 12) / 1000;

export interface RecapFile extends WeeklyFile {
  kind: RecapKind;
  /** Day the period ends (daily, weekly: "2026-11-30") or month it covers (monthly: "2026-11"). */
  key: string;
  /** Index rebalancing around the period: the last one up to its end and the next one after it. */
  rebalance?: { last: number | null; next: number; quarterly: boolean };
}

export interface RecapList {
  v: 1;
  daily: [string, number, number][];
  weekly: [string, number, number][];
  monthly: [string, number, number][];
}

const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * The `count` latest periods of a kind that end at or before `untilH` (hour index), newest first:
 * [start hour, end hour, key].
 */
export function periods(kind: RecapKind, untilH: number, count: number): [number, number, string][] {
  const out: [number, number, string][] = [];
  const t = untilH * HOUR;
  const d = new Date(t * 1000);
  if (kind === "monthly") {
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    if (Date.UTC(y, m, 1, POST_HOUR_UTC) / 1000 > t) m--;
    for (let i = 0; i < count; i++, m--) {
      const end = Date.UTC(y, m, 1, POST_HOUR_UTC) / 1000;
      const start = Date.UTC(y, m - 1, 1, POST_HOUR_UTC) / 1000;
      out.push([start / HOUR, end / HOUR, new Date(start * 1000).toISOString().slice(0, 7)]);
    }
    return out;
  }
  let end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), POST_HOUR_UTC) / 1000;
  if (end > t) end -= 86_400;
  if (kind === "weekly") while (new Date(end * 1000).getUTCDay() !== 1) end -= 86_400;
  const len = kind === "daily" ? 86_400 : 7 * 86_400;
  for (let i = 0; i < count; i++, end -= len) out.push([(end - len) / HOUR, end / HOUR, isoDay(end)]);
  return out;
}

/** The period's recap with its kind, key and index rebalancing dates. */
export function finishRecap(file: WeeklyFile, kind: RecapKind, key: string): RecapFile {
  const next = nextRebalance(file.end);
  return { ...file, kind, key, rebalance: { last: lastRebalance(file.end), next: next.at, quarterly: next.quarterly } };
}

/** Add a period to the list (newest first, no duplicates) and return the keys dropped beyond KEEP. */
export function addToList(list: RecapList, kind: RecapKind, entry: [string, number, number]): string[] {
  const rows = list[kind].filter(([k]) => k !== entry[0]);
  rows.push(entry);
  rows.sort((a, b) => b[2] - a[2]);
  list[kind] = rows.slice(0, KEEP[kind]);
  return rows.slice(KEEP[kind]).map(([k]) => k);
}

function main(): void {
  const dataDir = process.argv[2]!;
  const ctx = loadContext(dataDir);
  mkdirSync(join(dataDir, "weekly"), { recursive: true });
  for (const { id: house, faction } of ctx.houses) {
    const started = Date.now();
    const input = loadHouse(dataDir, ctx, house, faction);
    const weekly = buildWeekly(input);
    if (!weekly) continue;
    writeFileSync(join(dataDir, "weekly", `${house}.json`), JSON.stringify(weekly));
    const dir = join(dataDir, "recap", String(house));
    mkdirSync(dir, { recursive: true });
    const listPath = join(dir, "list.json");
    const list: RecapList = existsSync(listPath) ? readJson<RecapList>(listPath) : { v: 1, daily: [], weekly: [], monthly: [] };
    const latestH = weekly.end / HOUR;
    const made: string[] = [];
    for (const kind of KINDS) {
      // Newest missing period first; one a run.
      const missing = periods(kind, latestH, LOOKBACK[kind]).find(([, endH, key]) => endH * HOUR > FIRST_END && !existsSync(join(dir, `${kind}-${key}.json`)));
      if (!missing) continue;
      const [startH, endH, key] = missing;
      const file = buildRecap(input, startH, endH);
      if (!file) continue;
      writeFileSync(join(dir, `${kind}-${key}.json`), JSON.stringify(finishRecap(file, kind, key)));
      for (const old of addToList(list, kind, [key, startH * HOUR, endH * HOUR])) rmSync(join(dir, `${kind}-${old}.json`), { force: true });
      made.push(`${kind} ${key}`);
    }
    // Files no longer in the list (pruned) are removed, so R2 deletes them too.
    const listed = new Set(KINDS.flatMap((k) => list[k].map(([key]) => `${k}-${key}.json`)));
    for (const f of readdirSync(dir)) if (f !== "list.json" && f.endsWith(".json") && !listed.has(f)) rmSync(join(dir, f), { force: true });
    writeFileSync(listPath, JSON.stringify(list));
    console.log(`recaps ${house}: weekly ${weeklyLog(weekly)}; new ${made.length ? made.join(", ") : "none"} (${Date.now() - started} ms)`);
  }
}

if (process.argv[1]?.endsWith("recaps.ts")) main();
