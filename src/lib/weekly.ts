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
  flips: { found: number; paid: number; reached: number; rows: [number, number, number, number, number, number, number | null, number, number?][] } | null;
  crafts: { found: number; stillProfitable: number; rows: [number, number, number, number, number | null, number | null][] } | null;
  /** Most traded (since 1.2): [item, gold traded per day (copper), sold per day, market at the end, change % | null]. */
  traded?: [number, number, number, number, number | null][] | null;
  /** Raid consumables (since 1.2): sold per day, the period before, change %, rows [item, sold per day, market, change % | null]. */
  raid?: { soldPerDay: number; prevSoldPerDay: number | null; change: number | null; rows: [number, number, number, number | null][] } | null;
  /** Price paths for sparklines (since 1.3): item -> prices across the period, null where unknown. */
  sparks?: Record<string, (number | null)[]>;
}

export type RecapKind = "daily" | "weekly" | "monthly";
export const RECAP_KINDS: readonly RecapKind[] = ["daily", "weekly", "monthly"];

/** A fixed-period recap (recap/<house>/<kind>-<key>.json, collector/recaps.ts). */
export interface RecapFile extends WeeklyRecap {
  kind: RecapKind;
  key: string;
  rebalance?: { last: number | null; next: number; quarterly: boolean };
}

/** recap/<house>/list.json: [key, start, end] per kind, newest first. */
export interface RecapList {
  v: 1;
  daily: [string, number, number][];
  weekly: [string, number, number][];
  monthly: [string, number, number][];
}

/** The period in a sentence ("this week" / "cette semaine"). */
const PERIOD: Record<RecapKind, Record<Lang, string>> = {
  daily: { en: "over the day", fr: "sur la journée" },
  weekly: { en: "this week", fr: "cette semaine" },
  monthly: { en: "this month", fr: "ce mois-ci" },
};

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
  return recapSummary(w, "weekly", lang, itemName, indexName, now);
}

/**
 * Market notes for any recap, from the file only: the Ledger 100, the category indexes that moved most (3%+), the
 * biggest riser and faller, the most traded item, raid consumable demand, how the flips turned out, an index
 * rebalance coming within a week, and the days left before the first raids.
 */
export function recapSummary(
  w: WeeklyRecap & { rebalance?: RecapFile["rebalance"] },
  kind: RecapKind,
  lang: Lang,
  itemName: (id: number) => string,
  indexName: (id: string) => string,
  now: number = Date.now() / 1000,
): string[] {
  const fr = lang === "fr";
  const when = PERIOD[kind][lang];
  const out: string[] = [];
  const gl = w.indexes?.find(([id]) => id === "gl100");
  if (gl) {
    const c = gl[3];
    if (Math.abs(c) < FLAT) out.push(fr ? `Le Ledger 100 est resté stable ${when} (${pctText(c, lang, true)}).` : `The Ledger 100 held steady ${when} (${pctText(c, lang, true)}).`);
    else if (c > 0) out.push(fr ? `Le Ledger 100 a monté de ${pctText(c, lang)} ${when}.` : `The Ledger 100 rose ${pctText(c, lang)} ${when}.`);
    else out.push(fr ? `Le Ledger 100 a baissé de ${pctText(c, lang)} ${when}.` : `The Ledger 100 fell ${pctText(c, lang)} ${when}.`);
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
  const busiest = w.traded?.[0];
  if (busiest) out.push(fr ? `Le plus échangé : ${itemName(busiest[0])} (~${busiest[2].toLocaleString("fr-CA").replace(/\u202f|\u00a0/g, " ")} vendus par jour).` : `Most traded: ${itemName(busiest[0])} (~${busiest[2].toLocaleString("en-US")} sold a day).`);
  if (w.raid?.change != null && Math.abs(w.raid.change) >= NOTABLE) {
    const c = w.raid.change;
    out.push(fr
      ? `Consommables de raid : ventes ${c > 0 ? "en hausse" : "en baisse"} de ${pctText(c, lang)} par rapport à la période précédente.`
      : `Raid consumables: sales ${c > 0 ? "up" : "down"} ${pctText(c, lang)} on the period before.`);
  }
  if (w.flips && w.flips.found > 0) {
    out.push(fr
      ? `Sur ${w.flips.found} revente${w.flips.found > 1 ? "s" : ""} repérée${w.flips.found > 1 ? "s" : ""}, ${w.flips.paid} rapporte${w.flips.paid > 1 ? "nt" : ""} aux prix ${kind === "weekly" ? "d'aujourd'hui" : "de fin de période"}.`
      : `Of ${w.flips.found} flip${w.flips.found > 1 ? "s" : ""} spotted, ${w.flips.paid} pay${w.flips.paid === 1 ? "s" : ""} off at ${kind === "weekly" ? "today's" : "end-of-period"} prices.`);
  }
  const reb = w.rebalance;
  if (reb && reb.next - w.end <= 7 * 86_400 && reb.next > w.end) {
    const date = new Date(reb.next * 1000).toLocaleDateString(fr ? "fr-CA" : "en-US", { day: "numeric", month: "long", timeZone: "UTC" });
    out.push(fr
      ? `Rééquilibrage ${reb.quarterly ? "trimestriel" : "mensuel"} des indices le ${date} à 15 h UTC.`
      : `The indexes rebalance on ${date} at 15:00 UTC (${reb.quarterly ? "quarterly review" : "monthly"}).`);
  }
  const days = Math.ceil((RAID_LAUNCH - now) / 86_400);
  if (days > 1) out.push(fr ? `Les premiers raids ouvrent le 9 décembre, dans ${days} jours.` : `The first raids open 9 December, in ${days} days.`);
  return out;
}

/** True when the file has nothing to show yet (every section needs more history). */
export function weeklyEmpty(w: WeeklyRecap | null | undefined): boolean {
  return !w || (!w.indexes && !w.risers && !w.fallers && !w.highs && !w.lows && !w.flips && !w.crafts && !w.traded && !w.raid);
}
