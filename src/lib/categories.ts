import type { CatalogItem } from "../data/live";
import type { Lang } from "./i18n";
import type { Quote } from "./quotes";
import { normalize } from "./text.ts";

/**
 * Auction house categories, built from Blizzard's item class and subclass (Classic numbering, as WoW Forever uses).
 * Order follows the in-game auction house; names are what the game shows in English and French.
 */
export interface Subcategory {
  id: string;
  name: Record<Lang, string>;
  /** Item class and the subclasses it covers (empty list = every subclass of that class). */
  match: readonly [number, readonly number[]][];
}
export interface Category {
  id: string;
  name: Record<Lang, string>;
  icon: string;
  subs: readonly Subcategory[];
}

const sub = (id: string, en: string, fr: string, cls: number, subclasses: number[] = []): Subcategory => ({ id, name: { en, fr }, match: [[cls, subclasses]] });

export const AH_CATEGORIES: readonly Category[] = [
  {
    id: "weapon", name: { en: "Weapons", fr: "Armes" }, icon: "sword",
    subs: [
      sub("axe1", "One-Handed Axes", "Haches à une main", 2, [0]),
      sub("axe2", "Two-Handed Axes", "Haches à deux mains", 2, [1]),
      sub("bow", "Bows", "Arcs", 2, [2]),
      sub("gun", "Guns", "Armes à feu", 2, [3]),
      sub("mace1", "One-Handed Maces", "Masses à une main", 2, [4]),
      sub("mace2", "Two-Handed Maces", "Masses à deux mains", 2, [5]),
      sub("polearm", "Polearms", "Armes d'hast", 2, [6]),
      sub("sword1", "One-Handed Swords", "Épées à une main", 2, [7]),
      sub("sword2", "Two-Handed Swords", "Épées à deux mains", 2, [8]),
      sub("staff", "Staves", "Bâtons", 2, [10]),
      sub("fist", "Fist Weapons", "Armes de pugilat", 2, [13]),
      sub("dagger", "Daggers", "Dagues", 2, [15]),
      sub("thrown", "Thrown", "Armes de jet", 2, [16]),
      sub("crossbow", "Crossbows", "Arbalètes", 2, [18]),
      sub("wand", "Wands", "Baguettes", 2, [19]),
      sub("fishing", "Fishing Poles", "Cannes à pêche", 2, [20]),
      sub("wmisc", "Miscellaneous", "Divers", 2, [9, 11, 12, 14, 17]),
    ],
  },
  {
    id: "armor", name: { en: "Armor", fr: "Armures" }, icon: "shield",
    subs: [
      sub("cloth", "Cloth", "Tissu", 4, [1]),
      sub("leather", "Leather", "Cuir", 4, [2]),
      sub("mail", "Mail", "Mailles", 4, [3]),
      sub("plate", "Plate", "Plaques", 4, [4]),
      sub("shield", "Shields", "Boucliers", 4, [6]),
      sub("relic", "Librams, Idols and Totems", "Librams, idoles et totems", 4, [7, 8, 9]),
      sub("amisc", "Miscellaneous (rings, necks, trinkets, shirts)", "Divers (anneaux, cous, bijoux, chemises)", 4, [0, 5, 10, 11]),
    ],
  },
  {
    id: "container", name: { en: "Containers", fr: "Conteneurs" }, icon: "bag",
    subs: [
      sub("bag", "Bags", "Sacs", 1, [0]),
      sub("soulbag", "Soul Bags", "Sacs d'âmes", 1, [1]),
      sub("herbbag", "Herb Bags", "Sacs d'herbes", 1, [2]),
      sub("enchbag", "Enchanting Bags", "Sacs d'enchanteur", 1, [3]),
      sub("cmisc", "Other bags", "Autres sacs", 1, [4, 5, 6, 7, 8, 9, 10, 11]),
      sub("quiver", "Quivers and Ammo Pouches", "Carquois et gibernes", 11, []),
    ],
  },
  {
    id: "consumable", name: { en: "Consumables", fr: "Consommables" }, icon: "potion",
    subs: [
      sub("potion", "Potions", "Potions", 0, [1]),
      sub("elixir", "Elixirs", "Élixirs", 0, [2]),
      sub("flask", "Flasks", "Flacons", 0, [3]),
      sub("scroll", "Scrolls", "Parchemins", 0, [4]),
      sub("food", "Food & Drink", "Nourriture et boissons", 0, [5]),
      sub("enhance", "Item Enhancements", "Améliorations d'objets", 0, [6]),
      sub("bandage", "Bandages", "Bandages", 0, [7]),
      sub("cother", "Other", "Autres", 0, [0, 8, 9, 10, 11, 12, 13, 14]),
    ],
  },
  {
    id: "trade", name: { en: "Trade Goods", fr: "Artisanat" }, icon: "anvil",
    subs: [
      sub("cloth", "Cloth", "Tissu", 7, [5]),
      sub("leather", "Leather", "Cuir", 7, [6]),
      sub("metal", "Metal & Stone", "Métal et pierre", 7, [7]),
      sub("herb", "Herbs", "Herbes", 7, [9]),
      sub("ench", "Enchanting", "Enchantement", 7, [12]),
      sub("elemental", "Elemental", "Élémentaire", 7, [10]),
      sub("meat", "Meat", "Viande", 7, [8]),
      sub("parts", "Parts and Devices", "Pièces et appareils", 7, [1, 2, 3, 4]),
      sub("tother", "Other", "Autres", 7, [0, 11, 13, 14, 15, 16]),
    ],
  },
  {
    id: "projectile", name: { en: "Projectiles", fr: "Projectiles" }, icon: "arrow",
    subs: [sub("arrow", "Arrows", "Flèches", 6, [2]), sub("bullet", "Bullets", "Balles", 6, [3]), sub("pother", "Other", "Autres", 6, [0, 1, 4])],
  },
  {
    id: "recipe", name: { en: "Recipes", fr: "Recettes" }, icon: "scroll",
    subs: [
      sub("book", "Books", "Livres", 9, [0]),
      sub("lw", "Leatherworking", "Travail du cuir", 9, [1]),
      sub("tailor", "Tailoring", "Couture", 9, [2]),
      sub("eng", "Engineering", "Ingénierie", 9, [3]),
      sub("bs", "Blacksmithing", "Forge", 9, [4]),
      sub("cook", "Cooking", "Cuisine", 9, [5]),
      sub("alch", "Alchemy", "Alchimie", 9, [6]),
      sub("fa", "First Aid", "Secourisme", 9, [7]),
      sub("ench", "Enchanting", "Enchantement", 9, [8]),
      sub("fish", "Fishing", "Pêche", 9, [9]),
      sub("rother", "Other", "Autres", 9, [10, 11]),
    ],
  },
  {
    id: "gem", name: { en: "Gems", fr: "Gemmes" }, icon: "gem",
    subs: [sub("gems", "Gems", "Gemmes", 3, [])],
  },
  {
    id: "reagent", name: { en: "Reagents", fr: "Composants" }, icon: "dust",
    subs: [sub("reagent", "Reagents", "Composants", 5, []), sub("mreagent", "Class reagents", "Composants de classe", 15, [1])],
  },
  {
    id: "quest", name: { en: "Quest Items", fr: "Objets de quête" }, icon: "quest",
    subs: [sub("quest", "Quest Items", "Objets de quête", 12, []), sub("key", "Keys", "Clés", 13, [])],
  },
  {
    id: "misc", name: { en: "Miscellaneous", fr: "Divers" }, icon: "misc",
    subs: [
      sub("junk", "Junk", "Camelote", 15, [0]),
      sub("pet", "Pets", "Mascottes", 15, [2]),
      sub("holiday", "Holiday", "Fêtes", 15, [3]),
      sub("mount", "Mounts", "Montures", 15, [5]),
      sub("mother", "Other", "Autres", 15, [4, 6, 7, 8, 9]),
    ],
  },
];

/** "Other" bucket for any class or subclass the table above does not name, so no item is ever hidden. */
export const OTHER_CATEGORY: Category = {
  id: "other", name: { en: "Other", fr: "Autres" }, icon: "misc",
  subs: [{ id: "other", name: { en: "Other", fr: "Autres" }, match: [] }],
};

const index = new Map<string, [string, string]>();
for (const c of AH_CATEGORIES) for (const s of c.subs) for (const [cls, subs] of s.match) {
  if (subs.length === 0) index.set(`${cls}.*`, [c.id, s.id]);
  for (const x of subs) index.set(`${cls}.${x}`, [c.id, s.id]);
}

/** [category id, subcategory id] of an item. */
export function categoryOf(item: Pick<CatalogItem, "itemClass" | "subclass">): [string, string] {
  return index.get(`${item.itemClass}.${item.subclass}`) ?? index.get(`${item.itemClass}.*`) ?? ["other", "other"];
}

export type BrowseSort = "name" | "price" | "qty";

export interface BrowseRow {
  item: CatalogItem;
  quote: Quote | undefined;
}

/**
 * Items of one category (and subcategory), or all items when `cat` is null, filtered by a name or ID query,
 * optionally only those on sale, sorted by name (A-Z), price (high first) or quantity listed (high first).
 * Items without a price sort last for price and quantity.
 */
export function browseItems(
  items: Iterable<CatalogItem>,
  quotes: ReadonlyMap<number, Quote> | null,
  opts: { cat: string | null; sub: string | null; query: string; onSale: boolean; sort: BrowseSort; lang: Lang; priceField: "market" | "min" },
): BrowseRow[] {
  const q = normalize(opts.query.trim());
  const idQuery = /^\d+$/.test(q) ? Number(q) : null;
  const rows: BrowseRow[] = [];
  for (const item of items) {
    if (opts.cat) {
      const [c, s] = categoryOf(item);
      if (c !== opts.cat || (opts.sub && s !== opts.sub)) continue;
    }
    if (q && !(idQuery === item.id || normalize(item.name[opts.lang]).includes(q) || normalize(item.name[opts.lang === "en" ? "fr" : "en"]).includes(q))) continue;
    const quote = quotes?.get(item.id);
    if (opts.onSale && !quote) continue;
    rows.push({ item, quote });
  }
  const byName = (a: BrowseRow, b: BrowseRow) => a.item.name[opts.lang].localeCompare(b.item.name[opts.lang], opts.lang === "fr" ? "fr" : "en");
  if (opts.sort === "name") rows.sort(byName);
  else if (opts.sort === "price") rows.sort((a, b) => (b.quote?.[opts.priceField] ?? -1) - (a.quote?.[opts.priceField] ?? -1) || byName(a, b));
  else rows.sort((a, b) => (b.quote?.listed ?? -1) - (a.quote?.listed ?? -1) || byName(a, b));
  return rows;
}

/** Item counts per category and subcategory ("cat" and "cat/sub" keys), counting only on-sale items when asked. */
export function categoryCounts(items: Iterable<CatalogItem>, quotes: ReadonlyMap<number, Quote> | null, onSale: boolean): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (onSale && !quotes?.has(item.id)) continue;
    const [c, s] = categoryOf(item);
    counts.set(c, (counts.get(c) ?? 0) + 1);
    counts.set(`${c}/${s}`, (counts.get(`${c}/${s}`) ?? 0) + 1);
  }
  return counts;
}

export function findCategory(id: string | null): Category | undefined {
  return id === "other" ? OTHER_CATEGORY : AH_CATEGORIES.find((c) => c.id === id);
}
