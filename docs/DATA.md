# Goldline live data

## Where the prices come from

Blizzard's Game Data API, namespace `dynamic-forever-us`. Verified with real calls on 17–18 November 2026:

| Route | Result |
| --- | --- |
| `/data/wow/realm/index`, `/data/wow/connected-realm/index` (the usual Retail/Classic routes) | **404**: Forever publishes no realms |
| `/data/wow/ruleset/index` | 200: rulesets 1 PvP, 2 Normal, 3 Roleplay, 15 Roleplay PvP |
| `/data/wow/ruleset/{id}/auctions/index` | 200: houses 110–125 (the same list for every ruleset) |
| `/data/wow/ruleset/{id}/auctions/{houseId}` | 200: item auctions (`item.id`, `buyout`, `quantity`) |
| `/data/wow/ruleset/{id}/auctions/{houseId}/commodities` | 200: commodity auctions (`unit_price`, `quantity`) |
| `/data/wow/item/{id}` and `/data/wow/media/item/{id}`, `static-forever-us` | 200 for most items; some vanilla items only in `static-classic1x-us` (used as fallback) |

The house ID chooses the auction house; the ruleset number in the path does not change the answer. Houses come
in groups of Alliance / Horde / Blackwater (neutral). House 113 matched TSM's "PvP-Horde" prices on all 5,186
shared items, so **110 / 113 / 116 is the PvP realm**. The other live groups (111/114/117, 119/120/121,
123/124/125) are not named by the API; the app calls them Realm B, C and D. 112/115/118 are empty.
Blizzard refreshes the snapshots hourly, around :25.

## Pipeline

`collector/collect.ts` (Node 24, no dependencies) fetches the 12 live houses, summarizes each item
(`summarizeSnapshot`: lowest buyout, market price = average of the cheapest 15% listed, quantity listed,
auctions) and updates the files below. `collector/publish.sh` runs it and force-pushes the result as a single
commit to the `data` branch. The app reads the files from
`https://raw.githubusercontent.com/kevincaron28/Trading-Wow/data/` (public, `Access-Control-Allow-Origin: *`,
5-minute cache). **The Battle.net secret never leaves the collector**: the app and the APK contain none.

Runs hourly via `.github/workflows/collect.yml` once the repo has the `BNET_CLIENT_ID` and
`BNET_CLIENT_SECRET` secrets, or on a PC with the same values in `.env` (`bash collector/publish.sh <data checkout>`).
Both start from the latest published data, so they can overlap safely.

## Files on the `data` branch

| File | Content |
| --- | --- |
| `meta.json` | `{ updated, iconBase, houses: [{ id, realm, faction, snapshot, lastModified, items }] }` |
| `items.json` | `{ [itemId]: [nameEn, nameFr, quality, itemClass, itemSubclass, iconFileId] }` (~7,400 items) |
| `latest/{houseId}.json` | `{ t, items: { [itemId]: [minBuyout, market, listed, auctions, market24hAgo or 0, avg7d, soldLast24h or -1] } }`; items seen in the last 3 days |
| `h2/{houseId}/{itemId % 256}.json` (since 0.3.0) | Same content as `history/`, split 256 ways so one chart downloads about 1/256 of a house. Hourly rows may have a 6th value: estimated quantity sold since the previous snapshot |
| `history/{houseId}/{itemId % 32}.json` (0.2 layout, still written) | `{ v: 1, items: { [itemId]: { h: [[hourIndex, min, market, listed, auctions]], d: [[dayIndex, open, high, low, close, avgListed, lowestMin]] } } }` |

Hour index = unix seconds / 3600; day index = unix seconds / 86400 (UTC). Hourly rows are kept 14 days, daily
candles two years. Prices are copper per unit. Icons: `{iconBase}{iconFileId}.jpg` on Blizzard's render CDN.

## History before 18 November (seed)

Blizzard only serves the current snapshot, so nothing before collection started (18 Nov 2026, 02:00 UTC) can be fetched.
The only genuine earlier prices found are the owner's own **Auctionator** scans (SavedVariables, realm "PvP"; the account only
has Horde characters there, so house 113). `collector/import-auctionator.ts` decodes Auctionator's CBOR price database and
writes `seed/113/{itemId % 256}.json` = `{ items: { [itemId]: [[dayIndex, lowestBuyoutLow, lowestBuyoutHigh, quantityAvailable or -1]] } }`
plus `seed/113.meta.json` (source and coverage). Only scanned days exist: **8 Nov (4,172 items), 10 Nov (332), 11 Nov (5,449)**;
nothing for 4–7 Nov. No values are interpolated. The app draws them on 1D/1W charts as separate grey points labelled
"Earlier scans", never merged into the live candles (they measure the lowest buyout, not the market price).

Not used: TSM's AppHelper data (TSM's own data, not ours to republish) and third-party sites such as timesaver.gg (would need
their permission).

## Estimated sales

The collector keeps the previous snapshot's auction IDs in `state/` next to the data (gitignored, cached between GitHub
Actions runs, never published). An auction that disappears while it still had 2+ hours left (`LONG`/`VERY_LONG`) is counted
as sold, and a commodity stack that shrank counts the missing quantity. Cancellations look the same, so this is an
estimate; auctions with less time left are ignored because they may simply have expired.

## Known limits

- History starts on 18 November 2026, 02:00 UTC: nothing earlier exists (Blizzard publishes only the current snapshot).
- Listings, not sales: "volume" is the quantity listed.
- Gear with random suffixes ("of the Eagle") shares one item ID, so its prices mix variants. Explore leaves gear
  out of deals and flips.
