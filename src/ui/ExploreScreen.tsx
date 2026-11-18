import { useMemo, useState } from "preact/hooks";
import { arbitrage, deals, mostListed, topMovers } from "../lib/explore";
import { t, type MessageKey } from "../lib/i18n";
import { change24h, houseCut, type Quote } from "../lib/quotes";
import { REALM_GROUPS, houseId, openChart, useStore, type Faction } from "../app/store";
import { clearCache } from "../data/live";
import { PullToRefresh } from "./PullToRefresh";
import { bumpRefresh, useCatalog, useMeta, useQuotes } from "./data";
import { ChangePill, ErrorMsg, ItemIcon, Loading, Money, formatPct } from "./parts";
import { HouseBadge } from "./WatchlistScreen";

type View = "gainers" | "losers" | "topSellers" | "mostListed" | "deals" | "flips";
const VIEWS: View[] = ["gainers", "losers", "topSellers", "mostListed", "deals", "flips"];

export function ExploreScreen() {
  const s = useStore();
  const [view, setView] = useState<View>("gainers");
  const house = houseId(s);
  const quotes = useQuotes(house);
  const catalog = useCatalog();
  const meta = useMeta();
  const group = REALM_GROUPS.find((r) => r.id === s.realm) ?? REALM_GROUPS[0]!;
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
    return c === 2 || c === 4;
  };

  const list = useMemo(() => {
    const all = quotes.data ? [...quotes.data.values()] : [];
    const withHistory = all.filter((q) => q.prev24h != null && !isGear(q.id));
    switch (view) {
      case "gainers":
        return topMovers(all, { direction: "up", minListed: 5, limit: 50 }).map((m) => ({ id: m.quote.id, quote: m.quote, extra: null as number | null }));
      case "losers":
        return topMovers(all, { direction: "down", minListed: 5, limit: 50 }).map((m) => ({ id: m.quote.id, quote: m.quote, extra: null }));
      case "topSellers":
        return all
          .filter((q) => (q.soldPerDay ?? 0) > 0 && !isGear(q.id))
          .sort((a, b) => b.soldPerDay! * b.market - a.soldPerDay! * a.market)
          .slice(0, 50)
          .map((q) => ({ id: q.id, quote: q, extra: null as number | null }));
      case "mostListed":
        return mostListed(all, 50).map((q) => ({ id: q.id, quote: q, extra: null }));
      case "deals":
        return deals(withHistory, { minListed: 3, maxRatio: 0.7, limit: 50 }).map((d) => ({ id: d.quote.id, quote: d.quote, extra: d.discount }));
      default:
        return [];
    }
  }, [quotes.data, catalog.data, view]);

  const flips = useMemo(() => {
    if (view !== "flips" || !buyQuotes.data || !sellQuotes.data) return [];
    // Ignore thin markets and near-free junk: they produce huge but fake margins.
    const liquid = (m: ReadonlyMap<number, Quote>, minPrice: number) =>
      new Map([...m].filter(([id, q]) => q.listed >= 5 && q.auctions >= 3 && q.min >= minPrice && !isGear(id)));
    return arbitrage(liquid(buyQuotes.data, 100), liquid(sellQuotes.data, 100), { sellCut: houseCut(sellFaction), minProfit: 1_000, minSellListed: 5, limit: 500 })
      .filter((f) => f.profitPct <= 300)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 50);
  }, [view, buyQuotes.data, sellQuotes.data, sellFaction, catalog.data]);

  const factionName = (f: Faction) => t(s.lang, f === "blackwater" ? "blackwaterShort" : f);
  const name = (id: number) => catalog.data?.get(id)?.name[s.lang] ?? `#${id}`;
  const refresh = async () => {
    clearCache();
    bumpRefresh();
    await new Promise((r) => setTimeout(r, 700));
  };

  return (
    <section class="screen">
      <header class="topbar"><h1 class="title">{t(s.lang, "tabExplore")}</h1></header>
      <div class="subbar"><HouseBadge /></div>
      <div class="chips" role="tablist">
        {VIEWS.map((v) => (
          <button type="button" role="tab" aria-selected={v === view} class={v === view ? "chip on" : "chip"} onClick={() => setView(v)}>{t(s.lang, v as MessageKey)}</button>
        ))}
      </div>
      {view === "deals" && <p class="hint">{t(s.lang, "dealsHint")}</p>}
      {view === "flips" && (
        <div class="hint">
          <p>{t(s.lang, "flipsHint")}</p>
          <button type="button" class="btn ghost" onClick={() => setReverse(!reverse)}>
            {t(s.lang, "buyIn")} {factionName(buyFaction)} → {t(s.lang, "sellIn")} {factionName(sellFaction)} ⇄
          </button>
        </div>
      )}
      <PullToRefresh onRefresh={refresh}>
      {quotes.error && !quotes.data ? (
        <ErrorMsg text={t(s.lang, "loadError")} retry={bumpRefresh} retryLabel={t(s.lang, "retry")} />
      ) : !quotes.data || !catalog.data ? (
        <Loading text={t(s.lang, "loading")} />
      ) : view === "flips" ? (
        <ul class="rows">
          {flips.map((f) => (
            <li key={f.id} class="row">
              <button type="button" class="row-main" onClick={() => openChart(f.id)}>
                <ItemIcon item={catalog.data!.get(f.id)} meta={meta.data} />
                <span class="row-name">
                  <span class={`name q${catalog.data!.get(f.id)?.quality ?? 1}`}>{name(f.id)}</span>
                  <span class="sub"><Money copper={f.buyPrice} lang={s.lang} short /> → <Money copper={f.sellPrice} lang={s.lang} short /></span>
                </span>
                <span class="row-price up"><Money copper={f.profit} lang={s.lang} short /></span>
                <span class="pill up">{formatPct(f.profitPct, s.lang)}</span>
              </button>
            </li>
          ))}
          {flips.length === 0 && <p class="state-msg">{t(s.lang, "noResults")}</p>}
        </ul>
      ) : (
        <ul class="rows">
          {list.map(({ id, quote, extra }) => (
            <li key={id} class="row">
              <button type="button" class="row-main" onClick={() => openChart(id)}>
                <ItemIcon item={catalog.data!.get(id)} meta={meta.data} />
                <span class="row-name">
                  <span class={`name q${catalog.data!.get(id)?.quality ?? 1}`}>{name(id)}</span>
                  <span class="sub">{view === "topSellers" ? `${t(s.lang, "soldDay")}: ${(quote.soldPerDay ?? 0).toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US")}` : `${quote.listed.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US")} · ${quote.auctions}`}</span>
                </span>
                <span class="row-price"><Money copper={view === "deals" ? quote.min : quote[s.priceField]} lang={s.lang} short /></span>
                {extra != null ? <span class="pill down">-{formatPct(extra, s.lang, false)}</span> : <ChangePill pct={change24h(quote)} abs={quote.prev24h ? quote.market - quote.prev24h : null} mode={s.changeMode} lang={s.lang} />}
              </button>
            </li>
          ))}
          {list.length === 0 && <p class="state-msg">{view === "gainers" || view === "losers" || view === "deals" || view === "topSellers" ? t(s.lang, "needsHistory") : t(s.lang, "noResults")}</p>}
        </ul>
      )}
      </PullToRefresh>
    </section>
  );
}
