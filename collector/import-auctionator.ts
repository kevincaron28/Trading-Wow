/**
 * One-off import of Auctionator scans (WoW Forever, realm "PvP", Horde) as genuine daily history from before Goldline
 * started collecting (18 Nov 2026).
 *
 *   node collector/import-auctionator.ts <Auctionator.lua> <dataDir> <houseId> "<source label>" [--merge]
 *
 * Auctionator keeps, per item and per scan day, the lowest buyout it saw (h = highest of the day's minimums,
 * l = lowest when different) and the quantity available (a). Days are counted from 1 Jan 2020. Nothing is
 * interpolated: only days that were actually scanned are written, and only days from WoW Forever's launch (4 Nov 2026)
 * up to the day before collection started. Only the price database is read: no character names, no other fields.
 *
 * With --merge the existing seed is kept and wins on any item-day it already has (dedupe); the new file only adds the
 * days the existing seed lacks. Each row's 5th value is the index of its source in meta.sources.
 * Output: seed/{house}/{itemId % 256}.json and seed/{house}.meta.json (see docs/DATA.md).
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Minimal CBOR decoder (RFC 8949): unsigned/negative ints, byte/text strings, arrays, maps, simple values, floats. */
export function decodeCbor(bytes: Uint8Array): unknown {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readLength = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return bytes[pos++]!;
    if (info === 25) { const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { const v = view.getUint32(pos); pos += 4; return v; }
    if (info === 27) { const v = Number(view.getBigUint64(pos)); pos += 8; return v; }
    throw new Error(`CBOR: indefinite or reserved length at ${pos}`);
  };
  const item = (): unknown => {
    const head = bytes[pos++]!;
    const major = head >> 5;
    const info = head & 31;
    switch (major) {
      case 0: return readLength(info);
      case 1: return -1 - readLength(info);
      // Byte strings: Auctionator writes its keys and day numbers this way; read them as Latin-1 text.
      case 2: { const n = readLength(info); const v = String.fromCharCode(...bytes.subarray(pos, pos + n)); pos += n; return v; }
      case 3: { const n = readLength(info); const v = new TextDecoder().decode(bytes.subarray(pos, pos + n)); pos += n; return v; }
      case 4: { const n = readLength(info); return Array.from({ length: n }, item); }
      case 5: {
        const n = readLength(info);
        const out: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) { const k = item(); out[String(k)] = item(); }
        return out;
      }
      case 7: {
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22 || info === 23) return null;
        if (info === 25) { const v = view.getFloat16 ? view.getFloat16(pos) : NaN; pos += 2; return v; }
        if (info === 26) { const v = view.getFloat32(pos); pos += 4; return v; }
        if (info === 27) { const v = view.getFloat64(pos); pos += 8; return v; }
        throw new Error(`CBOR: simple value ${info} at ${pos}`);
      }
      default: throw new Error(`CBOR: major type ${major} at ${pos}`);
    }
  };
  return item();
}

/** Decode a Lua double-quoted string literal body (as written in SavedVariables) to raw bytes. */
export function luaStringBytes(body: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    if (c !== 92) { out.push(c & 255); continue; }
    const next = body[i + 1]!;
    const digits = body.slice(i + 1).match(/^\d{1,3}/);
    if (digits) { out.push(Number(digits[0]) & 255); i += digits[0].length; continue; }
    const map: Record<string, number> = { n: 10, r: 13, t: 9, a: 7, b: 8, f: 12, v: 11, "\\": 92, '"': 34, "'": 39, "\n": 10 };
    out.push(map[next] ?? next.charCodeAt(0));
    i += 1;
  }
  return Uint8Array.from(out);
}

/** Auctionator day number (days since 1 Jan 2020) to a unix day index (days since 1 Jan 1970). */
export const AUCTIONATOR_DAY0 = Date.UTC(2020, 0, 1) / 86_400_000;
/** WoW Forever launched 4 Nov 2026; Goldline's own collection started 18 Nov 2026 (unix day indexes). */
export const FOREVER_LAUNCH_DAY = Date.UTC(2026, 10, 4) / 86_400_000;
export const COLLECTION_START_DAY = Date.UTC(2026, 10, 18) / 86_400_000;

/** [unix day index, lowest buyout low, lowest buyout high, quantity available or -1, source index]. */
export type SeedRow = [number, number, number, number] | [number, number, number, number, number];

/** Daily rows [unix day index, lowest buyout low, lowest buyout high, quantity available] per numeric item ID. */
export function seedRows(db: Record<string, unknown>): Map<number, SeedRow[]> {
  const out = new Map<number, SeedRow[]>();
  for (const [key, value] of Object.entries(db)) {
    if (!/^\d+$/.test(key) || !value || typeof value !== "object") continue;
    const v = value as { h?: Record<string, number>; l?: Record<string, number> | unknown[]; a?: Record<string, number> };
    const highs = v.h && !Array.isArray(v.h) ? v.h : {};
    const lows = v.l && !Array.isArray(v.l) ? (v.l as Record<string, number>) : {};
    const avail = v.a && !Array.isArray(v.a) ? v.a : {};
    const rows: SeedRow[] = [];
    for (const [dayKey, high] of Object.entries(highs)) {
      const day = Number(dayKey);
      if (!Number.isInteger(day) || typeof high !== "number" || high <= 0) continue;
      const low = typeof lows[dayKey] === "number" && lows[dayKey]! > 0 ? Math.min(lows[dayKey]!, high) : high;
      rows.push([AUCTIONATOR_DAY0 + day, low, high, typeof avail[dayKey] === "number" ? avail[dayKey]! : -1]);
    }
    if (rows.length) out.set(Number(key), rows.sort((a, b) => a[0] - b[0]));
  }
  return out;
}

/**
 * Add `incoming` (tagged with `source`) to `existing`: keeps only days in [from, until), and an item-day already in
 * `existing` is never replaced (the earlier source wins). Existing rows without a source get source 0.
 */
export function mergeSeed(
  existing: Map<number, SeedRow[]>,
  incoming: Map<number, SeedRow[]>,
  source: number,
  from = FOREVER_LAUNCH_DAY,
  until = COLLECTION_START_DAY,
): { rows: Map<number, SeedRow[]>; added: number; skipped: number } {
  const rows = new Map<number, SeedRow[]>();
  for (const [id, r] of existing) rows.set(id, r.map((x) => [x[0], x[1], x[2], x[3], x[4] ?? 0] as SeedRow));
  let added = 0;
  let skipped = 0;
  for (const [id, r] of incoming) {
    const have = rows.get(id) ?? [];
    const days = new Set(have.map((x) => x[0]));
    for (const x of r) {
      if (x[0] < from || x[0] >= until || days.has(x[0])) { skipped++; continue; }
      have.push([x[0], x[1], x[2], x[3], source]);
      days.add(x[0]);
      added++;
    }
    if (have.length) rows.set(id, have.sort((a, b) => a[0] - b[0]));
  }
  return { rows, added, skipped };
}

interface SeedMeta {
  sources?: { label: string }[];
  source?: string;
}

function readPriceDatabase(file: string): Record<string, unknown> {
  const text = readFileSync(file, "latin1");
  const start = text.indexOf('["PvP"] = "');
  if (start < 0) throw new Error('no ["PvP"] entry in AUCTIONATOR_PRICE_DATABASE');
  let i = start + '["PvP"] = "'.length;
  let body = "";
  for (; i < text.length; i++) {
    if (text[i] === "\\") { body += text[i]! + text[i + 1]!; i++; continue; }
    if (text[i] === '"') break;
    body += text[i];
  }
  return decodeCbor(luaStringBytes(body)) as Record<string, unknown>;
}

const dateOf = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);

function main(): void {
  const args = process.argv.slice(2);
  const merge = args.includes("--merge");
  const [file, dataDir, house, label] = args.filter((a) => a !== "--merge");
  if (!file || !dataDir || !house || !label) throw new Error('usage: import-auctionator.ts <Auctionator.lua> <dataDir> <houseId> "<source label>" [--merge]');
  const dir = join(dataDir, "seed", house);
  const metaFile = join(dataDir, "seed", `${house}.meta.json`);

  const existing = new Map<number, SeedRow[]>();
  let sources: { label: string }[] = [];
  if (merge && existsSync(metaFile)) {
    const meta = JSON.parse(readFileSync(metaFile, "utf8")) as SeedMeta;
    sources = meta.sources ?? [{ label: meta.source ?? "earlier scans" }];
    for (let s = 0; s < 256; s++) {
      const f = join(dir, `${s}.json`);
      if (!existsSync(f)) continue;
      for (const [id, r] of Object.entries((JSON.parse(readFileSync(f, "utf8")) as { items: Record<string, SeedRow[]> }).items)) existing.set(Number(id), r);
    }
  }
  const sourceIndex = sources.length;
  sources.push({ label });
  const { rows, added, skipped } = mergeSeed(existing, seedRows(readPriceDatabase(file)), sourceIndex);

  const shards = new Map<number, Record<string, SeedRow[]>>();
  const perSource = sources.map(() => new Map<number, number>());
  for (const [id, r] of rows) {
    const s = id % 256;
    if (!shards.has(s)) shards.set(s, {});
    shards.get(s)![id] = r;
    for (const row of r) {
      const m = perSource[row[4] ?? 0]!;
      m.set(row[0], (m.get(row[0]) ?? 0) + 1);
    }
  }
  mkdirSync(dir, { recursive: true });
  for (let s = 0; s < 256; s++) writeFileSync(join(dir, `${s}.json`), JSON.stringify({ items: shards.get(s) ?? {} }));
  const allDays = new Map<number, number>();
  for (const m of perSource) for (const [d, n] of m) allDays.set(d, (allDays.get(d) ?? 0) + n);
  writeFileSync(
    metaFile,
    JSON.stringify({
      source: sources.map((s) => s.label).join("; "),
      measure: "lowest buyout seen that day (low and high of the day's minimums) and quantity available",
      sources: sources.map((s, i) => ({
        label: s.label,
        days: [...perSource[i]!].sort((a, b) => a[0] - b[0]).map(([d, n]) => ({ day: d, date: dateOf(d), items: n })),
      })),
      days: [...allDays].sort((a, b) => a[0] - b[0]).map(([d, n]) => ({ day: d, date: dateOf(d), items: n })),
      items: rows.size,
    }),
  );
  console.log(`added ${added} item-days, skipped ${skipped} (outside ${dateOf(FOREVER_LAUNCH_DAY)}..${dateOf(COLLECTION_START_DAY - 1)} or already present); items ${rows.size}`);
  sources.forEach((s, i) => console.log(`${i} ${s.label}: ${[...perSource[i]!].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${dateOf(d)}:${n}`).join(" ")}`));
}

if (process.argv[1]?.endsWith("import-auctionator.ts")) main();
