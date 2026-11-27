import { useEffect, useRef, useState } from "preact/hooks";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { houseUpdated, isOffline, loadCatalog, loadMeta, loadQuotes, onOfflineChange } from "../data/live";
import { nextUpdate } from "../lib/live";
import { checkForUpdates, markAppReady } from "../app/updates";
import { UpdateBanner } from "./UpdateBanner";
import { evaluateAlerts, type PriceAlert } from "../lib/alerts";
import { evaluateDealWatch, mergeReported, type DealHit, type DealWatch } from "../lib/dealAlerts";
import { systemNotify } from "../app/notify";
import { t, type MessageKey } from "../lib/i18n";
import { formatMoney } from "../lib/money";
import type { Quote } from "../lib/quotes";
import { getState, houseId, setState, useStore, type Tab } from "../app/store";
import { ensureNotificationPermission, popBackgroundFired, syncBackgroundAlerts } from "../app/background";
import { EXIT_WINDOW_MS, exitOnBack, handleBack } from "../app/back";
import { watchKeyboard } from "../app/keyboard";
import { askForReview, reviewDue } from "../app/rate";
import { bumpRefresh } from "./data";
import { AlertsScreen } from "./AlertsScreen";
import { ChartScreen } from "./ChartScreen";
import { ExploreScreen } from "./ExploreScreen";
import { MenuScreen } from "./MenuScreen";
import { OverviewScreen } from "./OverviewScreen";
import { Icon } from "./parts";
import { SearchScreen } from "./SearchScreen";
import { WatchlistScreen } from "./WatchlistScreen";
import { Onboarding } from "./Onboarding";

const TABS: { id: Tab; icon: string; label: MessageKey }[] = [
  { id: "overview", icon: "pulse", label: "tabOverview" },
  { id: "watchlist", icon: "list", label: "tabWatchlist" },
  { id: "chart", icon: "chart", label: "tabChart" },
  { id: "explore", icon: "explore", label: "tabExplore" },
  { id: "alerts", icon: "bell", label: "tabAlerts" },
  { id: "menu", icon: "menu", label: "tabMenu" },
];

/** Check active alerts and deal watches against fresh quotes; notify for what fired. */
async function checkAlerts(): Promise<void> {
  const before = getState();
  const watched = (st: typeof before) => st.dealWatches.filter((w) => st.watchlists.some((l) => l.id === w.listId));
  const wanted = [...before.alerts.filter((a) => a.active), ...watched(before)];
  if (wanted.length === 0) return;
  const houses = [...new Set(wanted.map((a) => a.house))];
  const quoteMaps = new Map<number, Map<number, Quote>>();
  await Promise.all(houses.map(async (h) => quoteMaps.set(h, await loadQuotes(h, true).catch(() => new Map<number, Quote>()))));
  // From here to setState nothing waits, so two checks running at once cannot report the same thing twice.
  const state = getState();
  const now = Math.floor(Date.now() / 1000);
  const { alerts, fired } = evaluateAlerts(state.alerts, (h) => quoteMaps.get(h), now);
  const found: { watch: DealWatch; hits: DealHit[] }[] = [];
  let dealsChanged = false;
  const dealWatches = state.dealWatches.map((watch) => {
    const list = state.watchlists.find((l) => l.id === watch.listId);
    const quotes = quoteMaps.get(watch.house);
    if (!list || !quotes?.size) return watch;
    const result = evaluateDealWatch(watch, list.items, quotes, now);
    if (result.watch !== watch) dealsChanged = true;
    if (result.hits.length) found.push(result);
    return result.watch;
  });
  if (fired.length || dealsChanged) setState({ alerts, dealWatches });
  if (fired.length) await notify("alertFired", await alertLines(fired));
  if (found.length) await notify("dealFired", await dealLines(found));
}

/** What the background runner fired while the app was closed: mark it here too. */
async function collectBackgroundFired(): Promise<void> {
  const { fired, deals } = await popBackgroundFired();
  if (fired.length === 0 && Object.keys(deals).length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  setState((st) => ({
    alerts: st.alerts.map((a) => (fired.includes(a.id) && a.active ? { ...a, active: false, triggeredAt: now } : a)),
    dealWatches: mergeReported(st.dealWatches, deals),
  }));
}

/** Checks run one after another, each collecting the runner's results first, so nothing is reported twice. */
let lastCheck: Promise<void> = Promise.resolve();
function runAlertCheck(): void {
  lastCheck = lastCheck.then(collectBackgroundFired).then(checkAlerts).catch(() => {});
}

async function alertLines(fired: PriceAlert[]): Promise<string[]> {
  const { lang } = getState();
  const catalog = await loadCatalog().catch(() => null);
  return fired.map((a) => {
    const name = catalog?.get(a.itemId)?.name[lang] ?? `#${a.itemId}`;
    return `${name} ${t(lang, a.op === "above" ? "alertAbove" : "alertBelow")} ${formatMoney(a.price, lang)}`;
  });
}

/** One line per watch: its list, then the three best deals and how many more. */
async function dealLines(found: { watch: DealWatch; hits: DealHit[] }[]): Promise<string[]> {
  const { lang, watchlists } = getState();
  const catalog = await loadCatalog().catch(() => null);
  return found.map(({ watch, hits }) => {
    const list = watchlists.find((l) => l.id === watch.listId)?.name[lang] ?? "";
    const best = hits.slice(0, 3).map((h) => `${catalog?.get(h.itemId)?.name[lang] ?? `#${h.itemId}`} ${formatMoney(h.price, lang)} (-${Math.floor(h.discount)}${lang === "fr" ? " %" : "%"})`);
    const more = hits.length > 3 ? ` ${t(lang, "andMore").replace("{n}", String(hits.length - 3))}` : "";
    return `${list}${lang === "fr" ? " : " : ": "}${best.join(", ")}${more}`;
  });
}

async function notify(title: "alertFired" | "dealFired", lines: string[]): Promise<void> {
  const { lang } = getState();
  const shown = await systemNotify(t(lang, title), lines);
  // On the website the banner shows too: the browser may hide its notification (do not disturb).
  if (shown && Capacitor.isNativePlatform()) return;
  window.dispatchEvent(new CustomEvent("goldline:toast", { detail: { title: t(lang, title), text: lines.join("\n") } }));
}

export function App() {
  const s = useStore();
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<{ title: string; text: string } | null>(null);
  const [offline, setOfflineState] = useState(isOffline());
  useEffect(() => onOfflineChange(setOfflineState), []);
  const [exitHint, setExitHint] = useState(0);
  useEffect(() => watchKeyboard(), []);
  useEffect(() => {
    if (!exitHint) return;
    const id = setTimeout(() => setExitHint(0), EXIT_WINDOW_MS);
    return () => clearTimeout(id);
  }, [exitHint]);

  // Google Play's rating window: only after an add made since the app opened (never at launch), once the search is closed.
  const addsAtStart = useRef(getState().itemsAdded);
  useEffect(() => {
    if (searching || !reviewDue(getState(), addsAtStart.current)) return;
    const id = setTimeout(() => {
      void askForReview().then((asked) => asked && setState({ reviewAsked: true }));
    }, 1_500);
    return () => clearTimeout(id);
  }, [s.itemsAdded, searching]);

  // Android back button: close the open search, sheet or page, else go to the market overview, else leave the app on a
  // second press.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    void import("@capacitor/app").then(({ App: NativeApp }) =>
      NativeApp.addListener("backButton", () => {
        if (handleBack()) return;
        if (getState().tab !== "overview") setState({ tab: "overview" });
        else if (exitOnBack(Date.now())) void NativeApp.exitApp();
        else setExitHint(Date.now());
      }).then((h) => (remove = () => void h.remove())),
    );
    return () => remove?.();
  }, []);

  // Keep the background runner (alerts while the app is closed) in step with the app's alerts.
  useEffect(() => {
    if (s.alerts.some((a) => a.active) || s.dealWatches.length > 0) void ensureNotificationPermission();
    const deals = s.dealWatches.flatMap((w) => {
      const list = s.watchlists.find((l) => l.id === w.listId);
      return list ? [{ ...w, listName: list.name[s.lang], items: list.items }] : [];
    });
    const ids = [...s.alerts.map((a) => a.itemId), ...deals.flatMap((d) => d.items)];
    void loadCatalog()
      .then((catalog) => Object.fromEntries(ids.map((id) => [id, catalog.get(id)?.name[s.lang] ?? `#${id}`])))
      .catch(() => ({}))
      .then((names) => syncBackgroundAlerts(s.alerts, s.lang, names, deals));
  }, [s.alerts, s.dealWatches, s.watchlists, s.lang]);

  // A new or changed deal watch is checked right away.
  useEffect(() => {
    if (s.dealWatches.length > 0) runAlertCheck();
  }, [s.dealWatches.map((w) => `${w.id}:${w.pct}`).join()]);

  useEffect(() => {
    document.documentElement.lang = s.lang;
    const dark = s.theme === "dark" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    // The window behind the status and navigation bars is always Goblin Ledger's dark background: keep their icons light.
    if (Capacitor.isNativePlatform()) void SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => {});
  }, [s.lang, s.theme]);

  useEffect(() => {
    const onToast = (e: Event) => {
      setToast((e as CustomEvent<{ title: string; text: string }>).detail);
      setTimeout(() => setToast(null), 8000);
    };
    window.addEventListener("goldline:toast", onToast);
    // New snapshots arrive about hourly: refresh every 10 minutes while open, and when the app comes back.
    const tick = () => {
      bumpRefresh();
      runAlertCheck();
    };
    const timer = setInterval(tick, 10 * 60_000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    runAlertCheck();
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("goldline:toast", onToast);
    };
  }, []);

  // Updates: confirm this bundle started (else the updater rolls back), then check on launch and every 6 hours.
  useEffect(() => {
    void markAppReady();
    void checkForUpdates();
    const id = setInterval(() => void checkForUpdates(), 6 * 3_600_000);
    return () => clearInterval(id);
  }, []);

  // Live prices: once the expected update time has passed, check meta.json every minute while the app is visible.
  // When newer prices are published, reload the screens and pulse the prices for a moment.
  useEffect(() => {
    let lastSeen: number | null = null;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const meta = await loadMeta(true);
        if (lastSeen != null && meta.updated > lastSeen) {
          bumpRefresh();
          runAlertCheck();
          document.body.classList.remove("fresh-data");
          void document.body.offsetWidth;
          document.body.classList.add("fresh-data");
          setTimeout(() => document.body.classList.remove("fresh-data"), 2_600);
        }
        lastSeen = meta.updated;
      } catch {
        // Offline or the data host is slow: try again next minute.
      }
    };
    void check();
    const id = setInterval(() => {
      const house = getState();
      void loadMeta().then((meta) => {
        const h = meta.houses.find((x) => x.id === houseId(house));
        const next = nextUpdate(houseUpdated(h), meta.updated, Date.now() / 1000);
        if (!next || next.due) void check();
      }).catch(() => void check());
    }, 60_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  // A new tab or a newly opened chart starts at the top (the scroll position of the previous screen does not carry over).
  useEffect(() => { document.querySelector(".content")?.scrollTo({ top: 0 }); }, [s.tab, s.chartItem]);

  return (
    <div class="app">
      {offline && <p class="offline-bar" role="status">{t(s.lang, "offline")}</p>}
      <UpdateBanner />
      <main class="content">
        {s.tab === "overview" && <OverviewScreen />}
        {s.tab === "watchlist" && <WatchlistScreen onSearch={() => setSearching(true)} />}
        {s.tab === "chart" && <ChartScreen />}
        {s.tab === "explore" && <ExploreScreen />}
        {s.tab === "alerts" && <AlertsScreen />}
        {s.tab === "menu" && <MenuScreen />}
      </main>
      <nav class="tabbar" aria-label="Goblin Ledger">
        {TABS.map((tab) => (
          <button type="button" class={tab.id === s.tab ? "on" : ""} aria-current={tab.id === s.tab ? "page" : undefined} onClick={() => setState({ tab: tab.id })}>
            <Icon name={tab.icon} />
            <span>{t(s.lang, tab.label)}</span>
            {tab.id === "alerts" && (s.alerts.some((a) => !a.active && a.triggeredAt && a.triggeredAt > Date.now() / 1000 - 86_400) || s.dealWatches.some((w) => Object.values(w.reported).some((at) => at > Date.now() / 1000 - 86_400))) && <i class="badge" />}
          </button>
        ))}
      </nav>
      {searching && <SearchScreen onClose={() => setSearching(false)} />}
      {!s.onboarded && <Onboarding />}
      {exitHint > 0 && <p class="snackbar" role="status">{t(s.lang, "backToExit")}</p>}
      {toast && (
        <div class="toast" role="status" onClick={() => setToast(null)}>
          <b>{toast.title}</b>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
