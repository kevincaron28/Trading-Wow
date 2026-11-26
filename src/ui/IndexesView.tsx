import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { onBack } from "../app/back";
import { houseId, openChart, setState, useStore } from "../app/store";
import { activeZone, formatDate, formatDateTime, toWall } from "../lib/time";
import type { BasketChange, IndexDefMeta, IndexMeta, IndexPeriod, IndexSeries } from "../data/live";
import { toCandles, type Timeframe } from "../lib/candles";
import { t } from "../lib/i18n";
import { ChartEngine } from "./chartEngine";
import { tfLabel } from "./ChartScreen";
import { formatPoints } from "../lib/money";
import { useCatalog, useIndexes, useIndexMeta, useMeta, useQuotes } from "./data";
import { EmptyState, ErrorMsg, Icon, ItemIcon, Loading, WindowToggle, formatPct } from "./parts";

const HOUR = 3_600;
/** The first UTC day of prices (5 Nov 00:00 UTC) is WoW Forever's launch evening (4 Nov, 15:00 PST). */
const LAUNCH_BUCKET_END = Date.UTC(2026, 10, 5) / 1000;

/** "Base 100 = ..." date: launch when the series starts there, else its base day (without early prices). */
export function baseLabel(series: IndexSeries | undefined, baseEnd: number, lang: "en" | "fr"): string {
  const fmt = (sec: number) => new Date(sec * 1000).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-US", { dateStyle: "medium", timeZone: "UTC" });
  const start = series?.link || (series?.method ?? 0) >= 4 ? series?.periods[0]?.start : undefined;
  if (start == null) return fmt(baseEnd - 1);
  return start <= LAUNCH_BUCKET_END ? t(lang, "launchLabel") : fmt(start);
}

/**
 * The points one item added to the index over the last 24 hours. Method 4 is a geometric mean, so an item's share is
 * its weight times its log price change, applied to the index's value; earlier methods add price changes directly.
 */
export function contribution(method: number | undefined, level: number, value: number, w: number, p0: number, now: number, before: number): number {
  return (method ?? 0) >= 4 ? value * w * Math.log(now / before) : (level * w * (now - before)) / p0;
}

/** Index points with two decimals in the reader's language (100.00 / 100,00). */
export const pts = formatPoints;

/** Value now, its change over 24 hours and over the last hour, and the last 7 days for the sparkline. */
export function summarize(s: IndexSeries | undefined): { value: number; change: number | null; change1h: number | null; spark: number[] } | null {
  const h = s?.hourly ?? [];
  if (!h.length) return null;
  const [lastHour, value] = h.at(-1)!;
  const dayAgo = [...h].reverse().find(([x]) => x <= lastHour - 24);
  const prev = h.at(-2);
  const hourAgo = prev && prev[0] >= lastHour - 3 ? prev : undefined;
  const spark = h.filter(([x]) => x > lastHour - 24 * 7).map(([, v]) => v);
  return { value, change: dayAgo ? ((value - dayAgo[1]) / dayAgo[1]) * 100 : null, change1h: hourAgo ? ((value - hourAgo[1]) / hourAgo[1]) * 100 : null, spark };
}

/** The change shown for the chosen window (24h by default). */
const pick = (sum: { change: number | null; change1h: number | null }, w: "1d" | "1h") => (w === "1h" ? sum.change1h : sum.change);

function ChangeCell({ value, lang }: { value: number | null; lang: "en" | "fr" }) {
  return <span class={`pill ${value == null ? "" : value >= 0 ? "up" : "down"}`}>{formatPct(value, lang)}</span>;
}

export function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <svg class="spark" width="72" height="28" aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 70 + 1).toFixed(1)},${(27 - ((v - min) / span) * 26).toFixed(1)}`).join(" ");
  return (
    <svg class="spark" width="72" height="28" viewBox="0 0 72 28" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? "var(--up)" : "var(--down)"} stroke-width="1.6" stroke-linejoin="round" />
    </svg>
  );
}

export function IndexesView() {
  const s = useStore();
  const house = houseId(s);
  const meta = useIndexMeta();
  const data = useIndexes(house);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => (open ? onBack(() => setOpen(null)) : undefined), [open]);

  if ((meta.error && !meta.data) || (data.error && !data.data)) return <ErrorMsg text={t(s.lang, "indexesUnavailable")} retry={() => location.reload()} retryLabel={t(s.lang, "retry")} />;
  if (!meta.data || !data.data) return <Loading text={t(s.lang, "loading")} />;
  const def = meta.data.indexes.find((d) => d.id === open);
  if (def) return <IndexDetail def={def} series={data.data[def.id]} baseEnd={meta.data.baseEnd} calendar={meta.data} onClose={() => setOpen(null)} />;

  const rows = meta.data.indexes.map((d) => ({ d, sum: summarize(data.data![d.id]) })).filter((r) => r.sum);
  const fromLaunch = Object.values(data.data).some((x) => x.link);
  const method4 = Object.values(data.data).some((x) => (x.method ?? 0) >= 4);
  return (
    <div class="indexes">
      <div class="index-hint-row">
        <p class="hint">{fromLaunch || method4 ? `${t(s.lang, "indexBase")} ${baseLabel(data.data.gl100, meta.data.baseEnd, s.lang)}` : t(s.lang, "indexProvisional")}</p>
        <WindowToggle lang={s.lang} value={s.changeWindow} onChange={(w) => setState({ changeWindow: w })} />
      </div>
      {rows.length === 0 ? (
        <EmptyState art="list" text={t(s.lang, "indexesUnavailable")} />
      ) : (
        <ul class="rows">
          {rows.map(({ d, sum }) => (
            <li key={d.id} class="row">
              <button type="button" class="row-main index-row" onClick={() => setOpen(d.id)}>
                <span class="row-name">
                  <span class="name">{d.name[s.lang]}</span>
                  <span class="sub">{data.data![d.id]!.periods.at(-1)!.basket.length} {t(s.lang, "itemsCount")} · {t(s.lang, "indexBase")} {baseLabel(data.data![d.id], meta.data!.baseEnd, s.lang)}</span>
                </span>
                <Sparkline values={sum!.spark} up={(sum!.change ?? 0) >= 0} />
                <span class="row-price">{pts(sum!.value, s.lang)}</span>
                <ChangeCell value={pick(sum!, s.changeWindow)} lang={s.lang} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {meta.data.next != null && <p class="hint">{nextRebalanceText(meta.data, s.lang)}</p>}
      <p class="muted small method-note">{t(s.lang, method4 ? "indexMethod4" : "indexMethod")}</p>
    </div>
  );
}

/** "Next rebalance: 1 Dec 2026, 15:00 UTC (monthly)". */
export function nextRebalanceText(m: Pick<IndexMeta, "next" | "nextQuarterly">, lang: "en" | "fr"): string {
  if (m.next == null) return "";
  const date = new Date(m.next * 1000).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${t(lang, "nextRebalance")}${lang === "fr" ? " : " : ": "}${date}, ${lang === "fr" ? "15 h" : "15:00"} UTC (${t(lang, m.nextQuarterly ? "quarterlyReview" : "monthlyRebalance")})`;
}

/** Basket changes, newest first. */
function ChangeHistory({ changes, lang, name }: { changes: BasketChange[] | undefined; lang: "en" | "fr"; name: (id: number) => string }) {
  if (!changes?.length) return <p class="muted small">{t(lang, "noRebalanceYet")}</p>;
  return (
    <div>
      {[...changes].reverse().map((c) => (
        <div key={c.at} class="rebalance-change small">
          <b>{formatDate(c.at, lang)}</b> · {t(lang, c.kind === "quarterly" ? "quarterlyReview" : c.kind === "launch" ? "launchReview" : "monthlyRebalance")} · {c.kept} {t(lang, "kept")}
          {c.added.length > 0 && <div><span class="up-text">{t(lang, "added")}:</span> {c.added.map(([id, w]) => `${name(id)} (${(w * 100).toFixed(1)}%)`).join(", ")}</div>}
          {c.removed.length > 0 && <div><span class="down-text">{t(lang, "removed")}:</span> {c.removed.map(([id]) => name(id)).join(", ")}</div>}
        </div>
      ))}
    </div>
  );
}

function IndexDetail({ def, series, baseEnd, calendar, onClose }: { def: IndexDefMeta; series: IndexSeries | undefined; baseEnd: number; calendar: IndexMeta; onClose: () => void }) {
  const s = useStore();
  const catalog = useCatalog();
  const meta = useMeta();
  const quotes = useQuotes(houseId(s));
  const [tf, setTf] = useState<Timeframe>("1d");
  const holder = useRef<HTMLDivElement>(null);
  const engine = useRef<ChartEngine | null>(null);
  const zone = activeZone();
  const candles = useMemo(
    () => toCandles((series?.hourly ?? []).map(([h, v]) => ({ time: toWall(h * HOUR, zone), minBuyout: v, market: v, listed: 0, auctions: 0 })), tf),
    [series, tf, zone],
  );
  useEffect(() => {
    if (!holder.current) return;
    engine.current = new ChartEngine(holder.current, () => {});
    return () => engine.current?.destroy();
  }, []);
  useEffect(() => {
    engine.current?.render({ candles, compare: null, chartType: "candles", indicators: [], lang: s.lang, lines: [100], range: "all", logScale: false, points: true });
  }, [candles, s.lang, s.theme]);

  const sum = summarize(series);
  const period: IndexPeriod | undefined = series?.periods.at(-1);
  const lastHour = series?.hourly.at(-1)?.[0] ?? 0;
  const lastChange = series?.changes?.at(-1)?.at ?? (series && series.periods.length > 1 ? period?.start : undefined);
  // Each item's contribution to the change over the last 24 hours, in points (from the market values in our quotes:
  // market now vs the item's 24h-ago market).
  const rows = (period?.basket ?? []).map(([id, w, p0]) => {
    const q = quotes.data?.get(id);
    const now = q?.market ?? null;
    const before = q?.prev24h ?? null;
    return {
      id,
      w,
      dayPoints: now != null && before != null ? contribution(series?.method, period!.level, sum?.value ?? period!.level, w, p0, now, before) : null,
      sinceStart: now != null ? ((now - p0) / p0) * 100 : null,
    };
  });
  const fmtDate = (sec: number) => formatDate(sec, s.lang);
  return (
    <div class="index-detail">
      <div class="index-head">
        <button type="button" class="crumb-back" aria-label={t(s.lang, "back")} onClick={onClose}><Icon name="back" size={18} /></button>
        <div>
          <h2>{def.name[s.lang]}</h2>
          {sum && (
            <p class="index-value">
              <b>{pts(sum.value, s.lang)}</b>{" "}
              <button type="button" class={`pill-btn ${pick(sum, s.changeWindow) == null ? "muted" : pick(sum, s.changeWindow)! >= 0 ? "up" : "down"}`} onClick={() => setState({ changeWindow: s.changeWindow === "1h" ? "1d" : "1h" })}>
                {formatPct(pick(sum, s.changeWindow), s.lang)} <span class="pill-window">{t(s.lang, s.changeWindow === "1h" ? "windowHour" : "windowDay")}</span>
              </button>
            </p>
          )}
        </div>
      </div>
      <div class="chart-toolbar">
        <div class="seg compact" role="radiogroup">
          {(["1h", "4h", "1d"] as Timeframe[]).map((x) => (
            <button type="button" role="radio" aria-checked={tf === x} class={tf === x ? "on" : ""} onClick={() => setTf(x)}>{tfLabel(x, s.lang)}</button>
          ))}
        </div>
      </div>
      <div ref={holder} class="chart index-chart" role="img" aria-label={`${def.name[s.lang]}: ${candles.length} ${t(s.lang, "points")}`} />
      <div class="details">
        <p class="small">{def.about[s.lang]}</p>
        <p class="muted small">
          {`${t(s.lang, "indexBase")} ${baseLabel(series, baseEnd, s.lang)}`}
          {lastChange != null ? ` · ${t(s.lang, "indexRebalanced")} ${fmtDate(lastChange)}` : ""}
          {lastHour ? ` · ${t(s.lang, "updated")} ${formatDateTime(lastHour * HOUR, s.lang)}` : ""}
        </p>
        {calendar.next != null && <p class="muted small">{nextRebalanceText(calendar, s.lang)}</p>}
        <p class="sheet-label">{t(s.lang, "constituents")}</p>
        <div class="table-head constituents-head">
          <span>{t(s.lang, "sortName")}</span>
          <span>{t(s.lang, "weight")}</span>
          <span>{t(s.lang, "contribution24h")}</span>
        </div>
        <ul class="rows">
          {rows.map((r) => {
            const item = catalog.data?.get(r.id);
            return (
              <li key={r.id} class="row">
                <button type="button" class="row-main constituent-row" onClick={() => openChart(r.id)}>
                  <ItemIcon item={item} meta={meta.data} />
                  <span class="row-name">
                    <span class={`name q${item?.quality ?? 1}`}>{item?.name[s.lang] ?? `#${r.id}`}</span>
                    <span class="sub">{r.sinceStart != null ? `${formatPct(r.sinceStart, s.lang)} ${t(s.lang, "sincePeriodStart")}` : t(s.lang, "notListed")}</span>
                  </span>
                  <span class="row-price">{(r.w * 100).toFixed(1)}%</span>
                  <span class={`pill ${r.dayPoints == null ? "" : r.dayPoints >= 0 ? "up" : "down"}`}>{r.dayPoints == null ? "–" : `${r.dayPoints >= 0 ? "+" : ""}${pts(r.dayPoints, s.lang)}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p class="sheet-label">{t(s.lang, "rebalanceHistory")}</p>
        <ChangeHistory changes={series?.changes} lang={s.lang} name={(id) => catalog.data?.get(id)?.name[s.lang] ?? `#${id}`} />
        <p class="muted small method-note">{t(s.lang, (series?.method ?? 0) >= 4 ? "indexMethod4" : "indexMethod")}</p>
      </div>
    </div>
  );
}
