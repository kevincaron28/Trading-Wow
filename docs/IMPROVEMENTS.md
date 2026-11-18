# Goldline 0.2.0 review and ranked improvements (18 November 2026)

**0.6.0 (18 Nov):** Explore opens on Browse: every item Goldline knows by auction house category (Blizzard item class and subclass: Weapons by type, Armor by type, Containers, Consumables, Trade Goods, Projectiles, Recipes, Reagents, Quest Items, Miscellaneous; empty ones hidden), then subcategory, then items with icon, price and quantity listed for the chosen house. Search inside the current category or all items, sort by name/price/quantity, "only items on sale" toggle, Android back goes up a level, virtualised list (7,000+ items), works offline from the cached catalog and prices. Movers, deals and flips moved to Explore > Markets (still 5 tabs). Fixes: Preact 11 numeric inline styles, a new tab or chart starts at the top.

**0.5.0 (18 Nov) polish:** dark launch splash and system bars with light icons; no TradingView logo over charts (licence credit moved to Settings > About); clean price axis ("80g", flat prices padded to ±2%); earlier-history notes moved under the chart as a legend (Goldline, Earlier scans, ahprice.com); realms named Normal, RP and RP-PvP; list rows say "329 listed · ~43/day"; Explore movers only among traded items (no ±500%+ noise); share shows it is working; search rows use the full width; empty-state illustrations for lists, alerts and search; item-icon fallback glyph; pulsing logo while loading and on first paint; compact rows on phones under 380 dp; the Menu tab is now Settings.

**0.4.0 (18 Nov) did:** #5 background alerts on Android (Capacitor Background Runner about every 30 min, public/runners/alerts.js,
tested in Node with mocked Android globals; not yet tried on a phone), #6 pull-to-refresh on Watchlist and Explore, #15 share a chart as an
image, estimated sold/day on watchlist rows with a Sold sort, and a kcaron.top privacy page (Guilded PR #1101). Still open: #9 realm names,
#10 gear variants, #11 crafting margins, home-screen widget, store screenshots after a week of data.

**0.3.0 (18 Nov) did:** #2 (256-file history, live since 12:35 UTC), #3 onboarding, #4 estimated sales per day (live from
the 13:35 UTC snapshot; Top sellers in Explore, Sold / day on the chart), #6 offline cache (pull-to-refresh not done),
#7 watchlist drag/swipe/long-press, #8 horizontal price lines with alert-at-line, #14 chart screen-reader label, #16
ranges and log scale; the APK on GitHub is now signed with the upload key. Still open: #1 and #13 (owner secrets), #5
background alerts, #9 realm names, #10 gear variants, #11 crafting margins, #12 store polish, #15 widget/share.

Measured on the live app and data: 12 houses collected hourly since 02:00 UTC with no gap (10 snapshots by
11:00 UTC); app JS 250 KB (83 KB gzip); first load fetches `items.json` 549 KB (138 KB gzip) and one
`latest` file 224 KB (77 KB gzip); a chart opens one history shard, 58 KB now but about 2 MB raw / 450 KB gzip once
14 days of hourly rows exist.

Effort: S = under half a day, M = about a day, L = several days.

| # | Improvement | Why | Effort |
| --- | --- | --- | --- |
| 1 | **Move collection to GitHub Actions** (add `BNET_CLIENT_ID` / `BNET_CLIENT_SECRET` secrets, merge PR #1) | Today the hourly feed runs from a loop on the owner's PC that stops this afternoon; without it prices freeze | S (owner: 2 min) |
| 2 | **Per-item history files + trimmed shards** | A chart would download ~450 KB gzip per open after two weeks; one small file per item (or 256 shards) keeps it under 20 KB | M |
| 3 | **First-run onboarding**: pick realm, faction and language, explain "listed, not sold" and the hourly refresh | New users land on PvP Horde in English without knowing why | S |
| 4 | **Estimated sales per day** from auctions that disappear before expiring (auction IDs are stable between snapshots) | The single most useful trading number Goldline lacks; turns "volume listed" into a demand signal | M–L |
| 5 | **Background alerts** (Android WorkManager via a Capacitor background task, or a small push service fed by the collector) | Alerts only fire while the app is open; TradingView-style alerts are expected to arrive when closed | M |
| 6 | **Offline cache and pull-to-refresh**: keep the last quotes and catalog on the device | The app is blank without network and re-downloads 140 KB catalog each start | S |
| 7 | **Watchlist gestures**: drag to reorder, swipe to remove, long-press to move to another list, sections | Core mobile watchlist behaviour that is missing | M |
| 8 | **Chart drawing tools**: horizontal price line, trend line, saved per item; tap-to-set alert from a line | Expected chart features; also the most natural way to place alerts | M |
| 9 | **Name realm groups B, C, D** (one in-game check of which realm uses houses 111/114/117, 119–121, 123–125) | "Realm B" confuses users | S (owner check) |
| 10 | **Gear variants**: split random-suffix items ("of the Eagle") using the `modifiers` field | Gear prices mix variants; currently hidden from deals/flips | M |
| 11 | **Crafting margins**: recipe costs vs product price per profession (needs recipe data from the static API) | Big draw for the profession watchlists; was in the original Gemini idea | L |
| 12 | **Store polish**: retake screenshots after a week of history (current chart shot shows one candle), move the privacy policy to kcaron.top, a Goldline contact address instead of Guilded's | Listing quality and review safety | S |
| 13 | **Release-signed APK on GitHub** (add the two `GOLDLINE_KEYSTORE_*` secrets) so GitHub and Play builds share one upload key | Avoids the "uninstall first" step between the two channels | S (owner) |
| 14 | **Accessibility pass**: TalkBack labels for chart and legend, larger tap targets on chips, text alternative for change colours (already signed +/−) | Store pre-launch report will flag some of these | S |
| 15 | **Home-screen widget** with 3–4 watchlist prices; share a chart as an image | Nice-to-have, matches the reference app | M |
| 16 | **Price history depth**: 1M / 3M / 1Y ranges once data exists, plus log scale | Comes naturally after weeks of collection | S |

Data accuracy notes: market price = average of the cheapest 15% listed (robust to junk listings); commodities
and item auctions are merged per item; about 250 item IDs have no catalog entry in either Forever or Classic
static data and are retried each run (they show as `#id`). Snapshots follow Blizzard's hourly refresh (~:25).

## Play Console status (18 Nov, 11:00 UTC)

| Section | Status |
| --- | --- |
| App created (Goldline, `top.kcaron.goldline`, free app) | Done by the owner |
| Privacy policy URL | Done |
| Ads (no ads) | Done |
| Sign-in details / app access (no restricted parts) | Done |
| Government apps, financial features, health (none) | Done |
| Advertising ID (not used) | Done |
| Target audience (18+) | Done |
| Data safety (no data collected or shared) | Done |
| **Content rating (IARC questionnaire)** | **Owner**: starting it accepts IARC's terms. Answers: category "Utility, productivity, communication, or other"; no to every content question; no user interaction, no location sharing, no digital purchases |
| Store listing EN + FR-CA + FR-FR, icon, feature graphic, 4 phone screenshots | Done |
| Store settings (Tools; support@guildedwow.com; kcaron.top) | Done (change the email if you want a Goldline address) |
| Internal testing: list "Goldline internal" (owner), release 200 (0.2.0) | **Live**. Opt-in: https://play.google.com/apps/internaltest/4699770959360019082 |
| Closed testing (Alpha): all countries, list "Goldline closed testers" (owner placeholder), feedback email, release 200 (0.2.0) draft | Ready; not sent for review |

Owner steps: finish Content rating; open the opt-in link on the phone and install; buy the tester credit, add the
community's 12+ emails to "Goldline closed testers"; in Publishing overview, send the closed-testing release for
review; when approved, keep 12+ testers opted in for 14 days, then apply for production.
