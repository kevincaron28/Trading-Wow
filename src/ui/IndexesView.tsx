import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { onBack } from "../app/back";
import { houseId, openChart, useStore } from "../app/store";
import type { IndexDefMeta, IndexPeriod, IndexSeries } from "../data/live";
import { toCandles, type Timeframe } from "../lib/candles";
import { t } from "../lib/i18n";
import { ChartEngine } from "./chartEngine";
import { tfLabel } from "./ChartScreen";
import { formatPoints } from "../lib/money";
import { useCatalog, useIndexes, useIndexMeta, useMeta, useQuotes } from "./data";
import { EmptyState, ErrorMsg, Icon, ItemIcon, Loading, formatPct } from "./parts";

const HOUR = 3_600;
/** The first UTC day of prices (5 Nov 00:00 UTC) is WoW Forever's launch evening (4 Nov, 15:00 PST). */
const LAUNCH_BUCKET_END = Date.UTC(2026, 10, 5) / 1000;

/** "Base 100 = ..." date: launch when the series starts there, else its base day (the close of 19 Nov without early prices). */
export function baseLabel(series: IndexSeries | undefined, baseEnd: number, lang: "en" | "fr"): string {
  const fmt = (sec: number) => new Date(sec * 1000).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-US", { dateStyle: "medium", timeZone: "UTC" });
  const start = series?.link ? series.periods[0]?.start : undefined;
  if (start == null) return fmt(baseEnd - 1);
  return start <= LAUNCH_BUCKET_END ? t(lang, "launchLabel") : fmt(start);
}

/** Index points with two decimals in the reader's language (100.00 / 100,00). */
export const pts = formatPoints;

/** Value now, 24 hours earlier, and the last 7 days for the sparkline. */
export function summarize(s: IndexSeries | undefined): { value: number; change: number | null; spark: number[] } | null {
  const h = s?.hourly ?? [];
  if (!h.length) return null;
  const [lastHour, value] = h.at(-1)!;
  const dayAgo = [...h].reverse().find(([x]) => x <= lastHour - 24);
  const spark = h.filter(([x]) => x > lastHour - 24 * 7).map(([, v]) => v);
  return { value, change: dayAgo ? ((value - dayAgo[1]) / dayAgo[1]) * 100 : null, spark };
}

function Sparkline({ values, up }: { values: number[]; up: boolean }) {
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
  if (def) return <IndexDetail def={def} series={data.data[def.id]} baseEnd={meta.data.baseEnd} onClose={() => setOpen(null)} />;

  const rows = meta.data.indexes.map((d) => ({ d, sum: summarize(data.data![d.id]) })).filter((r) => r.sum);
  const fromLaunch = Object.values(data.data).some((x) => x.link);
  return (
    <div class="indexes">
      <p class="hint">{fromLaunch ? `${t(s.lang, "indexBase")} ${baseLabel(data.data.gl100, meta.data.baseEnd, s.lang)}` : t(s.lang, "indexProvisional")}</p>
      {rows.length === 0 ? (
        <EmptyState art="list" text={t(s.lang, "indexesUnavailable")} />
      ) : (
        <ul class="rows">
          {rows.map(({ d, sum }) => (
            <li key={d.id} class="row">
              <button type="button" class="row-main index-row" onClick={() => setOpen(d.id)}>
                <span class="row-name">
                  <span class="name">{d.name[s.lang]}</span>
                  <span class="sub">{data.data![d.id]!.periods.at(-1)!.basket.length} {t(s.lang, "itemsCount")}</span>
                </span>
                <Sparkline values={sum!.spark} up={(sum!.change ?? 0) >= 0} />
                <span class="row-price">{pts(sum!.value, s.lang)}</span>
                <span class={`pill ${sum!.change == null ? "" : sum!.change >= 0 ? "up" : "down"}`}>{formatPct(sum!.change, s.lang)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p class="muted small method-note">{t(s.lang, "indexMethod")}</p>
    </div>
  );
}

function IndexDetail({ def, series, baseEnd, onClose }: { def: IndexDefMeta; series: IndexSeries | undefined; baseEnd: number; onClose: () => void }) {
  const s = useStore();
  const catalog = useCatalog();
  const meta = useMeta();
  const quotes = useQuotes(houseId(s));
  const [tf, setTf] = useState<Timeframe>("1d");
  const holder = useRef<HTMLDivElement>(null);
  const engine = useRef<ChartEngine | null>(null);
  const candles = useMemo(
    () => toCandles((series?.hourly ?? []).map(([h, v]) => ({ time: h * HOUR, minBuyout: v, market: v, listed: 0, auctions: 0 })), tf),
    [series, tf],
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
  // Each item's contribution: points it adds to the level now, and to the change over the last 24 hours (from hourly
  // market values in our quotes: market now vs the item's 24h-ago market).
  const rows = (period?.basket ?? []).map(([id, w, p0]) => {
    const q = quotes.data?.get(id);
    const now = q?.market ?? null;
    const before = q?.prev24h ?? null;
    return {
      id,
      w,
      level: now != null ? (period!.level * w * now) / p0 : null,
      dayPoints: now != null && before != null ? (period!.level * w * (now - before)) / p0 : null,
      sinceStart: now != null ? ((now - p0) / p0) * 100 : null,
    };
  });
  const fmtDate = (sec: number) => new Date(sec * 1000).toLocaleDateString(s.lang === "fr" ? "fr-CA" : "en-US", { dateStyle: "medium" });
  return (
    <div class="index-detail">
      <div class="index-head">
        <button type="button" class="crumb-back" aria-label={t(s.lang, "back")} onClick={onClose}><Icon name="back" size={18} /></button>
        <div>
          <h2>{def.name[s.lang]}</h2>
          {sum && (
            <p class="index-value">
              <b>{pts(sum.value, s.lang)}</b>{" "}
              <span class={sum.change == null ? "muted" : sum.change >= 0 ? "up" : "down"}>{formatPct(sum.change, s.lang)}</span>
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
          {series && series.periods.length > 1 ? ` · ${t(s.lang, "indexRebalanced")} ${fmtDate(period!.start)}` : ""}
          {lastHour ? ` · ${t(s.lang, "updated")} ${new Date(lastHour * HOUR * 1000).toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US", { dateStyle: "short", timeStyle: "short" })}` : ""}
        </p>
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
        <p class="muted small method-note">{t(s.lang, "indexMethod")}</p>
      </div>
    </div>
  );
}
