import type { Lang } from "./i18n";

/** Prices are stored in copper, like the game: 1 gold = 100 silver = 10,000 copper. */
export interface Coins {
  negative: boolean;
  gold: number;
  silver: number;
  copper: number;
}

export function splitCopper(amount: number): Coins {
  const value = Math.round(Math.abs(amount));
  return {
    negative: amount < 0 && value > 0,
    gold: Math.floor(value / 10_000),
    silver: Math.floor((value % 10_000) / 100),
    copper: value % 100,
  };
}

/** Coin suffixes: g/s/c in every language (the owner's rule: never po/pa/pc). */
export const COIN_SUFFIX: Record<Lang, { gold: string; silver: string; copper: string }> = {
  en: { gold: "g", silver: "s", copper: "c" },
  fr: { gold: "g", silver: "s", copper: "c" },
};

/** "12g 3s 40c": zero leading units are dropped, zero trailing ones too (but 0 shows "0c"). */
export function formatMoney(amount: number, lang: Lang = "en"): string {
  const coins = splitCopper(amount);
  const suffix = COIN_SUFFIX[lang];
  const groupedGold = coins.gold.toLocaleString(lang === "fr" ? "fr-CA" : "en-US").replace(/ | /g, " ");
  const parts: string[] = [];
  if (coins.gold > 0) parts.push(`${groupedGold}${suffix.gold}`);
  if (coins.silver > 0) parts.push(`${coins.silver}${suffix.silver}`);
  if (coins.copper > 0 || parts.length === 0) parts.push(`${coins.copper}${suffix.copper}`);
  return (coins.negative ? "-" : "") + parts.join(" ");
}

/** Short form for the price axis: "12.3g", "45s", "80c". */
export function formatMoneyShort(amount: number, lang: Lang = "en"): string {
  const suffix = COIN_SUFFIX[lang];
  const sign = amount < 0 ? "-" : "";
  const value = Math.abs(amount);
  const decimal = (n: number, digits: number) => {
    const fixed = n.toFixed(digits);
    const text = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
    return lang === "fr" ? text.replace(".", ",") : text;
  };
  if (value >= 10_000) return `${sign}${decimal(value / 10_000, value >= 1_000_000 ? 0 : 2)}${suffix.gold}`;
  if (value >= 100) return `${sign}${decimal(value / 100, 1)}${suffix.silver}`;
  return `${sign}${Math.round(value)}${suffix.copper}`;
}

/** Percent change from `from` to `to`, or null when there is no base. */
export function percentChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

/** Price-axis label: two coin units at most ("1,234g", "12g 25s", "13g 06s", "25s 77c", "77c"). */
export function formatMoneyAxis(amount: number, lang: Lang = "en"): string {
  const c = splitCopper(amount);
  const s = COIN_SUFFIX[lang];
  const sign = c.negative ? "-" : "";
  if (c.gold >= 100) return `${sign}${c.gold.toLocaleString(lang === "fr" ? "fr-CA" : "en-US").replace(/ | /g, " ")}${s.gold}`;
  const two = (n: number) => String(n).padStart(2, "0");
  if (c.gold > 0) return c.silver ? `${sign}${c.gold}${s.gold} ${two(c.silver)}${s.silver}` : `${sign}${c.gold}${s.gold}`;
  if (c.silver > 0) return c.copper ? `${sign}${c.silver}${s.silver} ${two(c.copper)}${s.copper}` : `${sign}${c.silver}${s.silver}`;
  return `${sign}${c.copper}${s.copper}`;
}

/** Index points with two decimals in the reader's language (100.00 / 100,00). */
export function formatPoints(value: number, lang: Lang = "en"): string {
  return value.toLocaleString(lang === "fr" ? "fr-CA" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
