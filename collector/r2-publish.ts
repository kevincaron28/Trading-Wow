/**
 * Publish the price files to Cloudflare R2 (the app reads them from there; the `data` branch on GitHub stays a copy
 * until R2 is confirmed). Run by collector/publish.sh after each collection when R2 is configured; the first time with
 * --full (docs/R2_DATA.md):
 *
 *   node collector/r2-publish.ts <dataDir> [--full] [--dry-run]
 *
 * What goes to R2 (gzip, Content-Encoding: gzip, with Cache-Control):
 * - meta.json, items.json, latest/, index/ (with index/legacy/, the series before method 4), weekly/, recap/, early/:
 *   as on the data branch;
 * - early-h/ (hourly prices before our own collection): compacted, hours older than COMPACT_AFTER_DAYS are dropped
 *   (the daily values in early/ keep those days); our own hourly prices are already kept 14 days, then daily;
 * - h64/{house}/{itemId % 64}.json: the item histories in 64 files per house instead of 256 (h2/), to keep uploads
 *   inside R2's free 1 million writes a month (all history files change every hour).
 * Not uploaded: history/ (the old duplicate layout), the raw sources (tsm/, ext/, seed/, audit/) and state/.
 * Only changed files are uploaded (sha-256 per file in state/r2-manifest.json); files that disappeared are deleted.
 * meta.json goes last, so the app never sees a new snapshot time before the files behind it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { deleteObject, putObject, r2ConfigFromEnv } from "./r2.ts";

export const R2_SHARDS = 64;
/** Early hourly prices are kept this many days, then only their daily value (early/) remains. */
export const COMPACT_AFTER_DAYS = 30;
const SHORT_CACHE = "public, max-age=300";
const LONG_CACHE = "public, max-age=86400";
const HOUR = 3_600;

export interface R2File {
  key: string;
  /** JSON text (uncompressed), or null when the file has nothing left to publish (deleted from R2). Read lazily. */
  text: () => string | null;
  cache: string;
}

/** Early hourly rows [hour, market, min, quantity] newer than `days` before `now` (unix seconds). */
export function compactEarlyHourly(rows: number[][], now: number, days: number = COMPACT_AFTER_DAYS): number[][] {
  const minHour = Math.floor((now - days * 86_400) / HOUR);
  return rows.filter((r) => r[0]! >= minHour);
}

/** One h64 file from the h2 shards whose number is congruent to it modulo 64. */
export function mergeShards(shards: { items: Record<string, unknown> }[]): { v: 1; items: Record<string, unknown> } {
  const items: Record<string, unknown> = {};
  for (const s of shards) Object.assign(items, s.items);
  return { v: 1, items };
}

const readText = (path: string) => readFileSync(path, "utf8");
const jsonFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []);

/** Every file R2 should hold, from a data branch checkout. */
export function listFiles(dataDir: string, now: number = Date.now() / 1000): R2File[] {
  const out: R2File[] = [];
  const asIs = (rel: string, cache: string) => out.push({ key: rel, text: () => readText(join(dataDir, rel)), cache });
  if (existsSync(join(dataDir, "items.json"))) asIs("items.json", SHORT_CACHE);
  for (const dir of ["latest", "index", "index/legacy", "weekly"]) for (const f of jsonFiles(join(dataDir, dir))) asIs(`${dir}/${f}`, SHORT_CACHE);
  // Daily, weekly and monthly recaps (collector/recaps.ts): recap/<house>/list.json and one file per period.
  for (const house of readdirSafe(join(dataDir, "recap"))) for (const f of jsonFiles(join(dataDir, "recap", house))) asIs(`recap/${house}/${f}`, SHORT_CACHE);
  for (const house of readdirSafe(join(dataDir, "early"))) {
    for (const f of jsonFiles(join(dataDir, "early", house))) asIs(`early/${house}/${f}`, LONG_CACHE);
  }
  for (const house of readdirSafe(join(dataDir, "early-h"))) {
    for (const f of jsonFiles(join(dataDir, "early-h", house))) {
      const path = join(dataDir, "early-h", house, f);
      out.push({
        key: `early-h/${house}/${f}`,
        text: () => {
          const file = JSON.parse(readText(path)) as { items: Record<string, number[][]> };
          const items: Record<string, number[][]> = {};
          for (const [id, rows] of Object.entries(file.items)) {
            const kept = compactEarlyHourly(rows, now);
            if (kept.length) items[id] = kept;
          }
          return Object.keys(items).length ? JSON.stringify({ ...file, items }) : null;
        },
        cache: LONG_CACHE,
      });
    }
  }
  for (const house of readdirSafe(join(dataDir, "h2"))) {
    const shards = jsonFiles(join(dataDir, "h2", house)).map((f) => Number(f.replace(".json", ""))).filter(Number.isInteger);
    for (let k = 0; k < R2_SHARDS; k++) {
      const parts = shards.filter((s) => s % R2_SHARDS === k);
      if (!parts.length) continue;
      out.push({
        key: `h64/${house}/${k}.json`,
        text: () => JSON.stringify(mergeShards(parts.map((s) => JSON.parse(readText(join(dataDir, "h2", house, `${s}.json`))) as { items: Record<string, unknown> }))),
        cache: SHORT_CACHE,
      });
    }
  }
  // Last: the app reads meta.json to learn that a new snapshot is out.
  if (existsSync(join(dataDir, "meta.json"))) asIs("meta.json", SHORT_CACHE);
  return out;
}

function readdirSafe(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
}

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

async function main(): Promise<void> {
  const dataDir = process.argv[2];
  if (!dataDir) throw new Error("usage: node collector/r2-publish.ts <dataDir> [--full] [--dry-run]");
  const full = process.argv.includes("--full");
  const dry = process.argv.includes("--dry-run");
  const cfg = r2ConfigFromEnv();
  if (!cfg && !dry) throw new Error("R2 is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)");
  const started = Date.now();
  const manifestPath = join(dataDir, "state", "r2-manifest.json");
  const old: Record<string, string> = full || !existsSync(manifestPath) ? {} : (JSON.parse(readText(manifestPath)) as Record<string, string>);
  const next: Record<string, string> = {};
  const files = listFiles(dataDir);
  const meta = files.find((f) => f.key === "meta.json");
  let uploaded = 0;
  let bytes = 0;
  const upload = async (f: R2File) => {
    const text = f.text();
    if (text == null) return;
    const hash = createHash("sha256").update(text).digest("hex");
    if (old[f.key] === hash) {
      next[f.key] = hash;
      return;
    }
    const body = gzipSync(text, { level: 7 });
    if (!dry) await putObject(cfg!, f.key, body, { "content-type": "application/json; charset=utf-8", "content-encoding": "gzip", "cache-control": f.cache });
    next[f.key] = hash;
    uploaded++;
    bytes += body.length;
  };
  let failed = 0;
  const tryUpload = async (f: R2File) => {
    try {
      await upload(f);
    } catch (error) {
      if (++failed <= 5) console.error(error instanceof Error ? error.message : error);
    }
  };
  await pool(files.filter((f) => f !== meta), 4, tryUpload);
  // meta.json only when everything behind it is in place; otherwise the next run retries the rest first.
  if (meta && !failed) await tryUpload(meta);
  // Files that are no longer published (for example compacted early hours): delete them from R2.
  const gone = failed ? [] : Object.keys(old).filter((key) => !(key in next));
  if (!dry) await pool(gone, 8, (key) => deleteObject(cfg!, key));
  // Keep what was uploaded even after a failure, so the next run only sends the rest.
  const keep = failed ? { ...old, ...next } : next;
  if (!dry) {
    mkdirSync(join(dataDir, "state"), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(keep));
  }
  console.log(`r2${dry ? " (dry run)" : ""}: ${Object.keys(next).length} files, ${uploaded} uploaded (${Math.round(bytes / 1024)} KB gzip), ${Object.keys(next).length - uploaded} unchanged, ${gone.length} deleted in ${Math.round((Date.now() - started) / 1000)} s`);
  if (failed) {
    console.error(`r2: ${failed} file(s) failed; they are sent again next run`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("r2-publish.ts")) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
