import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { openChart, useStore } from "../app/store";
import { t, type Lang } from "../lib/i18n";
import { formatPoints } from "../lib/money";
import { activeZone, formatDate } from "../lib/time";
import { pctText, recapSummary, weeklyEmpty, weeklySummary, type RecapFile, type RecapKind, type WeeklyRecap } from "../lib/weekly";
import { houseId } from "../app/store";
import { useCatalog, useIndexMeta, useMeta, useRecap, useRecapList } from "./data";
import { Icon, ItemIcon, Money } from "./parts";

const WEEK = 7 * 86_400;

/** Day and month in the reader's language and time zone ("Nov 16" / "16 nov."). */
export function shortDate(t: number, lang: Lang): string {
  return new Date(t * 1000).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-US", { month: "short", day: "numeric", timeZone: activeZone() });
}

/** "Nov 16 – Nov 23" (the 7 days up to the latest snapshot). */
export function weekRange(w: WeeklyRecap, lang: Lang): string {
  return `${shortDate(w.start, lang)} – ${shortDate(w.end, lang)}`;
}

function useNames() {
  const s = useStore();
  const catalog = useCatalog();
  const meta = useIndexMeta();
  return {
    item: (id: number) => catalog.data?.get(id)?.name[s.lang] ?? `#${id}`,
    index: (id: string) => meta.data?.indexes.find((d) => d.id === id)?.name[s.lang] ?? id,
  };
}

/** The "This week" card at the top of the Market tab. */
export function WeeklyCard({ recap, onOpen }: { recap: WeeklyRecap | null; onOpen: () => void }) {
  const s = useStore();
  const names = useNames();
  if (weeklyEmpty(recap)) return <p class="ov-empty">{t(s.lang, "notEnoughData")}</p>;
  const w = recap!;
  const lines = weeklySummary(w, s.lang, names.item, names.index);
  return (
    <button type="button" class="ov-card ov-week" onClick={onOpen}>
      <span class="ov-week-range">{weekRange(w, s.lang)}</span>
      {lines.slice(0, 3).map((l) => <span class="ov-week-line">{l}</span>)}
      <span class="link-btn">{t(s.lang, "seeFullRecap")} ›</span>
    </button>
  );
}

function Pill({ value, lang }: { value: number | null; lang: Lang }) {
  return <span class={`pill ${value == null ? "" : value >= 0 ? "up" : "down"}`}>{value == null ? "–" : pctText(value, lang, true)}</span>;
}

/** The full weekly recap (replaces the Market tab's content until Back). */
export function WeeklyFull({ recap, onClose }: { recap: WeeklyRecap | null; onClose: () => void }) {
  const s = useStore();
  const lang = s.lang;
  const w = recap;
  const fullFrom = w ? w.ownSince + WEEK : null;
  return (
    <div class="weekly">
      <div class="index-head">
        <button type="button" class="crumb-back" aria-label={t(lang, "back")} onClick={onClose}><Icon name="back" size={18} /></button>
        <div>
          <h2>{t(lang, "weeklyRecap")}</h2>
          {w && <p class="muted small">{weekRange(w, lang)}</p>}
        </div>
      </div>
      {w && !weeklyEmpty(w) && !w.risers && fullFrom != null && <p class="hint">{t(lang, "weekFullFrom")} {formatDate(fullFrom, lang)}.</p>}
      <RecapBody recap={w} kind="weekly" rolling />
      <p class="muted small method-note">{t(lang, "weeklyMethod")}</p>
    </div>
  );
}

/** "26 Nov", "23 Nov – 30 Nov", "November 2026": a fixed recap's period. */
export function recapPeriod(r: { kind: RecapKind; start: number; end: number }, lang: Lang): string {
  if (r.kind === "daily") return shortDate(r.end, lang);
  if (r.kind === "weekly") return `${shortDate(r.start, lang)} – ${shortDate(r.end, lang)}`;
  const m = new Date((r.start + 86_400) * 1000).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return m.charAt(0).toUpperCase() + m.slice(1);
}

const KIND_LABEL = { daily: "recapDaily", weekly: "recapWeekly", monthly: "recapMonthly" } as const;
const KIND_TITLE = { daily: "recapTitleDaily", weekly: "recapTitleWeekly", monthly: "recapTitleMonthly" } as const;

/** The Recaps screen: daily, weekly and monthly recaps of the house, with their history. */
export function RecapsView({ initial, onClose }: { initial: RecapKind; onClose: () => void }) {
  const s = useStore();
  const lang = s.lang;
  const house = houseId(s);
  const [kind, setKind] = useState<RecapKind>(initial);
  const [key, setKey] = useState<string | null>(null);
  const list = useRecapList(house);
  const entries = list.data?.[kind] ?? [];
  const chosen = key && entries.some(([k]) => k === key) ? key : entries[0]?.[0] ?? null;
  const recap = useRecap(house, kind, chosen);
  useEffect(() => { document.querySelector(".content")?.scrollTo({ top: 0 }); }, [kind, chosen]);
  return (
    <div class="weekly recaps">
      <div class="index-head">
        <button type="button" class="crumb-back" aria-label={t(lang, "back")} onClick={onClose}><Icon name="back" size={18} /></button>
        <div>
          <h2>{t(lang, KIND_TITLE[kind])}</h2>
          {recap.data && <p class="muted small">{recapPeriod(recap.data, lang)}</p>}
        </div>
      </div>
      <div class="chart-toolbar">
        <div class="seg compact" role="radiogroup" aria-label={t(lang, "recaps")}>
          {(["daily", "weekly", "monthly"] as RecapKind[]).map((k) => (
            <button type="button" role="radio" aria-checked={kind === k} class={kind === k ? "on" : ""} onClick={() => { setKind(k); setKey(null); }}>{t(lang, KIND_LABEL[k])}</button>
          ))}
        </div>
      </div>
      <p class="hint">{t(lang, "recapsHint")}</p>
      {list.loading && !list.data ? <p class="ov-empty muted small">{t(lang, "loading")}</p>
        : !entries.length ? <p class="ov-empty">{t(lang, "noRecapsYet")}</p>
        : recap.loading && !recap.data ? <p class="ov-empty muted small">{t(lang, "loading")}</p>
        : <RecapBody recap={recap.data} kind={kind} />}
      {entries.length > 1 && (<>
        <h3 class="section-label">{t(lang, "recapHistory")}</h3>
        <div class="recap-history">
          {entries.map(([k, start, end]) => (
            <button type="button" key={k} class={`chip ${k === chosen ? "on" : ""}`} aria-pressed={k === chosen} onClick={() => setKey(k)}>{recapPeriod({ kind, start, end }, lang)}</button>
          ))}
        </div>
      </>)}
      <p class="muted small method-note">{t(lang, "recapMethod")}</p>
    </div>
  );
}

/** Every section of a recap: notes, indexes, movers, most traded, raid consumables, records, flips and crafts. */
export function RecapBody({ recap, kind, rolling = false }: { recap: (WeeklyRecap & Partial<Pick<RecapFile, "rebalance">>) | null; kind: RecapKind; rolling?: boolean }) {
  const s = useStore();
  const catalog = useCatalog();
  const meta = useMeta();
  const names = useNames();
  const lang = s.lang;
  const notEnough = <p class="ov-empty">{t(lang, "notEnoughData")}</p>;
  const none = <p class="ov-empty">{t(lang, rolling ? "noneThisWeek" : "noneThisPeriod")}</p>;
  const perDay = (n: number) => `~${n.toLocaleString(lang === "fr" ? "fr-CA" : "en-US")}${t(lang, "perDayShort")}`;
  const row = (key: string, id: number, sub: ComponentChildren, price: ComponentChildren, pill: ComponentChildren) => (
    <li key={key} class="row">
      <button type="button" class="row-main" onClick={() => openChart(id)}>
        <ItemIcon item={catalog.data?.get(id)} meta={meta.data} />
        <span class="row-name">
          <span class={`name q${catalog.data?.get(id)?.quality ?? 1}`}>{names.item(id)}</span>
          <span class="sub">{sub}</span>
        </span>
        <span class="row-price">{price}</span>
        {pill}
      </button>
    </li>
  );
  const list = <T,>(rows: T[] | null | undefined, render: (r: T, i: number) => ComponentChildren) =>
    rows == null ? notEnough : rows.length === 0 ? none : <ul class="rows">{rows.map(render)}</ul>;
  const w = recap;
  if (weeklyEmpty(w)) return notEnough;
  const L = rolling
    ? { idx: "weekIndexes", up: "weekRisers", down: "weekFallers", flips: "weekFlips", crafts: "weekCrafts", ago: "weekAgo" } as const
    : { idx: "periodIndexes", up: "periodRisers", down: "periodFallers", flips: "periodFlips", crafts: "periodCrafts", ago: "atStart" } as const;
  return (<>
    <div class="ov-card ov-week static">
      {recapSummary(w!, kind, lang, names.item, names.index).map((l) => <span class="ov-week-line">{l}</span>)}
    </div>

    <h3 class="section-label">{t(lang, L.idx)}</h3>
    {w!.indexes == null ? notEnough : (
      <ul class="rows">
        {w!.indexes.map(([id, a, b, c]) => (
          <li key={id} class="row">
            <span class="row-main index-row no-icon">
              <span class="row-name"><span class="name">{names.index(id)}</span><span class="sub">{t(lang, L.ago)} {formatPoints(a, lang)}</span></span>
              <span />
              <span class="row-price">{formatPoints(b, lang)}</span>
              <Pill value={c} lang={lang} />
            </span>
          </li>
        ))}
      </ul>
    )}

    <h3 class="section-label">{t(lang, L.up)}</h3>
    {list(w!.risers, (r) => row(`r${r[0]}`, r[0], <><Money copper={r[1]} lang={lang} short /> → <Money copper={r[2]} lang={lang} short /> · {perDay(r[4])}</>, <Money copper={r[2]} lang={lang} short />, <Pill value={r[3]} lang={lang} />))}
    <h3 class="section-label">{t(lang, L.down)}</h3>
    {list(w!.fallers, (r) => row(`f${r[0]}`, r[0], <><Money copper={r[1]} lang={lang} short /> → <Money copper={r[2]} lang={lang} short /> · {perDay(r[4])}</>, <Money copper={r[2]} lang={lang} short />, <Pill value={r[3]} lang={lang} />))}

    {w!.traded !== undefined && (<>
      <h3 class="section-label">{t(lang, "mostTraded")}</h3>
      {list(w!.traded, (r) => row(`t${r[0]}`, r[0], <><Money copper={r[1]} lang={lang} short />{t(lang, "perDayShort")} · {perDay(r[2])}</>, <Money copper={r[3]} lang={lang} short />, <Pill value={r[4]} lang={lang} />))}
    </>)}

    {w!.raid !== undefined && (<>
      <h3 class="section-label">{t(lang, "raidConsumables")}</h3>
      {w!.raid && <p class="hint">{`${w!.raid.soldPerDay.toLocaleString(lang === "fr" ? "fr-CA" : "en-US")} ${t(lang, "raidSold")}`}{w!.raid.change != null && <> · <Pill value={w!.raid.change} lang={lang} /> {t(lang, "periodBefore")}</>}</p>}
      {list(w!.raid?.rows, (r) => row(`k${r[0]}`, r[0], perDay(r[1]), <Money copper={r[2]} lang={lang} short />, <Pill value={r[3]} lang={lang} />))}
    </>)}

    <h3 class="section-label">{t(lang, "newHighs")}</h3>
    {list(w!.highs, (r) => row(`h${r[0]}`, r[0], <>{shortDate(r[2], lang)} · {t(lang, "prevRecord")} <Money copper={r[3]} lang={lang} short /></>, <Money copper={r[1]} lang={lang} short />, <Pill value={(r[1] / r[3] - 1) * 100} lang={lang} />))}
    <h3 class="section-label">{t(lang, "newLows")}</h3>
    {list(w!.lows, (r) => row(`l${r[0]}`, r[0], <>{shortDate(r[2], lang)} · {t(lang, "prevRecord")} <Money copper={r[3]} lang={lang} short /></>, <Money copper={r[1]} lang={lang} short />, <Pill value={(r[1] / r[3] - 1) * 100} lang={lang} />))}

    <h3 class="section-label">{t(lang, L.flips)}</h3>
    {w!.flips && <p class="hint">{lang === "fr"
      ? `${w!.flips.found} repérée${w!.flips.found > 1 ? "s" : ""} · ${w!.flips.paid} rapporte${w!.flips.paid > 1 ? "nt" : ""} aux prix ${rolling ? "d'aujourd'hui" : "de fin de période"} · ${w!.flips.reached} ont atteint le prix visé`
      : `${w!.flips.found} spotted · ${w!.flips.paid} pay off at ${rolling ? "today's" : "end-of-period"} prices · ${w!.flips.reached} reached the target price`}</p>}
    {list(w!.flips?.rows, (r) => row(`p${r[0]}`, r[0], <>{shortDate(r[1], lang)} · <Money copper={r[2]} lang={lang} short /> → <Money copper={r[3]} lang={lang} short />{r[8] != null ? <> · {perDay(r[8])}</> : null}</>, r[5] ? <Money copper={r[5]} lang={lang} short /> : <span class="muted small">{t(lang, "notListed")}</span>, <Pill value={r[6]} lang={lang} />))}

    <h3 class="section-label">{t(lang, L.crafts)}</h3>
    {w!.crafts && <p class="hint">{lang === "fr"
      ? `${w!.crafts.found} repéré${w!.crafts.found > 1 ? "s" : ""} · ${w!.crafts.stillProfitable} encore rentable${w!.crafts.stillProfitable > 1 ? "s" : ""} ${rolling ? "aujourd'hui" : "en fin de période"}`
      : `${w!.crafts.found} spotted · ${w!.crafts.stillProfitable} still profitable ${rolling ? "today" : "at the end"}`}</p>}
    {list(w!.crafts?.rows, (r) => row(`c${r[0]}`, r[0], <>{shortDate(r[1], lang)} · {t(lang, "profitThen")} <Money copper={r[2]} lang={lang} short /></>, <span class={r[4] != null && r[4] > 0 ? "up-text" : "down-text"}>{r[4] != null ? <Money copper={r[4]} lang={lang} short /> : "–"}</span>, <Pill value={r[5]} lang={lang} />))}
  </>);
}
