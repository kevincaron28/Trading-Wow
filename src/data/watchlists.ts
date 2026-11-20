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
    items: [13468, 12360, 13510, 13512, 13452, 14047, 14342, 14256, 15417, 14344, 20725, 13463, 13465, 13444, 13446, 13457, 12404, 12359, 13422, 13759, 12363, 12808, 7076, 7068, 15409, 16206, 12811, 248819, 248822, 7082, 248815, 248824, 248820, 13926, 12804],
  },
  {
    id: "alchemy",
    name: { en: "Alchemy & Herbalism", fr: "Alchimie et herboristerie" },
    items: [13468, 13463, 13465, 13466, 13464, 13467, 8838, 8846, 8845, 8836, 4625, 8831, 8839, 3357, 3356, 3821, 3358, 3818, 3820, 3355, 2453, 2450, 785, 2449, 765, 2447, 8925, 18256, 3372, 7068, 7070, 3819, 3369, 2452, 3371, 248822, 249399, 249274, 248821, 248823, 249424, 249410, 3829],
  },
  {
    id: "mining",
    name: { en: "Mining & Blacksmithing", fr: "Minage et forge" },
    items: [10620, 12359, 12360, 11370, 11371, 7911, 6037, 3858, 3860, 3577, 2772, 3575, 3859, 2840, 2841, 3576, 12365, 7912, 2838, 7067, 7076, 7910, 12799, 12361, 12800, 12364, 12363, 2770, 2771, 2775, 2776, 2842, 2835, 2836, 12655, 12644, 12809, 249425, 249426, 249726, 251290, 248815, 249391, 248820],
  },
  {
    id: "tailoring",
    name: { en: "Tailoring", fr: "Couture" },
    items: [14047, 14048, 14256, 14342, 4338, 4339, 4306, 4305, 2592, 2997, 2589, 2996, 14341, 14227, 2325, 8343, 7080, 12808, 2320, 2321, 4291, 249431, 249409, 249430, 279943],
  },
  {
    id: "leather",
    name: { en: "Leatherworking & Skinning", fr: "Travail du cuir et dépeçage" },
    items: [15417, 4304, 8170, 15407, 8171, 8169, 4234, 2319, 2318, 12810, 15416, 15412, 15415, 15414, 8154, 8167, 15419, 15423, 15422, 7428, 15409, 8172, 4236, 4235, 4232, 783, 4289, 8150, 8165, 249427, 248824, 248825, 249428, 249429, 15408, 279941],
  },
  {
    id: "enchanting",
    name: { en: "Enchanting", fr: "Enchantement" },
    items: [14344, 14343, 20725, 16203, 16202, 16204, 11176, 11137, 11083, 10940, 11175, 11174, 11135, 11178, 11177, 11139, 11082, 10939, 16206, 10938, 10998, 11134, 10978, 11084, 11138, 247786, 247884],
  },
  {
    id: "engineering",
    name: { en: "Engineering", fr: "Ingénierie" },
    items: [15994, 10561, 10558, 18631, 16006, 15992, 10505, 4377, 4364, 4359, 4375, 7191, 10560, 12359, 3860, 7068, 7067, 15993, 4371, 10559, 4387, 4389, 249432, 249410, 10548, 16005],
  },
  {
    id: "elementals",
    name: { en: "Elementals", fr: "Éléments" },
    items: [7082, 7078, 7077, 7069, 7070, 7075, 7079, 7081, 12803, 7972, 12808, 7080, 7076, 7068, 7067, 10286, 13926, 4611, 12804],
  },
  {
    id: "cooking",
    name: { en: "Cooking & Fishing", fr: "Cuisine et pêche" },
    items: [13893, 13759, 13760, 13889, 13758, 4603, 21071, 21153, 6358, 6359, 13422, 8365, 1015, 12208, 12207, 3713, 12206, 6887, 13928, 13931, 20452, 18254, 12202, 12203, 12184, 730, 249870, 250070, 250069, 250071, 250072, 250065, 249876, 13935, 13933, 12217],
  },
  {
    id: "raid",
    name: { en: "Raid consumables", fr: "Consommables de raid" },
    items: [13510, 13512, 13511, 13452, 13454, 13453, 9264, 250334, 13444, 13446, 13457, 13458, 13459, 13456, 13461, 13455, 5634, 3387, 12404, 12820, 18253, 9206, 9187, 13445, 250341, 13442, 13443, 3928, 6149, 2459, 20520, 9088, 21151, 12643, 14530, 250351, 250329, 250350, 250337, 250338, 250348, 250335, 246948, 241650, 247242, 12645],
  },
  {
    id: "crates",
    name: { en: "Crates & writs", fr: "Caisses et ordres" },
    items: [248682, 248683, 248684, 248685, 248686, 248687, 248688, 248689, 248690, 248691, 248692, 248693, 248694, 248695, 248696, 248697, 248698, 248699, 248702, 248703, 248704, 248705, 248706, 248707, 248708, 248709, 248710, 248711, 248712, 248713, 262888, 262889, 262890],
  },
  {
    id: "camp",
    name: { en: "Camp & stations", fr: "Camp et ateliers" },
    items: [279981, 279978, 279979, 279967, 279941, 279956, 279965, 279982, 279968, 279944, 279970, 279960, 279976, 279943, 279962, 279950, 279940, 279966, 279972, 279973, 279961, 279945, 279985, 279964, 279949, 279948, 279952, 279957, 279969, 279988, 279990, 279938, 279959, 279955],
  },
].map((list) => ({ ...list, builtIn: true }));

/** Items added to built-in lists by list version (2 = 0.12, 3 = 0.13.1): appended once to lists people already have (store.ts, listsVersion). */
export const LISTS_ADDED: Readonly<Record<number, Readonly<Record<string, readonly number[]>>>> = {
  2: { flipping: [15409, 16206, 12811, 248819, 248822, 7082], alchemy: [3819, 3369, 2452, 3371, 248822, 249399, 249274], mining: [2770, 2771, 2775, 2776, 2842, 2835, 2836, 12655, 12644, 12809, 249425, 249426, 249726, 251290], tailoring: [2320, 2321, 4291, 249431, 249409], leather: [15409, 8172, 4236, 4235, 4232, 783, 4289, 8150, 8165, 249427], enchanting: [16206, 10938, 10998, 11134, 10978, 11084, 11138], engineering: [4371, 10559, 4387, 4389], raid: [9206, 9187, 13445, 250341, 13442, 13443, 3928, 6149, 2459, 20520, 9088, 21151, 12643, 14530] },
  // 3 (20 Nov 2026): WoW Forever goods missing from the lists (Fel and Pristine leather, new herbs, ores and dyes,
  // Forever elixirs, teas and steaks) and the most traded classic goods no list had.
  3: { flipping: [248815, 248824, 248820, 13926, 12804], alchemy: [248821, 248823, 249424, 249410, 3829], mining: [248815, 249391, 248820], tailoring: [249430, 279943], leather: [248824, 248825, 249428, 249429, 15408, 279941], enchanting: [247786, 247884], engineering: [249432, 249410, 10548, 16005], elementals: [13926, 4611, 12804], cooking: [12202, 12203, 12184, 730, 249870, 250070, 250069, 250071, 250072, 250065, 249876, 13935, 13933, 12217], raid: [250351, 250329, 250350, 250337, 250338, 250348, 250335, 246948, 241650, 247242, 12645] },
};
export const LISTS_VERSION = 3;

/** Append the items added to built-in lists after `fromVersion` (once; items the user removed earlier stay removed). */
export function addNewListItems<T extends { id: string; items: number[] }>(lists: T[], fromVersion: number): T[] {
  let out = lists;
  for (let v = fromVersion + 1; v <= LISTS_VERSION; v++) {
    const added = LISTS_ADDED[v] ?? {};
    out = out.map((w) => (added[w.id] ? { ...w, items: [...w.items, ...added[w.id]!.filter((id) => !w.items.includes(id))] } : w));
  }
  return out;
}

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