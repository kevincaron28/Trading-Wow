#!/usr/bin/env node
/**
 * Read-only probe: does Blizzard's Game Data API serve WoW Forever auction houses, and where?
 *
 *   BNET_CLIENT_ID=... BNET_CLIENT_SECRET=... npm run probe:blizzard
 *   (or put both in a gitignored .env file; `npm run probe:blizzard` loads it)
 *
 * Prints HTTP statuses, counts and field names only: never the token, the secret or listing contents.
 * Result on 17 Nov 2026: Forever has no realm or connected-realm index (404) but serves auctions per
 * ruleset: /data/wow/ruleset/{id}/auctions/{houseId}[/commodities]. See docs/PLAN.md.
 */

const REGION = process.env.BNET_REGION ?? "us";
const API = `https://${REGION}.api.blizzard.com`;
const NAMESPACES = [`dynamic-forever-${REGION}`, `dynamic-classic1x-${REGION}`];
// Classic-style auction house IDs: 2 Alliance, 6 Horde, 7 neutral (Blackwater, Steamwheedle...).
const HOUSE_IDS = [2, 6, 7];

const id = process.env.BNET_CLIENT_ID;
const secret = process.env.BNET_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Set BNET_CLIENT_ID and BNET_CLIENT_SECRET (a Battle.net developer client) first. See README.");
  process.exit(2);
}

async function token() {
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token request failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

const bearer = await token();

async function get(path, namespace) {
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}namespace=${namespace}&locale=en_US`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
  let body = null;
  if (res.headers.get("content-type")?.includes("json")) body = await res.json().catch(() => null);
  return { status: res.status, body, lastModified: res.headers.get("last-modified") };
}

function show(label, { status, body, lastModified }, extra = "") {
  const keys = body && typeof body === "object" ? Object.keys(body).filter((k) => k !== "_links").join(",") : "";
  console.log(`${String(status).padEnd(4)} ${label.padEnd(58)} ${keys}${extra ? `  ${extra}` : ""}${lastModified ? `  (last-modified ${lastModified})` : ""}`);
}

const idFromHref = (href) => Number(String(href).match(/connected-realm\/(\d+)/)?.[1]);

for (const ns of NAMESPACES) {
  console.log(`\n== ${ns}`);
  const regions = await get("/data/wow/region/index", ns);
  show("region index", regions, `regions=${regions.body?.regions?.length ?? 0}`);
  const realms = await get("/data/wow/realm/index", ns);
  show("realm index", realms, (realms.body?.realms ?? []).slice(0, 8).map((r) => r.slug).join(" "));
  const connected = await get("/data/wow/connected-realm/index", ns);
  const ids = (connected.body?.connected_realms ?? []).map((c) => idFromHref(c.href)).filter(Number.isFinite);
  show("connected-realm index", connected, `ids=${ids.slice(0, 8).join(",")}${ids.length > 8 ? "..." : ""}`);
  show("commodities (region-wide)", await get("/data/wow/auctions/commodities", ns));

  // Forever's working layout (found 17 Nov 2026): rulesets instead of realms. Every ruleset lists the
  // same houses; the house ID picks the auction house, the ruleset number in the path does not.
  const rulesets = await get("/data/wow/ruleset/index", ns);
  const rulesetIds = (rulesets.body?.rulesets ?? []).map((r) => r.id);
  show("ruleset index", rulesets, `ids=${rulesetIds.join(",")}`);
  for (const rs of rulesetIds.slice(0, 1)) {
    const index = await get(`/data/wow/ruleset/${rs}/auctions/index`, ns);
    const houses = index.body?.auctions ?? [];
    show(`ruleset ${rs} auction index`, index, houses.map((h) => `${h.id}:${String(h.name).split(" ")[0]}`).join(" "));
    for (const house of houses) {
      const items = await get(`/data/wow/ruleset/${rs}/auctions/${house.id}`, ns);
      const commodities = await get(`/data/wow/ruleset/${rs}/auctions/${house.id}/commodities`, ns);
      const count = (r) => (Array.isArray(r.body?.auctions) ? r.body.auctions.length : 0);
      show(`house ${house.id} items / commodities`, { ...items, body: null }, `items=${count(items)} commodities=${count(commodities)}`);
    }
  }

  // On the Classic namespace only peek at one realm: the point is to learn the Forever layout.
  for (const realmId of ns.startsWith("dynamic-forever") ? ids.slice(0, 10) : ids.slice(0, 1)) {
    const index = await get(`/data/wow/connected-realm/${realmId}/auctions/index`, ns);
    const houses = (index.body?.auctions ?? []).map((a) => `${a.id}:${a.name}`).join(" ");
    show(`connected-realm ${realmId} auction index`, index, houses);
    for (const house of HOUSE_IDS) {
      const res = await get(`/data/wow/connected-realm/${realmId}/auctions/${house}`, ns);
      const auctions = res.body?.auctions;
      const sample = Array.isArray(auctions) && auctions[0] ? Object.keys(auctions[0]).join(",") : "";
      show(`connected-realm ${realmId} house ${house}`, { ...res, body: null }, Array.isArray(auctions) ? `auctions=${auctions.length} fields=${sample}` : "");
    }
  }
}
