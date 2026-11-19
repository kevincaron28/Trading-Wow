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
(`summarizeSnapshot`: lowest buyout, market value, quantity listed, auctions, and the price at which 30% of the
quantity is reached) and updates the files below.

**Market value (since 0.8, 19 Nov 2026)** is the robust formula in `src/lib/market.ts`. It works by quantity, not by
number of auctions:
- take the cheapest 30% of the listed units (at least 3);
- find their quantity-weighted median m, and drop units below 0.5 m or above 1.5 m;
- average the cheaper half of what remains.

Until 0.7 it was the average of the cheapest 15% of units. `collector/backtest-formulas.ts` compared four formulas on
live snapshots of houses 113, 110, 120 and 116 (20,798 items):

| Formula | Fooled by one cheap unit | Fooled by one overpriced unit | Resample variation (median / p90) |
|---|---|---|---|
| Cheapest 15% (until 0.7) | 65.1% | 0.1% | 0.01% / 4.9% |
| TSM-style (15–30%, 1.5σ) | 48.5% | 0.2% | 0.09% / 6.1% |
| Median of cheapest 30% | 34.6% | 0.3% | 0.00% / 7.8% |
| **Robust (0.8)** | **11.8%** | 0.5% | 0.04% / 5.8% |

"Fooled" means one extra listing moved the value by more than 25% (cheap) or 33% (overpriced). Resample variation is
the spread when 20% of auctions are randomly removed. On mid-depth markets (6–99 units) the robust formula is fooled
0.7% of the time, against 58.4% before. On deep markets (100+ units) every formula held. A thin market (5 units or fewer)
can still be moved: 33.7% instead of 100%.

On today's snapshot of house 113 the robust value equals the old one for the median item at every depth: the ratio is
1.000, with a p90 of 1.015 on thin markets. So the history stays comparable; the switch date is 19 Nov 2026.

**Candle wicks.** Each hourly snapshot is one candle:
- the body runs from the previous close to this snapshot's market value;
- the wicks are the snapshot's own listing spread, from the lowest buyout up to the 30%-quantity price, kept within
  0.5–1.5× the market value.

Daily and 4-hour candles take their open, high, low and close from these hourly candles; the stored daily rows do the
same. Before 0.8 only the lowest buyout was stored, so older candles have lower wicks only. Points from ahprice.com and
the Auctionator scans are drawn as dots of the one price they have. `collector/publish.sh` runs it and force-pushes the result as a single
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
| `latest/{houseId}.json` | `{ t, items: { [itemId]: [minBuyout, market, listed, auctions, market24hAgo or 0, avg7d, soldLast24h or -1] } }`; items seen in the last 3 days. The 24h reference is the newest point at least 24 hours old, or (while less than a day exists) the oldest point if it is at least 12 hours old |
| `h2/{houseId}/{itemId % 256}.json` (since 0.3.0) | Same content as `history/`, split 256 ways so one chart downloads about 1/256 of a house. Hourly rows may have a 6th value: estimated quantity sold since the previous snapshot |
| `history/{houseId}/{itemId % 32}.json` (0.2 layout, still written) | `{ v: 1, items: { [itemId]: { h: [[hourIndex, min, market, listed, auctions]], d: [[dayIndex, open, high, low, close, avgListed, lowestMin]] } } }` |

Hour index = unix seconds / 3600; day index = unix seconds / 86400 (UTC). Hourly rows are kept 14 days, daily
candles two years. Prices are copper per unit. Icons: `{iconBase}{iconFileId}.jpg` on Blizzard's render CDN.

## History before 18 November (seed)

Blizzard only serves the current snapshot, so nothing before collection started (18 Nov 2026, 02:00 UTC) can be fetched.
The earlier prices come from **Auctionator** scans (SavedVariables, realm "PvP", Horde characters only, so house 113):

| # | Source label | Days (items scanned) |
|---|---|---|
| 0 | Auctionator scans by the owner | 8 Nov (4,172), 10 Nov (332), 11 Nov (5,449) |
| 1 | guildmate Auctionator scan (sent to the owner 18 Nov 2026) | 5 Nov (1,669), 6 (808), 7 (400), 8 (262), 9 (4,893), 10 (4,410), 11 (302), 12 (6,100), 13 (311), 14 (6,211), 15 (6,653), 16 (6,827), 17 (6,814) |

`collector/import-auctionator.ts` decodes Auctionator's CBOR price database (nothing else in the file is read: no character
names) and writes `seed/113/{itemId % 256}.json` = `{ items: { [itemId]: [[dayIndex, lowestBuyoutLow, lowestBuyoutHigh, quantityAvailable or -1, sourceIndex]] } }`
plus `seed/113.meta.json` (`sources` with each source's label and days). Only days from WoW Forever's launch (4 Nov) to
17 Nov are kept. `--merge` dedupes: an item-day already present (the owner's scan) is never replaced; the guildmate's
file only adds days the owner did not scan. On the 9,878 item-days both scanned, the two agree (median ratio 1.00), which
confirms the same auction house. Nothing for 4 Nov; no values are interpolated. The raw SavedVariables files are not
committed. The app draws these on 1D/1W charts as separate grey points labelled "Earlier scans", never merged into the
live candles (they measure the lowest buyout, not the market price).

The guildmate's TradeSkillMaster file was checked too: its only price records are that player's own sales, purchases and
cancellations with character names (personal accounting), and its AuctionDB values come from TSM's servers (not ours to
republish), so nothing from it is used.

## ahprice.com history (separate series)

**ahprice.com** (not ahprices.com) collects auction scans from players running its free addon. The owner has the site's
permission to search and record its price history (owner, 18 Nov 2026). `collector/backfill-ahprice.ts` is a one-time,
resumable backfill through its public API only (`/api/v1/items/{id}/history`, never the HTML pages): one request every
7 seconds, a generic user agent, no personal data sent, and it stops when the site's daily allowance
(`X-Ratelimit-Remaining-Day`, 2,000 per day) gets under 60 or on any 429, then resumes from its cache the next day.
Order: every built-in watchlist item in every market first, then the most-listed items, then every other item ahprice.com
lists in that market.

Since 18 Nov 2026 it runs on GitHub Actions (`.github/workflows/ahprice-backfill.yml`, no secrets),
not on the owner's PC. Each run:
- resumes from the `backfill-state` branch: `cache.json`, plus `budget.json` with the requests per UTC day, so all
  runs share one allowance of at most 1,900 a day;
- fetches for up to 50 minutes with the same 7-second pacing and backoff;
- saves its progress;
- publishes `ext/ahprice` and `audit/coverage.json` with `collector/publish-ext.sh` (lease and retry, safe next to the
  hourly collector).

It starts from two hourly cron slots (:17 and :47) and after every finished collector run, because GitHub sometimes
skips scheduled runs. A quick `check` job starts the real job only when:
- the backfill is not done,
- today's budget is not used up,
- no progress was saved in the last 45 minutes (a manual dispatch always runs).

Only one fetch job runs at a time.

When every item is fetched it writes `done.json` and later runs do nothing.

**Pace (19 Nov 2026).** ahprice.com has no batch or multi-market history call: every call covers one item, one realm
and one faction. The cap is 2,000 calls a day per IP whatever the `days` window, so a shorter window saves nothing.
History over 30 days only lowers the per-minute limit to 10, and the 7-second pacing stays under that.

Requests never come from extra machines or IPs to get past the per-IP limit, and the backfill does not use the MCP
endpoint's separate allowance. Instead, the most useful requests go first:
- items listed on that market in Goldline's latest snapshot, most traded first;
- last, PvP Horde items the Auctionator scans already cover, and items not listed on our auction houses.

That puts the essential part at about 21 days from 19 Nov (40,264 requests), with about 9,300 deferred requests after
it. The owner decided not to ask ahprice.com for an export or a higher limit (19 Nov 2026).

ahprice groups realms into markets (US and AU together). They were matched to Goldline's houses on 18 Nov 2026 by
comparing current prices of 50 busy items (median gap 3–14%, RP Horde 29% but still the clear best):

| ahprice market | Alliance | Horde |
|---|---|---|
| us-pvp | 110 | 113 |
| us-normal | 111 | 114 |
| us-rp | 119 | 120 |
| us-rppvp | 123 | 124 |

Blackwater (neutral) houses have no match. Output on the data branch: `ext/ahprice/{house}/{itemId % 256}.json` =
`{ items: { [itemId]: [[dayIndex, lowestBuyout, quantity]] } }` (one row per day, the day's last scan, 4–17 Nov only)
and `ext/ahprice/meta.json` (label "ahprice.com (crowd-sourced addon scans)", permission, market map, coverage). The app
draws it on 1D/1W charts as purple points labelled "ahprice.com", separate from Goldline's own data and from the
Auctionator seed.

Not used: TSM's AppHelper data (TSM's own data, not ours to republish) and third-party sites such as timesaver.gg or
ahprices.com (would need their permission).

## Estimated sales

The collector keeps the previous snapshot's auction IDs in `state/` next to the data (gitignored, cached between GitHub
Actions runs, never published). An auction that disappears although its shortest possible remaining time was longer than the gap between snapshots
(`LONG` = 2+ h for the usual 1-hour gap, `VERY_LONG` = 12+ h after a missed hour) is counted as sold, and a commodity stack that shrank counts the missing quantity. Cancellations look the same, so this is an
estimate; auctions with less time left are ignored because they may simply have expired.

## Known limits

- Goldline's own hourly history starts on 18 November 2026, 02:00 UTC (Blizzard publishes only the current snapshot);
  earlier days come only from the Auctionator scans and ahprice.com (below).
- Listings, not sales: "volume" is the quantity listed.
- Gear with random suffixes ("of the Eagle") shares one item ID, so its prices mix variants. Explore leaves gear
  out of deals and flips.

## Catalogue audit and coverage (18 Nov 2026)

`collector/audit-catalog.ts` compares items.json with every item ID Goldline can see. The sources are:
- the history of every house (h2/),
- the Auctionator seed,
- the ahprice.com series and its per-market price exports,
- the item IDs in the guildmate's TSM trade logs (IDs only).

Missing items are filled from Blizzard's static data, in this order: static-forever, static-classic1x, static-classic,
then retail. Some items are WoW Forever's own new ones (IDs above 200,000) that Blizzard does not list yet. They get:
- their English name from the ahprice.com export,
- no icon (the app shows a fallback glyph),
- class -1, so they appear under Browse > Other.

The summary is `audit/catalog.json` on the data branch.

`collector/coverage.ts` writes `audit/coverage.json`, refreshed with every ahprice.com publish. For every house and item
it holds:
- the first and last day with a real price since 4 Nov,
- the covered and missing days,
- the sources: 1 = Goldline, 2 = Auctionator scans, 4 = ahprice.com.

Not obtainable:
- anything before 5 Nov: no source has 4 Nov, launch day;
- the Blackwater (neutral) houses before 18 Nov: no source covers them;
- days nobody scanned.

The ahprice.com backfill covers every item it lists. That is about 50,000 item-market requests at 1,900 a day (the
site's limit is 2,000), so roughly four weeks from 18 Nov, most-listed items first.

**Collector watchdog (19 Nov 2026).** GitHub sometimes skips the collector's schedule for hours on this repository
(none ran from 03:52 to 10:22 UTC on 19 Nov). So the collector now has four hourly slots (:05, :20, :35, :50). The
ahprice.com backfill workflow's quick check job, which several triggers start, also starts a collector run when
`meta.json` on the data branch is more than 75 minutes old and no collector run is queued or running. An extra
collector run that finds an already stored snapshot skips it.

## TradeSkillMaster data (separate series)

The owner has permission to use TradeSkillMaster's online data for prices and markets (owner, 19 Nov 2026).
`collector/tsm.ts` reads TSM's **public pricing files** (https://tradeskillmaster.com/public-data). They are free, need
no API key and have no scraping. Their terms are followed:
- credit "Pricing data from TradeSkillMaster" with a link, shown in the app wherever TSM numbers appear;
- each file is downloaded at most once per update, so at most every 3 hours;
- the series is never presented as Goldline's own.

| File | Content | Updated |
|---|---|---|
| `forever/us/realm/<slug>/items.csv` | market value, min buyout, recent, historical (60-day) | every few hours |
| `forever/us/region/items.csv` | market value, historical, average sale price, sale rate, sold per day | daily |

The realm slugs map to our houses:

| TSM realm | Alliance | Horde |
|---|---|---|
| pvp | 110 | 113 |
| normal | 111 | 114 |
| roleplay | 119 | 120 |
| roleplay-pvp | 123 | 124 |

TSM has no Blackwater (neutral) houses, and its files hold only current values (plus the 60-day "historical"
average). So TSM cannot fill past gaps, and its daily history (`tsm/<house>/<shard>.json`) starts when Goldline began
recording it (19 Nov 2026). Region data is in `tsm/region/`.

The app shows a TradeSkillMaster card on each item page and TSM's daily market value as a dashed line on daily
charts.

Cross-check on 19 Nov (about 7,000 items per house): TSM's market value is about 10–14% higher than ours for the
median item (ratio p10 0.66–0.77, p90 1.93–2.06), and about half of items are within -20% to +25%. This is expected,
because TSM averages over 14 days of scans and a wider slice of listings, while ours is the current snapshot's robust
low. The two are shown side by side, never blended.

The indexes are described in `docs/INDEXES.md`.

**Collector relay (19 Nov 2026).** GitHub stopped firing this repository's scheduled runs for hours at a time: none
from 03:52 to 10:22 UTC, and again after 10:22. Each collector run now collects four times, 15 minutes apart (about 50
minutes), then starts the next run itself with `workflow_dispatch`, which a workflow's own token may do. The cron
slots and the backfill workflow's stale-data check only restart the relay if it ever breaks.
