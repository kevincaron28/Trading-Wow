/**
 * Recipe table (0.13, 20 Nov 2026): every WoW Forever profession recipe that makes an item, with its reagents, from
 * Blizzard's Game Data API (static-forever namespace: profession → skill tier → recipe). Writes src/data/recipes.json,
 * which ships with the app (recipes are static game data; rerun after a game patch).
 *
 *   node --env-file=.env collector/build-recipes.ts
 *
 * Output: { built, namespace, recipes: [recipeId, professionId, craftedItemId, craftedMin, craftedMax, [[reagentId, qty]...]][],
 * vendor: { itemId: copper per unit } } where vendor lists the reagents merchants sell (VENDOR_REAGENTS below) at
 * Blizzard's purchase price. Enchantments (no crafted item) are left out.
 */
import { writeFileSync } from "node:fs";

const REGION = "us";
const NS = `static-forever-${REGION}`;
const API = `https://${REGION}.api.blizzard.com`;

/**
 * Reagents sold by trade-supply merchants in the original game (vials, threads, dyes, flux, salt, spices, stocks, rods,
 * water...). Their cost is the merchant price (or the auction price when that is lower). Anything not listed here is
 * priced from the auction house only.
 */
export const VENDOR_REAGENTS = [
  159, 1179, 2320, 2321, 2324, 2325, 2596, 2604, 2605, 2678, 2692, 2880, 3371, 3372, 3466, 3713, 3857, 4289, 4291, 4340,
  4341, 4342, 4399, 4400, 4470, 4536, 6217, 6260, 6261, 6530, 8343, 8925, 10290, 14341, 18256, 2665, 17020, 17194, 17196,
  4537, 2894, 1645, 8766, 5173,
];
/** Profession IDs that are not real professions ("Test Profession [DNT]"). */
const SKIP_PROFESSIONS = new Set([2933]);

const id = process.env.BNET_CLIENT_ID;
const secret = process.env.BNET_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Set BNET_CLIENT_ID and BNET_CLIENT_SECRET first.");
  process.exit(2);
}
const tok = await fetch("https://oauth.battle.net/token", {
  method: "POST",
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
if (!tok.ok) throw new Error(`token: HTTP ${tok.status}`);
const bearer = ((await tok.json()) as { access_token: string }).access_token;

async function get<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}${path}?namespace=${NS}&locale=en_US`, { headers: { Authorization: `Bearer ${bearer}` } });
    if (res.status === 404) return null;
    if (res.ok) return (await res.json()) as T;
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`${path}: failed`);
}

/** Run `fn` over `items` with at most `n` at a time. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

interface Ref { id: number; name?: string }
const index = await get<{ professions: Ref[] }>("/data/wow/profession/index");
const recipeIds: [number, number][] = [];
for (const p of index!.professions.filter((x) => !SKIP_PROFESSIONS.has(x.id))) {
  const prof = await get<{ skill_tiers?: Ref[] }>(`/data/wow/profession/${p.id}`);
  for (const tier of prof?.skill_tiers ?? []) {
    const t = await get<{ categories?: { recipes: Ref[] }[] }>(`/data/wow/profession/${p.id}/skill-tier/${tier.id}`);
    for (const c of t?.categories ?? []) for (const r of c.recipes) recipeIds.push([r.id, p.id]);
  }
}
console.log(`${recipeIds.length} recipes listed`);

interface Recipe {
  crafted_item?: Ref;
  crafted_quantity?: { value?: number; minimum?: number; maximum?: number };
  reagents?: { reagent: Ref; quantity: number }[];
}
const rows = await pool(recipeIds, 8, async ([rid, pid]) => {
  const r = await get<Recipe>(`/data/wow/recipe/${rid}`);
  if (!r?.crafted_item || !r.reagents?.length) return null;
  const q = r.crafted_quantity ?? {};
  const min = q.value ?? q.minimum ?? 1;
  const max = q.value ?? q.maximum ?? min;
  return [rid, pid, r.crafted_item.id, min, max, r.reagents.map((x) => [x.reagent.id, x.quantity])] as const;
});
const recipes = rows.filter((x) => x != null).sort((a, b) => a![0] - b![0]);

const vendor: Record<string, number> = {};
const reagentIds = new Set(recipes.flatMap((r) => r![5].map(([rid]) => rid)));
for (const vid of [...new Set(VENDOR_REAGENTS)].filter((x) => reagentIds.has(x))) {
  const item = await get<{ purchase_price?: number; purchase_quantity?: number }>(`/data/wow/item/${vid}`);
  if (item?.purchase_price) vendor[vid] = Math.round(item.purchase_price / Math.max(1, item.purchase_quantity ?? 1));
}

writeFileSync(
  new URL("../src/data/recipes.json", import.meta.url),
  JSON.stringify({ built: new Date().toISOString().slice(0, 10), namespace: NS, recipes, vendor }) + "\n",
);
console.log(`${recipes.length} recipes with a crafted item, ${reagentIds.size} reagents, ${Object.keys(vendor).length} vendor reagents priced`);
