import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Candle } from "../lib/candles";
import { candlesFor } from "../data/series";
import { t, type Lang } from "../lib/i18n";
import { newAlertId } from "../lib/alerts";
import { requestWebNotifications } from "../app/notify";
import { MAX_LINES, RANGES, addLine, alertOpFor, earliestPoint, removeLine, type ChartRange } from "../lib/ranges";
import { formatMoneyAxis } from "../lib/money";
import "./chart-tools.css";
import { changeOver, houseCut } from "../lib/quotes";
import { flipStats } from "../lib/flip";
import { PROFESSIONS, bestCost, craftProfit, materialSeries } from "../lib/crafting";
import { activeZone, formatDate, localeOf } from "../lib/time";
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
import { useCatalog, useHistories, useHistory, useMeta, useQuotes, useRecipes, bumpRefresh } from "./data";
import { ChangePill, Icon, ItemIcon, Loading, Money, Sheet, formatPct , ErrorMsg } from "./parts";
import { SearchScreen } from "./SearchScreen";
import { HouseBadge } from "./WatchlistScreen";
import { shareChart } from "./share";
import { shareLink } from "../app/shareLink";
import { itemUrl } from "../lib/links";

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
  const daily = s.timeframe === "1d" || s.timeframe === "1w";
  const compareHistory = useHistory(house, s.compareItem);
  const item = catalog.data?.get(s.chartItem);
  const quote = quotes.data?.get(s.chartItem);
  const list = activeWatchlist(s);
  const [sheet, setSheet] = useState<null | "indicators" | "type" | "alert" | "compare" | "lines" | "share">(null);
  const [shareNote, setShareNote] = useState("");
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

  const zone = activeZone();
  const candles = useMemo(() => (history.data ? candlesFor(history.data, s.timeframe, s.priceField, zone) : []), [history.data, s.timeframe, s.priceField, zone]);
  // Crafting (0.13): the cheapest recipe for this item, its material cost now and per candle.
  const recipes = useRecipes();
  const itemRecipes = recipes.data?.byItem.get(s.chartItem);
  const vendor = recipes.data?.vendor;
  const craft = useMemo(
    () => (vendor ? bestCost(itemRecipes, (id) => quotes.data?.get(id)?.[s.priceField], vendor) : null),
    [itemRecipes, vendor, quotes.data, s.priceField],
  );
  const reagentIds = useMemo(() => (craft ? craft.recipe.reagents.map((r) => r.id).filter((id) => !vendor?.has(id)) : []), [craft?.recipe.id, vendor]);
  const reagentHistories = useHistories(house, reagentIds);
  const material = useMemo(() => {
    if (!craft || !vendor || !s.showMaterials || !reagentHistories.data || !candles.length) return undefined;
    const byId = new Map([...reagentHistories.data].map(([id, h]) => [id, candlesFor(h, s.timeframe, s.priceField, zone)]));
    return materialSeries(candles.map((c) => c.time), craft.recipe, byId, vendor);
  }, [craft?.recipe.id, vendor, s.showMaterials, reagentHistories.data, candles, s.timeframe, s.priceField, zone]);
  const compareCandles = useMemo(() => (s.compareItem && compareHistory.data ? candlesFor(compareHistory.data, s.timeframe, s.priceField, zone) : null), [compareHistory.data, s.compareItem, s.timeframe, s.priceField, zone]);

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
      rangeKey: `${s.chartItem}|${s.compareItem ?? ""}|${s.timeframe}|${s.priceField}|${s.range}|${zone}`,
      logScale: s.logScale,
      material,
      materialLabel: t(s.lang, "materialsShort"),
    });
  }, [candles, compareCandles, s.chartType, s.indicators, s.lang, s.theme, lines.join(","), s.range, s.logScale, material]);
  useEffect(() => { engine.current?.setPlacing(placing); }, [placing]);
  useEffect(() => { setPlacing(false); setLineMsg(""); }, [s.chartItem]);

  const shown = hover ?? candles.at(-1) ?? null;
  const day = changeOver(quote, "1d");
  const hour = changeOver(quote, "1h");
  const shownChange = s.changeWindow === "1h" ? hour : day;
  const flip = flipStats(quote, houseCut(s.faction));
  const headPrice = quote?.[s.priceField] ?? null;
  const loc = localeOf(s.lang);
  const num = (n: number | null, digits = 0) => (n == null ? "–" : n.toLocaleString(loc, { maximumFractionDigits: digits }));
  const pctCell = (n: number | null) => <dd class={n == null ? "" : n >= 0 ? "up" : "down"}>{formatPct(n, s.lang)}</dd>;
  const inList = list.items.includes(s.chartItem);
  const name = item?.name[s.lang] ?? `#${s.chartItem}`;
  const firstPoint = history.data?.hourly[0]?.time;
  // Earliest price in the item's history, for "History since <date>" (unix seconds).
  const earliest = earliestPoint([history.data?.early?.[0]?.time, history.data?.daily[0]?.time, firstPoint]);
  const earlierThanLive = earliest != null && firstPoint != null && earliest < firstPoint - 86_400;
  // Early history is stored per date (UTC); hourly prices are moments shown in the active time zone.
  const dateFmt = (t: number) => formatDate(t, s.lang, "UTC");
  const [sharing, setSharing] = useState(false);
  const onShareLink = () => {
    void shareLink({ title: `${name} - Goblin Ledger`, text: name, url: itemUrl(house, s.chartItem) }).then((r) => {
      if (r === "shared") setSheet(null);
      else setShareNote(t(s.lang, r === "copied" ? "linkCopied" : "shareFailed"));
    });
  };
  const onShare = () => {
    setSheet(null);
    if (sharing) return;
    const chart = engine.current?.screenshot();
    if (!chart) return;
    setSharing(true);
    const realm = REALM_GROUPS.find((r) => r.id === s.realm) ?? REALM_GROUPS[0]!;
    const faction = s.faction === "blackwater" ? t(s.lang, "blackwaterShort") : t(s.lang, s.faction);
    void shareChart({ itemId: s.chartItem, name, price: quote?.[s.priceField], houseLabel: `US · ${realm.label[s.lang]} · ${faction}`, lang: s.lang, chart, link: itemUrl(house, s.chartItem) }).catch(() => {}).finally(() => setSharing(false));
  };

  return (
    <section class="screen chart-screen">
      <header class="topbar">
        <div class="symbol">
          <ItemIcon item={item} meta={meta.data} size={30} />
          <div>
            <h1 class={`name q${item?.quality ?? 1}`}>{name}</h1>
            <div class="symbol-price">
              <Money copper={headPrice} lang={s.lang} />
              <button type="button" class="pill-btn" aria-label={`${t(s.lang, "sortChange")}: ${t(s.lang, s.changeWindow === "1h" ? "windowHour" : "windowDay")}`} onClick={() => setState({ changeWindow: s.changeWindow === "1h" ? "1d" : "1h" })}>
                <ChangePill pct={shownChange.pct} abs={shownChange.abs} mode={s.changeMode} lang={s.lang} />
                <span class="pill-window">{t(s.lang, s.changeWindow === "1h" ? "windowHour" : "windowDay")}</span>
              </button>
            </div>
          </div>
        </div>
        <div class="topbar-actions">
          <button type="button" class={`icon-btn ${inList ? "accent" : ""}`} aria-pressed={inList} aria-label={`${t(s.lang, "addTo")} ${list.name[s.lang]}`} onClick={() => toggleInList(list.id, s.chartItem)}>
            <Icon name="star" filled={inList} />
          </button>
          <button type="button" class={`icon-btn ${sharing ? "busy" : ""}`} aria-busy={sharing} aria-label={sharing ? t(s.lang, "preparing") : lt.share} title={lt.share} onClick={() => { setShareNote(""); setSheet("share"); }}>
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
          {material && material.length > 0 && !s.compareItem && <span class="material-tag">{t(s.lang, "materialLine")}</span>}
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
              {firstPoint ? <span class="muted">{t(s.lang, "hourlySince")} {formatDate(firstPoint, s.lang)}</span> : null}
            </span>
          ) : null}
        </div>
        <dl class="stats">
          <div><dt>{t(s.lang, "market")}</dt><dd><Money copper={quote?.market} lang={s.lang} /></dd></div>
          <div><dt>{t(s.lang, "minBuyout")}</dt><dd><Money copper={quote?.min} lang={s.lang} /></dd></div>
          <div><dt>{t(s.lang, "change24h")}</dt>{pctCell(day.pct)}</div>
          <div><dt>{t(s.lang, "change1h")}</dt>{pctCell(hour.pct)}</div>
          <div><dt>{t(s.lang, "avg7d")}</dt><dd><Money copper={quote?.avg7d} lang={s.lang} /></dd></div>
          <div><dt>{t(s.lang, "listed")}</dt><dd>{quote ? num(quote.listed) : "–"}</dd></div>
          <div><dt>{t(s.lang, "auctions")}</dt><dd>{quote?.auctions ?? "–"}</dd></div>
        </dl>
        <div class="flip-card">
          <p class="sheet-label">{t(s.lang, "flipping")}</p>
          <dl class="stats">
            <div title={t(s.lang, "soldDayHint")}><dt>{t(s.lang, "sold24h")}</dt><dd>{num(flip.sold24h)}</dd></div>
            <div><dt>{t(s.lang, "soldAvg7d")}</dt><dd>{num(flip.soldAvg7d)}</dd></div>
            <div><dt>{t(s.lang, "salesTrend")}</dt>{pctCell(flip.salesTrend)}</div>
            <div><dt>{t(s.lang, "sellThrough")}</dt><dd>{flip.sellThrough == null ? "–" : `${num(flip.sellThrough, 1)}%`}</dd></div>
            <div><dt>{t(s.lang, "daysSupply")}</dt><dd>{num(flip.daysSupply, 1)}</dd></div>
            <div><dt>{t(s.lang, "flipMargin")}</dt><dd class={flip.margin == null ? "" : flip.margin >= 0 ? "up" : "down"}><Money copper={flip.margin} lang={s.lang} short />{flip.marginPct != null ? ` (${formatPct(flip.marginPct, s.lang)})` : ""}</dd></div>
            <div><dt>{t(s.lang, "spread")}</dt><dd>{formatPct(flip.spreadPct, s.lang, false)}</dd></div>
            <div><dt>{t(s.lang, "vsAvg7d")}</dt>{pctCell(flip.vsAvg7d)}</div>
          </dl>
          <p class="muted small">{t(s.lang, "flipNote")}</p>
        </div>
        {craft && <CraftCard craft={craft} sell={quote?.[s.priceField] ?? null} cut={houseCut(s.faction)} count={itemRecipes?.length ?? 1} />}
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
            {itemRecipes?.length ? (
              <li>
                <button type="button" class={s.showMaterials ? "on" : ""} aria-pressed={s.showMaterials} onClick={() => setState({ showMaterials: !s.showMaterials })}>
                  <span>{t(s.lang, "materialCost")}</span>
                  {s.showMaterials && <Icon name="check" size={18} />}
                </button>
              </li>
            ) : null}
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
                      requestWebNotifications(); setState((st) => ({ alerts: [...st.alerts, { id: newAlertId(), itemId: st.chartItem, house: houseId(st), field: st.priceField, op: alertOpFor(price, cur), price, active: true, createdAt: Math.floor(Date.now() / 1000) }] }));
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
      {sheet === "share" && (
        <Sheet title={name} onClose={() => setSheet(null)}>
          <ul class="menu-list">
            <li><button type="button" onClick={onShareLink}>{t(s.lang, "shareLinkOnly")}</button></li>
            <li><button type="button" onClick={onShare}>{t(s.lang, "sharePicture")}</button></li>
          </ul>
          {shareNote && <p class="line-msg" role="status">{shareNote}</p>}
          <p class="muted small break">{itemUrl(house, s.chartItem)}</p>
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
        <input type="text" inputMode="decimal" enterKeyHint="done" value={gold} onInput={(e) => setGold((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </label>
      {current != null && <p class="muted small">{t(s.lang, "market")}: <Money copper={current} lang={s.lang} /></p>}
      <button type="button" class="btn wide" disabled={!(price > 0)} onClick={() => {
        requestWebNotifications(); setState((st) => ({ alerts: [...st.alerts, { id: newAlertId(), itemId, house: houseId(st), field: st.priceField, op, price, active: true, createdAt: Math.floor(Date.now() / 1000) }] }));
        onClose();
      }}>{t(s.lang, "alertCreate")}</button>
      <p class="muted small">{t(s.lang, "alertNote")}</p>
    </Sheet>
  );
}

/** Crafting card (0.13): reagents with their prices, the material cost per item and the profit of crafting to sell. */
function CraftCard({ craft, sell, cut, count }: { craft: import("../lib/crafting").CraftCost; sell: number | null; cut: number; count: number }) {
  const s = useStore();
  const catalog = useCatalog();
  const meta = useMeta();
  const { profit, pct } = craftProfit(craft.perItem, sell, cut);
  const prof = PROFESSIONS[craft.recipe.profession]?.[s.lang] ?? "";
  const makes = craft.recipe.makes;
  return (
    <div class="craft-card">
      <p class="sheet-label">{t(s.lang, "crafting")}{prof ? ` · ${prof}` : ""}{count > 1 ? ` · ${t(s.lang, "cheapestOf").replace("{n}", String(count))}` : ""}</p>
      <ul class="reagents">
        {craft.reagents.map((r) => (
          <li key={r.id}>
            <button type="button" class="reagent" onClick={() => setState({ chartItem: r.id })}>
              <ItemIcon item={catalog.data?.get(r.id)} meta={meta.data} size={20} />
              <span class="reagent-name">{r.qty} × {catalog.data?.get(r.id)?.name[s.lang] ?? `#${r.id}`}{r.source === "vendor" ? <span class="tag">{t(s.lang, "vendorTag")}</span> : null}</span>
              <span class="reagent-price">{r.total == null ? <span class="muted">{t(s.lang, "noPrice")}</span> : <Money copper={r.total} lang={s.lang} short />}</span>
            </button>
          </li>
        ))}
      </ul>
      <dl class="stats">
        <div><dt>{t(s.lang, "materialCost")}{makes !== 1 ? ` (${t(s.lang, "perItem")})` : ""}</dt><dd><Money copper={craft.perItem} lang={s.lang} /></dd></div>
        <div><dt>{t(s.lang, "sellAfterCut")}</dt><dd><Money copper={sell == null ? null : Math.round(sell * (1 - cut))} lang={s.lang} /></dd></div>
        <div><dt>{t(s.lang, "craftProfit")}</dt><dd class={profit == null ? "" : profit >= 0 ? "up" : "down"}><Money copper={profit} lang={s.lang} short />{pct != null ? ` (${formatPct(pct, s.lang)})` : ""}</dd></div>
        {makes !== 1 && <div><dt>{t(s.lang, "makesPerCraft")}</dt><dd>{makes}</dd></div>}
      </dl>
      <p class="muted small">{craft.missing.length ? t(s.lang, "craftMissing") : t(s.lang, "craftNote")}</p>
    </div>
  );
}
