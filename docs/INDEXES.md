# Goblin Ledger market indexes / Indices du marché Goblin Ledger

## English

Goblin Ledger publishes market indexes for every auction house, in the spirit of stock market indexes. They are computed
from Goblin Ledger's own hourly prices by `collector/indexes.ts` and published as `index/<house>.json` on the data branch;
the definitions are in `index/meta.json`.

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

**Method**
- **Weights.** An item's weight is its daily gold volume, meaning the estimated quantity sold (auctions that vanished
  early) times its median market value over the selection window. Weights are capped per item and renormalised to 1.
- **Liquidity.** A basket only takes liquid items: at least 5 units sold in the window, and listed in at least half of
  its hours.
- **Value.** `value(t) = level at the period start × Σ weight × price(t) / price at the period start`. The price is
  the robust market value (docs/DATA.md).
- **Missing prices.** A price older than 72 hours is left out for that hour, and the other weights are renormalised.
  Nothing is interpolated.
- **Base.** 100 = WoW Forever's launch (4 Nov 2026; the first UTC day of prices is 5 Nov, the launch evening in
  America). Precisely, the base is the first day on or after 4 Nov where the merged early history (`early/`, docs/DATA.md)
  prices at least 10 basket items, or half the basket when it is smaller. The basket is chosen from the first full day of our own hourly data
  (19 Nov), the same basket and weights are used back to launch, and the history is computed backwards from there.
- **Early days.** Daily values from launch until our hourly data starts (18 Nov 02:00 UTC).
  - Launch-week markets were thin: on 5 Nov only about a fifth of the busiest items were listed. So the early days
    are chain-linked: each day moves the level by the weighted mean price change of the basket items priced that
    day and on an earlier day (at most 3 days before).
  - Items that start trading later join without moving the level.
  - Outlier treatment: one item's daily move counts as at most ×2 or ÷2, and a day with fewer than 5 linked items
    leaves the level unchanged.
  - The hourly series is chain-linked to the last early day, so the level does not jump.
  - Everything is recomputed on each backfill publish (`link` and `earlyUntil` in index/<house>.json).
- **Blackwater:** no early prices exist, so the base stays at the close of 19 Nov.
- **Rebalancing.** See "Rebalancing" below.
- **Candles.** Hourly values build 1H, 4H and daily candles. Each item's contribution to the last 24 hours is
  `level × weight × (price now − price 24 h ago) / price at the period start`.

**Rebalancing** (like a stock index; rules since 26 Nov 2026, `RULES` in `collector/indexes.ts`)

| | Monthly reconstitution | Quarterly review |
|---|---|---|
| When | First weekly reset of each month, Tuesday 15:00 UTC (1 Dec 2026, then 2 Feb, 2 Mar 2027…) | The January, April, July and October rebalance (first: 5 Jan 2027) |
| Selection window | The last 7 days | The last 14 days (our hourly rows are kept 14 days) |
| Who can enter | Liquid items only: at least 5 sold in the window and 1 sold a day, listed in at least half of its hours, and at least 1 gold traded a day (estimated sold × median price) | Same |
| Ranking | Gold traded over the window, highest first | Same |
| Buffer | A constituent stays while it ranks within 1.2 × the basket size (top 120 for the Ledger 100); newcomers fill the remaining places by rank. Items hovering at the edge do not swap in and out every month | None: the basket is rebuilt from the ranking |
| Weights | Gold volume, capped per item (10% for the Ledger 100, 15–25% for the category indexes), renormalised to 1 | Same |

- **No jump: the divisor.** A stock index keeps its level continuous across a change by adjusting its divisor. Here,
  the new basket starts at the old basket's level, measured the hour before the rebalance:
  `level(new period) = value(old basket, t − 1 h)`. Then `value(t) = level × Σ weight × price(t) / price at the
  rebalance`. This is the same as a divisor `D = Σ units × base price / level` that is recomputed at each change.
- **History of changes.** Every past basket stays in `index/<house>.json` (`periods`, with `kind` monthly or quarterly)
  and is never edited. Each index also lists its `changes`: the date, the type, the items added and removed with their
  weights, the number kept and the level. The app shows them under an index ("Basket changes").
- **Calendar.** `index/meta.json` gives `next` (the next rebalance, unix seconds), `nextQuarterly`, `last` and the `rules`.
  The app shows the next date on the Indexes screen and under each index, and the recaps mention it in the week before.
- **Review.** At each quarterly review the owner also checks the thresholds, caps and basket sizes. A change to those
  applies from the next rebalance and is written here with its date. Past values are never recomputed.
- **Missed rebalance.** If the collector is down at 15:00 UTC, the next run does the rebalance with the prices up to
  15:00 (it is dated 15:00), so a late run gives the same result.

**Backtest** (PvP Horde, 18 Nov 02:00 to 19 Nov, provisional baskets)

| Index | Range | Median hourly move | Largest hourly move |
|---|---|---|---|
| Ledger 100 | 99.4–106.5 | 0.62% | 4.5% |
| Herbs | 98.4–131.5 | 1.6% | 19.9% |
| Ores & Bars | 93.5–108.3 | 1.7% | 7.6% |
| Cloth | 90.5–131.7 | 0.8% | 45% (Mooncloth, 18 Nov) |
| Consumables | 100–122.2 | 0.8% | 3.8% |
| Raid prep | 100–119.6 | 0.8% | 4.4% |

Early values use the merged daily market value. It is AHledger's median where AHledger has the item, otherwise the
lowest buyout, so they are a slightly rougher measure than the hourly robust market value used from 18 Nov.

## Français

Goblin Ledger publie des indices du marché pour chaque hôtel des ventes, à la manière des indices boursiers. Ils sont
calculés à partir des prix horaires de Goblin Ledger par `collector/indexes.ts` et publiés dans `index/<maison>.json` sur la
branche de données.

- **Paniers.** Le Ledger 100 regroupe les 100 objets les plus échangés, sans armes, armures ni recettes. Il y a aussi
  des indices sectoriels : herbes, minerais et lingots, tissu, cuir, composants d'enchantement, éléments, consommables
  et préparation de raid (voir le tableau ci-dessus).
- **Poids.** Ils suivent le volume quotidien en or (ventes estimées × valeur marchande médiane) et sont plafonnés par
  objet. Seuls les objets liquides entrent : au moins 5 ventes dans la fenêtre, et en vente pendant au moins la moitié
  des heures.
- **Valeur.** Niveau au début de la période × Σ poids × prix actuel ÷ prix au début. Les prix de plus de 72 h sont
  exclus et rien n'est interpolé.
- **Base.** 100 = lancement de WoW Forever (4 nov. 2026) : valeurs quotidiennes depuis le lancement, puis horaires,
  avec chaînage. Un objet sans prix un jour donné est exclu et les autres sont repondérés; un objet sans prix au
  lancement part de son premier prix. Bourbe-Noire n'a pas de prix antérieurs : sa base reste le 19 nov.
- **Rééquilibrage.** À la première réinitialisation hebdomadaire de chaque mois (mardi 15 h UTC). Le panier est choisi
  sur les 7 derniers jours. Seuls les objets liquides peuvent entrer : au moins 1 vente et 1 po échangée par jour.
  Un objet déjà dans le panier y reste tant qu'il est classé dans 1,2 × la taille du panier.
- **Révision trimestrielle.** En janvier, avril, juillet et octobre, le panier est reconstruit selon le classement
  des 14 derniers jours, sans cette marge. Le propriétaire revoit alors les seuils et les plafonds.
- **Continuité (diviseur).** Le nouveau panier part du niveau de l'ancien, mesuré l'heure d'avant : l'indice ne saute
  pas, comme quand un indice boursier ajuste son diviseur.
- **Historique.** Les paniers passés ne sont jamais modifiés. Les entrées et sorties de chaque rééquilibrage sont
  publiées (`changes`) et affichées dans l'application. La prochaine date est dans `index/meta.json` (`next`).
