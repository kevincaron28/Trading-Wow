# Goldline plan (17 November 2026)

## Owner decisions (17 Nov 2026)

- **Name:** Goldline. Original look; works like a trading chart site without copying any brand.
- **Stack and hosting:** TypeScript + Vite, hosted on Cloudflare Pages; price history later in a Cloudflare
  Worker with a D1 database. No server to run, same tools as the Guilded website.
- **Data source:** the official Blizzard Game Data API, through a Battle.net developer client created for
  this app (separate from Guilded's). Sample data until it works.
- **Scope:** every Forever realm and both factions, with a picker; PvP Horde first.
- **Languages:** English and French.

## Blizzard probe result (17 Nov 2026)

Battle.net client "Goldline Forever" created on the owner's account (credentials only in the gitignored `.env`).
`npm run probe:blizzard` found:

- Forever (`dynamic-forever-us`) has **no realm or connected-realm index** (404) and no region-wide commodities route.
- It serves auctions **per ruleset**: `/data/wow/ruleset/index` lists rulesets 1 "PvP", 2 "Normal",
  3 "Roleplay" and 15 "Roleplay PvP". Each lists the same 15 houses (110–125).
  `/data/wow/ruleset/{any}/auctions/{houseId}` returns that house's item auctions (`item.id`, `buyout`,
  `quantity`, `time_left`), and `.../commodities` its commodities (`unit_price`, `quantity`). The ruleset
  number in the path does not change the answer; the house ID does.
- Houses come in groups of three: Alliance, Horde, Blackwater (neutral). Live groups: 110/113/116,
  111/114/117, 119/120/121 and 123/124/125; 112/115/118 are empty.
- **110/113/116 is PvP**: house 113's lowest prices match TSM's PvP-Horde data on 100% of 5,186 shared
  items (other Horde houses: 9–24%). The other three groups still need names (Normal, Roleplay, Roleplay PvP).
  The page calls them Realm B, C and D for now.
- Snapshots refresh hourly (Last-Modified about :25). The large houses hold about 90,000 item auctions plus
  70,000 commodity auctions, roughly 5,000 distinct items per house.
- So **Gemini's route was right**. What it lacked was the house list.

## Review of the Gemini draft (now in `docs/gemini-draft/`)

What it described: a FastAPI + Postgres poller for "US PvP Horde (house 113)", hourly candles, 7-day
average, ">30% below average" Discord alerts, crafting margins, a mobile web page and an Android stub.

Problems found:

- The README promises Docker Compose, the schema and views, 72 hours of seed data, `manifest.json` and a
  start script; none of them exist.
- `/data/wow/ruleset/{id}/auctions/{house}` is not in Blizzard's public docs (those use
  `/data/wow/connected-realm/{id}/auctions/{house}`), but the probe showed it **is** the working Forever
  route. The draft only knew one house ID (113) and had no house list. TSM's data was used once, locally,
  to identify the PvP houses; it must not be republished (TSM terms).
- Item IDs 90001/90002 ("Azerothium Bar", "Pitchblende") look invented; "Master Chef 1.5x" and the recipe
  data behind crafting margins are not defined.
- Candle maths labelled listings as if they were trades; Goldline calls it "listed quantity".
- A default database password in code, open CORS, a Kotlin file without a project.

## MVP, in order

1. **First slice (this PR):** item chart page on sample data: candles/line, listed quantity, 1H/4H/1D/1W,
   SMA 20 and EMA 50, search (EN/FR, accents ignored), watchlist in the browser, realm/faction picker,
   light/dark, phone layout, tests and CI.
2. **Probe (done 17 Nov):** live Forever routes and house IDs found, see above. Still owed: names for realm groups B, C and D.
3. **Collector:** a Cloudflare Worker on an hourly cron fetches each Forever auction house (with
   `If-Modified-Since`), summarizes each item with `summarizeSnapshot`, and stores one row per item per
   hour in D1 (`item_id, house, hour, min_buyout, market, listed, auctions`). Old hours roll up to daily
   rows after 30 days to stay inside the free tier.
4. **API + live source:** `GET /api/history/:house/:item` and `GET /api/latest/:house?ids=` from the same
   Worker; an `ApiSource` implements `PriceSource`; the sample banner disappears.
5. **Item catalogue:** names (EN/FR), quality, icons from the Forever static item API
   (`static-forever-us`, which works today), cached in D1.
6. **Deploy:** Cloudflare Pages project + Worker, on a domain the owner picks.

Later (not MVP): movers list (biggest 24h changes), price alerts, crafting margins (needs recipe data),
comparison of two items, installable app (PWA).

## Open questions for later

- Domain name for the site.
- Whether alerts go to Discord (would reuse Guilded's opt-in rules) or stay on the site.
