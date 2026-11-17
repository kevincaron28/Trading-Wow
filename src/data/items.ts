import type { Lang } from "../lib/i18n";

export interface Item {
  id: number;
  name: Record<Lang, string>;
  category: Record<Lang, string>;
  /** Quality 0-5 (poor..legendary), for the name colour. */
  quality: number;
}

/**
 * Starter catalogue: real item IDs (checked against the Forever static item API later). Once the live
 * feed runs, the catalogue comes from the item data API instead of this list.
 */
export const ITEMS: readonly Item[] = [
  { id: 2589, name: { en: "Linen Cloth", fr: "Étoffe de lin" }, category: { en: "Cloth", fr: "Tissu" }, quality: 1 },
  { id: 4306, name: { en: "Silk Cloth", fr: "Étoffe de soie" }, category: { en: "Cloth", fr: "Tissu" }, quality: 1 },
  { id: 14047, name: { en: "Runecloth", fr: "Étoffe runique" }, category: { en: "Cloth", fr: "Tissu" }, quality: 1 },
  { id: 2840, name: { en: "Copper Bar", fr: "Barre de cuivre" }, category: { en: "Metal & Stone", fr: "Métal et pierre" }, quality: 1 },
  { id: 3575, name: { en: "Iron Bar", fr: "Barre de fer" }, category: { en: "Metal & Stone", fr: "Métal et pierre" }, quality: 1 },
  { id: 12359, name: { en: "Thorium Bar", fr: "Barre de thorium" }, category: { en: "Metal & Stone", fr: "Métal et pierre" }, quality: 1 },
  { id: 12363, name: { en: "Arcane Crystal", fr: "Cristal arcanique" }, category: { en: "Metal & Stone", fr: "Métal et pierre" }, quality: 2 },
  { id: 13468, name: { en: "Black Lotus", fr: "Lotus noir" }, category: { en: "Herb", fr: "Herbe" }, quality: 2 },
  { id: 13463, name: { en: "Dreamfoil", fr: "Feuillerêve" }, category: { en: "Herb", fr: "Herbe" }, quality: 1 },
  { id: 13452, name: { en: "Elixir of the Mongoose", fr: "Élixir de la mangouste" }, category: { en: "Elixir", fr: "Élixir" }, quality: 1 },
  { id: 13446, name: { en: "Major Healing Potion", fr: "Potion de soins majeure" }, category: { en: "Potion", fr: "Potion" }, quality: 1 },
  { id: 8846, name: { en: "Gromsblood", fr: "Gromsang" }, category: { en: "Herb", fr: "Herbe" }, quality: 1 },
];

export function findItem(id: number): Item | undefined {
  return ITEMS.find((item) => item.id === id);
}

/** Lowercase, accents removed, so "etoffe" finds "Étoffe". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Match on the name in either language, or on the item ID. Names in the current language rank first. */
export function searchItems(items: readonly Item[], query: string, lang: Lang, limit = 8): Item[] {
  const q = normalize(query);
  if (!q) return [];
  const scored: { item: Item; score: number }[] = [];
  for (const item of items) {
    const own = normalize(item.name[lang]);
    const other = normalize(item.name[lang === "en" ? "fr" : "en"]);
    let score = 0;
    if (String(item.id) === q) score = 100;
    else if (own.startsWith(q)) score = 80;
    else if (own.split(/\s+/).some((word) => word.startsWith(q))) score = 60;
    else if (own.includes(q)) score = 40;
    else if (other.includes(q)) score = 20;
    if (score > 0) scored.push({ item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.item.name[lang].localeCompare(b.item.name[lang], lang))
    .slice(0, limit)
    .map((s) => s.item);
}
