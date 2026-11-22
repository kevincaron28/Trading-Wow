# Goblin Ledger market indexes / Indices du marché Goblin Ledger

## English

Goldline publishes market indexes for every auction house, in the spirit of stock market indexes. They are computed
from Goldline's own hourly prices by `collector/indexes.ts` and published as `index/<house>.json` on the data branch;
the definitions are in `index/meta.json`.

| Index | Basket | Cap per item |
|---|---|---|
| Goldline 100 | The 100 most traded items by daily gold volume. Weapons and armour are left out (random suffixes share one item ID), and so are recipes (rare one-off purchases whose estimated sales are too noisy). | 10% |
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
- **Rebalancing.** On the first weekly reset (Tuesday 15:00 UTC) of each month, the new basket is chosen from the
  previous 7 days. It is chain-linked, so the level does not jump. A basket, once set, is never changed.
- **Candles.** Hourly values build 1H, 4H and daily candles. Each item's contribution to the last 24 hours is
  `level × weight × (price now − price 24 h ago) / price at the period start`.

**Backtest** (PvP Horde, 18 Nov 02:00 to 19 Nov, provisional baskets)

| Index | Range | Median hourly move | Largest hourly move |
|---|---|---|---|
| Goldline 100 | 99.4–106.5 | 0.62% | 4.5% |
| Herbs | 98.4–131.5 | 1.6% | 19.9% |
| Ores & Bars | 93.5–108.3 | 1.7% | 7.6% |
| Cloth | 90.5–131.7 | 0.8% | 45% (Mooncloth, 18 Nov) |
| Consumables | 100–122.2 | 0.8% | 3.8% |
| Raid prep | 100–119.6 | 0.8% | 4.4% |

Early values use the merged daily market value. It is AHledger's median where AHledger has the item, otherwise the
lowest buyout, so they are a slightly rougher measure than the hourly robust market value used from 18 Nov.

## Français

Goldline publie des indices du marché pour chaque hôtel des ventes, à la manière des indices boursiers. Ils sont
calculés à partir des prix horaires de Goldline par `collector/indexes.ts` et publiés dans `index/<maison>.json` sur la
branche de données.

- **Paniers.** Goldline 100 regroupe les 100 objets les plus échangés, sans armes, armures ni recettes. Il y a aussi
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
- **Rééquilibrage.** À la première réinitialisation hebdomadaire de chaque mois (mardi 15 h UTC), avec chaînage :
  le niveau ne saute pas, et un panier fixé ne change plus.
