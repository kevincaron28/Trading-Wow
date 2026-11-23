/**
 * Weekly recap (collector/weekly.ts writes weekly/<house>.json): types and the plain-language summary shown on the
 * Market tab. The summary only restates numbers from the file; it never predicts.
 */
import type { Lang } from "./i18n.ts";

export interface WeeklyRecap {
  v: 1;
  house: number;
  start: number;
  end: number;
  ownSince: number;
  indexes: [string, number, number, number][] | null;
  risers: [number, number, number, number, number][] | null;
  fallers: [number, number, number, number, number][] | null;
  highs: [number, number, number, number, number, number][] | null;
  lows: [number, number, number, number, number, number][] | null;
  flips: { found: number; paid: number; reached: number; rows: [number, number, number, number, number, number, number | null, number][] } | null;
  crafts: { found: number; stillProfitable: number; rows: [number, number, number, number, number | null, number | null][] } | null;
}

/** First raids on WoW Forever: 9 December 2026 (the day the raid prep index is built for). */
export const RAID_LAUNCH = Date.UTC(2026, 11, 9) / 1000;

/** A change in percent, whole numbers from 10% up, one decimal below (12% / 4.2% / 4,2 %). */
export function pctText(value: number, lang: Lang, signed = false): string {
  const abs = Math.abs(value);
  const n = abs >= 10 ? Math.round(abs).toString() : abs.toFixed(1);
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : "";
  return lang === "fr" ? `${sign}${n.replace(".", ",")} %` : `${sign}${n}%`;
}

/** Below this, an index "held steady". */
const FLAT = 0.5;
/** A category index is mentioned when it moved at least this much. */
const NOTABLE = 3;

/**
 * Short sentences for the week, from the file only:
 * the Ledger 100's change, the category index that fell most and the one that rose most (3%+), the biggest riser, how
 * the flips spotted during the week turned out, and the days left before the first raids.
 */
export function weeklySummary(
  w: WeeklyRecap,
  lang: Lang,
  itemName: (id: number) => string,
  indexName: (id: string) => string,
  now: number = Date.now() / 1000,
): string[] {
  const fr = lang === "fr";
  const out: string[] = [];
  const gl = w.indexes?.find(([id]) => id === "gl100");
  if (gl) {
    const c = gl[3];
    if (Math.abs(c) < FLAT) out.push(fr ? `Le Ledger 100 est resté stable cette semaine (${pctText(c, lang, true)}).` : `The Ledger 100 held steady this week (${pctText(c, lang, true)}).`);
    else if (c > 0) out.push(fr ? `Le Ledger 100 a monté de ${pctText(c, lang)} cette semaine.` : `The Ledger 100 rose ${pctText(c, lang)} this week.`);
    else out.push(fr ? `Le Ledger 100 a baissé de ${pctText(c, lang)} cette semaine.` : `The Ledger 100 fell ${pctText(c, lang)} this week.`);
  }
  const cats = (w.indexes ?? []).filter(([id, , , c]) => id !== "gl100" && Math.abs(c) >= NOTABLE);
  const fell = cats.filter((x) => x[3] < 0).sort((a, b) => a[3] - b[3])[0];
  const rose = cats.filter((x) => x[3] > 0).sort((a, b) => b[3] - a[3])[0];
  const parts: string[] = [];
  if (fell) parts.push(fr ? `${indexName(fell[0])} : ${pctText(fell[3], lang, true)}` : `${indexName(fell[0])} fell ${pctText(fell[3], lang)}`);
  if (rose) parts.push(fr ? `${indexName(rose[0])} : ${pctText(rose[3], lang, true)}` : `${indexName(rose[0])} rose ${pctText(rose[3], lang)}`);
  if (parts.length) out.push(`${parts.join(fr ? " ; " : "; ")}.`);
  const top = w.risers?.[0];
  if (top) out.push(fr ? `Plus forte hausse : ${itemName(top[0])} (${pctText(top[3], lang, true)}).` : `Biggest riser: ${itemName(top[0])} (${pctText(top[3], lang, true)}).`);
  const drop = w.fallers?.[0];
  if (drop) out.push(fr ? `Plus forte baisse : ${itemName(drop[0])} (${pctText(drop[3], lang, true)}).` : `Biggest faller: ${itemName(drop[0])} (${pctText(drop[3], lang, true)}).`);
  if (w.flips && w.flips.found > 0) {
    out.push(fr
      ? `Sur ${w.flips.found} revente${w.flips.found > 1 ? "s" : ""} repérée${w.flips.found > 1 ? "s" : ""}, ${w.flips.paid} rapporte${w.flips.paid > 1 ? "nt" : ""} aux prix d'aujourd'hui.`
      : `Of ${w.flips.found} flip${w.flips.found > 1 ? "s" : ""} spotted, ${w.flips.paid} pay${w.flips.paid === 1 ? "s" : ""} off at today's prices.`);
  }
  const days = Math.ceil((RAID_LAUNCH - now) / 86_400);
  if (days > 1) out.push(fr ? `Les premiers raids ouvrent le 9 décembre, dans ${days} jours.` : `The first raids open 9 December, in ${days} days.`);
  return out;
}

/** True when the file has nothing to show yet (every section needs more history). */
export function weeklyEmpty(w: WeeklyRecap | null | undefined): boolean {
  return !w || (!w.indexes && !w.risers && !w.fallers && !w.highs && !w.lows && !w.flips && !w.crafts);
}
