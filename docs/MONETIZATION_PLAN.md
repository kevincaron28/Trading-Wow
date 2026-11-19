# Goldline monetization plan (not built yet)

Written 19 November 2026 at the owner's request: "a free version with ads and a paid version without ads that has
trading strategies integrated". Nothing here is built. Owner decisions are marked **Owner**.

## 1. Free and Pro

One app on Play, with an in-app upgrade. Two separate listings would split reviews, alerts and watchlists.

| | Free (with ads) | Goldline Pro (no ads) |
|---|---|---|
| Live prices, every house, both languages | Yes | Yes |
| Charts: every timeframe, chart type and indicator | Yes | Yes |
| History (Goldline hourly, earlier sources) | Yes | Yes |
| Watchlists | 3 lists, 25 items each | Unlimited |
| Price alerts | 5 active | Unlimited, plus strategy alerts |
| Indexes | Read | Read, plus index-based signals |
| Ads | Banner on lists, no full-screen ads during charting | None |
| Trading strategies (section 2) | Preview: the top 3 results, blurred after that | Full |
| CSV export of a watchlist or strategy result | No | Yes |

Rules:
- Never show an ad on the chart while the user is touching it, or as a full-screen interstitial when the app opens.
  At most one rewarded ad, chosen by the user ("watch an ad to unlock this strategy for 24 h").
- Anything free today stays free. Pro adds features; it doesn't take any away.

## 2. Strategies (Pro)

Each strategy is one screen per house, computed on the device from data the app already has. Each result says why it
qualifies, and the risk is spelled out ("estimated sales: this is a guess").

1. **Flip finder.** Items listed under their 7-day market value by at least X% that also sell enough (estimated sales
   of at least N a day), ranked by expected profit after the 5% or 15% house cut and the deposit.
2. **Crafting margin.** For each recipe: result value after the cut, minus reagent cost at the current lowest buyout.
   Ranked by margin times estimated sales. Needs a recipe table: Blizzard's Game Data API has professions and
   recipes for Forever, so check that first. AHledger's crafting endpoint needs a licence (section 6).
3. **Sniping thresholds.** For each watched item, a suggested "buy under" and "sell over" price from the 30-day spread
   (25th and 75th percentiles of the market value). One tap turns either into an alert.
4. **Market alerts.** Alerts on more than price: a supply drop (listed quantity down X% in 24 h), a price spike over
   the 7-day high, or a new low. These run on the existing background runner.
5. **Index signals.** Moving-average crossovers and RSI extremes on the Goldline indexes (for example, "Herbs crossed
   above its 7-day average"), shown as context for the whole sector rather than as buy calls.
6. **Raid-prep calendar.** Consumable prices against the raid opening on 9 December and weekly resets, from the
   collector's history.
7. **Cross-faction and neutral spread.** The same item on Alliance, Horde and Blackwater, after the 15% neutral cut.

Every strategy screen carries a line saying it's information, not advice, that in-game gold has no cash value, and
that the figures are estimates.

## 3. Google Play Billing

- **Product.** One subscription, "Goldline Pro": monthly and yearly base plans, with an optional 7-day free trial.
  Add a lifetime one-time purchase later only if many people ask for it. **Owner** picks the prices; suggested
  CA$2.99 a month and CA$19.99 a year.
- **Library.** Play Billing Library 7+ through a Capacitor plugin (`@capgo/native-purchases` or RevenueCat's
  `@revenuecat/purchases-capacitor`). RevenueCat is free under US$2.5k a month in revenue and handles receipts,
  grace periods and restores without a server. Without it we'd need a server (the Cloudflare Worker) to verify
  purchase tokens with the Play Developer API.
- **What's needed.**
  - A Play payments profile, a merchant account and tax details. **Owner** only, since it involves ID and bank details.
  - Products created in Play Console.
  - A licence-testing account for test purchases.
  - The new plugin. It's native code, so the release raises `minNativeBuild` and everyone installs it from Play.
- **Restore purchases** in Settings. Pro state is cached on the device and checked again on each start.

## 4. Ads: AdMob with UMP consent

- **Setup.**
  - AdMob account linked to the Play developer account (**Owner**).
  - App ID in `AndroidManifest.xml` and the `@capacitor-community/admob` plugin (native, so `minNativeBuild` goes up).
  - Banner units only at first, plus an optional rewarded unit.
- **Consent.**
  - Google's User Messaging Platform (UMP) form on first start. It's required for EEA, UK and Switzerland users,
    and Quebec's Law 25 also expects clear consent.
  - The form needs a privacy policy URL; we have kcaron.top/goldline/privacy (to update).
  - Settings gets "Privacy choices", which reopens the UMP form.
- **Personalization.** Non-personalized ads by default until consent. No ads for users who said they're under 16
  (Families policy). Goldline isn't in the Families program, so set the target audience to 18+ in Play Console.
- **`app-ads.txt`** at `https://kcaron.top/app-ads.txt` with the AdMob publisher line
  (`google.com, pub-XXXXXXXX, DIRECT, f08c47fec0942fa0`). The developer website in the Play listing must be
  kcaron.top for AdMob to verify it. kcaron.top already serves AdSense; reuse the same publisher ID if AdMob shares it.
- **Play declarations to update when ads ship.**
  - "Contains ads": yes.
  - Data safety: the advertising ID, approximate location (from IP), device identifiers, and app interactions are
    collected and shared with Google for ads and analytics, encrypted in transit, and users can ask for deletion
    through Google.
  - Advertising ID declaration: yes, with the `AD_ID` permission (the AdMob plugin adds it).
  - Content rating: answer the ads question again (IARC).

## 5. Play "trader" status (Owner, before any monetized release)

Since the DSA (EU), Play asks every developer account whether it is a **trader**. Goldline was declared "not a
trader" while it's free with no ads. As soon as the app earns money (ads or Pro), the account becomes a trader for
EU purposes.
- **Owner** changes the declaration in Play Console (Account details, then Trader status).
- **Owner** provides public contact details that Play shows on the listing in the EU: name or business name, address,
  phone number and email.
- If he'd rather not show a home address, register a business (a Quebec sole proprietorship or corporation) with a
  business address first.
- This has to be done before the first release with ads or Pro, or EU users won't see the app.

## 6. Data licences that change with money

| Source | Free app today | Once there are ads or Pro |
|---|---|---|
| Blizzard Game Data API | Allowed (API terms) | Allowed: Blizzard's API terms allow apps with ads, but don't charge for access to Blizzard data itself, and keep the attribution. Pro must sell Goldline's features, not "the prices". |
| AHledger (live history on the chart) | Free as a community tool, credited | **Needs a commercial licence** (from 10 Dec 2026): "Site" tier, US$29 a month, for ads; "Product", US$99 a month, for a paid tier. Credited partners get 50% off. Otherwise turn it off (`AHLEDGER_ON` in `src/lib/ahledger.ts`). Ask through ahledger.com's contact form. |
| ahprice.com | Used with permission (owner, 18 Nov) | Ask ahprice again whether the permission covers a monetized app |
| TradeSkillMaster public files | Credited | Check TSM's terms for commercial use before the first ad build; drop the series if they say no |
| Auctionator seed (owner and guildmate scans) | Own data | Fine |

## 7. Build order (estimate)

| Step | What | Effort | Who |
|---|---|---|---|
| 1 | Privacy policy update; trader status and public contact details | 1 h writing, plus owner time | Owner and Claude |
| 2 | Pro gating layer: an `isPro()` flag, limits on lists and alerts, the upgrade screen (no billing yet, toggled by a dev flag) | 1 day | Claude |
| 3 | Strategies 1, 3 and 4 (flip finder, sniping thresholds, market alerts) from existing data | 2–3 days | Claude |
| 4 | Billing plugin and RevenueCat, products in Play Console, licence testers, restore purchases | 1–2 days, plus owner setup | Claude and Owner |
| 5 | AdMob and UMP, banner units, `app-ads.txt`, data safety and ads declarations | 1 day, plus owner setup | Claude and Owner |
| 6 | Data licences settled (AHledger licence or the series turned off; ahprice and TSM confirmed) | owner emails | Owner |
| 7 | Closed testing track with Pro and ads, about 1 week | 1 week | Testers |
| 8 | Strategies 2, 5, 6 and 7 (crafting needs the recipe table) | 3–4 days | Claude |
| 9 | Production release | after 7 | Owner approves |

Steps 2 and 3 can start without any owner action. Steps 4 and 5 can't be published until steps 1 and 6 are done.
