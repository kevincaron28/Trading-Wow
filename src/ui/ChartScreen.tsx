import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Candle } from "../lib/candles";
import { candlesFor } from "../data/series";
import { t, type Lang } from "../lib/i18n";
import { newAlertId } from "../lib/alerts";
import { MAX_LINES, RANGES, addLine, alertOpFor, earliestPoint, removeLine, type ChartRange } from "../lib/ranges";
import { formatMoneyAxis } from "../lib/money";
import "./chart-tools.css";
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
import { useCatalog, useHistory, useMeta, useQuotes, useTsm, useTsmRegion, bumpRefresh } from "./data";
import { ChangePill, Icon, ItemIcon, Loading, Money, Sheet, formatPct , ErrorMsg } from "./parts";
import { SearchScreen } from "./SearchScreen";
import { HouseBadge } from "./WatchlistScreen";
import { shareChart } from "./share";

const L = {
  en: { share: "Share chart", lines: "Lines", placeLine: "Place price line", log: "Log", tapChart: "Tap the chart to place a line", alertHere: "Alert at this price", del: "Delete", noLines: "No lines yet. Use the line tool, then tap the chart.", alertMade: "Alert created", max: `Max ${MAX_LINES} lines`, ranges: { "1d": "1D", "1w": "1W", "1m": "1M", "3m": "3M", "1y": "1Y", all: "All" } as Record<ChartRange, string> },
  fr: { share: "Partager le graphique", lines: "Lignes", placeLine: "Placer une ligne de prix", log: "Log", tapChart: "Touchez le graphique pour placer une ligne", alertHere: "Alerte à ce prix", del: "Supprimer", noLines: "Aucune ligne. Utilisez l'outil ligne, puis touchez le graphique.", alertMade: "Alerte créée", max: `Max ${MAX_LINES} lignes`, ranges: { "1d": "1J", "1w": "1S", "1m": "1M", "3m": "3M", "1y": "1A", all: "Tout" } as Record<ChartRange, string> },
};

const TIMEFRAMES: Timeframe[] = ["1h", "4h", "1d", "1w"];
const CHART_TYPES: ChartType[] = ["candles", "bars", "line", "area", "heikin"];
const INDICATOR_KEYS: IndicatorKey[] = ["volume", "sma20", "ema50", "bb", "rsi", "macd"];

export function tfLabel(tf: Timeframe, lang: Lang): string {
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
  const tsm = useTsm(house, s.chartItem);
  const tsmRegion = useTsmRegion(s.chartItem);
  const daily = s.timeframe === "1d" || s.timeframe === "1w";
  const compareHistory = useHistory(house, s.compareItem);
  const item = catalog.data?.get(s.chartItem);
  const quote = quotes.data?.get(s.chartItem);
  const list = activeWatchlist(s);
  const [sheet, setSheet] = useState<null | "indicators" | "type" | "alert" | "compare" | "lines">(null);
  const [placing, setPlacing] = useState(false);
  const [lineMsg, setLineMsg] = useState("");
  const itemKey = String(s.chartItem);
  const lines = s.drawings[itemKey] ?? [];
  const lt = L[s.lang];
  const placeRef = useRef<(p: number) => void>(() => {});
  placeRef.current = (price) => {
    setState((st) => ({ drawings: { ...st.drawings, [itemKey]: addLine(st.drawings[itemKey] ?? [], price) } }));
    setPlacing(false);
  };
  const [hover, setHover] = useState<Candle | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const engine = useRef<ChartEngine | null>(null);

  const candles = useMemo(() => (history.data ? candlesFor(history.data, s.timeframe, s.priceField) : []), [history.data, s.timeframe, s.priceField]);
  const compareCandles = useMemo(() => (s.compareItem && compareHistory.data ? candlesFor(compareHistory.data, s.timeframe, s.priceField) : null), [compareHistory.data, s.compareItem, s.timeframe, s.priceField]);

  useEffect(() => {
    if (!holder.current) return;
    engine.current = new ChartEngine(holder.current, setHover, (p) => placeRef.current(p));
    return () => engine.current?.destroy();
  }, []);
  useEffect(() => {
    engine.current?.render({
      candles,
      compare: compareCandles && s.compareItem ? { candles: compareCandles, label: catalog.data?.get(s.compareItem)?.name[s.lang] ?? `#${s.compareItem}` } : null,
      chartType: s.chartType,
      indicators: s.indicators,
      lang: s.lang,
      lines,
      range: s.range,
      // The visible window is set again only when one of these changes, so a data refresh or a new line keeps the
      // user's zoom and pan.
      rangeKey: `${s.chartItem}|${s.compareItem ?? ""}|${s.timeframe}|${s.priceField}|${s.range}`,
      logScale: s.logScale,
    });
  }, [candles, compareCandles, s.chartType, s.indicators, s.lang, s.theme, lines.join(","), s.range, s.logScale]);
  useEffect(() => { engine.current?.setPlacing(placing); }, [placing]);
  useEffect(() => { setPlacing(false); setLineMsg(""); }, [s.chartItem]);

  const shown = hover ?? candles.at(-1) ?? null;
  const pct = quote ? change24h(quote) : null;
  const inList = list.items.includes(s.chartItem);
  const name = item?.name[s.lang] ?? `#${s.chartItem}`;
  const firstPoint = history.data?.hourly[0]?.time;
  // Earliest price in the item's history, for "History since <date>" (unix seconds).
  const earliest = earliestPoint([history.data?.early?.[0]?.time, history.data?.daily[0]?.time, firstPoint]);
  const earlierThanLive = earliest != null && firstPoint != null && earliest < firstPoint - 86_400;
  const dateFmt = (t: number) => new Date(t * 1000).toLocaleDateString(s.lang === "fr" ? "fr-CA" : "en-US", { dateStyle: "medium", timeZone: "UTC" });
  const [sharing, setSharing] = useState(false);
  const onShare = () => {
    if (sharing) return;
    const chart = engine.current?.screenshot();
    if (!chart) return;
    setSharing(true);
    const realm = REALM_GROUPS.find((r) => r.id === s.realm) ?? REALM_GROUPS[0]!;
    const faction = s.faction === "blackwater" ? t(s.lang, "blackwaterShort") : t(s.lang, s.faction);
    void shareChart({ itemId: s.chartItem, name, price: quote?.[s.priceField], houseLabel: `${realm.label[s.lang]} · ${faction}`, lang: s.lang, chart }).catch(() => {}).finally(() => setSharing(false));
  };

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
          <button type="button" class={`icon-btn ${sharing ? "busy" : ""}`} aria-busy={sharing} aria-label={sharing ? t(s.lang, "preparing") : lt.share} title={lt.share} onClick={onShare}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
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
        <button type="button" class={`tool icon-only ${placing ? "on" : ""}`} aria-pressed={placing} aria-label={lt.placeLine} title={lt.placeLine} onClick={() => setPlacing(!placing && lines.length < MAX_LINES)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 12h18" stroke-dasharray="3 3" /><path d="M12 5v4M12 15v4" /></svg>
        </button>
        <button type="button" class="tool" aria-label={lt.lines} onClick={() => setSheet("lines")}>{lt.lines} <span class="count">{lines.length}</span></button>
        <button type="button" class={`tool ${s.logScale ? "on" : ""}`} aria-pressed={s.logScale} onClick={() => setState({ logScale: !s.logScale })}>{lt.log}</button>
        <button type="button" class={`tool ${s.compareItem ? "on" : ""}`} onClick={() => (s.compareItem ? setState({ compareItem: null }) : setSheet("compare"))} aria-label={t(s.lang, s.compareItem ? "removeCompare" : "compareWith")}>
          <Icon name="compare" size={18} />
        </button>
      </div>

      <div class="chart-wrap">
        {placing && <div class="place-hint">{lt.tapChart}</div>}
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
          {!daily && earlierThanLive && <span class="seed-tag">{t(s.lang, "seedHint")}</span>}
        </div>
        <div ref={holder} class={`chart ${placing ? "placing" : ""}`} role="img" aria-label={`${name}: ${candles.length} ${t(s.lang, "points")}`} />
        {history.loading && !history.data && <div class="chart-overlay"><Loading text={t(s.lang, "loading")} /></div>}
        {history.data && candles.length === 0 && <div class="chart-overlay"><p class="state-msg">{t(s.lang, "noHistory")}</p></div>}
        {history.error && !history.data && !history.loading && (
          <div class="chart-overlay interactive"><ErrorMsg text={t(s.lang, "loadError")} retry={bumpRefresh} retryLabel={t(s.lang, "retry")} /></div>
        )}
      </div>

      <div class="chart-toolbar ranges-bar">
        <div class="seg compact ranges" role="radiogroup">
          {RANGES.map((r) => (
            <button type="button" role="radio" aria-checked={r === s.range} class={r === s.range ? "on" : ""} onClick={() => setState({ range: r })}>{lt.ranges[r]}</button>
          ))}
        </div>
      </div>

      {(s.chartType === "candles" || s.chartType === "bars") && !s.compareItem && <p class="muted small wick-note">{t(s.lang, "wickNote")}</p>}
      <div class="details">
        <div class="subbar">
          <HouseBadge />
          {earliest != null ? (
            <span class="history-since small">
              <b>{t(s.lang, "historySince")} {dateFmt(earliest)}</b>
              {firstPoint ? <span class="muted">{t(s.lang, "hourlySince")} {dateFmt(firstPoint)}</span> : null}
            </span>
          ) : null}
        </div>
        <dl class="stats">
          <div><dt>{t(s.lang, "market")}</dt><dd><Money copper={quote?.market} lang={s.lang} /></dd></div>
          <div><dt>{t(s.lang, "minBuyout")}</dt><dd><Money copper={quote?.min} lang={s.lang} /></dd></div>
          <div><dt>{t(s.lang, "change24h")}</dt><dd class={pct == null ? "" : pct >= 0 ? "up" : "down"}>{formatPct(pct, s.lang)}</dd></div>
          <div><dt>{t(s.lang, "avg7d")}</dt><dd><Money copper={quote?.avg7d} lang={s.lang} /></dd></div>
          <div><dt>{t(s.lang, "listed")}</dt><dd>{quote?.listed.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US") ?? "–"}</dd></div>
          <div><dt>{t(s.lang, "auctions")}</dt><dd>{quote?.auctions ?? "–"}</dd></div>
          <div title={t(s.lang, "soldDayHint")}><dt>{t(s.lang, "soldDay")}</dt><dd>{quote?.soldPerDay != null ? quote.soldPerDay.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US") : "–"}</dd></div>
        </dl>
        {(tsm.data || tsmRegion.data) && (
          <div class="tsm-card">
            <p class="sheet-label">TradeSkillMaster</p>
            <dl class="stats">
              {tsm.data && <div><dt>{t(s.lang, "tsmMarket")}</dt><dd><Money copper={tsm.data.marketValue} lang={s.lang} /></dd></div>}
              {tsm.data && <div><dt>{t(s.lang, "tsmHistorical")}</dt><dd><Money copper={tsm.data.historical} lang={s.lang} /></dd></div>}
              {tsmRegion.data && <div><dt>{t(s.lang, "tsmSoldDay")}</dt><dd>{tsmRegion.data.soldPerDay.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US", { maximumFractionDigits: 1 })}</dd></div>}
              {tsmRegion.data && <div><dt>{t(s.lang, "tsmSaleRate")}</dt><dd>{Math.round(tsmRegion.data.saleRate * 100)}%</dd></div>}
              {tsmRegion.data && <div><dt>{t(s.lang, "tsmAvgSale")}</dt><dd><Money copper={tsmRegion.data.avgSalePrice} lang={s.lang} /></dd></div>}
            </dl>
            <p class="muted small">{t(s.lang, "tsmNote")} <a href="https://www.tradeskillmaster.com/" target="_blank" rel="noopener">{t(s.lang, "tsmCredit")}</a></p>
          </div>
        )}
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
      {sheet === "lines" && (
        <Sheet title={lt.lines} onClose={() => setSheet(null)}>
          {lines.length === 0 ? <p class="muted small">{lt.noLines}</p> : (
            <ul class="line-list">
              {lines.map((price) => (
                <li>
                  <b>{formatMoneyAxis(price, s.lang)}</b>
                  <span class="line-actions">
                    <button type="button" disabled={quote?.[s.priceField] == null} onClick={() => {
                      const cur = quote?.[s.priceField];
                      if (cur == null) return;
                      setState((st) => ({ alerts: [...st.alerts, { id: newAlertId(), itemId: st.chartItem, house: houseId(st), field: st.priceField, op: alertOpFor(price, cur), price, active: true, createdAt: Math.floor(Date.now() / 1000) }] }));
                      setLineMsg(`${lt.alertMade}: ${formatMoneyAxis(price, s.lang)}`);
                    }}>{lt.alertHere}</button>
                    <button type="button" onClick={() => setState((st) => ({ drawings: { ...st.drawings, [itemKey]: removeLine(st.drawings[itemKey] ?? [], price) } }))}>{lt.del}</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {lineMsg && <p class="line-msg" role="status">{lineMsg}</p>}
          {lines.length >= MAX_LINES && <p class="muted small">{lt.max}</p>}
        </Sheet>
      )}
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
