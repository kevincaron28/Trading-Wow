# Goblin Ledger: finish-line audit (22 November 2026, main at 0.14.0)

Scope of this pass: read the repo and history, run typecheck, tests and build, check the live data, read every screen's
code for EN/FR, accessibility, error states and leftover naming, and research what comparable tools offer.

**Limits of this pass (be aware):** the built-in browser pane refused to open `localhost`, so I could **not** look at the
running app on a phone-sized screen or click through every screen. Mobile layout, performance on a real phone and the
Android build were not exercised. Those are marked "not verified" below and should be checked by the owner or a
follow-up pass before 1.0. Competitor notes come from general knowledge of those tools, not from a fresh crawl.

## 1. What works (verified)

| Area | Result |
| --- | --- |
| `npm run typecheck` | Passes |
| `npm test` | 21 files, 126 tests, all pass |
| `vite build` | Passes; main bundle 331 kB (110 kB gzip), recipes 133 kB loaded on demand |
| CI (`ci.yml`) | Same checks plus a Node load test of every collector module |
| Data freshness | `data` branch updated 22 Nov 12:25 UTC (17 min before the check). All 12 live houses present, about 6,800 items each. `meta.json` snapshot matches Blizzard's hourly refresh |
| Collector on Actions | `collect.yml` runs from `main` and is working, so the `BNET_*` secrets are already set. Scheduled runs show "cancelled" when the relay run is already active: expected, not a failure |
| EN/FR text | The English and French tables have the same 211 keys (script-checked), no missing translations |
| Rename | UI, `index.html`, tab bar, about text, welcome text, update banner all say Goblin Ledger |
| Error states | `useAsync` keeps the previous item's data from showing after a failed load; files are cached offline on the device; an `offline` state exists |

## 2. Bugs found

| # | Sev | Bug | How to reproduce | Status |
| --- | --- | --- | --- | --- |
| B1 | Medium | The close button of every bottom sheet (list menu, add to list, alert editor, etc.) has the hard-coded English label "Close", so a French screen-reader user hears English | Switch to French, open any sheet with TalkBack on | **Fixed** (new `close` key, EN "Close", FR "Fermer") |
| B2 | Medium | `README.md` and `PRIVACY.md` still say "Goldline" everywhere. The privacy policy is the public document linked from the Play listing and mirrored on kcaron.top, so it names a product that no longer exists | Open either file | **Fixed** in the repo. The mirrored copy on kcaron.top (Guilded repo) must be updated by the owner |
| B3 | Low | README said the collector "needs two secrets, then runs hourly": outdated, it already runs | Read README "Live data" | Left; wording is still true as setup instructions |
| B4 | Low | The `data` branch `README.md` (written by `collector/publish.sh`) still says "Goldline price data" | Open the `data` branch | **Not fixed**: I was told not to push to `data`. One-line fix in `publish.sh` for the owner/master session |
| B5 | Low | Settings text says AHledger points are "read live and not stored by Goblin Ledger" (`ahlNoteMedian` / `ahlNoteMin`), but the collector stores them in `ext/ahledger/` on the public `data` branch | `docs/DATA.md` line 196 | Needs owner wording decision (see D2). The keys may be unused; I did not confirm in the UI |
| B6 | Info | `docs/*.md` (PLAN, DATA, IMPROVEMENTS, PLAY_STORE, MONETIZATION_PLAN) still use "Goldline" | grep | Left on purpose: they are history and internal notes; `PLAY_STORE.md` listing text must be updated before the store listing is renamed |

Not bugs, but things that still say Goldline and **cannot change without breaking installs**: Android package
`top.kcaron.goldline`, `localStorage` keys (`goldline:v2`, `goldline:file:`), the `goldline.apk` file name used by the
in-app updater and the "latest" download link, keystore alias and `GOLDLINE_*` secrets and env names, the
`goldline-collector` git author. Renaming the package id means a new Play listing; renaming the APK file needs the updater
to accept both names for one release. Both are owner decisions (D1).

## 3. Gaps before a 1.0

1. **Release signing.** APK is debug-signed until the `GOLDLINE_KEYSTORE_*` secrets are added. Debug and release builds can't
   update over each other, so this must be settled before real users install (owner, 2 minutes).
2. **Data licences.** The repo is **public**, and the `data` branch publishes `tsm/` (TradeSkillMaster market values, a
   daily history that we started recording, and region data), `ext/ahledger/` and `ext/ahprice/`. The owner has
   permission from all three (DATA.md, 19 Nov) but only verbally; AHledger's own terms need a commercial licence from
   **10 Dec 2026**, and the monetization plan says TSM must be checked before ads. If the rule is "never republish
   TSM data", the `tsm/` history on a public branch is the clearest conflict with it. See D2.
3. **Android not verified here.** The workflow builds a sideload debug APK; I did not run it. Background alerts were never
   tested on a phone (IMPROVEMENTS.md says so). Needs a real-device pass.
4. **Mobile layout, performance and accessibility not verified live.** Code review: 32 `aria-label`s across screens,
   the chart has a screen-reader label, tap targets are not audited. Run Lighthouse and TalkBack once.
5. **Web app is not installable.** `public/` has only `favicon.svg` and `runners/`: no web manifest, no service worker,
   no `robots.txt`, no social-preview image. Fine for the APK, weak for the Cloudflare Pages site.
6. **No in-app way to report a problem or contact the developer.** Settings has no contact or feedback link;
   `IMPROVEMENTS.md` #12 asked for a Goldline address instead of Guilded's.
7. **Store assets.** Store listing text and screenshots still use the old name (`docs/PLAY_STORE.md`,
   `assets/play/`). Note `assets/play/feature-1024x500.png` is untracked and was left alone.
8. **Realm names.** Realm groups were named in 0.5.0 (Normal, RP, RP-PvP); confirm in game once that
   111/114/117, 119-121, 123-125 map as shown.
9. **Hosting.** PLAN.md says Cloudflare Pages but nothing in the repo (no `wrangler.toml`, no Pages config, no domain in
   docs) shows where the web app is deployed or what URL it lives at. Check it is live and renamed.

## 4. Ranked improvement proposals

Effort: S under half a day, M about a day, L several days. "Owner" = needs a decision or an owner-only action.

| Rank | Proposal | Why a Forever player cares | Effort | Owner? |
| --- | --- | --- | --- | --- |
| 1 | **Settle data licences, then simplify the data**: written OK from AHledger and TSM for a public, possibly monetized app, or drop `tsm/` and turn the series off | Removes the one thing that could take the app down | S | **Yes (D2)** |
| 2 | **Release-sign the APK and publish 1.0** (secrets, tag `v1.0.0`) | Real users can install and update safely | S | **Yes (D3)** |
| 3 | **Profit per craft shown for every recipe in one ranked list** ("what should I craft now") with material cost from the cheapest source and the AH cut. 0.13.0 has the crafting card and a profitable list; extend it to filter by profession and your skill level | The most used TSM feature; the data is already in the app | M | No |
| 4 | **Shopping and selling lists**: tick "buy these materials for my crafts" and show a total to pay and what to list; shareable text | Matches TSM Shopping/Crafting and Undermine's "buy list" | M | No |
| 5 | **Server-side alerts (push)**: the collector already knows every price each hour; a small push service would make alerts arrive with the app closed and without phone battery use | The background runner is untested on devices and Android throttles it | L | Yes (needs a service, a secret, and a privacy policy change) |
| 6 | **Realm and faction comparison for one item** ("cheapest on which house, after the 5% cut vs the neutral house cut"). Item details already show the three houses; add a quick all-realms table | Cross-faction and neutral-AH flipping is the main Forever play | S | No |
| 7 | **Saved filters and "deals" notifications**: tell me when anything on my watchlist is 30% below its 7-day average | Saddlebag and Undermine both lead with deals | M | No |
| 8 | **Installable web app** (manifest, icons, service worker) and a share link that opens an item on the web | Many players use the site on a second monitor, not a phone | S | No |
| 9 | **Gold calculator tools**: a "net after cut" calculator, stack-price converter, vendor-vs-AH check | Small, loved by flippers | S | No |
| 10 | **Better empty and error states**: when a house has no data, say which and when it last updated, with a retry button; a status line in Settings with the age of each source | Players ask "is it broken?" first | S | No |
| 11 | **Contact and feedback link** in Settings, and a tester-reported "item missing" button | Needed once strangers use the app | S | Yes (which address) |
| 12 | **Export**: copy watchlist as text, import from a list of item IDs (TSM group string import is **not** proposed: it is their format) | Moves players off other tools | S | No |

### Competitor notes (from general knowledge, not a fresh crawl; no branding or data to be copied)

- **TradeSkillMaster (web and addon):** price sources and custom formulas, groups with operations (post, cancel,
  shop, craft), crafting queue with profit, shopping searches, accounting of sales, a market-value history per item.
  Most of the depth lives in the in-game addon, which a read-only AH app cannot copy. What carries over: crafting profit,
  shopping lists, market value history, deals.
- **Undermine Exchange and similar (Oribos Exchange, Saddlebag Exchange):** fast item search, price and quantity
  history per realm, region comparison, "best deals" lists, crafting profit per profession, realm and faction
  comparison, shareable item pages. These match Goblin Ledger's Explore plus item details; the gap is a clean web item
  page and cross-realm views.
- **In-game addons (Auctionator, Auctioneer):** local scans, shopping lists, history. Goblin Ledger complements them.

## 5. Decisions needed from the owner

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Keep the technical name "goldline" (package id, APK file name, storage keys) for 1.0, or rename? | Keep for 1.0. Renaming the package id forces a new Play listing and loses installs; revisit after 1.0 with a one-release updater that accepts both APK names |
| D2 | Data licences: get written permission (AHledger commercial licence by 10 Dec; TSM terms for ads), or switch those series off and delete `tsm/` from the public `data` branch? Also confirm the wording in Settings (B5) | Written permission or switch off before 1.0. Public history on `data` is hard to take back |
| D3 | Add `GOLDLINE_KEYSTORE_BASE64` and `GOLDLINE_KEYSTORE_PASSWORD` to the repo, and cut `v1.0.0` after a phone test | Yes |
| D4 | Contact address for support in the app and the privacy policy | Pick one |
| D5 | Is the web app a product (domain, manifest, link sharing) or only a preview? | Treat the APK as the product for 1.0 |

## 6. Suggested path to 1.0

1. Merge this PR, update the mirrored privacy page on kcaron.top (B2).
2. Real-phone pass (Android APK, EN and FR, small phone, light and dark, offline, alerts).
3. Settle D2 and D3. 4. Rename store assets and listing text. 5. Tag 1.0.0.
