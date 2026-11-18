/**
 * One-off import of the owner's own Auctionator scans (WoW Forever, realm "PvP", Horde characters only) as
 * genuine daily history from before Goldline started collecting (18 Nov 2026).
 *
 *   node collector/import-auctionator.ts <Auctionator.lua> <dataDir> <houseId>
 *
 * Auctionator keeps, per item and per scan day, the lowest buyout it saw (h = highest of the day's minimums,
 * l = lowest when different) and the quantity available (a). Days are counted from 1 Jan 2020. Nothing is
 * interpolated: only days that were actually scanned are written. Output: seed/{house}/{itemId % 256}.json
 * (see docs/DATA.md).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
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

export type SeedRow = [number, number, number, number];

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

function main(): void {
  const [file, dataDir, house] = process.argv.slice(2);
  if (!file || !dataDir || !house) throw new Error("usage: import-auctionator.ts <Auctionator.lua> <dataDir> <houseId>");
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
  const db = decodeCbor(luaStringBytes(body)) as Record<string, unknown>;
  const rows = seedRows(db);
  const shards = new Map<number, Record<string, SeedRow[]>>();
  const dayCounts = new Map<number, number>();
  for (const [id, r] of rows) {
    const s = id % 256;
    if (!shards.has(s)) shards.set(s, {});
    shards.get(s)![id] = r;
    for (const row of r) dayCounts.set(row[0], (dayCounts.get(row[0]) ?? 0) + 1);
  }
  const dir = join(dataDir, "seed", house);
  mkdirSync(dir, { recursive: true });
  for (let s = 0; s < 256; s++) writeFileSync(join(dir, `${s}.json`), JSON.stringify({ items: shards.get(s) ?? {} }));
  const days = [...dayCounts].sort((a, b) => a[0] - b[0]);
  writeFileSync(
    join(dataDir, "seed", `${house}.meta.json`),
    JSON.stringify({
      source: "Auctionator scans by the owner (WoW Forever, PvP, Horde)",
      measure: "lowest buyout seen that day (low and high of the day's minimums) and quantity available",
      days: days.map(([d, n]) => ({ day: d, date: new Date(d * 86_400_000).toISOString().slice(0, 10), items: n })),
      items: rows.size,
    }),
  );
  console.log(`items ${rows.size}; days ${days.map(([d, n]) => `${new Date(d * 86_400_000).toISOString().slice(0, 10)}:${n}`).join(" ")}`);
}

if (process.argv[1]?.endsWith("import-auctionator.ts")) main();
