import { useEffect, useState } from "preact/hooks";
import { BUILT_IN_WATCHLISTS, type WatchlistDef } from "../data/watchlists";
import type { PriceAlert } from "../lib/alerts";
import { LANGS, detectLang, type Lang } from "../lib/i18n";
import { readJson, writeJson } from "../lib/storage";

export type Faction = "alliance" | "horde" | "blackwater";
export type Tab = "watchlist" | "chart" | "explore" | "alerts" | "menu";
export type Timeframe = "1h" | "4h" | "1d" | "1w";
export type ChartType = "candles" | "bars" | "line" | "area" | "heikin";
export type IndicatorKey = "volume" | "sma20" | "ema50" | "bb" | "rsi" | "macd";
export type PriceField = "market" | "min";

/** Realm groups and their auction house IDs (probe of 17 Nov 2026, docs/PLAN.md); realm types matched 18 Nov (docs/DATA.md). */
export const REALM_GROUPS: readonly { id: string; label: Record<Lang, string>; houses: Record<Faction, number> }[] = [
  { id: "pvp", label: { en: "PvP", fr: "JcJ" }, houses: { alliance: 110, horde: 113, blackwater: 116 } },
  { id: "b", label: { en: "Normal", fr: "Normal" }, houses: { alliance: 111, horde: 114, blackwater: 117 } },
  { id: "c", label: { en: "RP", fr: "JdR" }, houses: { alliance: 119, horde: 120, blackwater: 121 } },
  { id: "d", label: { en: "RP-PvP", fr: "JdR-JcJ" }, houses: { alliance: 123, horde: 124, blackwater: 125 } },
];

export interface State {
  lang: Lang;
  realm: string;
  faction: Faction;
  theme: "dark" | "light" | "system";
  tab: Tab;
  chartItem: number;
  compareItem: number | null;
  timeframe: Timeframe;
  chartType: ChartType;
  indicators: IndicatorKey[];
  priceField: PriceField;
  changeMode: "pct" | "abs";
  watchlists: WatchlistDef[];
  activeList: string;
  alerts: PriceAlert[];
  recent: number[];
  /** Horizontal price lines drawn on charts, per item ID (copper). */
  drawings: Record<string, number[]>;
  /** Chart range: how much history is shown ("all" = everything loaded). */
  range: "1d" | "1w" | "1m" | "3m" | "1y" | "all";
  logScale: boolean;
  /** First-run setup finished. */
  onboarded: boolean;
}

const KEY = "goldline:v2";
const PERSISTED: (keyof State)[] = [
  "lang", "realm", "faction", "theme", "chartItem", "timeframe", "chartType", "indicators", "priceField", "changeMode", "watchlists", "activeList", "alerts", "recent", "drawings", "range", "logScale", "onboarded",
];

function initial(): State {
  const nav = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  const base: State = {
    lang: detectLang(nav),
    realm: "pvp",
    faction: "horde",
    theme: "dark",
    tab: "watchlist",
    chartItem: 13468,
    compareItem: null,
    timeframe: "1h",
    chartType: "candles",
    indicators: ["volume", "sma20"],
    priceField: "market",
    changeMode: "pct",
    watchlists: BUILT_IN_WATCHLISTS.map((w) => ({ ...w, items: [...w.items] })),
    activeList: "flipping",
    alerts: [],
    recent: [],
    drawings: {},
    range: "all",
    logScale: false,
    onboarded: false,
  };
  const saved = readJson<Partial<State>>(KEY, {});
  const merged = { ...base, ...pick(saved) };
  if (!LANGS.includes(merged.lang)) merged.lang = base.lang;
  if (!REALM_GROUPS.some((r) => r.id === merged.realm)) merged.realm = base.realm;
  if (!["alliance", "horde", "blackwater"].includes(merged.faction)) merged.faction = base.faction;
  // New built-in lists added in later versions appear for existing users too.
  for (const list of BUILT_IN_WATCHLISTS) if (!merged.watchlists.some((w) => w.id === list.id)) merged.watchlists.push({ ...list, items: [...list.items] });
  if (!merged.watchlists.some((w) => w.id === merged.activeList)) merged.activeList = merged.watchlists[0]!.id;
  return merged;
}

function pick(saved: Partial<State>): Partial<State> {
  const out: Partial<State> = {};
  for (const key of PERSISTED) if (saved[key] !== undefined) (out as Record<string, unknown>)[key] = saved[key];
  return out;
}

let state: State = initial();
const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  writeJson(KEY, pick(state));
  listeners.forEach((fn) => fn());
}

export function useStore(): State {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return state;
}

export function houseId(s: Pick<State, "realm" | "faction">, faction: Faction = s.faction): number {
  const group = REALM_GROUPS.find((r) => r.id === s.realm) ?? REALM_GROUPS[0]!;
  return group.houses[faction];
}

export function openChart(itemId: number): void {
  setState((s) => ({ tab: "chart", chartItem: itemId, compareItem: null, recent: [itemId, ...s.recent.filter((id) => id !== itemId)].slice(0, 12) }));
}

export function activeWatchlist(s: State): WatchlistDef {
  return s.watchlists.find((w) => w.id === s.activeList) ?? s.watchlists[0]!;
}

export function toggleInList(listId: string, itemId: number): void {
  setState((s) => ({
    watchlists: s.watchlists.map((w) =>
      w.id !== listId ? w : { ...w, items: w.items.includes(itemId) ? w.items.filter((id) => id !== itemId) : [...w.items, itemId] },
    ),
  }));
}

/** Move one item inside a watchlist (indices into its items array). */
export function reorderInList(listId: string, from: number, to: number): void {
  setState((s) => ({
    watchlists: s.watchlists.map((w) => {
      if (w.id !== listId || from === to || from < 0 || from >= w.items.length) return w;
      const items = [...w.items];
      const [moved] = items.splice(from, 1);
      items.splice(Math.max(0, Math.min(items.length, to)), 0, moved!);
      return { ...w, items };
    }),
  }));
}

/** Copy an item to another list (appended when missing); with `move`, also remove it from the source list. */
export function copyToList(fromListId: string, toListId: string, itemId: number, move = false): void {
  setState((s) => ({
    watchlists: s.watchlists.map((w) => {
      if (w.id === toListId && !w.items.includes(itemId)) return { ...w, items: [...w.items, itemId] };
      if (move && w.id === fromListId && w.id !== toListId) return { ...w, items: w.items.filter((id) => id !== itemId) };
      return w;
    }),
  }));
}
