/**
 * Recap cards: a market-close style image of each daily, weekly and monthly recap, posted with it to Discord
 * (collector/discord-recap.ts).
 *
 * The card is an SVG built here, then turned into a PNG by resvg (@resvg/resvg-js, a small native module; on the VM it
 * is installed outside the app by deploy/collector/run.sh) with the DejaVu fonts in assets/fonts, so it looks the same
 * everywhere and needs no system fonts. Without resvg the post falls back to the embed and the plain chart.
 *
 * Layout (1000 px wide, four cards of about 800 to 1,500 px; cardSvgs):
 * header; the Ledger 100 with its change, open/high/low/close and a line chart; category heatmap tiles; top gainers
 * and losers with sparklines; most traded as volume bars; raid consumables; flips and crafts; new highs and lows; for
 * a week or a month, category ranges against the range since launch (the "52-week" range of a 3-week-old game);
 * index rebalancing; footer. Every number comes from the recap file and the index series: nothing is estimated here.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Lang } from "../src/lib/i18n.ts";
import type { RecapFile } from "../src/lib/weekly.ts";

const HOUR = 3_600;
export const CARD_WIDTH = 1000;
/** Discord accepts files up to 10 MB from a webhook; a card stays far below (about 0.3–0.6 MB). */
export const MAX_CARD_BYTES = 8 * 1024 * 1024;

const C = {
  bg: "#0a0c10",
  panel: "#11151c",
  line: "#252b36",
  text: "#e8e6e1",
  muted: "#8b93a1",
  gold: "#f0b429",
  goldDim: "#8a6a1f",
  up: "#2fd27a",
  down: "#ff5c5c",
  flat: "#c9a227",
  coinGold: "#ffd100",
  coinSilver: "#c9ccd6",
  coinCopper: "#d0814a",
};
/** Item quality colours as the game shows them. */
const QUALITY = ["#9d9d9d", "#ffffff", "#1eff00", "#0070dd", "#a335ee", "#ff8000", "#e6cc80", "#00ccff"];
const SANS = "DejaVu Sans Condensed";
const MONO = "DejaVu Sans Mono";

export interface CardNames {
  item: (id: number) => string;
  quality: (id: number) => number;
  index: (id: string) => string;
  house: string;
}

export interface CardChange { index: string; at: number; kind: "monthly" | "quarterly"; added: number[]; removed: number[] }

export interface CardInput {
  recap: RecapFile;
  lang: Lang;
  names: CardNames;
  /** Hourly [hour, value] of every index of the house (index/<house>.json), early daily points included. */
  series: Record<string, [number, number][]>;
  /** Basket changes of the house's indexes made during the period. */
  changes: CardChange[];
  now?: number;
  /** The market summary (collector/recap-ai.ts, checked against the data), shown under the header of card 1. */
  summary?: string;
}

/** Split a text into lines of at most `width` px. */
export function wrap(s: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const TEXT = {
  en: {
    daily: "DAILY MARKET CLOSE", weekly: "WEEKLY MARKET WRAP", monthly: "MONTHLY MARKET REVIEW",
    sub: "WOW FOREVER · AUCTION HOUSE", open: "OPEN", high: "HIGH", low: "LOW", close: "CLOSE",
    launchHigh: "HIGH SINCE LAUNCH", launchLow: "LOW SINCE LAUNCH",
    wire: "MARKET WIRE", sectors: "SECTORS", gainers: "TOP GAINERS", losers: "TOP LOSERS", traded: "MOST TRADED · GOLD A DAY",
    raid: "RAID CONSUMABLES", raidSub: "flasks, elixirs, potions sold a day", before: "period before",
    raidsIn: (d: number) => `RAIDS OPEN 9 DEC · ${d} DAYS`, raidsOpen: "RAIDS ARE OPEN",
    flips: "BEST FLIPS · 5+ SOLD A DAY", crafts: "CRAFTING MARGINS", buy: "buy", sell: "sell", profit: "profit", then: "then", now: "now",
    highs: "NEW HIGHS", lows: "NEW LOWS", ranges: "RANGES · PERIOD VS SINCE LAUNCH",
    rebalance: "INDEX REBALANCING", next: "Next rebalance", quarterly: "quarterly review", monthlyReb: "monthly",
    inn: "IN", out: "OUT", none: "No basket change this period.", perDay: "/day", sold: "sold/day",
    footer: "Goblin Ledger · prices from Blizzard's WoW Forever auction house API · not financial advice",
    noData: "not enough data yet",
  },
  fr: {
    daily: "CLÔTURE DU JOUR", weekly: "BILAN DE LA SEMAINE", monthly: "BILAN DU MOIS",
    sub: "WOW FOREVER · HÔTEL DES VENTES", open: "OUV.", high: "HAUT", low: "BAS", close: "CLÔT.",
    launchHigh: "SOMMET DEPUIS LE LANCEMENT", launchLow: "CREUX DEPUIS LE LANCEMENT",
    wire: "FIL DU MARCHÉ", sectors: "SECTEURS", gainers: "PLUS FORTES HAUSSES", losers: "PLUS FORTES BAISSES", traded: "LES PLUS ÉCHANGÉS · OR PAR JOUR",
    raid: "CONSOMMABLES DE RAID", raidSub: "flacons, élixirs, potions vendus par jour", before: "période précédente",
    raidsIn: (d: number) => `RAIDS LE 9 DÉC. · DANS ${d} J`, raidsOpen: "LES RAIDS SONT OUVERTS",
    flips: "MEILLEURES REVENTES · 5+ VENTES/JOUR", crafts: "MARGES D'ARTISANAT", buy: "achat", sell: "revente", profit: "profit", then: "alors", now: "maint.",
    highs: "NOUVEAUX SOMMETS", lows: "NOUVEAUX CREUX", ranges: "FOURCHETTES · PÉRIODE ET DEPUIS LE LANCEMENT",
    rebalance: "RÉÉQUILIBRAGE DES INDICES", next: "Prochain rééquilibrage", quarterly: "révision trimestrielle", monthlyReb: "mensuel",
    inn: "ENTRÉES", out: "SORTIES", none: "Aucun changement de panier sur la période.", perDay: "/j", sold: "ventes/j",
    footer: "Goblin Ledger · prix de l'API de l'hôtel des ventes de WoW Forever (Blizzard) · pas un conseil financier",
    noData: "pas encore assez de données",
  },
} as const;

const RAID_LAUNCH = Date.UTC(2026, 11, 9) / 1000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Rough text width (DejaVu Sans Condensed averages ~0.52 em, bold ~0.56, the mono font 0.6). */
export function textWidth(s: string, size: number, font: "sans" | "bold" | "mono" = "sans"): number {
  return s.length * size * (font === "mono" ? 0.602 : font === "bold" ? 0.57 : 0.53);
}

/** Cut a text with "…" so it fits `width` px. */
export function fit(s: string, size: number, width: number, font: "sans" | "bold" | "mono" = "sans"): string {
  if (textWidth(s, size, font) <= width) return s;
  let n = s.length;
  while (n > 1 && textWidth(`${s.slice(0, n)}…`, size, font) > width) n--;
  return `${s.slice(0, n).trimEnd()}…`;
}

/** Gold, silver and copper as coloured parts: 18g 49s / 87s 94c / 12c (po/pa/pc in French). Gold from 1,000 up drops silver. */
export function coinParts(copper: number, lang: Lang): [string, string][] {
  const suf = lang === "fr" ? { g: "po", s: "pa", c: "pc" } : { g: "g", s: "s", c: "c" };
  const v = Math.round(Math.abs(copper));
  const g = Math.floor(v / 10_000);
  const s = Math.floor((v % 10_000) / 100);
  const c = v % 100;
  const sign = copper < 0 ? "-" : "";
  const grp = (n: number) => n.toLocaleString(lang === "fr" ? "fr-CA" : "en-US").replace(/[  ]/g, " ");
  if (g >= 1_000) return [[`${sign}${grp(g)}${suf.g}`, C.coinGold]];
  if (g > 0) return [[`${sign}${g}${suf.g}`, C.coinGold], ...(s ? [[` ${s}${suf.s}`, C.coinSilver] as [string, string]] : [])];
  if (s > 0) return [[`${sign}${s}${suf.s}`, C.coinSilver], ...(c ? [[` ${c}${suf.c}`, C.coinCopper] as [string, string]] : [])];
  return [[`${sign}${c}${suf.c}`, C.coinCopper]];
}
const coinText = (copper: number, lang: Lang) => coinParts(copper, lang).map(([t]) => t).join("");

export function pct(v: number | null | undefined, lang: Lang): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  const n = a >= 100 ? Math.round(a).toString() : a.toFixed(1);
  const s = `${v > 0 ? "+" : v < 0 ? "-" : ""}${lang === "fr" ? n.replace(".", ",") : n}`;
  return lang === "fr" ? `${s} %` : `${s}%`;
}
const num = (n: number, lang: Lang, digits = 0) => n.toLocaleString(lang === "fr" ? "fr-CA" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/[  ]/g, " ");
const tone = (v: number | null | undefined) => (v == null ? C.muted : v > 0.05 ? C.up : v < -0.05 ? C.down : C.flat);
const date = (t: number, lang: Lang, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(t * 1000).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-GB", { ...o, timeZone: "UTC" });

/** An SVG text element. */
function text(x: number, y: number, s: string, o: { size?: number; fill?: string; font?: "sans" | "bold" | "mono" | "monobold"; anchor?: "start" | "middle" | "end"; ls?: number } = {}): string {
  const font = o.font ?? "sans";
  const family = font.startsWith("mono") ? MONO : SANS;
  const weight = font === "bold" || font === "monobold" ? ` font-weight="bold"` : "";
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${family}"${weight} font-size="${o.size ?? 24}" fill="${o.fill ?? C.text}"${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""}${o.ls ? ` letter-spacing="${o.ls}"` : ""}>${esc(s)}</text>`;
}

/** Money in game colours, right-aligned at x. */
function money(x: number, y: number, copper: number, lang: Lang, size = 24, anchor: "start" | "end" = "end"): string {
  const parts = coinParts(copper, lang);
  const spans = parts.map(([t, fill]) => `<tspan fill="${fill}">${esc(t)}</tspan>`).join("");
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${MONO}" font-size="${size}"${anchor === "end" ? ` text-anchor="end"` : ""}>${spans}</text>`;
}

/** A sparkline path in the box (x, y, w, h); nulls are skipped. */
export function sparkPath(values: readonly (number | null)[], x: number, y: number, w: number, h: number): string | null {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null && Number.isFinite(p[1]));
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((p) => p[1]));
  const max = Math.max(...pts.map((p) => p[1]));
  const span = max - min || 1;
  const n = Math.max(1, values.length - 1);
  return pts.map(([i, v], k) => `${k ? "L" : "M"}${(x + (i / n) * w).toFixed(1)},${(y + h - ((v - min) / span) * h).toFixed(1)}`).join("");
}

function spark(values: readonly (number | null)[] | undefined, x: number, y: number, w: number, h: number, color: string): string {
  const d = values ? sparkPath(values, x, y, w, h) : null;
  return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` : "";
}

function panelTitle(y: number, title: string, right?: string): string {
  return `<rect x="24" y="${y}" width="6" height="26" fill="${C.gold}"/>` + text(42, y + 22, title, { size: 24, fill: C.gold, font: "monobold", ls: 1 }) + (right ? text(CARD_WIDTH - 28, y + 22, right, { size: 20, fill: C.muted, anchor: "end" }) : "");
}

/** Heat colour of a change: deeper green or red with the size of the move (full at ±8%). */
function heat(v: number): string {
  const k = Math.min(1, Math.abs(v) / 8);
  const [r, g, b] = v >= 0 ? [20 + 10 * k, 60 + 90 * k, 40 + 30 * k] : [70 + 120 * k, 28 + 10 * k, 32 + 10 * k];
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

/** Values of a series within (startH, endH]. */
const within = (s: [number, number][] | undefined, startH: number, endH: number) => (s ?? []).filter(([h]) => h >= startH && h <= endH);

/**
 * The recap as cards (SVG), one per page, so each stays readable on a phone (Discord shrinks a very tall image):
 * 1 the Ledger 100 and the sectors (and the ranges for a week or a month), 2 gainers, losers and most traded,
 * 3 raid consumables, flips and crafts, 4 new highs and lows and index rebalancing.
 */
export function cardSvgs(input: CardInput): { svg: string; width: number; height: number }[] {
  const { recap: r, lang, names } = input;
  const T = TEXT[lang];
  const big = r.kind !== "daily";
  const W = CARD_WIDTH;
  const startH = r.start / HOUR;
  const endH = r.end / HOUR;
  const now = input.now ?? r.end;
  let out: string[] = [];
  let y = 0;
  const pageNo = (n: number, of: number) => out.push(`<text x="${W - 28}" y="118" font-family="${MONO}" font-size="17" fill="${C.muted}" text-anchor="end">${n}/${of}</text>`);

  const header = () => {
  // Header.
  out.push(`<rect x="0" y="0" width="${W}" height="128" fill="#07080b"/>`, `<rect x="0" y="126" width="${W}" height="3" fill="${C.gold}"/>`);
  out.push(text(28, 58, "GOBLIN LEDGER", { size: 44, fill: C.gold, font: "bold", ls: 2 }));
  // The house first: the line gives way to the period on the right ("19 NOV. – 26 NOV. 2026" is long).
  const periodText = r.kind === "monthly" ? date(r.start + 86_400, lang, { month: "long", year: "numeric" }).toUpperCase() : r.kind === "weekly" ? `${date(r.start, lang)} – ${date(r.end, lang, { day: "numeric", month: "short", year: "numeric" })}`.toUpperCase() : date(r.end, lang, { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
  out.push(text(W - 28, 56, T[r.kind], { size: 26, fill: C.text, font: "monobold", anchor: "end" }));
  const periodLine = r.kind === "daily" ? `${periodText} · 13:00 UTC` : periodText;
  out.push(text(W - 28, 96, periodLine, { size: 22, fill: C.gold, font: "mono", anchor: "end" }));
  out.push(text(30, 98, fit(`${names.house.toUpperCase()} · ${T.sub}`, 21, W - 28 - textWidth(periodLine, 22, "mono") - 60, "mono"), { size: 21, fill: C.muted, font: "mono" }));
  y = 150;

  };
  const wireSec = () => {
    if (!input.summary) return;
    const lines = wrap(input.summary, 25, W - 96).slice(0, 9);
    out.push(panelTitle(y, T.wire));
    y += 40;
    out.push(`<rect x="16" y="${y}" width="${W - 32}" height="${lines.length * 36 + 28}" rx="8" fill="${C.panel}" stroke="${C.goldDim}"/>`);
    lines.forEach((l, i) => out.push(text(40, y + 44 + i * 36, l, { size: 25 })));
    y += lines.length * 36 + 50;
  };
  const hero = () => {
  // Hero: the Ledger 100.
  const gl = within(input.series.gl100, startH, endH);
  const glAll = (input.series.gl100 ?? []).filter(([h]) => h <= endH);
  const glFromSeries: [string, number, number, number] | undefined = gl.length > 1 ? ["gl100", gl[0]![1], gl.at(-1)![1], (gl.at(-1)![1] / gl[0]![1] - 1) * 100] : undefined;
  const glRow = r.indexes?.find(([id]) => id === "gl100") ?? glFromSeries;
  const heroH = big ? 470 : 420;
  out.push(`<rect x="16" y="${y}" width="${W - 32}" height="${heroH}" rx="10" fill="${C.panel}" stroke="${C.line}"/>`);
  out.push(text(40, y + 44, names.index("gl100").toUpperCase(), { size: 24, fill: C.muted, font: "monobold", ls: 1 }));
  if (glRow) {
    const [, , close, ch] = glRow;
    out.push(text(40, y + 118, num(close, lang, 2), { size: 76, font: "monobold" }));
    const chText = pct(ch, lang);
    const cx = 40 + textWidth(num(close, lang, 2), 76, "mono") + 24;
    out.push(`<rect x="${cx}" y="${y + 70}" width="${textWidth(chText, 34, "mono") + 28}" height="54" rx="8" fill="${tone(ch)}" fill-opacity="0.18" stroke="${tone(ch)}"/>`);
    out.push(text(cx + 14, y + 109, chText, { size: 34, fill: tone(ch), font: "monobold" }));
  } else out.push(text(40, y + 110, T.noData, { size: 28, fill: C.muted }));
  // Open / high / low / close (and the range since launch for a week or a month).
  if (gl.length) {
    const vals = gl.map(([, v]) => v);
    const stats: [string, string][] = [[T.open, num(vals[0]!, lang, 2)], [T.high, num(Math.max(...vals), lang, 2)], [T.low, num(Math.min(...vals), lang, 2)], [T.close, num(vals.at(-1)!, lang, 2)]];
    stats.forEach(([k, v], i) => {
      const sx = W - 40 - (3 - i) * 128;
      out.push(text(sx, y + 52, k, { size: 18, fill: C.muted, font: "mono", anchor: "end" }));
      out.push(text(sx, y + 82, v, { size: 24, font: "mono", anchor: "end" }));
    });
    if (big && glAll.length) {
      const all = glAll.map(([, v]) => v);
      out.push(text(W - 40, y + 150, `${T.launchHigh} ${num(Math.max(...all), lang, 2)} · ${T.launchLow} ${num(Math.min(...all), lang, 2)}`, { size: 17, fill: C.goldDim, font: "mono", anchor: "end" }));
    }
    // The line chart.
    const cx = 40, cy = y + (big ? 180 : 150), cw = W - 80 - 70, chh = heroH - (big ? 220 : 190);
    const min = Math.min(...vals), max = Math.max(...vals);
    const pad = (max - min || 1) * 0.08;
    const lo = min - pad, hi = max + pad;
    const X = (h: number) => cx + ((h - startH) / Math.max(1, endH - startH)) * cw;
    const Y = (v: number) => cy + chh - ((v - lo) / (hi - lo)) * chh;
    for (let g = 0; g <= 4; g++) {
      const gy = cy + (g / 4) * chh;
      out.push(`<line x1="${cx}" y1="${gy.toFixed(1)}" x2="${cx + cw}" y2="${gy.toFixed(1)}" stroke="${C.line}" stroke-width="1"/>`);
      out.push(text(cx + cw + 10, gy + 7, num(hi - (g / 4) * (hi - lo), lang, 1), { size: 18, fill: C.muted, font: "mono" }));
    }
    const color = tone(glRow?.[3] ?? vals.at(-1)! - vals[0]!);
    const line = gl.map(([h, v], i) => `${i ? "L" : "M"}${X(h).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    out.push(`<defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`);
    out.push(`<path d="${line}L${X(gl.at(-1)![0]).toFixed(1)},${cy + chh}L${X(gl[0]![0]).toFixed(1)},${cy + chh}Z" fill="url(#area)"/>`);
    out.push(`<line x1="${cx}" y1="${Y(vals[0]!).toFixed(1)}" x2="${cx + cw}" y2="${Y(vals[0]!).toFixed(1)}" stroke="${C.muted}" stroke-dasharray="6 6" stroke-width="1.2"/>`);
    out.push(`<path d="${line}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linejoin="round"/>`);
    const last = gl.at(-1)!;
    out.push(`<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="6" fill="${color}"/>`);
    out.push(text(cx, cy + chh + 30, date(r.start, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), { size: 18, fill: C.muted, font: "mono" }));
    out.push(text(cx + cw, cy + chh + 30, date(r.end, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), { size: 18, fill: C.muted, font: "mono", anchor: "end" }));
  }
  y += heroH + 22;

  };
  const sectorsSec = () => {
  // Sector heatmap.
  const sectors = (r.indexes ?? []).filter(([id]) => id !== "gl100");
  if (sectors.length) {
    out.push(panelTitle(y, T.sectors));
    y += 40;
    const cols = 4;
    const tw = (W - 32 - (cols - 1) * 10) / cols;
    const th = big ? 128 : 104;
    sectors.forEach(([id, , v, ch], i) => {
      const tx = 16 + (i % cols) * (tw + 10);
      const ty = y + Math.floor(i / cols) * (th + 10);
      out.push(`<rect x="${tx.toFixed(1)}" y="${ty}" width="${tw.toFixed(1)}" height="${th}" rx="8" fill="${heat(ch)}"/>`);
      out.push(text(tx + 14, ty + 32, fit(names.index(id), 21, tw - 28, "bold"), { size: 21, font: "bold" }));
      out.push(text(tx + 14, ty + 70, pct(ch, lang), { size: 30, font: "monobold" }));
      out.push(text(tx + tw - 14, ty + 70, num(v, lang, 1), { size: 18, fill: "#d9dde3", font: "mono", anchor: "end" }));
      if (big) out.push(spark(within(input.series[id], startH, endH).map(([, x]) => x), tx + 14, ty + 84, tw - 28, 32, "#ffffff"));
    });
    y += Math.ceil(sectors.length / cols) * (th + 10) + 14;
  }

  };
  const movers = () => {
  // Gainers and losers, full width rows with sparklines.
  const moverRows = (title: string, rows: [number, number, number, number, number][] | null | undefined) => {
    out.push(panelTitle(y, title));
    y += 40;
    if (!rows || !rows.length) { out.push(text(42, y + 26, T.noData, { size: 22, fill: C.muted })); y += 46; return; }
    const rh = 58;
    out.push(`<rect x="16" y="${y}" width="${W - 32}" height="${rows.length * rh}" rx="8" fill="${C.panel}" stroke="${C.line}"/>`);
    rows.slice(0, 5).forEach(([id, , b, ch], i) => {
      const ry = y + i * rh;
      if (i) out.push(`<line x1="28" y1="${ry}" x2="${W - 28}" y2="${ry}" stroke="${C.line}"/>`);
      out.push(text(36, ry + 38, fit(names.item(id), 26, 430), { size: 26, fill: QUALITY[names.quality(id)] ?? C.text }));
      out.push(spark(r.sparks?.[id], 490, ry + 12, 150, 34, tone(ch)));
      out.push(money(830, ry + 38, b, lang, 24));
      out.push(text(W - 32, ry + 38, pct(ch, lang), { size: 26, fill: tone(ch), font: "monobold", anchor: "end" }));
    });
    y += rows.slice(0, 5).length * rh + 18;
  };
  moverRows(T.gainers, r.risers);
  moverRows(T.losers, r.fallers);

  };
  const tradedSec = () => {
  // Most traded: volume bars.
  if (r.traded?.length) {
    out.push(panelTitle(y, T.traded));
    y += 42;
    const maxV = Math.max(...r.traded.map((x) => x[1]));
    r.traded.slice(0, 5).forEach(([id, gold, sold, , ch], i) => {
      const ry = y + i * 60;
      out.push(text(28, ry + 24, fit(names.item(id), 24, 420), { size: 24, fill: QUALITY[names.quality(id)] ?? C.text }));
      out.push(text(W - 28, ry + 24, `${num(sold, lang)} ${T.sold} · ${pct(ch, lang)}`, { size: 19, fill: C.muted, font: "mono", anchor: "end" }));
      const bw = Math.max(6, ((W - 260) * gold) / maxV);
      out.push(`<rect x="28" y="${ry + 34}" width="${bw.toFixed(1)}" height="16" rx="4" fill="${C.gold}" fill-opacity="${(0.95 - i * 0.12).toFixed(2)}"/>`);
      out.push(text(28 + bw + 12, ry + 49, `${coinText(gold, lang)}${T.perDay}`, { size: 19, fill: C.coinGold, font: "mono" }));
    });
    y += Math.min(5, r.traded.length) * 60 + 14;
  }

  };
  const raidSec = () => {
  // Raid consumables.
  if (r.raid) {
    const days = Math.ceil((RAID_LAUNCH - now) / 86_400);
    out.push(panelTitle(y, T.raid, days > 0 ? T.raidsIn(days) : T.raidsOpen));
    y += 42;
    const head = r.raid.prevSoldPerDay != null ? 118 : 76;
    out.push(`<rect x="16" y="${y}" width="${W - 32}" height="${head + Math.min(5, r.raid.rows.length) * 50}" rx="8" fill="${C.panel}" stroke="${C.line}"/>`);
    out.push(text(36, y + 52, num(r.raid.soldPerDay, lang), { size: 42, font: "monobold" }));
    out.push(text(36 + textWidth(num(r.raid.soldPerDay, lang), 42, "mono") + 16, y + 50, T.raidSub, { size: 20, fill: C.muted }));
    if (r.raid.prevSoldPerDay != null) {
      const maxS = Math.max(r.raid.soldPerDay, r.raid.prevSoldPerDay, 1);
      const bw = W - 520;
      out.push(`<rect x="36" y="${y + 70}" width="${((bw * r.raid.soldPerDay) / maxS).toFixed(1)}" height="14" rx="4" fill="${tone(r.raid.change)}"/>`);
      out.push(`<rect x="36" y="${y + 90}" width="${((bw * r.raid.prevSoldPerDay) / maxS).toFixed(1)}" height="14" rx="4" fill="${C.muted}" fill-opacity="0.6"/>`);
      out.push(text(W - 36, y + 96, `${pct(r.raid.change, lang)} · ${T.before} ${num(r.raid.prevSoldPerDay, lang)}`, { size: 20, fill: tone(r.raid.change), font: "mono", anchor: "end" }));
    }
    r.raid.rows.slice(0, 5).forEach(([id, sold, price, ch], i) => {
      const ry = y + head + i * 50;
      out.push(text(36, ry + 32, fit(names.item(id), 23, 380), { size: 23, fill: QUALITY[names.quality(id)] ?? C.text }));
      out.push(spark(r.sparks?.[id], 440, ry + 8, 120, 30, tone(ch)));
      out.push(text(700, ry + 32, `${num(sold, lang)}${T.perDay}`, { size: 20, fill: C.muted, font: "mono", anchor: "end" }));
      out.push(money(860, ry + 32, price, lang, 21));
      out.push(text(W - 32, ry + 32, pct(ch, lang), { size: 21, fill: tone(ch), font: "mono", anchor: "end" }));
    });
    y += head + Math.min(5, r.raid.rows.length) * 50 + 22;
  }

  };
  const desk = () => {
  // Flips and crafts.
  const flips = r.flips?.rows.slice(0, big ? 5 : 3) ?? [];
  if (flips.length) {
    out.push(panelTitle(y, T.flips, `${r.flips!.paid}/${r.flips!.found}`));
    y += 40;
    flips.forEach(([id, , buy, sell, profit, , result, , sold], i) => {
      const ry = y + i * 50;
      out.push(text(28, ry + 30, fit(names.item(id), 23, 360), { size: 23, fill: QUALITY[names.quality(id)] ?? C.text }));
      out.push(money(560, ry + 30, buy, lang, 20));
      out.push(text(572, ry + 30, "→", { size: 20, fill: C.muted }));
      out.push(money(720, ry + 30, sell, lang, 20));
      out.push(text(850, ry + 30, sold != null ? `${num(sold, lang)}${T.perDay}` : "", { size: 18, fill: C.muted, font: "mono", anchor: "end" }));
      out.push(text(W - 28, ry + 30, result != null ? pct(result, lang) : `+${coinText(profit, lang)}`, { size: 21, fill: tone(result ?? 1), font: "mono", anchor: "end" }));
    });
    y += flips.length * 50 + 16;
  }
  const crafts = r.crafts?.rows.slice(0, big ? 5 : 3) ?? [];
  if (crafts.length) {
    out.push(panelTitle(y, T.crafts, `${r.crafts!.stillProfitable}/${r.crafts!.found}`));
    y += 40;
    crafts.forEach(([id, , then, , nowProfit, nowPct], i) => {
      const ry = y + i * 50;
      out.push(text(28, ry + 30, fit(names.item(id), 23, 370), { size: 23, fill: QUALITY[names.quality(id)] ?? C.text }));
      out.push(text(410, ry + 30, T.then, { size: 17, fill: C.muted }));
      out.push(money(610, ry + 30, then, lang, 20));
      out.push(text(630, ry + 30, T.now, { size: 17, fill: C.muted }));
      if (nowProfit != null) out.push(money(850, ry + 30, nowProfit, lang, 20));
      out.push(text(W - 28, ry + 30, pct(nowPct, lang), { size: 21, fill: tone(nowPct), font: "mono", anchor: "end" }));
    });
    y += crafts.length * 50 + 16;
  }

  };
  const recordsSec = () => {
  // New highs and lows (a week or a month; a day shows them when there are any).
  const records = (title: string, rows: [number, number, number, number, number, number][] | null | undefined) => {
    if (!rows?.length) return;
    out.push(panelTitle(y, title));
    y += 40;
    rows.slice(0, big ? 5 : 3).forEach(([id, rec, , prev], i) => {
      const ry = y + i * 48;
      const ch = (rec / prev - 1) * 100;
      out.push(text(28, ry + 30, fit(names.item(id), 23, 480), { size: 23, fill: QUALITY[names.quality(id)] ?? C.text }));
      out.push(money(830, ry + 30, rec, lang, 21));
      out.push(text(W - 28, ry + 30, pct(ch, lang), { size: 21, fill: tone(ch), font: "mono", anchor: "end" }));
    });
    y += Math.min(big ? 5 : 3, rows.length) * 48 + 14;
  };
  records(T.highs, r.highs);
  records(T.lows, r.lows);

  };
  const rangesSec = () => {
  // Ranges: each index's period range and close against its range since launch (a week or a month).
  if (big && r.indexes?.length) {
    out.push(panelTitle(y, T.ranges));
    y += 44;
    for (const [id, , close] of r.indexes) {
      const all = (input.series[id] ?? []).filter(([h]) => h <= endH).map(([, v]) => v);
      const per = within(input.series[id], startH, endH).map(([, v]) => v);
      if (!all.length || !per.length) continue;
      const lo = Math.min(...all), hi = Math.max(...all);
      const span = hi - lo || 1;
      const bx = 300, bw = W - 300 - 200;
      const X = (v: number) => bx + ((v - lo) / span) * bw;
      out.push(text(28, y + 24, fit(names.index(id), 22, 200, "bold"), { size: 22, font: "bold" }));
      out.push(`<rect x="${bx}" y="${y + 10}" width="${bw}" height="16" rx="8" fill="${C.line}"/>`);
      out.push(`<rect x="${X(Math.min(...per)).toFixed(1)}" y="${y + 10}" width="${Math.max(4, X(Math.max(...per)) - X(Math.min(...per))).toFixed(1)}" height="16" rx="8" fill="${C.gold}" fill-opacity="0.55"/>`);
      out.push(`<rect x="${(X(close) - 2.5).toFixed(1)}" y="${y + 3}" width="5" height="30" rx="2" fill="${C.text}"/>`);
      out.push(text(bx - 10, y + 24, num(lo, lang, 1), { size: 17, fill: C.muted, font: "mono", anchor: "end" }));
      out.push(text(bx + bw + 10, y + 24, num(hi, lang, 1), { size: 17, fill: C.muted, font: "mono" }));
      out.push(text(W - 28, y + 24, num(close, lang, 1), { size: 20, font: "mono", anchor: "end" }));
      y += 46;
    }
    y += 10;
  }

  };
  const rebalanceSec = () => {
  // Index rebalancing.
  out.push(panelTitle(y, T.rebalance));
  y += 42;
  if (r.rebalance) {
    const when = `${date(r.rebalance.next, lang, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · ${lang === "fr" ? "15 h" : "15:00"} UTC · ${r.rebalance.quarterly ? T.quarterly : T.monthlyReb}`;
    out.push(text(28, y + 26, `${T.next}${lang === "fr" ? " : " : ": "}${when}`, { size: 22, font: "mono" }));
    y += 40;
  }
  const changes = input.changes.filter((c) => c.at > r.start && c.at <= r.end);
  if (!changes.length) {
    out.push(text(28, y + 24, T.none, { size: 21, fill: C.muted }));
    y += 40;
  }
  for (const c of changes.slice(0, 4)) {
    out.push(text(28, y + 24, `${names.index(c.index)} · ${date(c.at, lang)} · ${c.kind === "quarterly" ? T.quarterly : T.monthlyReb}`, { size: 21, fill: C.gold, font: "bold" }));
    y += 32;
    const line = (label: string, ids: number[], color: string) => {
      if (!ids.length) return;
      const list = ids.slice(0, 6).map((id) => names.item(id)).join(", ") + (ids.length > 6 ? ` +${ids.length - 6}` : "");
      out.push(text(28, y + 22, `${label}${lang === "fr" ? " : " : ": "}${fit(list, 20, W - 160)}`, { size: 20, fill: color }));
      y += 30;
    };
    line(T.inn, c.added, C.up);
    line(T.out, c.removed, C.down);
    y += 6;
  }
  y += 16;

  };
  const footer = () => {
  // Footer.
  out.push(`<rect x="0" y="${y}" width="${W}" height="3" fill="${C.goldDim}"/>`);
  out.push(text(W / 2, y + 38, T.footer, { size: 17, fill: C.muted, anchor: "middle" }));
  };

  const pages: (() => void)[][] = [
    [wireSec, hero, sectorsSec],
    [movers, tradedSec],
    [raidSec, desk],
    [recordsSec, ...(big ? [rangesSec] : []), rebalanceSec],
  ];
  // Render each page's sections; a page with nothing to show (no raid data or flips yet) is left out.
  const bodies: { out: string[]; y: number }[] = [];
  for (const secs of pages) {
    out = [];
    y = 0;
    header();
    const before = out.length;
    secs.forEach((f) => f());
    if (out.length > before) bodies.push({ out, y });
  }
  return bodies.map((b, i) => {
    out = b.out;
    y = b.y;
    pageNo(i + 1, bodies.length);
    footer();
    const height = Math.ceil(y + 62);
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}"><rect width="${W}" height="${height}" fill="${C.bg}"/>${out.join("")}</svg>`, width: W, height };
  });
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FONT_FILES = ["DejaVuSansCondensed.ttf", "DejaVuSansCondensed-Bold.ttf", "DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf"].map((f) => join(ROOT, "assets", "fonts", f));

type ResvgModule = { Resvg: new (svg: string, opts: unknown) => { render: () => { asPng: () => Buffer } } };
let resvg: ResvgModule | null | undefined;
/** resvg from GOBLIN_RENDER_DIR (the VM installs it there) or the app's own node_modules; null when missing. */
export function loadResvg(): ResvgModule | null {
  if (resvg !== undefined) return resvg;
  resvg = null;
  for (const dir of [process.env.GOBLIN_RENDER_DIR, ROOT]) {
    if (!dir) continue;
    try {
      resvg = createRequire(join(dir, "package.json"))("@resvg/resvg-js") as ResvgModule;
      break;
    } catch {
      // try the next place
    }
  }
  return resvg;
}

/** The cards as PNGs, or null without resvg or fonts (or if one card would be too big for Discord). */
export function renderCards(input: CardInput): Buffer[] | null {
  const lib = loadResvg();
  if (!lib || !FONT_FILES.every((f) => existsSync(f))) return null;
  const pngs = cardSvgs(input).map(({ svg }) => new lib.Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: SANS }, background: C.bg }).render().asPng());
  return pngs.every((p) => p.length <= MAX_CARD_BYTES) && pngs.reduce((a, p) => a + p.length, 0) <= MAX_CARD_BYTES ? pngs : null;
}
