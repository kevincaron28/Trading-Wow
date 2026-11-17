# Goldline plan (17 November 2026)

## Owner decisions (17 Nov 2026)

- **Name:** Goldline. Original look; works like a trading chart site without copying any brand.
- **Stack and hosting:** TypeScript + Vite, hosted on Cloudflare Pages; price history later in a Cloudflare
  Worker with a D1 database. No server to run, same tools as the Guilded website.
- **Data source:** the official Blizzard Game Data API, through a Battle.net developer client created for
  this app (separate from Guilded's). Sample data until it works.
- **Scope:** every Forever realm and both factions, with a picker; PvP Horde first.
- **Languages:** English and French.

## Review of the Gemini draft (now in `docs/gemini-draft/`)

What it described: a FastAPI + Postgres poller for "US PvP Horde (house 113)", hourly candles, 7-day
average, ">30% below average" Discord alerts, crafting margins, a mobile web page and an Android stub.

Problems found:

- The README promises Docker Compose, the schema and views, 72 hours of seed data, `manifest.json` and a
  start script; none of them exist.
- `/data/wow/ruleset/{id}/auctions/{house}` is not a documented Blizzard route (the documented one is
  `/data/wow/connected-realm/{id}/auctions/{house}`), and Guilded's 7 Nov probe got 404 from the Forever
  realm and connected-realm indexes. **But** the owner's TSM data (17 Nov) has Forever prices for realm
  "PvP-Horde" and region "Forever-US", so Blizzard publishes them somewhere: `npm run probe:blizzard`
  finds out where. TSM's own data must not be republished (TSM terms); it only proves the data exists.
- Item IDs 90001/90002 ("Azerothium Bar", "Pitchblende") look invented; "Master Chef 1.5x" and the recipe
  data behind crafting margins are not defined.
- Candle maths labelled listings as if they were trades; Goldline calls it "listed quantity".
- A default database password in code, open CORS, a Kotlin file without a project.

## MVP, in order

1. **First slice (this PR):** item chart page on sample data: candles/line, listed quantity, 1H/4H/1D/1W,
   SMA 20 and EMA 50, search (EN/FR, accents ignored), watchlist in the browser, realm/faction picker,
   light/dark, phone layout, tests and CI.
2. **Probe** (needs the owner's Battle.net client): run `npm run probe:blizzard`, record which routes answer
   for Forever, the realm list and the auction house IDs. Replace the placeholder realm list.
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
