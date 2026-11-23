# Goblin Ledger on Google Play

Prepared 18 November 2026. Package `top.kcaron.goldline`, developer account "KCaron".

## Files (outside the repo)

| What | Where |
| --- | --- |
| Upload key (PKCS12, alias `goldline`, password in README.txt) | `C:\Users\Kev\Desktop\wow-trading-signing\goldline-release.p12`: private, back it up; use **Play App Signing** so Google holds the app signing key and this is only the upload key |
| Signed App Bundle 0.2.0 (version code 200) | `C:\Users\Kev\Desktop\wow-trading-play\goldline-0.2.0.aab` |
| Icon 512×512 | `C:\Users\Kev\Desktop\wow-trading-play\icon-512.png` |
| Feature graphic 1024×500 (no text) | `C:\Users\Kev\Desktop\wow-trading-play\feature-1024x500.png` |
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

**App name:** Goblin Ledger

**Short description (EN, ≤80):** Live auction house price charts, watchlists and alerts for WoW Forever players.

**Short description (FR-CA, ≤80):** Graphiques des prix de l'hôtel des ventes, listes de suivi et alertes pour WoW Forever.

**Full description (EN):**

Goblin Ledger turns the World of Warcraft Forever auction house into live price charts.

• Live prices for every Forever auction house (Alliance, Horde and neutral Blackwater), updated every hour from Blizzard's official auction data
• Nine ready-made watchlists: flipping, alchemy and herbs, mining and smithing, tailoring, leather, enchanting, engineering, cooking and fishing, raid consumables, plus your own lists
• Search over 7,000 items in English or French, by name, ID or category
• Full charts: candles, bars, line, area and Heikin Ashi; 1 hour, 4 hours, 1 day and 1 week
• Indicators: listed quantity, moving averages, Bollinger bands, RSI and MACD; compare two items
• Market price, lowest buyout, 24-hour change, 7-day average and the same item in the other auction houses after the house cut
• Explore: top gainers and losers, most listed, below-average deals and a flip finder between your faction and the neutral auction house
• Price alerts with notifications
• Dark and light themes, English and French

No account, no ads, no tracking: your lists and alerts stay on your phone.

Goblin Ledger is an independent fan project and is not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft is a trademark of Blizzard Entertainment, Inc.

**Full description (FR-CA):**

Goblin Ledger transforme l'hôtel des ventes de World of Warcraft Forever en graphiques de prix en direct.

• Prix en direct pour tous les hôtels des ventes de Forever (Alliance, Horde et Bourbe-Noire neutre), mis à jour chaque heure à partir des données officielles de Blizzard
• Neuf listes de suivi prêtes à l'emploi : revente, alchimie et herbes, minage et forge, couture, cuir, enchantement, ingénierie, cuisine et pêche, consommables de raid, plus vos propres listes
• Recherche parmi plus de 7 000 objets en français ou en anglais, par nom, ID ou catégorie
• Graphiques complets : chandeliers, barres, ligne, aire et Heikin Ashi; 1 heure, 4 heures, 1 jour et 1 semaine
• Indicateurs : quantité en vente, moyennes mobiles, bandes de Bollinger, RSI et MACD; comparaison de deux objets
• Prix du marché, achat immédiat le plus bas, variation sur 24 heures, moyenne sur 7 jours et le même objet dans les autres hôtels des ventes après commission
• Explorer : plus fortes hausses et baisses, objets les plus en vente, aubaines sous la moyenne et chercheur de reventes entre votre faction et l'hôtel neutre
• Alertes de prix avec notifications
• Thèmes sombre et clair, français et anglais

Aucun compte, aucune publicité, aucun pistage : vos listes et alertes restent sur votre téléphone.

Goblin Ledger est un projet de fan indépendant, sans affiliation avec Blizzard Entertainment. World of Warcraft est une marque de commerce de Blizzard Entertainment, Inc.

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
  and opens Android's installer; Android asks once to allow installs from Goldline.

Both get JS/CSS updates over the air, which Play allows for WebView code:
- each tag release publishes `web-bundle.zip` and `update.json` (version, version code, minNativeBuild, SHA-256);
- the app checks on launch and every 6 hours, downloads with Capgo's open-source updater (self-hosted, no Capgo cloud
  or statistics), applies it at the next start or right away with "Update now", and rolls back if the bundle does not
  start.

Raise `goldline.minNativeBuild` in package.json to the new version code whenever a release changes native code
(plugins, Android files). Older apps are then sent the APK or Play update instead of the bundle.
