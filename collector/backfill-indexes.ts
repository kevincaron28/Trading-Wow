/**
 * Rebuild every index of every house from the first day of data with method 4 (docs/INDEXES.md), and switch the houses
 * to it: collector/indexes.ts keeps a method-4 house on method 4 at every later run.
 *
 *   node collector/backfill-indexes.ts <dataDir>               rebuild in place (the old files go to index/legacy/)
 *   node collector/backfill-indexes.ts <dataDir> --out <dir>   write the new files to <dir>/index only (a preview)
 *   --now <unix seconds>   the time to build for (default: the data's own update time, so a rerun gives the same files)
 *
 * Nothing is deleted. The files replaced are first copied to index/legacy/ and an archived file is never overwritten,
 * so index/legacy/ keeps the series as it was before the first run, however often the script is run again.
 * It must run while the hourly history still starts on 18 November (hourly rows are kept 14 days): afterwards it
 * refuses, because it could no longer rebuild the first days.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildHouse4, describeHouse, indexMeta, readCatalog, readDaily, readSeries } from "./indexes.ts";
import { FIRST_OWN_HOUR, prepare } from "./index-v4.ts";

export interface BackfillResult { files: Map<string, string>; log: string[] }

/** The backfilled files (path under the data folder -> text), without writing anything. */
export function backfill(dataDir: string, now?: number): BackfillResult {
  const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8")) as { updated: number; houses: { id: number }[] };
  const at = now ?? meta.updated;
  const catalog = readCatalog(dataDir);
  const files = new Map<string, string>();
  const log: string[] = [];
  for (const { id: house } of meta.houses) {
    const data = prepare({ hourly: readSeries(dataDir, house), daily: readDaily(dataDir, house) });
    if (data.firstHour * 3_600 > FIRST_OWN_HOUR) {
      throw new Error(`house ${house}: the hourly history starts at ${new Date(data.firstHour * 3_600_000).toISOString()}, after our first hours (18 Nov). The series can no longer be rebuilt from the start; nothing was written.`);
    }
    const indexes = buildHouse4({}, data, catalog, at);
    files.set(`index/${house}.json`, JSON.stringify({ house, updated: at, indexes }));
    log.push(describeHouse(house, indexes));
  }
  files.set("index/meta.json", JSON.stringify(indexMeta(at, true)));
  return { files, log };
}

/** Write the files into `target`, archiving what they replace under index/legacy/ (once). Returns the files archived. */
export function writeBackfill(target: string, files: Map<string, string>): string[] {
  const legacy = join(target, "index", "legacy");
  mkdirSync(legacy, { recursive: true });
  const archived: string[] = [];
  // A house file already on method 4 is a previous run's output, not the old series.
  const isNew = (path: string) => (JSON.parse(readFileSync(path, "utf8")) as { method?: number; indexes?: Record<string, { method?: number }> });
  for (const rel of files.keys()) {
    const from = join(target, rel);
    const to = join(legacy, rel.slice("index/".length));
    if (!existsSync(from) || existsSync(to)) continue;
    const old = isNew(from);
    if (old.method === 4 || Object.values(old.indexes ?? {}).some((x) => x.method === 4)) continue;
    copyFileSync(from, to);
    archived.push(rel);
  }
  for (const [rel, text] of files) writeFileSync(join(target, rel), text);
  return archived;
}

function main(): void {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const out = flag("--out");
  const now = flag("--now");
  const dataDir = args[0];
  if (!dataDir) throw new Error("usage: node collector/backfill-indexes.ts <dataDir> [--out <dir>] [--now <unix seconds>]");
  const result = backfill(dataDir, now ? Number(now) : undefined);
  const target = out ?? dataDir;
  const archived = writeBackfill(target, result.files);
  for (const line of result.log) console.log(line);
  console.log(`wrote ${result.files.size} files to ${join(target, "index")}${archived.length ? `; ${archived.length} old files kept in index/legacy/` : ""}`);
}

if (process.argv[1]?.endsWith("backfill-indexes.ts")) main();
