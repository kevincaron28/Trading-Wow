import { useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { houseId, openChart, useStore } from "../app/store";
import { clearCache, houseUpdated } from "../data/live";
import { t, type Lang } from "../lib/i18n";
import { houseCut, type Quote } from "../lib/quotes";
import { breadth, investments, movers, overviewClass, quickFlips, salesVolume, seriesChange, topCrafts, type ClassOf } from "../lib/overview";
import { formatPoints } from "../lib/money";
import { bumpRefresh, useCatalog, useIndexes, useMeta, useQuotes, useRecipes } from "./data";
import { openExplore } from "./ExploreScreen";
import { ErrorMsg, ItemIcon, Loading, Money, formatPct, relativeTime } from "./parts";
import { PullToRefresh } from "./PullToRefresh";
import { HouseBadge } from "./WatchlistScreen";

const ROWS = 5;

function num(n: number, lang: Lang): string {
  return Math.round(n).toLocaleString(lang === "fr" ? "fr-CA" : "en-US");
}

/** Wide sparkline of the last 7 days of the index (hourly values). */
function WideSpark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 300).toFixed(1)},${(46 - ((v - min) / span) * 42).toFixed(1)}`).join(" ");
  return (
    <svg class="ov-spark" viewBox="0 0 300 48" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? "var(--up)" : "var(--down)"} stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

function Pct({ value, lang, label }: { value: number | null; lang: Lang; label?: string }) {
  return (
    <span class={`ov-pct ${value == null ? "" : value >= 0 ? "up" : "down"}`}>
      {formatPct(value, lang)}{label && <small> {label}</small>}
    </span>
  );
}

function Section({ title, hint, more, lang, children }: { title: string; hint?: string; more?: () => void; lang: Lang; children: ComponentChildren }) {
  return (
    <section class="ov-section">
      <div class="ov-section-head">
        <h2 class="section-label">{title}</h2>
        {more && <button type="button" class="link-btn" onClick={more}>{t(lang, "seeAll")}</button>}
      </div>
      {hint && <p class="hint">{hint}</p>}
      {children}
    </section>
  );
}

export function OverviewScreen() {
  const s = useStore();
  const house = houseId(s);
  const quotes = useQuotes(house);
  const catalog = useCatalog();
  const meta = useMeta();
  const indexes = useIndexes(house);
  const recipes = useRecipes();
  const [moveWindow, setMoveWindow] = useState<"1d" | "7d">("1d");
  const cut = houseCut(s.faction);
  const classOf: ClassOf = (id) => overviewClass(catalog.data?.get(id));

  const all: Quote[] = useMemo(() => (quotes.data ? [...quotes.data.values()] : []), [quotes.data]);
  const ready = !!quotes.data && !!catalog.data;
  const recap = useMemo(() => (ready ? { breadth: breadth(all, classOf), volume: salesVolume(all, classOf), onSale: all.filter((q) => q.listed > 0).length } : null), [all, catalog.data]);
  const up = useMemo(() => (ready ? movers(all, classOf, { window: moveWindow, direction: "up", limit: ROWS }) : []), [all, catalog.data, moveWindow]);
  const down = useMemo(() => (ready ? movers(all, classOf, { window: moveWindow, direction: "down", limit: ROWS }) : []), [all, catalog.data, moveWindow]);
  const flips = useMemo(() => (ready ? quickFlips(all, classOf, cut, { limit: ROWS }) : []), [all, catalog.data, cut]);
  const invest = useMemo(() => (ready ? investments(all, classOf, { limit: ROWS }) : []), [all, catalog.data]);
  const crafts = useMemo(() => (ready && recipes.data ? topCrafts(recipes.data, quotes.data!, s.priceField, cut, ROWS) : []), [quotes.data, recipes.data, s.priceField, cut, ready]);

  const gl100 = indexes.data?.gl100;
  const index = useMemo(() => {
    const h = gl100?.hourly ?? [];
    if (!h.length) return null;
    const last = h.at(-1)!;
    return { value: last[1], d1: seriesChange(h, 24), d7: seriesChange(h, 24 * 7), spark: h.filter(([x]) => x > last[0] - 24 * 7).map(([, v]) => v) };
  }, [gl100]);
  const updated = houseUpdated(meta.data?.houses.find((h) => h.id === house));

  const name = (id: number) => catalog.data?.get(id)?.name[s.lang] ?? `#${id}`;
  const notEnough = <p class="ov-empty">{t(s.lang, "notEnoughData")}</p>;
  // With a day of prices, an empty list means nothing meets the rules right now (not missing data).
  const none = recap?.breadth ? <p class="ov-empty">{t(s.lang, "nothingNow")}</p> : notEnough;
  const refresh = async () => {
    clearCache();
    bumpRefresh();
    await new Promise((r) => setTimeout(r, 700));
  };

  /** One item row: icon and name, a sub line, the price and a pill; tapping opens the item's chart. */
  const row = (id: number, sub: ComponentChildren, price: ComponentChildren, pill: ComponentChildren) => (
    <li key={id} class="row">
      <button type="button" class="row-main" onClick={() => openChart(id)}>
        <ItemIcon item={catalog.data!.get(id)} meta={meta.data} />
        <span class="row-name">
          <span class={`name q${catalog.data!.get(id)?.quality ?? 1}`}>{name(id)}</span>
          <span class="sub">{sub}</span>
        </span>
        <span class="row-price">{price}</span>
        {pill}
      </button>
    </li>
  );
  const pill = (value: number, kind: "up" | "down", signed = true) => <span class={`pill ${kind}`}>{signed ? formatPct(value, s.lang) : `-${formatPct(value, s.lang, false)}`}</span>;
  const perDay = (n: number | null) => (n == null ? "" : `~${num(n, s.lang)}${t(s.lang, "perDayShort")}`);

  return (
    <section class="screen">
      <header class="topbar"><h1 class="title">{t(s.lang, "tabOverview")}</h1></header>
      <div class="subbar">
        <HouseBadge />
        {updated != null && <span class="muted small">{t(s.lang, "updated")} {relativeTime(updated, s.lang)}</span>}
      </div>
      <PullToRefresh onRefresh={refresh}>
        {quotes.error && !quotes.data ? (
          <ErrorMsg text={t(s.lang, "loadError")} retry={bumpRefresh} retryLabel={t(s.lang, "retry")} />
        ) : !ready ? (
          <Loading text={t(s.lang, "loading")} />
        ) : (
          <div class="overview">
            <Section title={t(s.lang, "marketRecap")} lang={s.lang}>
              <button type="button" class="ov-card ov-index" onClick={() => openExplore("indexes")}>
                {index ? (
                  <>
                    <span class="ov-index-head">
                      <span class="muted small">{t(s.lang, "ledger100")}</span>
                      <b class="ov-index-value">{formatPoints(index.value, s.lang)}</b>
                      <span class="ov-index-changes">
                        <Pct value={index.d1} lang={s.lang} label={t(s.lang, "window24h")} />
                        <Pct value={index.d7} lang={s.lang} label={t(s.lang, "window7d")} />
                      </span>
                    </span>
                    <WideSpark values={index.spark} up={(index.d7 ?? index.d1 ?? 0) >= 0} />
                  </>
                ) : indexes.data || indexes.error ? notEnough : <span class="muted small">{t(s.lang, "loading")}</span>}
              </button>
              <dl class="stats">
                <div>
                  <dt>{t(s.lang, "risingFalling")}</dt>
                  <dd>{recap?.breadth ? <><span class="up-text">{num(recap.breadth.up, s.lang)} ▲</span> · <span class="down-text">{num(recap.breadth.down, s.lang)} ▼</span></> : <span class="muted small">{t(s.lang, "notEnoughData")}</span>}</dd>
                </div>
                <div>
                  <dt>{t(s.lang, "salesVsUsual")}</dt>
                  <dd>{recap?.volume ? <Pct value={recap.volume.pct} lang={s.lang} /> : <span class="muted small">{t(s.lang, "notEnoughData")}</span>}</dd>
                </div>
                <div>
                  <dt>{t(s.lang, "goldTraded")}</dt>
                  <dd>{recap?.volume ? <Money copper={recap.volume.today} lang={s.lang} short /> : <span class="muted small">{t(s.lang, "notEnoughData")}</span>}</dd>
                </div>
                <div>
                  <dt>{t(s.lang, "itemsOnSale")}</dt>
                  <dd>{num(recap?.onSale ?? 0, s.lang)}</dd>
                </div>
              </dl>
            </Section>

            <Section title={t(s.lang, "biggestMovers")} lang={s.lang} more={() => openExplore("markets", "gainers")}>
              <div class="ov-toggle">
                <div class="seg compact" role="radiogroup">
                  {(["1d", "7d"] as const).map((w) => (
                    <button type="button" role="radio" aria-checked={moveWindow === w} class={moveWindow === w ? "on" : ""} onClick={() => setMoveWindow(w)}>{t(s.lang, w === "1d" ? "window24h" : "vs7dAvg")}</button>
                  ))}
                </div>
              </div>
              <h3 class="ov-sub">{t(s.lang, "goingUp")}</h3>
              {up.length ? <ul class="rows">{up.map((m) => row(m.quote.id, `${num(m.quote.listed, s.lang)} ${t(s.lang, "listedShort")} · ${perDay(m.quote.soldPerDay)}`, <Money copper={m.quote.market} lang={s.lang} short />, pill(m.change, "up")))}</ul> : none}
              <h3 class="ov-sub">{t(s.lang, "goingDown")}</h3>
              {down.length ? <ul class="rows">{down.map((m) => row(m.quote.id, `${num(m.quote.listed, s.lang)} ${t(s.lang, "listedShort")} · ${perDay(m.quote.soldPerDay)}`, <Money copper={m.quote.market} lang={s.lang} short />, pill(m.change, "down")))}</ul> : none}
            </Section>

            <Section title={t(s.lang, "bestFlips")} hint={t(s.lang, "bestFlipsHint")} lang={s.lang} more={() => openExplore("markets", "deals")}>
              {flips.length ? (
                <ul class="rows">
                  {flips.map((f) => row(f.quote.id, <><Money copper={f.buy} lang={s.lang} short /> → <Money copper={f.sell} lang={s.lang} short /> · {perDay(f.quote.soldAvg7d ?? f.quote.soldPerDay)}</>, <span class="up-text"><Money copper={f.profit} lang={s.lang} short /></span>, pill(f.pct, "up")))}
                </ul>
              ) : none}
            </Section>

            <Section title={t(s.lang, "bestCrafts")} hint={t(s.lang, "bestCraftsHint")} lang={s.lang} more={() => openExplore("markets", "crafts")}>
              {!recipes.data && !recipes.error ? <Loading text={t(s.lang, "loading")} /> : crafts.length ? (
                <ul class="rows">
                  {crafts.map((c) => row(c.item, <><Money copper={c.cost.perItem} lang={s.lang} short /> → <Money copper={c.sell} lang={s.lang} short /> · {perDay(c.soldPerDay)}</>, <span class="up-text"><Money copper={c.profit} lang={s.lang} short /></span>, pill(c.pct, "up")))}
                </ul>
              ) : none}
            </Section>

            <Section title={t(s.lang, "investIdeas")} hint={t(s.lang, "investIdeasHint")} lang={s.lang}>
              {invest.length ? (
                <ul class="rows">
                  {invest.map((v) => row(v.quote.id, <>{t(s.lang, "avg7dShort")} <Money copper={v.quote.avg7d} lang={s.lang} short /> · {perDay(v.soldPerDay)}</>, <Money copper={v.quote.market} lang={s.lang} short />, pill(v.discount, "down", false)))}
                </ul>
              ) : none}
            </Section>

            <p class="muted small method-note">{t(s.lang, "overviewNote")}</p>
          </div>
        )}
      </PullToRefresh>
    </section>
  );
}

