import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { onBack } from "../app/back";
import { houseId, openChart, useStore } from "../app/store";
import { AH_CATEGORIES, OTHER_CATEGORY, browseItems, categoryCounts, findCategory, type BrowseRow, type BrowseSort } from "../lib/categories";
import { t } from "../lib/i18n";
import { bumpRefresh, useCatalog, useMeta, useQuotes } from "./data";
import { EmptyState, ErrorMsg, Icon, ItemIcon, Loading, Money } from "./parts";

/** Simple original line icons for the categories (24px grid). */
const CAT_ICONS: Record<string, string> = {
  sword: "M14.5 3.5H20v5.5L9 20l-2-2-2 2-1-1 2-2-2-2zM6 14l4 4",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z",
  bag: "M8 8V6a4 4 0 0 1 8 0v2M5 8h14l-1 12H6z",
  potion: "M10 3h4M10 3v5L5.5 16a3 3 0 0 0 2.6 5h7.8a3 3 0 0 0 2.6-5L14 8V3M7.5 14h9",
  anvil: "M4 7h13a3 3 0 0 1-3 3h-1v3l3 5H8l3-5v-3H8a4 4 0 0 1-4-3z",
  arrow: "M4 20L18 6M13 5h6v6M4 20l3-1M4 20l1-3",
  scroll: "M7 4h11v13a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2v-2h11v2M7 4a2 2 0 0 0-2 2v10M10 8h5M10 12h5",
  gem: "M6 4h12l3 5-9 11L3 9zM3 9h18M9 4l3 16 3-16",
  dust: "M6 18h12M8 18c0-3 1-5 4-8 3 3 4 5 4 8M12 6v-2M17 8l1.5-1.5M7 8L5.5 6.5",
  quest: "M12 3l1.5 4.5H18l-3.6 2.7 1.4 4.6L12 12l-3.8 2.8 1.4-4.6L6 7.5h4.5zM12 15v6",
  misc: "M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z",
};
function CatIcon({ name }: { name: string }) {
  return (
    <svg class="cat-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={CAT_ICONS[name] ?? CAT_ICONS.misc} />
    </svg>
  );
}

const ROW_H = 64;

/** Renders only the rows near the screen (the page scroller is the app's `.content`), so 7,000 items stay smooth. */
function VirtualList<T>({ items, render, keyOf }: { items: readonly T[]; render: (item: T) => ComponentChildren; keyOf: (item: T) => string | number }) {
  const ref = useRef<HTMLUListElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 30]);
  useLayoutEffect(() => {
    const list = ref.current;
    const scroller = list?.closest(".content") as HTMLElement | null;
    if (!list || !scroller) return;
    const update = () => {
      const top = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(-top / ROW_H) - 8);
      const count = Math.ceil(scroller.clientHeight / ROW_H) + 16;
      setRange((r) => (r[0] === first && r[1] === first + count ? r : [first, first + count]));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items]);
  const [from, to] = [range[0], Math.min(items.length, range[1])];
  return (
    <ul ref={ref} class="rows vlist" style={{ height: `${items.length * ROW_H}px` }}>
      {items.slice(from, to).map((item, i) => (
        <li key={keyOf(item)} class="row vrow" style={{ top: `${(from + i) * ROW_H}px` }}>{render(item)}</li>
      ))}
    </ul>
  );
}

const SORTS: BrowseSort[] = ["name", "price", "qty"];
/** Where the browser was, kept while the app runs (switching tabs and back returns to the same place). */
let remembered: { cat: string | null; sub: string | null; sort: BrowseSort; onSale: boolean } = { cat: null, sub: null, sort: "name", onSale: true };

export function BrowseView() {
  const s = useStore();
  const catalog = useCatalog();
  const meta = useMeta();
  const quotes = useQuotes(houseId(s));
  const [cat, setCat] = useState<string | null>(remembered.cat);
  const [sub, setSub] = useState<string | null>(remembered.sub);
  const [sort, setSort] = useState<BrowseSort>(remembered.sort);
  const [onSale, setOnSale] = useState(remembered.onSale);
  const [query, setQuery] = useState("");
  // Filter 150 ms after the last key, so typing stays smooth over 7,000 items.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), query ? 150 : 0);
    return () => clearTimeout(id);
  }, [query]);
  useEffect(() => { remembered = { cat, sub, sort, onSale }; }, [cat, sub, sort, onSale]);

  // Android back and the on-screen back arrow go up one level.
  const up = () => (sub ? setSub(null) : setCat(null));
  useEffect(() => (cat ? onBack(up) : undefined), [cat, sub]);
  useEffect(() => { document.querySelector(".content")?.scrollTo({ top: 0 }); }, [cat, sub]);

  const category = findCategory(cat);
  const counts = useMemo(() => (catalog.data ? categoryCounts(catalog.data.values(), quotes.data, onSale) : new Map<string, number>()), [catalog.data, quotes.data, onSale]);
  // Inside a category without a chosen subcategory, a category with a single subcategory goes straight to its items.
  const visibleSubs = category ? category.subs.filter((x) => (counts.get(`${category.id}/${x.id}`) ?? 0) > 0) : [];
  const showItems = !!debounced.trim() || (!!category && (!!sub || visibleSubs.length <= 1));
  const rows = useMemo(
    () => (catalog.data && showItems ? browseItems(catalog.data.values(), quotes.data, { cat, sub: sub === "*" ? null : sub, query: debounced, onSale, sort, lang: s.lang, priceField: s.priceField }) : []),
    [catalog.data, quotes.data, cat, sub, debounced, onSale, sort, s.lang, s.priceField, showItems],
  );

  if (catalog.error && !catalog.data) return <ErrorMsg text={t(s.lang, "loadError")} retry={bumpRefresh} retryLabel={t(s.lang, "retry")} />;
  if (!catalog.data) return <Loading text={t(s.lang, "loading")} />;

  const subName = sub === "*" && category ? `${t(s.lang, "allIn")} ${category.name[s.lang]}` : category?.subs.find((x) => x.id === sub)?.name[s.lang];
  const fmt = (n: number) => n.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US");
  const scope = subName ?? category?.name[s.lang];

  return (
    <div class="browse">
      <div class="browse-search">
        <span class="search-icon"><Icon name="search" size={18} /></span>
        <input
          type="search"
          value={query}
          placeholder={scope ? `${t(s.lang, "searchIn")} ${scope}` : t(s.lang, "searchAll")}
          aria-label={scope ? `${t(s.lang, "searchIn")} ${scope}` : t(s.lang, "searchAll")}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        {query && <button type="button" class="icon-btn small" aria-label={t(s.lang, "clear")} onClick={() => setQuery("")}><Icon name="close" size={16} /></button>}
      </div>

      {category && (
        <nav class="crumbs" aria-label={t(s.lang, "browseCategories")}>
          <button type="button" class="crumb-back" aria-label={t(s.lang, "back")} onClick={up}><Icon name="back" size={18} /></button>
          <button type="button" class="crumb" onClick={() => { setCat(null); setSub(null); }}>{t(s.lang, "browseCategories")}</button>
          <span aria-hidden="true">›</span>
          <button type="button" class={`crumb ${sub ? "" : "on"}`} onClick={() => setSub(null)}>{category.name[s.lang]}</button>
          {subName && (<><span aria-hidden="true">›</span><span class="crumb on">{subName}</span></>)}
        </nav>
      )}

      <div class="browse-tools">
        {showItems && <div class="seg compact" role="radiogroup" aria-label={t(s.lang, "sortBy")}>
          {SORTS.map((x) => (
            <button type="button" role="radio" aria-checked={sort === x} class={sort === x ? "on" : ""} onClick={() => setSort(x)}>{t(s.lang, x === "name" ? "sortName" : x === "price" ? "sortPrice" : "sortQty")}</button>
          ))}
        </div>}
        <label class="toggle">
          <input type="checkbox" checked={onSale} onChange={(e) => setOnSale((e.target as HTMLInputElement).checked)} />
          <span>{t(s.lang, "onSaleOnly")}</span>
        </label>
      </div>

      {!showItems && !category && (
        <ul class="cat-list">
          {[...AH_CATEGORIES, OTHER_CATEGORY].filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => (
            <li key={c.id}>
              <button type="button" class="cat-row" onClick={() => { setCat(c.id); setSub(null); }}>
                <CatIcon name={c.icon} />
                <span class="cat-name">{c.name[s.lang]}</span>
                <span class="cat-count">{fmt(counts.get(c.id) ?? 0)}</span>
                <Icon name="chevronRight" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!showItems && category && (
        <ul class="cat-list">
          <li>
            <button type="button" class="cat-row all" onClick={() => setSub("*")}>
              <CatIcon name={category.icon} />
              <span class="cat-name">{t(s.lang, "allIn")} {category.name[s.lang]}</span>
              <span class="cat-count">{fmt(counts.get(category.id) ?? 0)}</span>
              <Icon name="chevronRight" size={18} />
            </button>
          </li>
          {visibleSubs.map((x) => (
            <li key={x.id}>
              <button type="button" class="cat-row" onClick={() => setSub(x.id)}>
                <span class="cat-icon spacer" />
                <span class="cat-name">{x.name[s.lang]}</span>
                <span class="cat-count">{fmt(counts.get(`${category.id}/${x.id}`) ?? 0)}</span>
                <Icon name="chevronRight" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {showItems && (
        <>
          <p class="browse-count muted small">{fmt(rows.length)} {t(s.lang, "itemsCount")}{quotes.loading && !quotes.data ? ` · ${t(s.lang, "loading")}` : ""}</p>
          {rows.length === 0 ? (
            <EmptyState art="search" text={t(s.lang, "noResults")} />
          ) : (
            <VirtualList
              items={rows}
              keyOf={(r: BrowseRow) => r.item.id}
              render={(r: BrowseRow) => (
                <button type="button" class="row-main no-pill" onClick={() => openChart(r.item.id)}>
                  <ItemIcon item={r.item} meta={meta.data} />
                  <span class="row-name">
                    <span class={`name q${r.item.quality}`}>{r.item.name[s.lang]}</span>
                    <span class="sub">{r.quote ? `${fmt(r.quote.listed)} ${t(s.lang, "listedShort")}` : t(s.lang, "notListed")}</span>
                  </span>
                  <span class="row-price"><Money copper={r.quote?.[s.priceField]} lang={s.lang} short /></span>
                </button>
              )}
            />
          )}
        </>
      )}
    </div>
  );
}
