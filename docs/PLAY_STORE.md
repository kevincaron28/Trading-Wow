# Goblin Ledger on Google Play

Prepared 18 November 2026; listing text updated 26 November 2026. Package `top.kcaron.goldline`, developer account "KCaron".

## Files (outside the repo)

| What | Where |
| --- | --- |
| Upload key (PKCS12, alias `goldline`, password in README.txt) | `C:\Users\Kev\Desktop\wow-trading-signing\goldline-release.p12`: private, back it up; use **Play App Signing** so Google holds the app signing key and this is only the upload key |
| Signed App Bundle 0.2.0 (version code 200) | `C:\Users\Kev\Desktop\wow-trading-play\goldline-0.2.0.aab` |
| Icon 512×512 (in the repo, painted 26 November 2026) | `assets/play/icon-512.png` |
| Feature graphic 1024×500, no text (in the repo, painted 26 November 2026) | `assets/play/feature-1024x500.png` |
| Phone screenshots 810×1440 | `C:\Users\Kev\Desktop\wow-trading-play\phone-1-watchlist.png` … `phone-4-search.png` |

**Since 1.0.1 the bundle is built by CI.** Pushing a `v*` tag runs `.github/workflows/android.yml`, which builds
`goblin-ledger-<version>.aab` (flavour `play`, version code major*10000 + minor*100 + patch, signed with the upload key
from the `GOLDLINE_KEYSTORE_BASE64` / `GOLDLINE_KEYSTORE_PASSWORD` secrets) and attaches it to the GitHub release next to
the APK. Download it from the release (or from the run's "goblin-ledger-play-bundle" artifact after a manual run) and
upload it in Play Console. The run summary prints the signing certificate's SHA-256: it must match Play Console >
App integrity > Upload key certificate. Backing up the upload key: [KEY_BACKUP.md](KEY_BACKUP.md).

Fallback, building by hand on this PC (JDK and SDK from `D:\GuildedAndroidLab`):

```bash
npm run build && npx cap sync android
cd android && JAVA_HOME="D:/GuildedAndroidLab/jdk/jdk-21.0.13+9" ANDROID_HOME="D:/GuildedAndroidLab/sdk" \
  GOLDLINE_KEYSTORE="C:/Users/Kev/Desktop/wow-trading-signing/goldline-release.p12" GOLDLINE_KEYSTORE_PASSWORD=... \
  GOLDLINE_VERSION_CODE=<major*10000+minor*100+patch> ./gradlew bundlePlayRelease   # app/build/outputs/bundle/playRelease/app-play-release.aab
```

## Store listing

Rewritten 27 November 2026 for search and conversion; the research behind it is in [play/aso.md](play/aso.md). It
describes the app from 1.1.2 plus `main`: send it for review together with the 1.2.0 release.

**App name (Play title, ≤30, English and French):** Goblin Ledger: WoW Forever AH

The app, the website and the text below use the brand name, Goblin Ledger. The package stays `top.kcaron.goldline`.

**Short description (EN, ≤80):** Track WoW auction house prices: US Forever charts, alerts, flips and crafts.

**Short description (FR-CA and FR-FR, ≤80):** Prix de l’hôtel des ventes WoW Forever (US) : graphiques, alertes, reventes.

**Full description (EN, 3489 characters):**

```text
Check WoW auction house prices from your phone and know what to buy, craft or resell before you log in. Goblin Ledger is a price tracker for the World of Warcraft Forever auction house on US (Americas) realms, refreshed about every hour from Blizzard's official auction data. Prices read the way they do in game, in gold, silver and copper (g/s/c).

■ Know the market in a minute
• See a price index, how many items are rising or falling, sales compared with a usual day and the gold traded
• Spot the biggest movers over 24 hours or 7 days
• Find consumables and materials selling below their 7-day average, to stock up on before raid night

■ Catch up with recaps
• Daily, weekly and monthly recaps of your auction house, with earlier ones kept
• Index performance, top risers and fallers, most traded items, raid consumables, flips and crafting margins
• A weekly view with new price highs and lows

■ Spend your gold where it pays
• Flips: items listed well under their usual price, with the profit after the auction house cut
• Flip finder between your faction and the neutral Blackwater auction house
• Gainers, losers, top sellers, most listed and below-average deals
• A sales-per-day filter keeps deals and flips to items that actually move

■ Craft only what makes money
• Material cost and profit per item, using the cheapest recipe
• Profitable crafts by profession, from alchemy to tailoring
• A material cost line on the chart shows when crafting beats buying

■ Read the price history
• Candles, bars, line, area and Heikin Ashi charts, from 1-hour to 1-week candles
• Listed quantity, moving averages, Bollinger bands, RSI and MACD
• Compare two items, draw price lines, switch to a log scale and share a chart as an image
• Market price, lowest buyout, 24-hour change, 7-day average, estimated sales per day and days of supply
• The same item in other auction houses, after the cut

■ Get told when the price is right
• Price alerts when an item rises above or falls below your target
• Deal alerts when something on a watchlist is listed 20, 30 or 50% under its 7-day average
• On Android, alerts are also checked in the background about every 30 minutes; your phone decides the exact time

■ Follow what you trade
• Twelve ready-made watchlists: flipping, professions, elementals, raid consumables, crates and writs, camp and stations
• Build your own lists, reorder them and sort by name, price, sales or change
• Search over 7,000 items by English or French name, item ID, category or several words in any order

■ Follow whole markets
• Price indexes for the most traded items, herbs, ores and bars, cloth, leather, enchanting materials, elementals, consumables and raid prep
• See what is in each basket, its weight and how it moved the index

■ Made for your realm
• WoW auction house prices for all 12 US Forever houses: PvP, Normal, RP and RP-PvP, for Alliance, Horde and neutral Blackwater
• English or French, dark or light theme, your choice of time zone
• Offline, the app shows the last prices saved on your phone

■ Honest numbers, private by design
• The auction house shows listings, not sales: sales figures are estimates from auctions that disappear before expiring
• Profit figures leave out deposits
• No account, no ads, no tracking: your lists and alerts stay on your phone

Goblin Ledger is an independent fan project and is not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft is a trademark of Blizzard Entertainment, Inc.
```

**Full description (FR-CA and FR-FR, 3690 characters):**

```text
Consultez les prix de l’hôtel des ventes WoW sur votre téléphone et sachez quoi acheter, fabriquer ou revendre avant de vous connecter. Goblin Ledger suit les prix de l’HV de World of Warcraft Forever pour les royaumes des États-Unis (Amériques), mis à jour environ chaque heure à partir des données officielles de Blizzard. Les prix s’affichent comme en jeu, en or, argent et cuivre (g/s/c).

■ Le marché en une minute
• Indice des prix, objets en hausse et en baisse, ventes comparées à une journée habituelle, or échangé
• Les plus fortes variations sur 24 heures ou 7 jours
• Consommables et matériaux sous leur moyenne de 7 jours, à accumuler avant le raid

■ Les récaps
• Récaps quotidiens, hebdomadaires et mensuels de votre hôtel des ventes, avec les précédents
• Indices, meilleures hausses et baisses, objets les plus échangés, consommables de raid, reventes et marges d’artisanat
• Une vue de la semaine avec les nouveaux sommets et creux

■ Placez votre or là où il rapporte
• Reventes : objets bien sous leur prix habituel, avec le profit après la commission
• Chercheur de reventes entre votre faction et l’hôtel neutre de Bourbe-Noire
• Hausses, baisses, plus vendus, plus en vente et aubaines sous la moyenne
• Un filtre de ventes par jour limite les aubaines et reventes aux objets qui partent vraiment

■ Fabriquez ce qui paie
• Coût des matériaux et profit par objet, avec la recette la moins chère
• Fabrications rentables par métier, de l’alchimie à la couture
• Une ligne de coût sur le graphique montre quand fabriquer bat l’achat

■ L’historique des prix
• Chandeliers, barres, ligne, aire et Heikin Ashi, en chandelles d’une heure à une semaine
• Quantité en vente, moyennes mobiles, bandes de Bollinger, RSI et MACD
• Comparez deux objets, tracez des lignes de prix, passez en échelle log et partagez un graphique en image
• Prix du marché, achat immédiat le plus bas, variation sur 24 heures, moyenne sur 7 jours, ventes estimées par jour et jours de stock
• Le même objet dans les autres hôtels des ventes, après commission

■ Des alertes au bon prix
• Alertes quand un objet monte au-dessus ou descend sous votre cible
• Alertes d’aubaines quand un objet d’une liste est affiché 20, 30 ou 50 % sous sa moyenne de 7 jours
• Sur Android, les alertes sont aussi vérifiées en arrière-plan environ toutes les 30 minutes; le téléphone choisit le moment

■ Vos listes de suivi
• Douze listes prêtes : revente, métiers, éléments, consommables de raid, caisses et ordres, camp et ateliers
• Créez vos listes, réorganisez-les et triez par nom, prix, ventes ou variation
• Plus de 7 000 objets à chercher par nom français ou anglais, ID, catégorie ou plusieurs mots

■ Des marchés entiers
• Indices de prix : objets les plus échangés, herbes, minerais et lingots, tissus, cuirs, enchantement, éléments, consommables et préparation de raid
• Le contenu de chaque panier, les poids et l’effet de chaque objet

■ Pour votre royaume
• Les prix des 12 hôtels des ventes américains de Forever : JcJ, Normal, JdR et JdR-JcJ; Alliance, Horde et Bourbe-Noire neutre
• Français ou anglais, thème sombre ou clair, fuseau horaire au choix
• Hors ligne, l’application montre les derniers prix enregistrés

■ Chiffres honnêtes, vie privée respectée
• L’hôtel des ventes montre des annonces, pas des ventes : les ventes sont estimées à partir des enchères disparues avant d’expirer
• Les profits excluent les dépôts
• Aucun compte, aucune publicité, aucun pistage : vos listes et alertes restent sur votre téléphone

Goblin Ledger est un projet de fan indépendant, sans affiliation avec Blizzard Entertainment. World of Warcraft est une marque de commerce de Blizzard Entertainment, Inc.
```

**Category:** Tools. **Tags:** finance-free. **Contact:** the developer account's email; website <https://kcaron.top>.

**Privacy policy URL:** https://github.com/kevincaron28/Trading-Wow/blob/legal/PRIVACY.md

## App content answers

| Section | Answer |
| --- | --- |
| Privacy policy | URL above |
| App access | All functionality is available without special access (no login) |
| Ads | No, the app contains no ads |
| Content rating (IARC) | Category "Utility, productivity, communication or other" (not a game). No violence, sexuality, language, controlled substances or gambling; no user interaction or chat; no sharing of location; no purchases of digital goods. Expected rating: Everyone / PEGI 3 |
| Target audience | 18 and over (not designed for children; avoids the Families programme) |
| News app | No |
| Data safety | Collects no data, shares no data. Data is encrypted in transit (HTTPS). No account, so no account-deletion URL needed |
| Government app | No |
| Financial features | None (in-game gold only, no real money) |
| Health | None |
| Advertising ID | Not used |

## Testing

- **Internal testing:** list "Goldline internal" with the owner's Gmail; roll out the 0.2.0 bundle; share the opt-in link.
- **Closed testing (Alpha):** list "Goldline closed testers", countries: all; same bundle. Add the tester community's emails (12+), then start the test. Personal accounts need 12+ testers opted in for 14 continuous days before applying for production.

The Play-installed app is signed by Google (Play App Signing), so the GitHub APK (debug-signed) must be uninstalled once before installing from Play.

## Two builds and updates (0.8)

`android/app/build.gradle` has two flavors:
- **play:** the Google Play bundle (`bundlePlayRelease`). It never installs APKs; native updates come from Play's
  in-app update prompt (`@capawesome/capacitor-app-update`).
- **sideload:** the GitHub / kcaron.top APK (`assembleSideloadRelease`, built by the tag workflow). Only this build
  declares REQUEST_INSTALL_PACKAGES (`src/sideload/AndroidManifest.xml`). It downloads a newer APK from the release
  and opens Android's installer; Android asks once to allow installs from Goblin Ledger.

Both get JS/CSS updates over the air, which Play allows for WebView code:
- each tag release publishes `web-bundle.zip` and `update.json` (version, version code, minNativeBuild, SHA-256);
- the app checks on launch and every 6 hours, downloads with Capgo's open-source updater (self-hosted, no Capgo cloud
  or statistics), applies it at the next start or right away with "Update now", and rolls back if the bundle does not
  start.

Raise `goldline.minNativeBuild` in package.json to the new version code whenever a release changes native code
(plugins, Android files). Older apps are then sent the APK or Play update instead of the bundle.
