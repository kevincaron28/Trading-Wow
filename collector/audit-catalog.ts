/**
 * Item catalogue audit: every item ID Goldline has ever seen or can price, compared with items.json, and an optional
 * fill of the missing ones from Blizzard's static data.
 *
 *   node --env-file=.env collector/audit-catalog.ts <dataDir> [--ahprice <dir of ahprice export CSVs>] [--tsm <TradeSkillMaster.lua>] [--fill]
 *
 * Sources: every item in any house's history (h2/), the Auctionator seed (seed/), the ahprice.com series (ext/), the
 * ahprice.com price exports (one CSV per market; item_id and name only) and item IDs in a TSM SavedVariables file
 * (only the item IDs are read: no names, players or prices).
 * --fill asks Blizzard for each missing item in static-forever, then static-classic1x, static-classic and the retail
 * static namespace; when none has it, the English name from the ahprice.com export is used with no icon. Rows are
 * [en, fr, quality, class, subclass, icon] as in items.json. Writes audit/catalog.json (summary) in the data dir.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type CatalogRow = [string, string, number, number, number, string];
const REGION = "us";
const NAMESPACES = [`static-forever-${REGION}`, `static-classic1x-${REGION}`, `static-classic-${REGION}`, `static-${REGION}`];
const QUALITY: Record<string, number> = { POOR: 0, COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5, ARTIFACT: 6 };

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);

/** Item IDs per source. */
export function itemIdsFromShards(dir: string): Set<number> {
  const ids = new Set<number>();
  if (!existsSync(dir)) return ids;
  for (const house of readdirSync(dir)) {
    const hdir = join(dir, house);
    if (!/^\d+$/.test(house)) continue;
    for (const f of readdirSync(hdir)) {
      if (!f.endsWith(".json")) continue;
      for (const id of Object.keys((readJson<{ items?: Record<string, unknown> }>(join(hdir, f), {}).items ?? {}))) ids.add(Number(id));
    }
  }
  return ids;
}

/** item_id,name,... rows of an ahprice.com export (names can contain commas inside quotes). */
export function parseAhpriceCsv(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = line.match(/^(\d+),("(?:[^"]|"")*"|[^,]*),/);
    if (m) out.set(Number(m[1]), m[2]!.replace(/^"|"$/g, "").replace(/""/g, '"'));
  }
  return out;
}

/**
 * Item IDs that were really traded in a TSM SavedVariables file: the "i:12345" item strings inside its accounting logs
 * (csvSales, csvBuys, csvCancelled, csvExpired). TSM also lists every item of its own database, which says nothing about
 * this auction house, so the rest of the file is ignored. Only item IDs are read: no names, players or prices.
 */
export function tsmItemIds(text: string): Set<number> {
  const ids = new Set<number>();
  for (const log of text.matchAll(/@internalData@csv(?:Sales|Buys|Cancelled|Expired)"\]\s*=\s*"((?:[^"\\]|\\.)*)"/g))
    // Rows are separated by a literal "\n" in the saved string, so "i:" may follow a letter: no word boundary.
    for (const m of log[1]!.matchAll(/i:(\d{1,7})\b/g)) ids.add(Number(m[1]));
  return ids;
}

async function token(): Promise<string> {
  const id = process.env.BNET_CLIENT_ID;
  const secret = process.env.BNET_CLIENT_SECRET;
  if (!id || !secret) throw new Error("BNET_CLIENT_ID and BNET_CLIENT_SECRET are required");
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function api<T>(bearer: string, path: string, namespace: string): Promise<{ status: number; body: T | null }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://${REGION}.api.blizzard.com${path}?namespace=${namespace}`, { headers: { Authorization: `Bearer ${bearer}` } });
      if ((res.status === 429 || res.status >= 500) && attempt < 5) { await new Promise((r) => setTimeout(r, 1_000 * attempt * attempt)); continue; }
      return { status: res.status, body: res.ok ? ((await res.json()) as T) : null };
    } catch (error) {
      if (attempt >= 5) throw error;
      await new Promise((r) => setTimeout(r, 1_000 * attempt * attempt));
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dataDir = args[0]!;
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const fill = args.includes("--fill");
  const catalog = readJson<Record<string, CatalogRow>>(join(dataDir, "items.json"), {});
  const before = Object.keys(catalog).length;

  const sources: Record<string, Set<number>> = {
    snapshots: itemIdsFromShards(join(dataDir, "h2")),
    auctionatorSeed: itemIdsFromShards(join(dataDir, "seed")),
    ahpriceSeries: itemIdsFromShards(join(dataDir, "ext", "ahprice")),
  };
  const ahNames = new Map<number, string>();
  const ahDir = opt("--ahprice");
  if (ahDir) {
    const ids = new Set<number>();
    for (const f of readdirSync(ahDir).filter((x) => x.endsWith(".csv"))) for (const [id, name] of parseAhpriceCsv(readFileSync(join(ahDir, f), "utf8"))) { ids.add(id); if (name) ahNames.set(id, name); }
    sources.ahpriceExports = ids;
  }
  const tsm = opt("--tsm");
  if (tsm) sources.tsm = tsmItemIds(readFileSync(tsm, "latin1"));

  const all = new Set<number>();
  for (const s of Object.values(sources)) for (const id of s) all.add(id);
  const missing = [...all].filter((id) => !catalog[id]).sort((a, b) => a - b);
  const missingBySource = Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, [...s].filter((id) => !catalog[id]).length]));
  console.log(`catalog ${before}; ids from all sources ${all.size}; missing ${missing.length}`, missingBySource);

  const filled: Record<string, number> = {};
  const unresolved: number[] = [];
  if (fill && missing.length) {
    const bearer = await token();
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < missing.length) {
        const id = missing[next++]!;
        type ItemBody = { name?: Record<string, string>; quality?: { type?: string }; item_class?: { id: number }; item_subclass?: { id: number } };
        let found: { ns: string; body: ItemBody } | null = null;
        for (const ns of NAMESPACES) {
          const r = await api<ItemBody>(bearer, `/data/wow/item/${id}`, ns);
          if (r.body?.name?.en_US) { found = { ns, body: r.body }; break; }
        }
        if (found) {
          const media = await api<{ assets?: { key: string; value: string }[] }>(bearer, `/data/wow/media/item/${id}`, found.ns);
          const url = media.body?.assets?.find((a) => a.key === "icon")?.value ?? "";
          const icon = url ? url.slice(url.lastIndexOf("/") + 1).replace(/\.jpg$/, "") : "";
          const b = found.body;
          catalog[id] = [b.name!.en_US!, b.name!.fr_FR ?? b.name!.en_US!, QUALITY[b.quality?.type ?? ""] ?? 1, b.item_class?.id ?? -1, b.item_subclass?.id ?? -1, icon];
          filled[found.ns] = (filled[found.ns] ?? 0) + 1;
        } else if (ahNames.get(id)) {
          catalog[id] = [ahNames.get(id)!, ahNames.get(id)!, 1, -1, -1, ""];
          filled["ahprice name only"] = (filled["ahprice name only"] ?? 0) + 1;
        } else unresolved.push(id);
      }
    }));
    writeFileSync(join(dataDir, "items.json"), JSON.stringify(catalog));
  }
  const rows = Object.entries(catalog);
  const summary = {
    when: new Date().toISOString(),
    before,
    after: rows.length,
    sources: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, s.size])),
    missingBySource,
    filled,
    unresolved,
    noName: rows.filter(([, r]) => !r[0]).map(([id]) => Number(id)),
    noIcon: rows.filter(([, r]) => !r[5]).map(([id]) => Number(id)),
    noFrenchName: rows.filter(([, r]) => !r[1] || r[1] === r[0]).length,
  };
  mkdirSync(join(dataDir, "audit"), { recursive: true });
  writeFileSync(join(dataDir, "audit", "catalog.json"), JSON.stringify(summary));
  console.log(JSON.stringify({ ...summary, noIcon: summary.noIcon.length, noName: summary.noName.length, unresolved: summary.unresolved.length }));
}

if (process.argv[1]?.endsWith("audit-catalog.ts")) await main();
