import type { ComponentChildren } from "preact";
import { openChart, useStore } from "../app/store";
import { t, type Lang } from "../lib/i18n";
import { formatPoints } from "../lib/money";
import { activeZone, formatDate } from "../lib/time";
import { pctText, weeklyEmpty, weeklySummary, type WeeklyRecap } from "../lib/weekly";
import { useCatalog, useIndexMeta, useMeta } from "./data";
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
  const catalog = useCatalog();
  const meta = useMeta();
  const names = useNames();
  const lang = s.lang;
  const notEnough = <p class="ov-empty">{t(lang, "notEnoughData")}</p>;
  const none = <p class="ov-empty">{t(lang, "noneThisWeek")}</p>;
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
      {weeklyEmpty(w) ? notEnough : (<>
        <div class="ov-card ov-week static">
          {weeklySummary(w!, lang, names.item, names.index).map((l) => <span class="ov-week-line">{l}</span>)}
        </div>
        {!w!.risers && fullFrom != null && <p class="hint">{t(lang, "weekFullFrom")} {formatDate(fullFrom, lang)}.</p>}

        <h3 class="section-label">{t(lang, "weekIndexes")}</h3>
        {w!.indexes == null ? notEnough : (
          <ul class="rows">
            {w!.indexes.map(([id, a, b, c]) => (
              <li key={id} class="row">
                <span class="row-main index-row no-icon">
                  <span class="row-name"><span class="name">{names.index(id)}</span><span class="sub">{t(lang, "weekAgo")} {formatPoints(a, lang)}</span></span>
                  <span />
                  <span class="row-price">{formatPoints(b, lang)}</span>
                  <Pill value={c} lang={lang} />
                </span>
              </li>
            ))}
          </ul>
        )}

        <h3 class="section-label">{t(lang, "weekRisers")}</h3>
        {list(w!.risers, (r) => row(`r${r[0]}`, r[0], <><Money copper={r[1]} lang={lang} short /> → <Money copper={r[2]} lang={lang} short /> · {perDay(r[4])}</>, <Money copper={r[2]} lang={lang} short />, <Pill value={r[3]} lang={lang} />))}
        <h3 class="section-label">{t(lang, "weekFallers")}</h3>
        {list(w!.fallers, (r) => row(`f${r[0]}`, r[0], <><Money copper={r[1]} lang={lang} short /> → <Money copper={r[2]} lang={lang} short /> · {perDay(r[4])}</>, <Money copper={r[2]} lang={lang} short />, <Pill value={r[3]} lang={lang} />))}

        <h3 class="section-label">{t(lang, "newHighs")}</h3>
        {list(w!.highs, (r) => row(`h${r[0]}`, r[0], <>{shortDate(r[2], lang)} · {t(lang, "prevRecord")} <Money copper={r[3]} lang={lang} short /></>, <Money copper={r[1]} lang={lang} short />, <Pill value={(r[1] / r[3] - 1) * 100} lang={lang} />))}
        <h3 class="section-label">{t(lang, "newLows")}</h3>
        {list(w!.lows, (r) => row(`l${r[0]}`, r[0], <>{shortDate(r[2], lang)} · {t(lang, "prevRecord")} <Money copper={r[3]} lang={lang} short /></>, <Money copper={r[1]} lang={lang} short />, <Pill value={(r[1] / r[3] - 1) * 100} lang={lang} />))}

        <h3 class="section-label">{t(lang, "weekFlips")}</h3>
        {w!.flips && <p class="hint">{lang === "fr"
          ? `${w!.flips.found} repérée${w!.flips.found > 1 ? "s" : ""} · ${w!.flips.paid} rapporte${w!.flips.paid > 1 ? "nt" : ""} aux prix d'aujourd'hui · ${w!.flips.reached} ont atteint le prix visé`
          : `${w!.flips.found} spotted · ${w!.flips.paid} pay off at today's prices · ${w!.flips.reached} reached the target price`}</p>}
        {list(w!.flips?.rows, (r) => row(`p${r[0]}`, r[0], <>{shortDate(r[1], lang)} · <Money copper={r[2]} lang={lang} short /> → <Money copper={r[3]} lang={lang} short /></>, r[5] ? <Money copper={r[5]} lang={lang} short /> : <span class="muted small">{t(lang, "notListed")}</span>, <Pill value={r[6]} lang={lang} />))}

        <h3 class="section-label">{t(lang, "weekCrafts")}</h3>
        {w!.crafts && <p class="hint">{lang === "fr"
          ? `${w!.crafts.found} repéré${w!.crafts.found > 1 ? "s" : ""} · ${w!.crafts.stillProfitable} encore rentable${w!.crafts.stillProfitable > 1 ? "s" : ""} aujourd'hui`
          : `${w!.crafts.found} spotted · ${w!.crafts.stillProfitable} still profitable today`}</p>}
        {list(w!.crafts?.rows, (r) => row(`c${r[0]}`, r[0], <>{shortDate(r[1], lang)} · {t(lang, "profitThen")} <Money copper={r[2]} lang={lang} short /></>, <span class={r[4] != null && r[4] > 0 ? "up-text" : "down-text"}>{r[4] != null ? <Money copper={r[4]} lang={lang} short /> : "–"}</span>, <Pill value={r[5]} lang={lang} />))}

        <p class="muted small method-note">{t(lang, "weeklyMethod")}</p>
      </>)}
    </div>
  );
}
