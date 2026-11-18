import type { CatalogItem } from "../data/live";
import { CATEGORIES } from "../data/watchlists";
import type { Lang } from "./i18n";
import { normalize } from "./text";

/** Rank catalog items for a query: exact ID, name prefix, word prefix, substring; listed items first. */
export function searchCatalog(items: Iterable<CatalogItem>, query: string, lang: Lang, listed: (id: number) => boolean, category: string | null, limit = 60): CatalogItem[] {
  const q = normalize(query);
  const cat = CATEGORIES.find((c) => c.id === category);
  const scored: { item: CatalogItem; score: number }[] = [];
  for (const item of items) {
    if (cat && !cat.match(item.itemClass, item.subclass)) continue;
    let score = 0;
    if (!q) score = 10;
    else {
      const own = normalize(item.name[lang]);
      const other = normalize(item.name[lang === "en" ? "fr" : "en"]);
      if (String(item.id) === q) score = 100;
      else if (own.startsWith(q)) score = 80;
      else if (own.split(/[\s'-]+/).some((w) => w.startsWith(q))) score = 60;
      else if (own.includes(q)) score = 40;
      else if (other.includes(q)) score = 20;
    }
    if (score === 0) continue;
    if (listed(item.id)) score += 5;
    scored.push({ item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.item.name[lang].localeCompare(b.item.name[lang], lang))
    .slice(0, limit)
    .map((s) => s.item);
}
