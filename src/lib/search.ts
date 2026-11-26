import type { CatalogItem } from "../data/live";
import { CATEGORIES } from "../data/watchlists";
import type { Lang } from "./i18n";
import { normalize, queryWords } from "./text";

const WORD_BREAK = /[\s'-]+/;

/**
 * How a name matches a query typed as several words in any order ("flask titan" finds "Flask of the Titans"): 2 when
 * every word starts a word of the name, 1 when every word appears somewhere in it, else 0.
 */
function everyWord(name: string, words: readonly string[]): 0 | 1 | 2 {
  if (words.length < 2 || !words.every((w) => name.includes(w))) return 0;
  const parts = name.split(WORD_BREAK);
  return words.every((w) => parts.some((p) => p.startsWith(w))) ? 2 : 1;
}

/** Rank catalog items for a query: exact ID, name prefix, word prefix, substring, then all words in any order; listed items first. */
export function searchCatalog(items: Iterable<CatalogItem>, query: string, lang: Lang, listed: (id: number) => boolean, category: string | null, limit = 60): CatalogItem[] {
  const q = normalize(query);
  const words = queryWords(q);
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
      else if (own.split(WORD_BREAK).some((w) => w.startsWith(q))) score = 60;
      else if (own.includes(q)) score = 40;
      else if (everyWord(own, words)) score = everyWord(own, words) === 2 ? 35 : 28;
      else if (other.includes(q)) score = 20;
      else if (everyWord(other, words)) score = 12;
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
