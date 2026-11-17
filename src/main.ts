import "./styles.css";
import { PriceChart, type ChartType } from "./chart";
import { ITEMS, findItem, searchItems, type Item } from "./data/items";
import { DEFAULT_HOUSE, REALMS, createSampleSource, houseKey, type House } from "./data/source";
import { toCandles, type Candle, type PricePoint, type Timeframe } from "./lib/candles";
import { LANGS, detectLang, t, type Lang, type MessageKey } from "./lib/i18n";
import { INDICATORS, type IndicatorId } from "./lib/indicators";
import { formatMoney } from "./lib/money";
import { cleanWatchlist, readJson, toggleWatch, writeJson } from "./lib/storage";
import { summarize } from "./lib/stats";

interface Prefs {
  lang: Lang;
  house: House;
  timeframe: Timeframe;
  chartType: ChartType;
  indicators: IndicatorId[];
  showVolume: boolean;
  watchlist: number[];
}

const PREFS_KEY = "goldline:prefs";
const TIMEFRAMES: Timeframe[] = ["1h", "4h", "1d", "1w"];
const DEFAULT_WATCHLIST = [14047, 12363, 13468, 13452];

function loadPrefs(): Prefs {
  const saved = readJson<Partial<Prefs>>(PREFS_KEY, {});
  const lang = LANGS.includes(saved.lang as Lang) ? (saved.lang as Lang) : detectLang(navigator.languages ?? [navigator.language]);
  return {
    lang,
    house: REALMS.some((r) => r.id === saved.house?.realm) ? { ...DEFAULT_HOUSE, ...saved.house } : DEFAULT_HOUSE,
    timeframe: TIMEFRAMES.includes(saved.timeframe as Timeframe) ? (saved.timeframe as Timeframe) : "4h",
    chartType: saved.chartType === "line" ? "line" : "candles",
    indicators: (saved.indicators ?? ["sma20"]).filter((id): id is IndicatorId => id in INDICATORS),
    showVolume: saved.showVolume ?? true,
    watchlist: saved.watchlist ? cleanWatchlist(saved.watchlist) : DEFAULT_WATCHLIST,
  };
}

const prefs = loadPrefs();
const source = createSampleSource();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let currentItem: Item = findItem(Number(location.hash.match(/item\/(\d+)/)?.[1])) ?? ITEMS[0]!;
let points: PricePoint[] = [];
let candles: Candle[] = [];

const chart = new PriceChart($("chart"), (hovered) => renderLegend(hovered));

function savePrefs(): void {
  writeJson(PREFS_KEY, prefs);
}

function tr(key: MessageKey): string {
  return t(prefs.lang, key);
}

function changeClass(value: number | null): string {
  return value == null ? "" : value >= 0 ? "up" : "down";
}

function formatPercent(value: number | null): string {
  if (value == null) return "–";
  const text = `${value >= 0 ? "+" : ""}${value.toFixed(1)} %`;
  return prefs.lang === "fr" ? text.replace(".", ",") : text.replace(" %", "%");
}

/** Static texts, selects and toolbar buttons. */
function renderChrome(): void {
  document.documentElement.lang = prefs.lang;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = tr(el.dataset.i18n as MessageKey);
  });
  document.querySelectorAll<HTMLElement>("[data-label]").forEach((el) => {
    el.dataset.caption = tr(el.dataset.label as MessageKey);
    el.setAttribute("aria-label", tr(el.dataset.label as MessageKey));
  });
  $<HTMLInputElement>("search").placeholder = tr("search");
  const lang = $<HTMLButtonElement>("lang");
  lang.textContent = tr("language");
  lang.setAttribute("aria-label", tr("languageLabel"));
  $("sample-banner").hidden = !source.isSample;

  const realm = $<HTMLSelectElement>("realm");
  realm.replaceChildren(...REALMS.map((r) => new Option(r.label, r.id, false, r.id === prefs.house.realm)));
  $<HTMLSelectElement>("faction").value = prefs.house.faction;

  const tf = $("timeframes");
  tf.replaceChildren(
    ...TIMEFRAMES.map((value) =>
      chip(value.toUpperCase().replace("1D", prefs.lang === "fr" ? "1J" : "1D").replace("1W", prefs.lang === "fr" ? "1S" : "1W"), "radio", prefs.timeframe === value, () => {
        prefs.timeframe = value;
        refreshChart();
      }),
    ),
  );
  const types = $("chart-types");
  types.replaceChildren(
    ...(["candles", "line"] as const).map((value) =>
      chip(tr(value), "radio", prefs.chartType === value, () => {
        prefs.chartType = value;
        refreshChart();
      }),
    ),
  );
  const toggles = $("indicator-toggles");
  toggles.replaceChildren(
    ...(Object.keys(INDICATORS) as IndicatorId[]).map((id) =>
      chip(id.replace(/(\D+)(\d+)/, (_, a: string, n: string) => `${a.toUpperCase()} ${n}`), "toggle", prefs.indicators.includes(id), () => {
        prefs.indicators = prefs.indicators.includes(id) ? prefs.indicators.filter((x) => x !== id) : [...prefs.indicators, id];
        refreshChart();
      }),
    ),
    chip(tr("volume"), "toggle", prefs.showVolume, () => {
      prefs.showVolume = !prefs.showVolume;
      refreshChart();
    }),
  );
}

function chip(label: string, kind: "radio" | "toggle", on: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  button.textContent = label;
  if (kind === "radio") {
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(on));
  } else {
    button.setAttribute("aria-pressed", String(on));
  }
  button.addEventListener("click", () => {
    onClick();
    savePrefs();
    renderChrome();
  });
  return button;
}

function refreshChart(): void {
  candles = toCandles(points, prefs.timeframe);
  chart.render({
    candles,
    chartType: prefs.chartType,
    indicators: new Set(prefs.indicators),
    showVolume: prefs.showVolume,
    lang: prefs.lang,
  });
  renderLegend(null);
}

function renderLegend(hovered: Candle | null): void {
  const c = hovered ?? candles.at(-1);
  const legend = $("legend");
  if (!c) {
    legend.textContent = "";
    return;
  }
  const m = (v: number) => formatMoney(v, prefs.lang);
  // UTC, like the chart's time axis, so a daily candle never shows the previous day.
  const intraday = prefs.timeframe === "1h" || prefs.timeframe === "4h";
  const date =
    new Date(c.time * 1000).toLocaleString(prefs.lang === "fr" ? "fr-CA" : "en-US", {
      dateStyle: "medium",
      timeStyle: intraday ? "short" : undefined,
      timeZone: "UTC",
    }) + (intraday ? " UTC" : "");
  legend.innerHTML = "";
  const parts: [string, string][] = [
    ["O", m(c.open)],
    ["H", m(c.high)],
    ["L", m(c.low)],
    ["C", m(c.close)],
    [tr("volume"), c.volume.toLocaleString(prefs.lang === "fr" ? "fr-CA" : "en-US")],
  ];
  legend.append(date + "  ");
  for (const [label, value] of parts) {
    legend.append(`${label} `);
    const b = document.createElement("b");
    b.textContent = value;
    legend.append(b, "  ");
  }
}

function renderItem(): void {
  const item = currentItem;
  const name = $("item-name");
  name.textContent = item.name[prefs.lang];
  name.className = `q${item.quality}`;
  $("item-category").textContent = `${item.category[prefs.lang]} · #${item.id}`;
  document.title = `${item.name[prefs.lang]} · Goldline`;

  const star = $<HTMLButtonElement>("star");
  const watched = prefs.watchlist.includes(item.id);
  star.setAttribute("aria-pressed", String(watched));
  star.setAttribute("aria-label", tr(watched ? "removeWatch" : "addWatch"));
  star.title = tr(watched ? "removeWatch" : "addWatch");

  const s = summarize(points);
  $("price").textContent = s.last ? formatMoney(s.last.market, prefs.lang) : "–";
  const change = $("change");
  change.textContent = `${formatPercent(s.change24h)} ${tr("change24h")}`;
  change.className = `change ${changeClass(s.change24h)}`;

  const rows: [MessageKey, string][] = s.last
    ? [
        ["minBuyout", formatMoney(s.last.minBuyout, prefs.lang)],
        ["avg7d", s.avg7d == null ? "–" : formatMoney(s.avg7d, prefs.lang)],
        ["listed", s.last.listed.toLocaleString(prefs.lang === "fr" ? "fr-CA" : "en-US")],
        ["auctions", String(s.last.auctions)],
        ["updated", new Date(s.last.time * 1000).toLocaleString(prefs.lang === "fr" ? "fr-CA" : "en-US", { dateStyle: "medium", timeStyle: "short" })],
      ]
    : [];
  $("stats").replaceChildren(
    ...rows.map(([key, value]) => {
      const wrap = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = tr(key);
      const dd = document.createElement("dd");
      dd.textContent = value;
      wrap.append(dt, dd);
      return wrap;
    }),
  );
}

async function renderWatchlist(): Promise<void> {
  const list = $("watchlist");
  if (prefs.watchlist.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = tr("watchlistEmpty");
    list.replaceChildren(li);
    return;
  }
  const rows = await Promise.all(
    prefs.watchlist.map(async (id) => {
      const item = findItem(id);
      if (!item) return null;
      const s = summarize(await source.history(id, prefs.house));
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `#/item/${id}`;
      if (id === currentItem.id) a.setAttribute("aria-current", "page");
      const name = document.createElement("span");
      name.className = `q${item.quality}`;
      name.textContent = item.name[prefs.lang];
      const price = document.createElement("span");
      price.className = "w-price";
      price.textContent = s.last ? formatMoney(s.last.market, prefs.lang) : "–";
      const cat = document.createElement("span");
      cat.className = "w-cat muted";
      cat.textContent = item.category[prefs.lang];
      const change = document.createElement("span");
      change.className = `w-change ${changeClass(s.change24h)}`;
      change.textContent = formatPercent(s.change24h);
      a.append(name, price, cat, change);
      li.append(a);
      return li;
    }),
  );
  list.replaceChildren(...rows.filter((r): r is HTMLLIElement => r !== null));
}

async function loadItem(): Promise<void> {
  points = await source.history(currentItem.id, prefs.house);
  renderItem();
  refreshChart();
  await renderWatchlist();
}

function renderAll(): void {
  renderChrome();
  void loadItem();
}

// --- Search (combobox) ---
const search = $<HTMLInputElement>("search");
const results = $<HTMLUListElement>("search-results");
let matches: Item[] = [];
let active = -1;

function closeResults(): void {
  results.hidden = true;
  search.setAttribute("aria-expanded", "false");
  search.removeAttribute("aria-activedescendant");
  active = -1;
}

function renderResults(): void {
  const q = search.value;
  if (!q.trim()) {
    closeResults();
    return;
  }
  matches = searchItems(ITEMS, q, prefs.lang);
  results.replaceChildren();
  if (matches.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = tr("noResults");
    results.append(li);
  }
  matches.forEach((item, i) => {
    const li = document.createElement("li");
    li.id = `result-${item.id}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === active));
    const name = document.createElement("span");
    name.className = `q${item.quality}`;
    name.textContent = item.name[prefs.lang];
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = item.category[prefs.lang];
    li.append(name, meta);
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      choose(item);
    });
    results.append(li);
  });
  const highlighted = active >= 0 ? matches[active] : undefined;
  if (highlighted) search.setAttribute("aria-activedescendant", `result-${highlighted.id}`);
  results.hidden = false;
  search.setAttribute("aria-expanded", "true");
}

function choose(item: Item): void {
  search.value = "";
  closeResults();
  location.hash = `#/item/${item.id}`;
}

search.addEventListener("input", () => {
  active = -1;
  renderResults();
});
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (matches.length === 0) return;
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    renderResults();
  } else if (e.key === "Enter") {
    const item = matches[active >= 0 ? active : 0];
    if (item) choose(item);
  } else if (e.key === "Escape") {
    closeResults();
  }
});
search.addEventListener("blur", closeResults);

// --- Other controls ---
$<HTMLButtonElement>("star").addEventListener("click", () => {
  prefs.watchlist = toggleWatch(prefs.watchlist, currentItem.id);
  savePrefs();
  renderItem();
  void renderWatchlist();
});
$<HTMLButtonElement>("lang").addEventListener("click", () => {
  prefs.lang = prefs.lang === "en" ? "fr" : "en";
  savePrefs();
  renderAll();
});
function onHouseChange(): void {
  prefs.house = {
    ...prefs.house,
    realm: $<HTMLSelectElement>("realm").value,
    faction: $<HTMLSelectElement>("faction").value === "alliance" ? "alliance" : "horde",
  };
  savePrefs();
  void loadItem();
}
$<HTMLSelectElement>("realm").addEventListener("change", onHouseChange);
$<HTMLSelectElement>("faction").addEventListener("change", onHouseChange);
window.addEventListener("hashchange", () => {
  const id = Number(location.hash.match(/item\/(\d+)/)?.[1]);
  const item = findItem(id);
  if (item && item.id !== currentItem.id) {
    currentItem = item;
    void loadItem();
  }
});

// Exposed for debugging in the console only.
(window as unknown as { goldline: unknown }).goldline = { prefs, houseKey };

renderAll();
