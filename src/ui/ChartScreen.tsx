import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Candle } from "../lib/candles";
import { candlesFor } from "../data/series";
import { t, type Lang } from "../lib/i18n";
import { newAlertId } from "../lib/alerts";
import { change24h, houseCut } from "../lib/quotes";
import {
  REALM_GROUPS,
  activeWatchlist,
  houseId,
  setState,
  toggleInList,
  useStore,
  type ChartType,
  type Faction,
  type IndicatorKey,
  type Timeframe,
} from "../app/store";
import { ChartEngine } from "./chartEngine";
import { useCatalog, useHistory, useMeta, useQuotes } from "./data";
import { ChangePill, Icon, ItemIcon, Loading, Money, Sheet, formatPct } from "./parts";
import { SearchScreen } from "./SearchScreen";
import { HouseBadge } from "./WatchlistScreen";

const TIMEFRAMES: Timeframe[] = ["1h", "4h", "1d", "1w"];
const CHART_TYPES: ChartType[] = ["candles", "bars", "line", "area", "heikin"];
const INDICATOR_KEYS: IndicatorKey[] = ["volume", "sma20", "ema50", "bb", "rsi", "macd"];

function tfLabel(tf: Timeframe, lang: Lang): string {
  if (lang === "fr") return { "1h": "1H", "4h": "4H", "1d": "1J", "1w": "1S" }[tf];
  return tf.toUpperCase();
}

export function ChartScreen() {
  const s = useStore();
  const house = houseId(s);
  const catalog = useCatalog();
  const meta = useMeta();
  const quotes = useQuotes(house);
  const history = useHistory(house, s.chartItem);
  const compareHistory = useHistory(house, s.compareItem);
  const item = catalog.data?.get(s.chartItem);
  const quote = quotes.data?.get(s.chartItem);
  const list = activeWatchlist(s);
  const [sheet, setSheet] = useState<null | "indicators" | "type" | "alert" | "compare">(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const engine = useRef<ChartEngine | null>(null);

  const candles = useMemo(() => (history.data ? candlesFor(history.data, s.timeframe, s.priceField) : []), [history.data, s.timeframe, s.priceField]);
  const compareCandles = useMemo(() => (s.compareItem && compareHistory.data ? candlesFor(compareHistory.data, s.timeframe, s.priceField) : null), [compareHistory.data, s.compareItem, s.timeframe, s.priceField]);

  useEffect(() => {
    if (!holder.current) return;
    engine.current = new ChartEngine(holder.current, setHover);
    return () => engine.current?.destroy();
  }, []);
  useEffect(() => {
    engine.current?.render({
      candles,
      compare: compareCandles && s.compareItem ? { candles: compareCandles, label: catalog.data?.get(s.compareItem)?.name[s.lang] ?? `#${s.compareItem}` } : null,
      chartType: s.chartType,
      indicators: s.indicators,
      lang: s.lang,
    });
  }, [candles, compareCandles, s.chartType, s.indicators, s.lang, s.theme]);

  const shown = hover ?? candles.at(-1) ?? null;
  const pct = quote ? change24h(quote) : null;
  const inList = list.items.includes(s.chartItem);
  const name = item?.name[s.lang] ?? `#${s.chartItem}`;
  const firstPoint = history.data?.hourly[0]?.time;

  return (
    <section class="screen chart-screen">
      <header class="topbar">
        <div class="symbol">
          <ItemIcon item={item} meta={meta.data} size={30} />
          <div>
            <h1 class={`name q${item?.quality ?? 1}`}>{name}</h1>
            <div class="symbol-price">
              <Money copper={quote?.[s.priceField]} lang={s.lang} />
              <ChangePill pct={pct} abs={quote?.prev24h ? quote.market - quote.prev24h : null} mode={s.changeMode} lang={s.lang} />
            </div>
          </div>
        </div>
        <div class="topbar-actions">
          <button type="button" class={`icon-btn ${inList ? "accent" : ""}`} aria-pressed={inList} aria-label={`${t(s.lang, "addTo")} ${list.name[s.lang]}`} onClick={() => toggleInList(list.id, s.chartItem)}>
            <Icon name="star" filled={inList} />
          </button>
          <button type="button" class="icon-btn" aria-label={t(s.lang, "setAlert")} onClick={() => setSheet("alert")}>
            <Icon name="bell" />
          </button>
        </div>
      </header>

      <div class="chart-toolbar">
        <div class="seg compact" role="radiogroup">
          {TIMEFRAMES.map((tf) => (
            <button type="button" role="radio" aria-checked={tf === s.timeframe} class={tf === s.timeframe ? "on" : ""} onClick={() => setState({ timeframe: tf })}>{tfLabel(tf, s.lang)}</button>
          ))}
        </div>
        <button type="button" class="tool" onClick={() => setSheet("type")}>{t(s.lang, s.chartType)}</button>
        <button type="button" class="tool" onClick={() => setSheet("indicators")}><Icon name="layers" size={18} /> {s.indicators.length}</button>
        <button type="button" class={`tool ${s.compareItem ? "on" : ""}`} onClick={() => (s.compareItem ? setState({ compareItem: null }) : setSheet("compare"))} aria-label={t(s.lang, s.compareItem ? "removeCompare" : "compareWith")}>
          <Icon name="compare" size={18} />
        </button>
      </div>

      <div class="chart-wrap">
        <div class="legend">
          {shown ? (
            <>
              <span>O <b><Money copper={shown.open} lang={s.lang} short /></b></span>
              <span>H <b><Money copper={shown.high} lang={s.lang} short /></b></span>
              <span>L <b><Money copper={shown.low} lang={s.lang} short /></b></span>
              <span>C <b><Money copper={shown.close} lang={s.lang} short /></b></span>
              <span>{t(s.lang, "volume")} <b>{shown.volume.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US")}</b></span>
            </>
          ) : null}
          {s.compareItem && <span class="compare-tag">vs {catalog.data?.get(s.compareItem)?.name[s.lang]}</span>}
        </div>
        <div ref={holder} class="chart" />
        {history.loading && !history.data && <div class="chart-overlay"><Loading text={t(s.lang, "loading")} /></div>}
        {history.data && candles.length === 0 && <div class="chart-overlay"><p class="state-msg">{t(s.lang, "noHistory")}</p></div>}
      </div>

      <div class="details">
        <div class="subbar">
          <HouseBadge />
          {firstPoint ? <span class="muted small">{t(s.lang, "collecting")} {new Date(firstPoint * 1000).toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US", { dateStyle: "medium", timeStyle: "short" })} · {history.data?.hourly.length} {t(s.lang, "points")}</span> : null}
        </div>
        <dl class="stats">
          <div><dt>{t(s.lang, "market")}</dt><dd><Money copper={quote?.market} lang={s.lang} /></dd></div>
          <div><dt>{t(s.lang, "minBuyout")}</dt><dd><Money copper={quote?.min} lang={s.lang} /></dd></div>
          <div><dt>{t(s.lang, "change24h")}</dt><dd class={pct == null ? "" : pct >= 0 ? "up" : "down"}>{formatPct(pct, s.lang)}</dd></div>
          <div><dt>{t(s.lang, "avg7d")}</dt><dd><Money copper={quote?.avg7d} lang={s.lang} /></dd></div>
          <div><dt>{t(s.lang, "listed")}</dt><dd>{quote?.listed.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US") ?? "–"}</dd></div>
          <div><dt>{t(s.lang, "auctions")}</dt><dd>{quote?.auctions ?? "–"}</dd></div>
        </dl>
        <AcrossHouses itemId={s.chartItem} />
        <p class="muted small">{t(s.lang, "listedNote")}</p>
      </div>

      {sheet === "type" && (
        <Sheet title={t(s.lang, "line")} onClose={() => setSheet(null)}>
          <ul class="menu-list">
            {CHART_TYPES.map((ct) => (
              <li><button type="button" class={ct === s.chartType ? "on" : ""} onClick={() => { setState({ chartType: ct }); setSheet(null); }}>{t(s.lang, ct)}</button></li>
            ))}
          </ul>
          <p class="sheet-label">{t(s.lang, "priceField")}</p>
          <div class="seg">
            {(["market", "min"] as const).map((f) => (
              <button type="button" class={f === s.priceField ? "on" : ""} onClick={() => setState({ priceField: f })}>{t(s.lang, f === "market" ? "market" : "minBuyout")}</button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === "indicators" && (
        <Sheet title={t(s.lang, "indicators")} onClose={() => setSheet(null)}>
          <ul class="menu-list">
            {INDICATOR_KEYS.map((k) => {
              const on = s.indicators.includes(k);
              return (
                <li>
                  <button type="button" class={on ? "on" : ""} aria-pressed={on} onClick={() => setState({ indicators: on ? s.indicators.filter((x) => x !== k) : [...s.indicators, k] })}>
                    <span>{t(s.lang, k)}</span>
                    {on && <Icon name="check" size={18} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}
      {sheet === "alert" && <AlertSheet itemId={s.chartItem} name={name} current={quote?.[s.priceField] ?? null} onClose={() => setSheet(null)} />}
      {sheet === "compare" && <SearchScreen onClose={() => setSheet(null)} onPick={(id) => setState({ compareItem: id === s.chartItem ? null : id })} />}
    </section>
  );
}

/** The same item in the three houses of the realm group, with resale after the house cut. */
function AcrossHouses({ itemId }: { itemId: number }) {
  const s = useStore();
  const group = REALM_GROUPS.find((r) => r.id === s.realm) ?? REALM_GROUPS[0]!;
  const a = useQuotes(group.houses.alliance);
  const h = useQuotes(group.houses.horde);
  const b = useQuotes(group.houses.blackwater);
  const rows: { faction: Faction; quote: ReturnType<NonNullable<typeof a.data>["get"]> }[] = [
    { faction: "alliance", quote: a.data?.get(itemId) },
    { faction: "horde", quote: h.data?.get(itemId) },
    { faction: "blackwater", quote: b.data?.get(itemId) },
  ];
  return (
    <div class="houses">
      <p class="section-label">{t(s.lang, "acrossHouses")}</p>
      <table>
        <thead>
          <tr><th>{t(s.lang, "house")}</th><th>{t(s.lang, "minBuyout")}</th><th>{t(s.lang, "market")}</th><th>{t(s.lang, "afterCut")}</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr class={r.faction === s.faction ? "current" : ""} onClick={() => setState({ faction: r.faction })}>
              <td><span class={`dot ${r.faction}`} />{t(s.lang, r.faction === "blackwater" ? "blackwaterShort" : r.faction)}</td>
              <td><Money copper={r.quote?.min} lang={s.lang} short /></td>
              <td><Money copper={r.quote?.market} lang={s.lang} short /></td>
              <td><Money copper={r.quote ? Math.round(r.quote.market * (1 - houseCut(r.faction))) : null} lang={s.lang} short /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertSheet({ itemId, name, current, onClose }: { itemId: number; name: string; current: number | null; onClose: () => void }) {
  const s = useStore();
  const [op, setOp] = useState<"above" | "below">("below");
  const [gold, setGold] = useState(current ? String(Math.round((current / 10_000) * 100) / 100) : "");
  const price = Math.round(Number(gold.replace(",", ".")) * 10_000);
  return (
    <Sheet title={`${t(s.lang, "setAlert")}: ${name}`} onClose={onClose}>
      <p class="sheet-label">{t(s.lang, s.priceField === "market" ? "market" : "minBuyout")} · {t(s.lang, "alertWhen")}</p>
      <div class="seg">
        {(["below", "above"] as const).map((o) => (
          <button type="button" class={o === op ? "on" : ""} onClick={() => setOp(o)}>{t(s.lang, o === "above" ? "alertAbove" : "alertBelow")}</button>
        ))}
      </div>
      <label class="field">
        <span>{t(s.lang, "alertPrice")}</span>
        <input type="text" inputMode="decimal" value={gold} onInput={(e) => setGold((e.target as HTMLInputElement).value)} />
      </label>
      {current != null && <p class="muted small">{t(s.lang, "market")}: <Money copper={current} lang={s.lang} /></p>}
      <button type="button" class="btn wide" disabled={!(price > 0)} onClick={() => {
        setState((st) => ({ alerts: [...st.alerts, { id: newAlertId(), itemId, house: houseId(st), field: st.priceField, op, price, active: true, createdAt: Math.floor(Date.now() / 1000) }] }));
        onClose();
      }}>{t(s.lang, "alertCreate")}</button>
      <p class="muted small">{t(s.lang, "alertNote")}</p>
    </Sheet>
  );
}
