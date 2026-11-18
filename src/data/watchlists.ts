import type { Lang } from "../lib/i18n";

export interface WatchlistDef {
  id: string;
  name: Record<Lang, string>;
  items: number[];
  /** Built-in lists can be edited; "Reset" restores these items. */
  builtIn?: boolean;
}

/**
 * Prebuilt lists. Item IDs were matched by name against the live WoW Forever catalog on 18 Nov 2026
 * (every ID below is listed on the Forever auction houses). Names that Forever does not list
 * (Core Leather, Wicked Leather, Juju Power, Brilliant Wizard Oil, ...) were left out.
 */
export const BUILT_IN_WATCHLISTS: readonly WatchlistDef[] = [
  {
    id: "flipping",
    name: { en: "Flipping", fr: "Revente" },
    items: [13468, 12360, 13510, 13512, 13452, 14047, 14342, 14256, 15417, 14344, 20725, 13463, 13465, 13444, 13446, 13457, 12404, 12359, 13422, 13759, 12363, 12808, 7076, 7068],
  },
  {
    id: "alchemy",
    name: { en: "Alchemy & Herbalism", fr: "Alchimie et herboristerie" },
    items: [13468, 13463, 13465, 13466, 13464, 13467, 8838, 8846, 8845, 8836, 4625, 8831, 8839, 3357, 3356, 3821, 3358, 3818, 3820, 3355, 2453, 2450, 785, 2449, 765, 2447, 8925, 18256, 3372, 7068, 7070],
  },
  {
    id: "mining",
    name: { en: "Mining & Blacksmithing", fr: "Minage et forge" },
    items: [10620, 12359, 12360, 11370, 11371, 7911, 6037, 3858, 3860, 3577, 2772, 3575, 3859, 2840, 2841, 3576, 12365, 7912, 2838, 7067, 7076, 7910, 12799, 12361, 12800, 12364, 12363],
  },
  {
    id: "tailoring",
    name: { en: "Tailoring", fr: "Couture" },
    items: [14047, 14048, 14256, 14342, 4338, 4339, 4306, 4305, 2592, 2997, 2589, 2996, 14341, 14227, 2325, 8343, 7080, 12808],
  },
  {
    id: "leather",
    name: { en: "Leatherworking & Skinning", fr: "Travail du cuir et dépeçage" },
    items: [15417, 4304, 8170, 15407, 8171, 8169, 4234, 2319, 2318, 12810, 15416, 15412, 15415, 15414, 8154, 8167, 15419, 15423, 15422, 7428],
  },
  {
    id: "enchanting",
    name: { en: "Enchanting", fr: "Enchantement" },
    items: [14344, 14343, 20725, 16203, 16202, 16204, 11176, 11137, 11083, 10940, 11175, 11174, 11135, 11178, 11177, 11139, 11082, 10939],
  },
  {
    id: "engineering",
    name: { en: "Engineering", fr: "Ingénierie" },
    items: [15994, 10561, 10558, 18631, 16006, 15992, 10505, 4377, 4364, 4359, 4375, 7191, 10560, 12359, 3860, 7068, 7067, 15993],
  },
  {
    id: "cooking",
    name: { en: "Cooking & Fishing", fr: "Cuisine et pêche" },
    items: [13893, 13759, 13760, 13889, 13758, 4603, 21071, 21153, 6358, 6359, 13422, 8365, 1015, 12208, 12207, 3713, 12206, 6887, 13928, 13931, 20452, 18254],
  },
  {
    id: "raid",
    name: { en: "Raid consumables", fr: "Consommables de raid" },
    items: [13510, 13512, 13511, 13452, 13454, 13453, 9264, 250334, 13444, 13446, 13457, 13458, 13459, 13456, 13461, 13455, 5634, 3387, 12404, 12820, 18253],
  },
].map((list) => ({ ...list, builtIn: true }));

/** Search filter groups, by Blizzard item class / subclass. */
export interface Category {
  id: string;
  name: Record<Lang, string>;
  match: (itemClass: number, subclass: number) => boolean;
}

export const CATEGORIES: readonly Category[] = [
  { id: "herb", name: { en: "Herbs", fr: "Herbes" }, match: (c, s) => c === 7 && s === 9 },
  { id: "metal", name: { en: "Metal & stone", fr: "Métal et pierre" }, match: (c, s) => c === 7 && s === 7 },
  { id: "cloth", name: { en: "Cloth", fr: "Tissu" }, match: (c, s) => c === 7 && s === 5 },
  { id: "leather", name: { en: "Leather", fr: "Cuir" }, match: (c, s) => c === 7 && s === 6 },
  { id: "enchanting", name: { en: "Enchanting", fr: "Enchantement" }, match: (c, s) => c === 7 && s === 12 },
  { id: "elemental", name: { en: "Elemental", fr: "Élémentaire" }, match: (c, s) => c === 7 && s === 10 },
  { id: "cooking", name: { en: "Cooking", fr: "Cuisine" }, match: (c, s) => (c === 7 && s === 8) || (c === 0 && s === 5) },
  { id: "parts", name: { en: "Parts", fr: "Pièces" }, match: (c, s) => c === 7 && (s === 1 || s === 2 || s === 3) },
  { id: "potions", name: { en: "Potions & flasks", fr: "Potions et flacons" }, match: (c, s) => c === 0 && (s === 1 || s === 2 || s === 3) },
  { id: "recipes", name: { en: "Recipes", fr: "Recettes" }, match: (c) => c === 9 },
  { id: "gear", name: { en: "Gear", fr: "Équipement" }, match: (c) => c === 2 || c === 4 },
];
