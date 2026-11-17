# Goldline

Auction house price charts for **World of Warcraft Forever**: candles or lines per item, listed quantity,
timeframes (1H, 4H, 1D, 1W), simple indicators (SMA 20, EMA 50), item search and a watchlist, in
English and French.

> **Status: first slice, sample data.** The charts run on generated prices until the Blizzard feed is
> connected (see [docs/PLAN.md](docs/PLAN.md)). The page says so in a banner.

Goldline is an original, independent fan project. It is not affiliated with Blizzard Entertainment.
Charts use the open-source [Lightweight Charts](https://github.com/tradingview/lightweight-charts) library
(Apache 2.0); its small attribution logo on the chart is required by that licence and stays.

## Run it

Needs Node 22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

Before calling anything done:

```bash
npm run typecheck
npm test
npm run build      # type check + production build into dist/
```

CI (`.github/workflows/ci.yml`) runs the same three on every pull request.

## How it is built

| Path | What |
| --- | --- |
| `src/lib/candles.ts` | Snapshot of listings → hourly price point → candles for any timeframe |
| `src/lib/indicators.ts` | SMA and EMA |
| `src/lib/money.ts` | Copper → `12g 34s 56c` / `12po 34pa 56pc` |
| `src/lib/i18n.ts` | English and French texts (a test fails if a French text is missing) |
| `src/data/source.ts` | `PriceSource` interface; today the sample source, later the live API |
| `src/data/sample.ts` | Deterministic generated prices (same item + house = same chart) |
| `src/data/items.ts` | Starter item list (EN/FR names) and accent-insensitive search |
| `src/chart.ts` | The chart (price, listed quantity, indicator lines), light and dark themes |
| `src/main.ts` | Page: search, realm/faction picker, timeframes, watchlist (saved in the browser) |
| `scripts/probe-blizzard.mjs` | Read-only check of which Blizzard auction routes answer for Forever |
| `docs/gemini-draft/` | The original Gemini draft, kept for reference (not used by the app) |

### What the numbers mean

The auction house shows **listings, not sales**. For each item and hourly snapshot Goldline keeps the
lowest buyout, the **market price** (average of the cheapest 15% of the listed quantity, so one
overpriced listing does not move it), the quantity listed and the number of auctions. Candles are
built from the market price; each opens at the previous close. "Volume" is the average quantity
listed, never quantity traded.

## Blizzard API access (next step)

1. Create a free client at <https://develop.battle.net/access/clients> (a separate one from Guilded's).
2. Put the two values in a `.env` file at the repo root (gitignored, never committed):

   ```
   BNET_CLIENT_ID=...
   BNET_CLIENT_SECRET=...
   ```

3. `npm run probe:blizzard` prints which Forever auction routes answer (statuses and field names only).

## Hosting

Planned on Cloudflare Pages: build command `npm run build`, output directory `dist`. Price history will
live in a Cloudflare Worker with a D1 database (see the plan). Nothing is deployed yet.

## Android app

`android/` is a [Capacitor](https://capacitorjs.com) wrapper around the web build (app ID `top.kcaron.goldline`).
The APK is built by GitHub Actions (`.github/workflows/android.yml`), not on this PC:

- **Actions → Android APK → Run workflow** builds an APK and attaches it to the run.
- Pushing a tag such as `v0.1.1` (after bumping `package.json`) also publishes a release; the stable download link
  is `https://github.com/kevincaron28/Trading-Wow/releases/latest/download/goldline.apk`.

Signing: the release key lives outside the repo (`C:\Users\Kev\Desktop\wow-trading-signing`, keep it private and backed
up). Until the repo has the `GOLDLINE_KEYSTORE_BASE64` and `GOLDLINE_KEYSTORE_PASSWORD` secrets, CI builds a
debug-signed APK; switching to the release key later means uninstalling that preview once.

Icons and splash screens come from `assets/` (`npx @capacitor/assets generate --android`).
