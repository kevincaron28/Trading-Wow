import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CatalogItem } from "../data/live";
import { searchCatalog } from "../lib/search";
import { onBack } from "../app/back";
import { CATEGORIES } from "../data/watchlists";
import { t } from "../lib/i18n";
import { activeWatchlist, houseId, openChart, toggleInList, useStore } from "../app/store";
import { useCatalog, useMeta, useQuotes } from "./data";
import { Icon, ItemIcon, Loading, Money } from "./parts";

export function SearchScreen({ onClose, onPick }: { onClose: () => void; onPick?: (id: number) => void }) {
  const s = useStore();
  const catalog = useCatalog();
  const meta = useMeta();
  const quotes = useQuotes(houseId(s));
  const list = activeWatchlist(s);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => onBack(onClose), [onClose]);

  const results = useMemo(() => {
    if (!catalog.data) return [];
    if (!query.trim() && !category) return s.recent.map((id) => catalog.data!.get(id)).filter((x): x is CatalogItem => !!x);
    return searchCatalog(catalog.data.values(), query, s.lang, (id) => !!quotes.data?.has(id), category);
  }, [catalog.data, quotes.data, query, category, s.lang, s.recent]);

  const pick = (id: number) => {
    if (onPick) onPick(id);
    else openChart(id);
    onClose();
  };

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label={t(s.lang, "search")}>
      <header class="topbar search-bar">
        <button type="button" class="icon-btn" onClick={onClose} aria-label={t(s.lang, "cancel")}>
          <Icon name="back" />
        </button>
        <input ref={input} type="search" value={query} placeholder={t(s.lang, "searchPlaceholder")} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && results[0] && pick(results[0].id)} autocomplete="off" spellcheck={false} />
      </header>
      <div class="chips" role="group">
        <button type="button" class={category === null ? "chip on" : "chip"} onClick={() => setCategory(null)}>{t(s.lang, "allCategories")}</button>
        {CATEGORIES.map((c) => (
          <button type="button" class={category === c.id ? "chip on" : "chip"} onClick={() => setCategory(category === c.id ? null : c.id)}>{c.name[s.lang]}</button>
        ))}
      </div>
      {!catalog.data ? (
        <Loading text={t(s.lang, "loading")} />
      ) : (
        <>
          {!query.trim() && !category && results.length > 0 && <p class="section-label">{t(s.lang, "recent")}</p>}
          {(query.trim() || category) && results.length === 0 && <p class="state-msg">{t(s.lang, "noResults")}</p>}
          <ul class="rows">
            {results.map((item) => {
              const quote = quotes.data?.get(item.id);
              const inList = list.items.includes(item.id);
              return (
                <li key={item.id} class="row">
                  <button type="button" class="row-main" onClick={() => pick(item.id)}>
                    <ItemIcon item={item} meta={meta.data} />
                    <span class="row-name">
                      <span class={`name q${item.quality}`}>{item.name[s.lang]}</span>
                      <span class="sub">#{item.id}{quote ? "" : ` · ${t(s.lang, "notListed")}`}</span>
                    </span>
                    <span class="row-price"><Money copper={quote?.[s.priceField]} lang={s.lang} short /></span>
                  </button>
                  {!onPick && (
                    <button type="button" class={`icon-btn ${inList ? "accent" : ""}`} aria-pressed={inList} aria-label={`${t(s.lang, inList ? "inList" : "addTo")} ${list.name[s.lang]}`} onClick={() => toggleInList(list.id, item.id)}>
                      <Icon name={inList ? "check" : "plus"} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
