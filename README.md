# Goblin Ledger

Live auction house price charts for **World of Warcraft Forever**, as a phone app (Android APK) and a web preview of it,
in English and French, for the US (Americas) auction houses. The Android app is the product; the website is a preview and companion, with no separate features.

- **Watchlists**: twelve prebuilt lists (Flipping, Alchemy & Herbalism, Mining & Blacksmithing, Tailoring,
  Leatherworking & Skinning, Enchanting, Engineering, Elementals, Cooking & Fishing, Raid consumables, Crates & writs,
  Camp & stations) plus your own. Price, 24h change (% or gold), sort, edit, reset.
- **Search**: every item seen on the Forever auction houses (~7,400), English or French names, item ID,
  category filters, recent items, add to a list in one tap.
- **Chart**: candles, bars, line, area or Heikin Ashi; 1H / 4H / 1D / 1W; listed quantity, SMA 20, EMA 50,
  Bollinger bands, RSI and MACD panes; compare with another item (percent scale); market price or lowest buyout.
- **Item details**: market price, lowest buyout, 24h change, 7-day average, quantity and auctions, and the same
  item in the Alliance, Horde and Blackwater (neutral) houses after the house cut.
- **Explore**: gainers, losers, most listed, below-average deals and a flip finder between your faction house
  and the neutral house.
- **Alerts**: price above/below, checked while the app is open and on Android about every 30 minutes in the
  background (Capacitor Background Runner, `public/runners/alerts.js`), with a phone notification.
- Realm and faction picker (PvP and three other realm groups × Alliance / Horde / Blackwater), dark and light themes.

Goblin Ledger is an independent fan project, not affiliated with Blizzard Entertainment. Charts use the open-source
[Lightweight Charts](https://github.com/tradingview/lightweight-charts) library (Apache 2.0); its small
attribution logo on the chart is required by that licence and stays.

## Live data

Prices come from Blizzard's official Game Data API for WoW Forever, collected hourly by `collector/` and
published as JSON on the `data` branch, which the app reads. New data comes only from the Blizzard API. History before 18 Nov 2026 is a finished, static part of our own
series (permission and merge rule in docs/DATA.md); where they overlap, our Blizzard data wins. Details, verified routes and file formats:
[docs/DATA.md](docs/DATA.md). The app contains no secret.

The hourly collection runs on an Oracle VM from a systemd timer: [docs/COLLECTOR_VM.md](docs/COLLECTOR_VM.md) (install,
checks, troubleshooting). GitHub Actions is the manual fallback: to run the collection on GitHub, add two repository secrets (Settings → Secrets and variables →
Actions): `BNET_CLIENT_ID` and `BNET_CLIENT_SECRET` from the "Goldline Forever" Battle.net client (kept under its old name) at
<https://develop.battle.net/access/clients>. `.github/workflows/collect.yml` then runs every hour (scheduled
workflows run from `main`, so after this branch is merged).

On a PC: put the same two values in a gitignored `.env`, check out the `data` branch next to the repo
(`git worktree add ../wow-trading-data data`), then `bash collector/publish.sh ../wow-trading-data`.

## Develop

Needs Node 22+ (the collector uses Node 24's built-in TypeScript support).

```bash
npm install
npm run dev
```

Before calling anything done:

```bash
npm run typecheck
npm test
npm run build
```

CI runs the same on every pull request. `npm run probe:blizzard` re-checks which Blizzard routes answer.

| Path | What |
| --- | --- |
| `src/ui/` | Preact screens: watchlist, search, chart, explore, alerts, menu |
| `src/ui/chartEngine.ts` | Chart types, indicators, panes, comparison |
| `src/app/store.ts` | Settings, watchlists, alerts (saved on the device) and the realm → house map |
| `src/data/live.ts` | Reads the published data files |
| `src/data/watchlists.ts` | Prebuilt lists (verified item IDs) and search categories |
| `src/lib/` | Pure logic with tests: candles, indicators, explore (movers, deals, flips), alerts, money, i18n |
| `collector/` | Hourly Blizzard collection and publishing |

## Android app

`android/` is a [Capacitor](https://capacitorjs.com) wrapper (app ID `top.kcaron.goldline`). GitHub Actions builds
the APK (`.github/workflows/android.yml`); pushing a tag `vX.Y.Z` publishes it, and
`https://github.com/kevincaron28/Trading-Wow/releases/latest/download/goldline.apk` always serves the newest one.

Signing: the release key is kept outside the repo (`C:\Users\Kev\Desktop\wow-trading-signing`, private, back it
up). Until the repo has the `GOLDLINE_KEYSTORE_BASE64` and `GOLDLINE_KEYSTORE_PASSWORD` secrets, CI builds a
debug-signed APK; moving to the release key later means uninstalling once.
