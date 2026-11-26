# WoW Forever context for the recap summaries

The AI-written summaries of the recaps (`collector/recap-ai.ts`) may use only two things: the recap's own numbers,
and the reviewed facts below (the list between the `facts` markers is what the model sees). Anything else, including
causes, predictions, events and dates, is not allowed. The accuracy guard also rejects any number that is in neither
the data nor this list.

**Last checked: 26 Nov 2026.** Update this note when the game changes: a new raid date, a phase, a patch, a reset
change. Check the sources below again before each new phase, and at least once a month. Edit only the list, keep each
line short and sourced, and change the date above.

<!-- facts:start -->
- World of Warcraft: Forever launched on 4 November 2026.
- The first raids all open on 9 December 2026: Barrow Deeps (10 players), Hyjal Summit (20 players) and Onyxia's Lair (40 players).
- Onyxia's Lair needs the Drakefire Amulet attunement, and Blizzard advises fire resistance for it.
- Raids reset weekly; Blizzard has not announced the day or hour.
- Raiders stock up on flasks, elixirs and potions before raid night: the raid consumables section of the recap measures that demand.
- Blizzard's roadmap places a Hardcore mode in winter 2026 and major updates in spring and summer 2027, without exact dates.
- Goblin Ledger's indexes rebalance on the first Tuesday of each month at 15:00 UTC, with a quarterly review in January, April, July and October.
<!-- facts:end -->

## Sources

| Fact | Source | Status |
|---|---|---|
| Launch on 4 Nov 2026 (15:00 PST) | [VaultAlts roadmap](https://vaultalts.com/wow-forever/guides/roadmap-every-phase-and-unlock-date) and [Timesaver roadmap](https://timesaver.gg/blog/wow-forever-roadmap-after-launch), both citing Blizzard; our own data starts the evening of 4 Nov (US) | Confirmed |
| Raids on 9 Dec, names and sizes; Drakefire Amulet; fire resistance; weekly resets | [Blizzard: WoW Forever raid overview](https://news.blizzard.com/en-us/article/24303009/world-of-warcraft-forever-raid-overviewlocations-raid-sizes-and-attunement) | Official |
| No unlock hour announced | [Timesaver roadmap](https://timesaver.gg/blog/wow-forever-roadmap-after-launch) | Third party |
| Hardcore in winter 2026; spring and summer 2027 updates | Blizzard's BlizzCon roadmap graphic, as reported by [VaultAlts](https://vaultalts.com/wow-forever/guides/roadmap-every-phase-and-unlock-date) and [Timesaver](https://timesaver.gg/blog/wow-forever-roadmap-after-launch). Not checked against a Blizzard page | Reported |
| Consumable demand before raids | Market behaviour, not a sourced fact. The model may only point to the recap's own raid consumables numbers | Rule |
| Index rebalancing calendar | Goblin Ledger's own method (docs/INDEXES.md) | Ours |

Not used, because no source says it: world buffs, a specific flask being required, the raid unlock hour, and names of
2027 raids. Blizzard has not named any spring or summer raid.
