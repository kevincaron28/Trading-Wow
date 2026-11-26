import { useMemo, useState } from "preact/hooks";
import { deals, findFlips, mostListed, topMovers } from "../lib/explore";
import { t, type MessageKey } from "../lib/i18n";
import { change24h, houseCut, salesPerDay, type Quote } from "../lib/quotes";
import { SALES_STEPS, loadFilters, saveFilters, type MoneyFilters } from "../app/filters";
import { REALM_GROUPS, houseId, openChart, setState, useStore, type Faction } from "../app/store";
import { clearCache } from "../data/live";
import { PullToRefresh } from "./PullToRefresh";
import { bumpRefresh, useCatalog, useMeta, useQuotes, useRecipes } from "./data";
import { PROFESSIONS, profitableCrafts } from "../lib/crafting";
import { ChangePill, ErrorMsg, ItemIcon, Loading, Money, formatPct } from "./parts";
import { HouseBadge } from "./WatchlistScreen";
import { BrowseView } from "./BrowseView";
import { IndexesView } from "./IndexesView";

type View = "gainers" | "losers" | "topSellers" | "mostListed" | "deals" | "flips" | "crafts";
const VIEWS: View[] = ["gainers", "losers", "topSellers", "mostListed", "deals", "flips", "crafts"];
/** Professions offered as filters on Profitable crafts (the ones whose recipes make tradable items). */
const CRAFT_PROFESSIONS = [171, 164, 185, 333, 202, 129, 165, 186, 197];
/** Item class of recipes, patterns, plans, formulas and schematics. */
const RECIPE_CLASS = 9;
/** Browse (every item by category) or Markets (movers, deals, flips); kept while the app runs. */
let rememberedMode: "browse" | "markets" | "indexes" = "browse";
let rememberedView: View = "gainers";

/** Open Explore on one mode (and one Markets list), e.g. from the overview's "See all" links. */
export function openExplore(mode: "browse" | "markets" | "indexes", view?: View): void {
  rememberedMode = mode;
  if (view) rememberedView = view;
  setState({ tab: "explore" });
}

export function ExploreScreen() {
  const s = useStore();
  const [view, setViewState] = useState<View>(rememberedView);
  const setView = (v: View) => { rememberedView = v; setViewState(v); };
  const [mode, setModeState] = useState(rememberedMode);
  const setMode = (m: "browse" | "markets" | "indexes") => { rememberedMode = m; setModeState(m); };
  const house = houseId(s);
  const quotes = useQuotes(house);
  const catalog = useCatalog();
  const meta = useMeta();
  const group = REALM_GROUPS.find((r) => r.id === s.realm) ?? REALM_GROUPS[0]!;
  const [filters, setFiltersState] = useState(loadFilters);
  const setFilters = (patch: Partial<MoneyFilters>) => { const next = { ...filters, ...patch }; saveFilters(next); setFiltersState(next); };
  // Flip finder: your faction house <-> the neutral house (both reachable by one character).
  const [reverse, setReverse] = useState(false);
  const own: Faction = s.faction === "blackwater" ? "horde" : s.faction;
  const buyFaction: Faction = reverse ? "blackwater" : own;
  const sellFaction: Faction = reverse ? own : "blackwater";
  const buyQuotes = useQuotes(group.houses[buyFaction]);
  const sellQuotes = useQuotes(group.houses[sellFaction]);

  // Gear carries random stat suffixes ("of the Eagle") that share one item ID, so its prices mix
  // different items: keep it out of deals and flips.
  const isGear = (id: number) => {
    const c = catalog.data?.get(id)?.itemClass;
    return c === 2 || c === 4 || c == null || c < 0;
  };

  // Movers only among items that really trade: thin or relisted junk swings by thousands of percent.
  const movable = (q: Quote) => q.auctions >= 3 && (q.soldPerDay ?? 0) >= 1 && !isGear(q.id);

  const list = useMemo(() => {
    const all = quotes.data ? [...quotes.data.values()] : [];
    const withHistory = all.filter((q) => q.prev24h != null && !isGear(q.id));
    switch (view) {
      case "gainers":
        return topMovers(all.filter(movable), { direction: "up", minListed: 20, limit: 500 }).filter((m) => Math.abs(m.change) <= 500).slice(0, 50).map((m) => ({ id: m.quote.id, quote: m.quote, extra: null as number | null }));
      case "losers":
        return topMovers(all.filter(movable), { direction: "down", minListed: 20, limit: 500 }).filter((m) => Math.abs(m.change) <= 500).slice(0, 50).map((m) => ({ id: m.quote.id, quote: m.quote, extra: null }));
      case "topSellers":
        return all
          .filter((q) => (q.soldPerDay ?? 0) > 0 && !isGear(q.id))
          .sort((a, b) => b.soldPerDay! * b.market - a.soldPerDay! * a.market)
          .slice(0, 50)
          .map((q) => ({ id: q.id, quote: q, extra: null as number | null }));
      case "mostListed":
        return mostListed(all, 50).map((q) => ({ id: q.id, quote: q, extra: null }));
      case "deals":
        return deals(withHistory, { minListed: 3, maxRatio: 0.7, limit: 50, minSales: filters.minSales }).map((d) => ({ id: d.quote.id, quote: d.quote, extra: d.discount }));
      default:
        return [];
    }
  }, [quotes.data, catalog.data, view, filters.minSales]);

  const flips = useMemo(() => {
    if (view !== "flips" || !buyQuotes.data || !sellQuotes.data) return [];
    const skip = (id: number) => isGear(id) || (!filters.recipes && catalog.data?.get(id)?.itemClass === RECIPE_CLASS);
    return findFlips(buyQuotes.data, sellQuotes.data, { sellCut: houseCut(sellFaction), minSales: filters.minSales, skip });
  }, [view, buyQuotes.data, sellQuotes.data, sellFaction, catalog.data, filters]);

  // Profitable crafts (0.13): cheapest recipe per item, every reagent priced, the crafted item listed.
  const recipes = useRecipes();
  const [profession, setProfession] = useState<number | null>(null);
  const crafts = useMemo(() => {
    if (view !== "crafts" || !recipes.data || !quotes.data) return [];
    return profitableCrafts(recipes.data, quotes.data, s.priceField, houseCut(s.faction), { profession, minAuctions: 2, maxPct: 1000, limit: 100, minSales: filters.minSales });
  }, [view, recipes.data, quotes.data, s.priceField, s.faction, profession, filters.minSales]);

  const factionName = (f: Faction) => t(s.lang, f === "blackwater" ? "blackwaterShort" : f);
  const name = (id: number) => catalog.data?.get(id)?.name[s.lang] ?? `#${id}`;
  const num = (n: number) => n.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US");
  /** "~12/day · 40 listed": what makes a row worth acting on. */
  const demand = (q: Quote | undefined) => {
    if (!q) return "";
    const sold = salesPerDay(q);
    return `${sold == null ? "" : `~${num(sold)}${t(s.lang, "perDayShort")} · `}${num(q.listed)} ${t(s.lang, "listedShort")}`;
  };
  // An empty money list is usually the sales filter: say so.
  const emptyMoney = filters.minSales > 0 ? t(s.lang, "noSalesMatch") : t(s.lang, "noResults");
  const refresh = async () => {
    clearCache();
    bumpRefresh();
    await new Promise((r) => setTimeout(r, 700));
  };

  return (
    <section class="screen">
      <header class="topbar"><h1 class="title">{t(s.lang, "tabExplore")}</h1></header>
      <div class="subbar"><HouseBadge /></div>
      <div class="mode-switch">
        <div class="seg" role="tablist">
          {(["browse", "markets", "indexes"] as const).map((m) => (
            <button type="button" role="tab" aria-selected={mode === m} class={mode === m ? "on" : ""} onClick={() => setMode(m)}>{t(s.lang, m)}</button>
          ))}
        </div>
      </div>
      {mode === "browse" ? <BrowseView /> : mode === "indexes" ? <IndexesView /> : (<>
      <div class="chips wrap" role="tablist">
        {VIEWS.map((v) => (
          <button type="button" role="tab" aria-selected={v === view} class={v === view ? "chip on" : "chip"} onClick={() => setView(v)}>{t(s.lang, v as MessageKey)}</button>
        ))}
      </div>
      {view === "deals" && <p class="hint">{t(s.lang, "dealsHint")}</p>}
      {view === "crafts" && (
        <div class="hint">
          <p>{t(s.lang, "craftsHint")}</p>
          <div class="chips small" role="tablist">
            {[null, ...CRAFT_PROFESSIONS].map((p) => (
              <button type="button" role="tab" aria-selected={p === profession} class={p === profession ? "chip on" : "chip"} onClick={() => setProfession(p)}>{p == null ? t(s.lang, "allCategories") : PROFESSIONS[p]![s.lang]}</button>
            ))}
          </div>
        </div>
      )}
      {view === "flips" && (
        <div class="hint">
          <p>{t(s.lang, "flipsHint")}</p>
          <button type="button" class="btn ghost" onClick={() => setReverse(!reverse)}>
            {t(s.lang, "buyIn")} {factionName(buyFaction)} → {t(s.lang, "sellIn")} {factionName(sellFaction)} ⇄
          </button>
        </div>
      )}
      {(view === "deals" || view === "flips" || view === "crafts") && (
        <div class="money-filters">
          <div class="filter-row" role="group" aria-label={t(s.lang, "minSales")}>
            <span class="filter-label">{t(s.lang, "minSales")}</span>
            {SALES_STEPS.map((n) => (
              <button type="button" class={n === filters.minSales ? "chip on" : "chip"} aria-pressed={n === filters.minSales} onClick={() => setFilters({ minSales: n })}>{n === 0 ? t(s.lang, "anySales") : `${n}+`}</button>
            ))}
          </div>
          {view === "flips" && (
            <div class="filter-row">
              <button type="button" class={filters.recipes ? "chip on" : "chip"} aria-pressed={filters.recipes} onClick={() => setFilters({ recipes: !filters.recipes })}>{t(s.lang, filters.recipes ? "recipesShown" : "recipesHidden")}</button>
            </div>
          )}
        </div>
      )}
      <PullToRefresh onRefresh={refresh}>
      {quotes.error && !quotes.data ? (
        <ErrorMsg text={t(s.lang, "loadError")} retry={bumpRefresh} retryLabel={t(s.lang, "retry")} />
      ) : !quotes.data || !catalog.data ? (
        <Loading text={t(s.lang, "loading")} />
      ) : view === "crafts" ? (
        <ul class="rows">
          {crafts.map((c) => (
            <li key={c.item} class="row">
              <button type="button" class="row-main" onClick={() => openChart(c.item)}>
                <ItemIcon item={catalog.data!.get(c.item)} meta={meta.data} />
                <span class="row-name">
                  <span class={`name q${catalog.data!.get(c.item)?.quality ?? 1}`}>{name(c.item)}</span>
                  <span class="sub"><Money copper={c.cost.perItem} lang={s.lang} short /> → <Money copper={c.sell} lang={s.lang} short /></span>
                  <span class="sub">{demand(quotes.data!.get(c.item))}</span>
                </span>
                <span class={`row-price ${c.profit >= 0 ? "up" : "down"}`}><Money copper={c.profit} lang={s.lang} short /></span>
                <span class={`pill ${c.profit >= 0 ? "up" : "down"}`}>{formatPct(c.pct, s.lang)}</span>
              </button>
            </li>
          ))}
          {crafts.length === 0 && <p class="state-msg">{recipes.data ? emptyMoney : t(s.lang, "loading")}</p>}
        </ul>
      ) : view === "flips" ? (
        <ul class="rows">
          {flips.map((f) => (
            <li key={f.id} class="row">
              <button type="button" class="row-main" onClick={() => openChart(f.id)}>
                <ItemIcon item={catalog.data!.get(f.id)} meta={meta.data} />
                <span class="row-name">
                  <span class={`name q${catalog.data!.get(f.id)?.quality ?? 1}`}>{name(f.id)}</span>
                  <span class="sub"><Money copper={f.buyPrice} lang={s.lang} short /> → <Money copper={f.sellPrice} lang={s.lang} short /></span>
                  <span class="sub">{demand(sellQuotes.data?.get(f.id))}</span>
                </span>
                <span class="row-price up"><Money copper={f.profit} lang={s.lang} short /></span>
                <span class="pill up">{formatPct(f.profitPct, s.lang)}</span>
              </button>
            </li>
          ))}
          {flips.length === 0 && <p class="state-msg">{emptyMoney}</p>}
        </ul>
      ) : (
        <ul class="rows">
          {list.map(({ id, quote, extra }) => (
            <li key={id} class="row">
              <button type="button" class="row-main" onClick={() => openChart(id)}>
                <ItemIcon item={catalog.data!.get(id)} meta={meta.data} />
                <span class="row-name">
                  <span class={`name q${catalog.data!.get(id)?.quality ?? 1}`}>{name(id)}</span>
                  {view === "deals" ? (<>
                    <span class="sub">{t(s.lang, "avg7dShort")} <Money copper={quote.avg7d} lang={s.lang} short /></span>
                    <span class="sub">{demand(quote)}</span>
                  </>) : (
                    <span class="sub">{view === "topSellers" ? `${t(s.lang, "soldDay")}: ${num(quote.soldPerDay ?? 0)}` : `${num(quote.listed)} ${t(s.lang, "listedShort")} · ${quote.auctions} ${t(s.lang, "auctionsShort")}`}</span>
                  )}
                </span>
                <span class="row-price"><Money copper={view === "deals" ? quote.min : quote[s.priceField]} lang={s.lang} short /></span>
                {extra != null ? <span class="pill down">-{formatPct(extra, s.lang, false)}</span> : <ChangePill pct={change24h(quote)} abs={quote.prev24h ? quote.market - quote.prev24h : null} mode={s.changeMode} lang={s.lang} />}
              </button>
            </li>
          ))}
          {list.length === 0 && <p class="state-msg">{view === "deals" && filters.minSales > 0 ? emptyMoney : view === "gainers" || view === "losers" || view === "deals" || view === "topSellers" ? t(s.lang, "needsHistory") : t(s.lang, "noResults")}</p>}
        </ul>
      )}
      </PullToRefresh>
      </>)}
    </section>
  );
}
