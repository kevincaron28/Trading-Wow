/**
 * Goldline collector: fetch every WoW Forever auction house from Blizzard's Game Data API, summarize
 * each item and update the published price files in DATA_DIR (the checked-out `data` branch).
 *
 *   node --env-file=.env collector/collect.ts [dataDir]
 *
 * Needs BNET_CLIENT_ID and BNET_CLIENT_SECRET. Never writes them anywhere. Formats: docs/DATA.md.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  SHARDS,
  SHARDS_V2,
  addPoint,
  auctionState,
  estimateSold,
  shardOfV2,
  type AuctionState,
  type ItemHistory,
  emptyShard,
  latestRow,
  shardOf,
  snapshotHour,
  summarizeHouse,
  type LatestRow,
  type RawAuction,
  type Shard,
} from "./store.ts";

const REGION = "us";
const API = `https://${REGION}.api.blizzard.com`;
const DYNAMIC = `dynamic-forever-${REGION}`;
const STATIC = `static-forever-${REGION}`;
const FALLBACK_STATIC = `static-classic1x-${REGION}`;
/** Realm groups found by the 17 Nov 2026 probe (see docs/PLAN.md). Empty houses 112/115/118 are skipped. */
export const HOUSES: readonly { id: number; realm: string; faction: "alliance" | "horde" | "blackwater" }[] = [
  { id: 110, realm: "pvp", faction: "alliance" },
  { id: 113, realm: "pvp", faction: "horde" },
  { id: 116, realm: "pvp", faction: "blackwater" },
  { id: 111, realm: "b", faction: "alliance" },
  { id: 114, realm: "b", faction: "horde" },
  { id: 117, realm: "b", faction: "blackwater" },
  { id: 119, realm: "c", faction: "alliance" },
  { id: 120, realm: "c", faction: "horde" },
  { id: 121, realm: "c", faction: "blackwater" },
  { id: 123, realm: "d", faction: "alliance" },
  { id: 124, realm: "d", faction: "horde" },
  { id: 125, realm: "d", faction: "blackwater" },
];
/** New catalog entries fetched per run (two API calls each), so a first run stays well under the hourly quota. */
const CATALOG_PER_RUN = Number(process.env.GOLDLINE_CATALOG_PER_RUN ?? 6000);

type CatalogRow = [string, string, number, number, number, string];
interface Meta {
  v: 1;
  updated: number;
  iconBase: string;
  houses: { id: number; realm: string; faction: string; snapshot: number; lastModified: string | null; items: number }[];
}

const dataDir = process.argv[2] ?? "data-out";
const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

async function token(): Promise<string> {
  const id = process.env.BNET_CLIENT_ID;
  const secret = process.env.BNET_CLIENT_SECRET;
  if (!id || !secret) throw new Error("BNET_CLIENT_ID and BNET_CLIENT_SECRET are required");
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function api<T>(bearer: string, path: string, namespace: string, tries = 4): Promise<{ status: number; body: T | null; lastModified: string | null }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const sep = path.includes("?") ? "&" : "?";
      const res = await fetch(`${API}${path}${sep}namespace=${namespace}`, { headers: { Authorization: `Bearer ${bearer}` } });
      if ((res.status === 429 || res.status >= 500) && attempt < tries) {
        await new Promise((r) => setTimeout(r, 1_000 * attempt * attempt));
        continue;
      }
      const body = res.ok ? ((await res.json()) as T) : null;
      return { status: res.status, body, lastModified: res.headers.get("last-modified") };
    } catch (error) {
      if (attempt >= tries) throw error;
      await new Promise((r) => setTimeout(r, 1_000 * attempt * attempt));
    }
  }
}

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

async function main(): Promise<void> {
  const started = Date.now();
  const bearer = await token();
  const meta = readJson<Meta>(join(dataDir, "meta.json"), { v: 1, updated: 0, iconBase: "", houses: [] });
  const catalog = readJson<Record<string, CatalogRow>>(join(dataDir, "items.json"), {});
  const seen = new Set<number>();

  for (const house of HOUSES) {
    const base = `/data/wow/ruleset/1/auctions/${house.id}`;
    const [items, commodities] = await Promise.all([
      api<{ auctions?: RawAuction[] }>(bearer, base, DYNAMIC),
      api<{ auctions?: RawAuction[] }>(bearer, `${base}/commodities`, DYNAMIC),
    ]);
    if (items.status !== 200 && commodities.status !== 200) {
      log(`house ${house.id}: HTTP ${items.status}/${commodities.status}, skipped`);
      continue;
    }
    const auctions = [...(items.body?.auctions ?? []), ...(commodities.body?.auctions ?? [])];
    const lastModified = items.lastModified ?? commodities.lastModified;
    const time = snapshotHour(lastModified, Date.now() / 1_000);
    const previous = meta.houses.find((h) => h.id === house.id);
    const points = summarizeHouse(time, auctions);
    for (const id of points.keys()) seen.add(id);
    if (previous && previous.snapshot === time) {
      log(`house ${house.id}: snapshot ${new Date(time * 1000).toISOString()} already stored`);
      continue;
    }

    // Load every item's history: the v2 layout (256 files) if present, else migrate from v1 (32 files).
    const histories = new Map<string, ItemHistory>();
    const v2Dir = join(dataDir, "h2", String(house.id));
    const hasV2 = existsSync(join(v2Dir, "0.json"));
    const shardFiles = hasV2
      ? Array.from({ length: SHARDS_V2 }, (_, s) => join(v2Dir, `${s}.json`))
      : Array.from({ length: SHARDS }, (_, s) => join(dataDir, "history", String(house.id), `${s}.json`));
    for (const path of shardFiles) for (const [id, h] of Object.entries(readJson<Shard>(path, emptyShard()).items)) histories.set(id, h);

    // Estimated sales since the previous snapshot (state kept next to the data, never published).
    const statePath = join(dataDir, "state", `${house.id}.json`);
    const prevState = readJson<{ t: number; a: AuctionState } | null>(statePath, null);
    const sold = estimateSold(prevState?.a ?? null, prevState?.t ?? 0, auctions, time);
    writeJson(statePath, { t: time, a: auctionState(auctions) });

    for (const [id, point] of points) {
      const key = String(id);
      histories.set(key, addPoint(histories.get(key) ?? { h: [], d: [] }, point, time, sold ? (sold.get(id) ?? 0) : undefined));
    }

    // Write both layouts and the latest file.
    const latest: Record<string, LatestRow> = {};
    const v1: Shard[] = Array.from({ length: SHARDS }, emptyShard);
    const v2: Shard[] = Array.from({ length: SHARDS_V2 }, emptyShard);
    for (const [id, history] of histories) {
      v1[shardOf(Number(id))]!.items[id] = history;
      v2[shardOfV2(Number(id))]!.items[id] = history;
      // Items not listed this hour keep their history; their latest row shows the last time they were seen.
      const row = latestRow(history);
      if (row && history.h.at(-1)![0] * 3_600 > time - 3 * 86_400) latest[id] = row;
    }
    v1.forEach((shard, s) => writeJson(join(dataDir, "history", String(house.id), `${s}.json`), shard));
    v2.forEach((shard, s) => writeJson(join(v2Dir, `${s}.json`), shard));
    writeJson(join(dataDir, "latest", `${house.id}.json`), { t: time, items: latest });
    const entry = { id: house.id, realm: house.realm, faction: house.faction, snapshot: time, lastModified, items: points.size };
    meta.houses = [...meta.houses.filter((h) => h.id !== house.id), entry].sort((a, b) => a.id - b.id);
    log(`house ${house.id}: ${auctions.length} auctions, ${points.size} items, sold ${sold ? [...sold.values()].reduce((a, b) => a + b, 0) : "n/a"} @ ${new Date(time * 1000).toISOString()}`);
  }

  // Catalog: names (en/fr), quality, class, subclass and icon for items not seen before. Every recipe reagent and
  // crafted item is named too (0.13.1), even before it is first listed, so the Crafting card and search show names.
  const recipeFile = new URL("../src/data/recipes.json", import.meta.url);
  if (existsSync(recipeFile)) {
    const book = JSON.parse(readFileSync(recipeFile, "utf8")) as { recipes: [number, number, number, number, number, [number, number][]][] };
    for (const r of book.recipes) {
      seen.add(r[2]);
      for (const [id] of r[5]) seen.add(id);
    }
  }
  const missing = [...seen].filter((id) => !catalog[id]).slice(0, CATALOG_PER_RUN);
  let iconBase = meta.iconBase;
  let fetched = 0;
  let failed = 0;
  await pool(missing, 6, async (id) => {
    type ItemBody = { name?: Record<string, string>; quality?: { type?: string }; item_class?: { id: number }; item_subclass?: { id: number } };
    type MediaBody = { assets?: { key: string; value: string }[] };
    // Some vanilla items are only in the Classic Era static data, not Forever's: fall back on 404.
    let ns = STATIC;
    let item = await api<ItemBody>(bearer, `/data/wow/item/${id}`, ns, 6);
    if (item.status === 404) item = await api<ItemBody>(bearer, `/data/wow/item/${id}`, (ns = FALLBACK_STATIC), 6);
    const media = item.body ? await api<MediaBody>(bearer, `/data/wow/media/item/${id}`, ns, 6) : null;
    if (!item.body?.name) {
      failed++;
      return;
    }
    const iconUrl = media?.body?.assets?.find((a) => a.key === "icon")?.value ?? "";
    const slash = iconUrl.lastIndexOf("/");
    if (!iconBase && slash > 0) iconBase = iconUrl.slice(0, slash + 1);
    const icon = slash > 0 ? iconUrl.slice(slash + 1).replace(/\.jpg$/, "") : "";
    catalog[id] = [
      item.body.name.en_US ?? "",
      item.body.name.fr_FR ?? item.body.name.en_US ?? "",
      QUALITY[item.body.quality?.type ?? ""] ?? 1,
      item.body.item_class?.id ?? -1,
      item.body.item_subclass?.id ?? -1,
      icon,
    ];
    fetched++;
  });
  writeJson(join(dataDir, "items.json"), catalog);
  meta.updated = Math.floor(Date.now() / 1_000);
  meta.iconBase = iconBase;
  writeJson(join(dataDir, "meta.json"), meta);
  log(`catalog +${fetched}, ${failed} failed (total ${Object.keys(catalog).length}, ${Math.max(0, seen.size - Object.keys(catalog).length)} still missing); done in ${Math.round((Date.now() - started) / 1000)} s`);
}

const QUALITY: Record<string, number> = { POOR: 0, COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5, ARTIFACT: 6 };

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
