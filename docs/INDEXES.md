# Goblin Ledger market indexes / Indices du marché Goblin Ledger

## English

Goblin Ledger publishes market indexes for every auction house, in the spirit of stock and commodity indexes. They are
computed from Goblin Ledger's hourly prices by `collector/indexes.ts` and published as `index/<house>.json`; the
definitions are in `index/meta.json`.

| Index | Basket | Cap per item |
|---|---|---|
| Ledger 100 | The 100 most traded items by daily gold volume. Weapons and armour are left out (random suffixes share one item ID), and so are recipes (rare one-off purchases whose estimated sales are too noisy). | 10% |
| Herbs | Up to 30 herbs | 25% |
| Ores & Bars | Up to 30 ores, bars and stones | 25% |
| Cloth | Up to 30 cloth items | 25% |
| Leather | Up to 30 leathers and hides | 25% |
| Enchanting mats | Up to 30 dusts, essences and shards | 25% |
| Elementals | Up to 30 elemental trade goods (WoW Forever has no gem category) | 25% |
| Consumables | Up to 50 potions, elixirs, flasks, food, scrolls and bandages | 15% |
| Raid prep | Up to 30 flasks, elixirs and potions (raids open 9 December) | 20% |

Not built: a "crafted gear" index (the item data does not say whether gear is crafted) and a gem index (no gem
category in WoW Forever).

**Which method is live.** Method 4 (below) applies to a house once the backfill has been published
([COLLECTOR_VM.md](COLLECTOR_VM.md), "Publish an index backfill"). Until then the house stays on method 3. The `method`
field of each index in `index/<house>.json` says which one it uses. The series as they were before the backfill stay in
`index/legacy/`.

### Method 4

| Part | Rule |
|---|---|
| **Formula** | Weighted geometric mean with weights fixed for the period (a "geometric Young" index): `value(t) = L × exp( Σ w × ln( price(t) / price₀ ) / Σ w )`. `L` is the level at the last review, `price₀` the price at that review, `w` the weight. |
| **Price** | Hourly: the median of the item's last 7 hourly market values (the market value is itself the cheaper half of the cheapest 30% of listed units, [DATA.md](DATA.md)). Daily, before 18 Nov: the day's market value. |
| **Spike guard** | A price is held within ×2 and ÷2 of the item's median over the 72 hours before (daily: the 3 days before). A lasting move passes once the 72-hour median has moved. |
| **Outlier cap** | In the value, one item counts as at most ×3 or ÷3 of its price at the last review. |
| **Weights** | The item's **median daily gold traded** over the selection window (estimated units sold × that day's median price), capped per item and renormalised to 1. Before 18 Nov, when sales are unknown: the median daily gold **listed** (quantity × market value). |
| **Who can enter** | Hourly data: at least 5 sold in the window and 1 a day, listed in at least half of its hours, at least 1 gold traded a day. Daily data: listed on at least half of the days, at least 1 gold listed on a typical day. |
| **Missing prices** | A price older than 72 hours (3 days) is left out and the other weights are renormalised; nothing is interpolated. An item that stops trading fails the entry rules at the next review and leaves. An index needs 5 priced items. |
| **Base** | 100 on the first day of data, 5 Nov 2026 (WoW Forever's launch evening, 4 Nov in America); a house starts later when too little was listed. Houses with no earlier prices (Blackwater) start at 100 at the close of their first day of hourly data (18 Nov). |
| **Continuity** | At a review the new basket starts at the old basket's level, both measured at the same prices, so a review never moves the index (what a stock index does by changing its divisor). Where our hourly prices take over from the daily ones (18 Nov), no price relative crosses the two sources: the level carries over and the base prices are our first hourly ones. |

**Reviews** (`reviewTimes` in `collector/index-v4.ts`, `RULES` in `collector/indexes.ts`)

| | Launch reviews | Monthly reconstitution | Quarterly review |
|---|---|---|---|
| When | Tuesday 15:00 UTC on 10, 17 and 24 Nov 2026 | First weekly reset of each month, Tuesday 15:00 UTC (1 Dec 2026, then 5 Jan, 2 Feb 2027…) | The January, April, July and October rebalance (first: 5 Jan 2027) |
| Selection window | The 7 days before | The last 7 days | The last 14 days |
| Buffer | A constituent stays while it ranks within 1.2 × the basket size | Same | None: the basket is rebuilt from the ranking |

- **Launch reviews** exist because the first calendar date of the monthly rule after launch is 1 December (the first
  Tuesday of November, 3 Nov, was the day before launch), and the market changed too fast to hold one basket for four
  weeks: items listed went from about 1,900 on 5 Nov to 6,900 on 17 Nov (PvP Horde).
- **The one look-ahead.** The first basket is chosen from the first five days (5–9 Nov). A single launch-day snapshot is
  full of joke prices: on PvP Horde, Benedict's Key was listed at 50 g on 5 Nov and 1 s on 8 Nov, and a basket chosen
  from day one alone gave such items the 10% cap. Every later basket uses only data from before its review.
- **History.** Every past basket stays in `index/<house>.json` (`periods`) and is never edited; `changes` lists what each
  review added and removed (a launch review there has `kind` "monthly", which the recaps read, plus `launch: true`).
  A review is applied once a snapshot at or after its time exists, so a late collector run gives the same result.
- **Restatement.** Published values are not recomputed once the hourly rows behind them are dropped (14 days). A change
  of method applies going forward and is dated here; the backfill to method 4 is the one restatement, with the old series
  kept.

### Why this formula

The auction house is thin, young and easy to game: one person can list an item at any price, and "sales" are estimated
from auctions that vanish early, which includes cancellations. The choices follow from that.

| Question | Choice | Why |
|---|---|---|
| How to average price changes | Geometric, not arithmetic | An arithmetic mean of price relatives is biased upward when prices bounce, and the bias compounds from one rebalance to the next, one reason consumer price indexes adopted the geometric mean at item level ([Ottawa Group summary, IMF][ottawa]; [IMF CPI manual, chain drift][drift]). The geometric mean passes the time reversal test: if prices come back, so does the index. Measured on our data below. |
| Superlative indexes (Fisher, Törnqvist) or Paasche | Not used | They need the current period's quantities. Ours are estimates that include cancellations, the cheapest thing to fake, and the index would change after publication. |
| Fixed or current weights | Fixed between reviews, from past data | As in stock and commodity indexes, which set weights at a rebalance and keep the level continuous with a divisor ([S&P DJI index mathematics][spmath]). |
| What to weight by | Gold traded, median day | Commodity indexes weight by liquidity and production ([S&P GSCI][gsci]; [Bloomberg Commodity Index][bcom], two thirds liquidity); there is no production figure here. MSCI measures liquidity with the **median** daily traded value so a few extreme days do not count ([MSCI GIMI][msci]). EVE Online's mineral index reweights monthly by the previous month's trade value ([CCP][eve]). |
| Concentration | Caps per item and a 1.2× buffer | Standard capping and buffer zones ([S&P DJI][spmath]; [MSCI][msci]). |
| Price input | Medians over time, a guard and a cap | Crypto reference rates, built for markets that can be gamed, use medians over time slices so that a cluster of odd trades has little effect and moving the rate takes sustained activity ([CF Benchmarks][cf]). |
| Items that stop trading | Drop after 72 hours, remove at review | Carrying the last price forward indefinitely biases a price index toward no change ([UNECA summary of the CPI manual][carry]); stock indexes remove dead constituents at a review ([S&P DJI policies][sppol]). |
| Back-tested history | Labelled, rules fixed, old series kept | A back-test is built with hindsight even when it follows the live rules ([FTSE Russell statement on the IOSCO principles][ftse]). The two judgement calls here (launch reviews and the five formation days) are stated above. |

Sources were read through search summaries, except the CF Benchmarks page (read directly); the IMF and Bloomberg
documents refused automated reading. Check the primary text before quoting any of them.

### Tests on our own data (data to 26 Nov 2026, 16:00 UTC)

**Time reversal.** 90 baskets (10 auction houses × 9 indexes), measured from 20 Nov to 26 Nov and back; the product
should be exactly 1.

| Formula | Average error | Largest |
|---|---|---|
| Geometric | 0.00% | 0.0% |
| Arithmetic | +19.2% | +224% |

**Spikes.** All 105 series, hourly values from 18 Nov. "Undone moves" are hourly moves over 10% mostly reversed within
48 hours: noise or manipulation rather than news.

| Variant | 99th percentile hourly move | Largest | Undone moves |
|---|---|---|---|
| **Guard ×2 and cap ×3 (chosen)** | 8.3% | 34% | 84 |
| No guard, cap ×3 | 9.8% | 51% | 133 |
| Guard ×1.5, cap ×3 | 6.9% | 28% | 39 |
| Guard ×3, cap ×3 | 9.2% | 46% | 116 |
| Guard ×2, no cap | 8.7% | 49% | 92 |
| Neither | 12.1% | 142% | 192 |
| Arithmetic, guard ×2, cap ×3 | 9.3% | 40% | 116 |

A guard of ×1.5 is quieter still but holds back real moves longer; ×2 was kept. Review it at the January review, when
there are two months of data (raids open on 9 December).

**Gold listed as a stand-in for gold traded** (the days before 18 Nov). Measured on later days, where both are known:
the top 100 by gold listed shares 64–80 items with the top 100 by gold traded and holds 87–97% of its traded value.
Counting auctions instead shares only 10–23.

**Checks** (`tests/index-v4.test.ts` and a run on the real data): a rebuild gives the same files every time; hourly runs
after the backfill give the same values as one rebuild (21,395 points, 12 houses); none of 317 basket changes moves a
level.

**Limits.** The days before 18 Nov come from the merged early history, a rougher measure than our hourly prices, with no
sales figures. Launch prices were extreme, so most indexes fall steeply in the first week under either method. Thin houses
(Blackwater, RP PvP) move much more than large ones.

### Rebuilding the history

`collector/backfill-indexes.ts` rebuilds every index of every house from the first day of data with method 4. It is
deterministic (the build time is the data's own update time), deletes nothing, copies the files it replaces to
`index/legacy/` once, and refuses to run once the hourly history no longer reaches 18 Nov (after 2 December 2026,
02:00 UTC). Old against new charts: [index-backfill/](index-backfill/).

### Method 3 (before the backfill)

Arithmetic mean of price relatives, `level × Σ w × price(t) / price₀` (each relative held within ×3 and ÷3); weights
from the gold traded over the window (sum); the 19 Nov basket applied back to launch, with chain-linked daily steps
before 18 Nov; monthly and quarterly rules as above, no launch reviews. Since 26 Nov a rebalance takes its base prices
at the changeover: with the window median, used before, the first rebalance would have moved every index by the gap
between that day's prices and the week's median.

## Français

Goblin Ledger publie des indices du marché pour chaque hôtel des ventes, à la manière des indices boursiers et de
matières premières. Ils sont calculés par `collector/indexes.ts` à partir des prix horaires de Goblin Ledger et publiés
dans `index/<maison>.json`.

La méthode 4 s'applique à un hôtel des ventes une fois la reconstruction publiée; avant, la méthode 3 reste en place. Les
anciennes séries sont conservées dans `index/legacy/`.

- **Paniers.** Le Ledger 100 regroupe les 100 objets les plus échangés, sans armes, armures ni recettes. Il y a aussi
  des indices sectoriels : herbes, minerais et lingots, tissu, cuir, composants d'enchantement, éléments, consommables
  et préparation de raid (tableau ci-dessus).
- **Formule.** Moyenne géométrique pondérée, avec des poids fixes d'une révision à l'autre : niveau à la dernière
  révision × exp(Σ poids × ln(prix actuel ÷ prix à la révision)). Un prix qui double et un prix qui diminue de moitié
  s'annulent, et l'indice revient à son niveau quand les prix reviennent (ce qu'une moyenne arithmétique ne fait pas :
  +19 % d'erreur en moyenne sur nos données).
- **Prix.** Médiane des 7 dernières heures, maintenue entre ×2 et ÷2 de la médiane des 72 heures précédentes; dans la
  valeur, un objet compte au plus pour ×3 ou ÷3 de son prix à la révision.
- **Poids.** Or échangé un jour typique (médiane des ventes estimées × prix), plafonné par objet. Avant le 18 nov., sans
  chiffres de ventes : l'or mis en vente un jour typique. Seuls les objets liquides entrent (au moins 5 ventes dans la
  fenêtre, 1 par jour, 1 po échangée par jour).
- **Base.** 100 le premier jour de données (5 nov. 2026, lancement de WoW Forever). Les hôtels sans prix antérieurs
  (Bourbe-Noire) partent de 100 à la fin de leur première journée de prix horaires.
- **Révisions.** Les mardis 10, 17 et 24 nov. à 15 h UTC (semaines de lancement), puis à la première réinitialisation de
  chaque mois, sur les 7 derniers jours; un objet déjà présent reste tant qu'il est classé dans 1,2 × la taille du
  panier. En janvier, avril, juillet et octobre, le panier est reconstruit sur 14 jours. Une révision ne fait jamais
  bouger le niveau.
- **Seule vue rétrospective.** Le premier panier est choisi sur les cinq premiers jours (5 au 9 nov.) : les prix du seul
  jour du lancement étaient trop souvent fantaisistes. Tous les paniers suivants n'utilisent que les données
  antérieures à leur révision.
- **Historique.** Les paniers passés ne sont jamais modifiés; les entrées et sorties sont publiées (`changes`) et
  affichées dans l'application. La prochaine date est dans `index/meta.json` (`next`).

[ottawa]: https://www.imf.org/-/media/files/data/cpi/companion-publication/the-ottawa-group-after-30-years.pdf.md
[drift]: https://imf.org/-/media/Files/Data/CPI/companion-publication/chapter-6-chain-drift-problem-and-multilateral-indices.ashx
[carry]: https://apai-crvs.uneca.org/sites/default/files/resourcefiles/en-special-series-on-covid-19-business-continuity-consumer-price-index.pdf
[spmath]: https://www.spglobal.com/spdji/en/methodology/article/index-mathematics-methodology
[sppol]: https://spglobal.com/spdji/es/documents/methodologies/methodology-sp-equity-indices-policies-practices.pdf
[gsci]: https://spglobal.com/spdji/kr/documents/methodologies/methodology-sp-gsci.pdf
[bcom]: https://assets.bbhub.io/professional/sites/27/BCOM-Methodology-FEB-2026.pdf
[msci]: https://www.msci.com/index/methodology/latest/GIMI
[cf]: https://www.cfbenchmarks.com/blog/suitability-analysis-of-the-cme-cf-bitcoin-reference-rate-new-york-variant-as-a-basis-for-regulated-financial-products
[eve]: https://www.eveonline.com/news/view/monthly-economic-report-february-2026
[ftse]: https://www.lseg.com/content/dam/ftse-russell/en_us/documents/statement/iosco-statement.pdf
