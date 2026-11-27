/**
 * Recap share pages: what the Discord recap posts as images (recap.html?house=113&kind=daily&key=2026-11-26&page=overview).
 * Each page is 1200 px wide and drawn with the app's own styles, chart engine and rows, so the post looks like the app.
 * scripts/render-recap.mjs opens them in headless Chromium and waits for body[data-ready].
 *
 * Labels follow `lang`; item names are always in English (the guild's choice: players search the auction house in
 * English). Every number comes from the recap file and the index series; nothing is computed that the recap lacks.
 */
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { loadCatalog, loadIndexMeta, loadIndexes, loadMeta, loadRecap, type CatalogItem, type IndexMeta, type IndexSeries, type Meta } from "../data/live";
import type { RecapFile, RecapKind } from "../lib/weekly";
import { RAID_LAUNCH } from "../lib/weekly";
import type { Lang } from "../lib/i18n";
import { toCandles, type Timeframe } from "../lib/candles";
import { formatPoints } from "../lib/money";
import { ChartEngine } from "../ui/chartEngine";
import { useAsync } from "../ui/data";
import { ItemIcon, Money, formatPct } from "../ui/parts";
import { houseLabel } from "../ui/AlertsScreen";

export const SHARE_PAGES = ["overview", "movers", "raid", "desk"] as const;
export type SharePage = (typeof SHARE_PAGES)[number];
export interface ShareParams { house: number; kind: RecapKind; key: string; page: SharePage; lang: Lang }

export function parseShareParams(search: string): ShareParams {
  const q = new URLSearchParams(search);
  const kind = (["daily", "weekly", "monthly"] as const).find((k) => k === q.get("kind")) ?? "daily";
  const page = SHARE_PAGES.find((p) => p === q.get("page")) ?? "overview";
  return { house: Number(q.get("house")) || 113, kind, key: q.get("key") ?? "", page, lang: q.get("lang") === "en" ? "en" : "fr" };
}

const HOUR = 3_600;
const DAY = 86_400;

const L = {
  en: {
    daily: "Daily recap", weekly: "Weekly recap", monthly: "Monthly recap",
    overview: "Market overview", movers: "Top movers", raid: "Raid consumables", desk: "Flips & crafts",
    ledger: "Ledger 100", sectors: "Sector indexes", traded: "Most traded", perDay: "/day", goldDay: "gold a day",
    gainers: "Gainers", losers: "Losers", highs: "New highs", lows: "New lows", sold: "sold", listedFor: "sold a day",
    raidTotal: "Flasks, elixirs and potions sold a day", vsBefore: "vs the period before", raidOpen: "Raids open 9 December",
    raidIn: (d: number) => (d > 1 ? `in ${d} days` : d === 1 ? "tomorrow" : "today"), busiest: "Busiest consumables",
    price: "Price", change: "Change", flips: "Flips found", crafts: "Profitable crafts",
    buy: "Buy", target: "target", now: "Now", priceNow: "Price over the period", result: "Result", reached: "Reached", profitThen: "Profit when found", profitNow: "Profit now",
    flipsSum: (f: number, r: number) => `${f} found · ${r} reached their target`, craftsSum: (f: number, s: number) => `${f} found · ${s} still profitable`,
    none: "Nothing met the rules in this period.", notEnough: "Not enough history yet.",
    rules: "Movers and records: items selling 10+ a day, 500+ gold traded a day, priced 1 gold or more.",
    flipRule: "Flips: items selling 5+ a day, after the 5% house cut.", source: "Blizzard auction house data, collected hourly",
    rebalance: "Next index rebalance", was: "was",
  },
  fr: {
    daily: "Récap du jour", weekly: "Récap de la semaine", monthly: "Récap du mois",
    overview: "Vue du marché", movers: "Plus fortes variations", raid: "Consommables de raid", desk: "Reventes et artisanat",
    ledger: "Ledger 100", sectors: "Indices par secteur", traded: "Les plus échangés", perDay: "/j", goldDay: "or par jour",
    gainers: "Hausses", losers: "Baisses", highs: "Nouveaux sommets", lows: "Nouveaux creux", sold: "vendus", listedFor: "vendus par jour",
    raidTotal: "Flacons, élixirs et potions vendus par jour", vsBefore: "par rapport à la période précédente", raidOpen: "Ouverture des raids le 9 décembre",
    raidIn: (d: number) => (d > 1 ? `dans ${d} jours` : d === 1 ? "demain" : "aujourd'hui"), busiest: "Les plus vendus",
    price: "Prix", change: "Variation", flips: "Reventes repérées", crafts: "Artisanat rentable",
    buy: "Achat", target: "cible", now: "Maintenant", priceNow: "Prix sur la période", result: "Résultat", reached: "Atteinte", profitThen: "Profit au repérage", profitNow: "Profit maintenant",
    flipsSum: (f: number, r: number) => `${f} repérées · ${r} ont atteint leur cible`, craftsSum: (f: number, s: number) => `${f} repérés · ${s} encore rentables`,
    none: "Rien n'a rempli les critères sur la période.", notEnough: "Pas encore assez d'historique.",
    rules: "Variations et records : objets vendus 10+ fois par jour, 500g+ échangés par jour, prix de 1g ou plus.",
    flipRule: "Reventes : objets vendus 5+ fois par jour, après la taxe de 5 % de l'hôtel des ventes.", source: "Données de l'hôtel des ventes de Blizzard, relevées chaque heure",
    rebalance: "Prochain rééquilibrage des indices", was: "avant",
  },
};
type Labels = (typeof L)["en"];

interface Loaded { recap: RecapFile; catalog: Map<number, CatalogItem>; meta: Meta; indexes: Record<string, IndexSeries>; indexMeta: IndexMeta }

export function RecapShare(p: ShareParams) {
  const data = useAsync<Loaded>(
    async () => {
      const [recap, catalog, meta, indexes, indexMeta] = await Promise.all([loadRecap(p.house, p.kind, p.key), loadCatalog(), loadMeta(), loadIndexes(p.house), loadIndexMeta()]);
      return { recap, catalog, meta, indexes, indexMeta };
    },
    `${p.house}:${p.kind}:${p.key}`,
  );
  // Tell the renderer when the page is drawn: data in, item icons loaded (or failed), chart painted.
  useEffect(() => {
    if (data.error) document.body.dataset.ready = "error";
    if (!data.data) return;
    const imgs = [...document.querySelectorAll("img")];
    void Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => requestAnimationFrame(() => requestAnimationFrame(() => (document.body.dataset.ready = "1"))));
  }, [data.data, data.error]);
  if (data.error) return <div class="share"><p class="muted">{String(data.error)}</p></div>;
  if (!data.data) return <div class="share" />;
  const t = L[p.lang];
  const d = data.data;
  return (
    <div class={`share share-${p.page}`}>
      <ShareHeader p={p} t={t} recap={d.recap} />
      {p.page === "overview" && <Overview p={p} t={t} d={d} />}
      {p.page === "movers" && <Movers p={p} t={t} d={d} />}
      {p.page === "raid" && <Raid p={p} t={t} d={d} />}
      {p.page === "desk" && <Desk p={p} t={t} d={d} />}
      <footer class="share-foot">
        <span class="muted">{t.source}</span>
        <span class="share-brand"><Logo size={20} /> Goblin Ledger</span>
      </footer>
    </div>
  );
}

function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12.5" fill="#e2b13c" /><circle cx="16" cy="16" r="10.3" fill="#141924" />
      <rect x="9.5" y="15.6" width="3" height="5" rx=".6" fill="#e2b13c" /><rect x="14.5" y="12.8" width="3" height="5" rx=".6" fill="#3fcf8e" /><rect x="19.5" y="9.4" width="3" height="5.6" rx=".6" fill="#3fcf8e" />
    </svg>
  );
}

/** "26 nov. 2026" or "23 – 30 nov. 2026": the period as days (the recap ends at 13:00 UTC on the last one). */
export function periodText(r: Pick<RecapFile, "kind" | "start" | "end">, lang: Lang): string {
  const fmt = (sec: number, o: Intl.DateTimeFormatOptions) => new Date(sec * 1000).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-US", { timeZone: "UTC", ...o });
  if (r.kind === "daily") return fmt(r.end, { day: "numeric", month: "long", year: "numeric" });
  if (r.kind === "monthly") return fmt(r.start + DAY, { month: "long", year: "numeric" });
  return `${fmt(r.start, { day: "numeric", month: "short" })} – ${fmt(r.end, { day: "numeric", month: "short", year: "numeric" })}`;
}

function ShareHeader({ p, t, recap }: { p: ShareParams; t: Labels; recap: RecapFile }) {
  return (
    <header class="share-head">
      <div class="share-title">
        <span class="share-kicker">{t[p.kind]} · {houseLabel(p.house, p.lang)}</span>
        <h1>{t[p.page]}</h1>
      </div>
      <span class="share-date">{periodText(recap, p.lang)}</span>
    </header>
  );
}

function Pct({ v, lang, big = false }: { v: number | null | undefined; lang: Lang; big?: boolean }) {
  return <span class={`pill ${v == null ? "" : v >= 0 ? "up" : "down"}${big ? " big" : ""}`}>{v == null ? "–" : formatPct(v, lang)}</span>;
}

/** A sparkline of the recap's price path (nulls skipped); green when the period ended higher. */
function Spark({ values, w = 150, h = 40 }: { values: (number | null)[] | undefined; w?: number; h?: number }) {
  const pts = (values ?? []).map((v, i) => [i, v] as const).filter((x): x is readonly [number, number] => x[1] != null);
  if (pts.length < 2) return <svg class="share-spark" width={w} height={h} aria-hidden="true" />;
  const n = (values?.length ?? 2) - 1;
  const vs = pts.map(([, v]) => v);
  const min = Math.min(...vs);
  const span = Math.max(...vs) - min || 1;
  const up = vs.at(-1)! >= vs[0]!;
  const line = pts.map(([i, v]) => `${((i / n) * (w - 2) + 1).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(" ");
  const color = up ? "var(--up)" : "var(--down)";
  return (
    <svg class="share-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={`1,${h} ${line} ${w - 1},${h}`} fill={color} opacity="0.12" />
      <polyline points={line} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" />
    </svg>
  );
}

function Card({ title, sub, children, class: cls = "" }: { title: string; sub?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <section class={`share-card ${cls}`}>
      <div class="share-card-head"><h2>{title}</h2>{sub && <span class="muted">{sub}</span>}</div>
      {children}
    </section>
  );
}

/** An item row as the app draws it: icon, English name in its quality colour, a sub line, sparkline, price, pill. */
function ItemRow({ id, d, sub, spark = true, compact = false, price, pill }: { id: number; d: Loaded; sub: ComponentChildren; spark?: boolean; compact?: boolean; price: ComponentChildren; pill?: ComponentChildren }) {
  const item = d.catalog.get(id);
  return (
    <li class={`share-row${compact ? " compact" : ""}`}>
      <ItemIcon item={item} meta={d.meta} size={40} />
      <span class="row-name">
        <span class={`name q${item?.quality ?? 1}`}>{item?.name.en ?? `#${id}`}</span>
        <span class="sub">{sub}</span>
      </span>
      {spark && <Spark values={d.recap.sparks?.[id]} w={320} h={40} />}
      <span class="row-price">{price}</span>
      {pill}
    </li>
  );
}

/** Prices without the clutter: copper dropped from 1 gold, silver from 100 gold (the recap is read at a glance). */
const tidy = (c: number) => (Math.abs(c) >= 1_000_000 ? Math.round(c / 10_000) * 10_000 : Math.abs(c) >= 10_000 ? Math.round(c / 100) * 100 : c);
function Coins({ c, lang }: { c: number; lang: Lang }) {
  return <Money copper={tidy(c)} lang={lang} />;
}

const num = (n: number, lang: Lang) => Math.round(n).toLocaleString(lang === "fr" ? "fr-CA" : "en-US");

// ---------------------------------------------------------------- 1. Market overview

function IndexChart({ series, recap, lang }: { series: IndexSeries | undefined; recap: RecapFile; lang: Lang }) {
  const holder = useRef<HTMLDivElement>(null);
  // Context before the period: one more period for a day or a week, the whole history for a month.
  const span = recap.end - recap.start;
  const from = recap.kind === "monthly" ? 0 : recap.start - span;
  const tf: Timeframe = recap.kind === "daily" ? "1h" : recap.kind === "weekly" ? "4h" : "1d";
  const candles = useMemo(
    () => toCandles((series?.hourly ?? []).filter(([h]) => h * HOUR > from && h * HOUR <= recap.end).map(([h, v]) => ({ time: h * HOUR, minBuyout: v, market: v, listed: 0, auctions: 0 })), tf),
    [series, recap],
  );
  useEffect(() => {
    if (!holder.current) return;
    const e = new ChartEngine(holder.current, () => {});
    e.render({ candles, compare: null, chartType: "candles", indicators: [], lang, lines: [], range: "all", logScale: false, points: true });
    return () => e.destroy();
  }, [candles]);
  return <div ref={holder} class="share-chart" />;
}

function Overview({ p, t, d }: { p: ShareParams; t: Labels; d: Loaded }) {
  const r = d.recap;
  const idx = new Map((r.indexes ?? []).map((x) => [x[0], x]));
  const gl = idx.get("gl100");
  const series = d.indexes.gl100;
  const inPeriod = (s: IndexSeries | undefined) => (s?.hourly ?? []).filter(([h]) => h * HOUR >= r.start && h * HOUR <= r.end).map(([, v]) => v);
  const glVals = inPeriod(series);
  const sectors = d.indexMeta.indexes.filter((x) => x.id !== "gl100" && idx.has(x.id));
  const traded = r.traded ?? [];
  const maxTraded = Math.max(1, ...traded.map((x) => x[1]));
  return (
    <>
      <section class="share-hero">
        <div class="share-hero-head">
          <div>
            <span class="muted">{t.ledger}</span>
            <div class="share-hero-value">
              <b>{gl ? formatPoints(gl[2], p.lang) : "–"}</b>
              <Pct v={gl?.[3]} lang={p.lang} big />
            </div>
          </div>
          {glVals.length > 1 && (
            <dl class="share-ohlc">
              <div><dt>{p.lang === "fr" ? "Ouv." : "Open"}</dt><dd>{formatPoints(gl?.[1] ?? glVals[0]!, p.lang)}</dd></div>
              <div><dt>{p.lang === "fr" ? "Haut" : "High"}</dt><dd>{formatPoints(Math.max(...glVals), p.lang)}</dd></div>
              <div><dt>{p.lang === "fr" ? "Bas" : "Low"}</dt><dd>{formatPoints(Math.min(...glVals), p.lang)}</dd></div>
              <div><dt>{p.lang === "fr" ? "Clôt." : "Close"}</dt><dd>{formatPoints(gl?.[2] ?? glVals.at(-1)!, p.lang)}</dd></div>
            </dl>
          )}
        </div>
        <IndexChart series={series} recap={r} lang={p.lang} />
      </section>
      <Card title={t.sectors}>
        <div class="share-tiles">
          {sectors.map((s) => {
            const x = idx.get(s.id)!;
            const ch = x[3];
            const heat = Math.min(1, Math.abs(ch) / 8);
            return (
              <div class={`share-tile ${ch >= 0 ? "tile-up" : "tile-down"}`} style={{ "--heat": String(0.12 + heat * 0.5) }}>
                <span class="share-tile-name">{s.name[p.lang]}</span>
                <span class="share-tile-row"><b>{formatPoints(x[2], p.lang)}</b><span>{formatPct(ch, p.lang)}</span></span>
                <Spark values={inPeriod(d.indexes[s.id])} w={240} h={36} />
              </div>
            );
          })}
        </div>
      </Card>
      {traded.length > 0 && (
        <Card title={t.traded} sub={t.goldDay}>
          <ul class="share-bars">
            {traded.map(([id, value, sold, , change]) => {
              const item = d.catalog.get(id);
              return (
                <li>
                  <ItemIcon item={item} meta={d.meta} size={28} />
                  <span class={`name q${item?.quality ?? 1}`}>{item?.name.en ?? `#${id}`}</span>
                  <span class="share-bar"><i style={{ width: `${(value / maxTraded) * 100}%` }} /></span>
                  <span class="row-price"><Coins c={value} lang={p.lang} /></span>
                  <span class="muted share-bar-sub">{num(sold, p.lang)} {t.sold}{change != null ? ` · ${formatPct(change, p.lang)}` : ""}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- 2. Top movers

function Movers({ p, t, d }: { p: ShareParams; t: Labels; d: Loaded }) {
  const r = d.recap;
  const list = (rows: RecapFile["risers"]) =>
    !rows ? <p class="muted">{t.notEnough}</p> : !rows.length ? <p class="muted">{t.none}</p> : (
      <ul class="share-rows">
        {rows.map(([id, a, b, pct, sold]) => (
          <ItemRow id={id} d={d} sub={<><Coins c={a} lang={p.lang} /> → <Coins c={b} lang={p.lang} /> · {num(sold, p.lang)} {t.listedFor}</>} price={<Coins c={b} lang={p.lang} />} pill={<Pct v={pct} lang={p.lang} />} />
        ))}
      </ul>
    );
  const records = (rows: RecapFile["highs"], up: boolean) =>
    !rows?.length ? <p class="muted">{rows ? t.none : t.notEnough}</p> : (
      <ul class="share-rows compact">
        {rows.slice(0, 3).map(([id, close, , prev]) => (
          <ItemRow id={id} d={d} spark={false} compact sub={<>{t.was} <Coins c={prev} lang={p.lang} /></>} price={<span class={up ? "up-text" : "down-text"}><Coins c={close} lang={p.lang} /></span>} pill={<Pct v={((close - prev) / prev) * 100} lang={p.lang} />} />
        ))}
      </ul>
    );
  return (
    <>
      <Card title={`▲ ${t.gainers}`}>{list(r.risers)}</Card>
      <Card title={`▼ ${t.losers}`}>{list(r.fallers)}</Card>
      <div class="share-cols">
        <Card title={t.highs}>{records(r.highs, true)}</Card>
        <Card title={t.lows}>{records(r.lows, false)}</Card>
      </div>
      <p class="muted share-note">{t.rules}</p>
    </>
  );
}

// ---------------------------------------------------------------- 3. Raid consumables

function Raid({ p, t, d }: { p: ShareParams; t: Labels; d: Loaded }) {
  const raid = d.recap.raid;
  const days = Math.ceil((RAID_LAUNCH - d.recap.end) / DAY);
  if (!raid) return <Card title={t.raid}><p class="muted">{t.notEnough}</p></Card>;
  return (
    <>
      <section class="share-hero raid">
        <div>
          <span class="muted">{t.raidTotal}</span>
          <div class="share-hero-value"><b>{num(raid.soldPerDay, p.lang)}</b><Pct v={raid.change} lang={p.lang} big /></div>
          {raid.prevSoldPerDay != null && <span class="muted">{t.vsBefore} · {num(raid.prevSoldPerDay, p.lang)}{t.perDay}</span>}
        </div>
        {days >= 0 && (
          <div class="share-countdown">
            <b>{days}</b>
            <span>{t.raidOpen}<br /><span class="muted">{t.raidIn(days)}</span></span>
          </div>
        )}
      </section>
      <Card title={t.busiest}>
        <ul class="share-rows">
          {raid.rows.map(([id, sold, market, change]) => (
            <ItemRow id={id} d={d} sub={<>{num(sold, p.lang)} {t.listedFor}</>} price={<Coins c={market} lang={p.lang} />} pill={<Pct v={change} lang={p.lang} />} />
          ))}
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- 4. Flips and crafts

/** Column names over a table of item rows: [under the name, over the sparkline, over the price, over the pill]. */
function Heads({ cols }: { cols: string[] }) {
  return <li class="share-row share-heads"><span /><span>{cols[0]}</span><span>{cols[1]}</span><span>{cols[2]}</span><span>{cols[3]}</span></li>;
}

function Desk({ p, t, d }: { p: ShareParams; t: Labels; d: Loaded }) {
  const { flips, crafts } = d.recap;
  return (
    <>
      <Card title={t.flips} sub={flips ? t.flipsSum(flips.found, flips.reached) : undefined}>
        {!flips ? <p class="muted">{t.notEnough}</p> : !flips.rows.length ? <p class="muted">{t.none}</p> : (
          <ul class="share-rows">
            <Heads cols={[`${t.buy} → ${t.target}`, t.priceNow, t.now, t.result]} />
            {flips.rows.slice(0, 5).map(([id, , buy, target, , now, result, reached]) => (
              <ItemRow id={id} d={d} sub={<><Coins c={buy} lang={p.lang} /> → <Coins c={target} lang={p.lang} />{reached ? " ✓" : ""}</>} price={now ? <Coins c={now} lang={p.lang} /> : "–"} pill={<Pct v={result} lang={p.lang} />} />
            ))}
          </ul>
        )}
      </Card>
      <Card title={t.crafts} sub={crafts ? t.craftsSum(crafts.found, crafts.stillProfitable) : undefined}>
        {!crafts ? <p class="muted">{t.notEnough}</p> : !crafts.rows.length ? <p class="muted">{t.none}</p> : (
          <ul class="share-rows">
            <Heads cols={[t.profitThen, t.priceNow, t.profitNow, "%"]} />
            {crafts.rows.slice(0, 5).map(([id, , then, pctThen, now, pctNow]) => (
              <ItemRow id={id} d={d} sub={<><Coins c={then} lang={p.lang} /> ({formatPct(pctThen, p.lang)})</>} price={now != null ? <span class="up-text"><Coins c={now} lang={p.lang} /></span> : "–"} pill={<Pct v={pctNow} lang={p.lang} />} />
            ))}
          </ul>
        )}
      </Card>
      <p class="muted share-note">{t.flipRule}</p>
    </>
  );
}
