import { useEffect, useState } from "preact/hooks";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { isOffline, loadCatalog, loadQuotes, onOfflineChange } from "../data/live";
import { evaluateAlerts, type PriceAlert } from "../lib/alerts";
import { t, type MessageKey } from "../lib/i18n";
import { formatMoney } from "../lib/money";
import type { Quote } from "../lib/quotes";
import { getState, setState, useStore, type Tab } from "../app/store";
import { ensureNotificationPermission, popBackgroundFired, syncBackgroundAlerts } from "../app/background";
import { handleBack } from "../app/back";
import { bumpRefresh } from "./data";
import { AlertsScreen } from "./AlertsScreen";
import { ChartScreen } from "./ChartScreen";
import { ExploreScreen } from "./ExploreScreen";
import { MenuScreen } from "./MenuScreen";
import { Icon } from "./parts";
import { SearchScreen } from "./SearchScreen";
import { WatchlistScreen } from "./WatchlistScreen";
import { Onboarding } from "./Onboarding";

const TABS: { id: Tab; icon: string; label: MessageKey }[] = [
  { id: "watchlist", icon: "list", label: "tabWatchlist" },
  { id: "chart", icon: "chart", label: "tabChart" },
  { id: "explore", icon: "explore", label: "tabExplore" },
  { id: "alerts", icon: "bell", label: "tabAlerts" },
  { id: "menu", icon: "menu", label: "tabMenu" },
];

/** Check active alerts against fresh quotes; notify for each one that fired. */
async function checkAlerts(): Promise<void> {
  const active = getState().alerts.filter((a) => a.active);
  if (active.length === 0) return;
  const houses = [...new Set(active.map((a) => a.house))];
  const quoteMaps = new Map<number, Map<number, Quote>>();
  await Promise.all(houses.map(async (h) => quoteMaps.set(h, await loadQuotes(h, true).catch(() => new Map<number, Quote>()))));
  const { alerts, fired } = evaluateAlerts(getState().alerts, (h) => quoteMaps.get(h), Math.floor(Date.now() / 1000));
  if (fired.length === 0) return;
  setState({ alerts });
  await notify(fired);
}

/** Alerts the background runner fired while the app was closed: mark them triggered here too. */
async function collectBackgroundFired(): Promise<void> {
  const ids = await popBackgroundFired();
  if (ids.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  setState((st) => ({ alerts: st.alerts.map((a) => (ids.includes(a.id) && a.active ? { ...a, active: false, triggeredAt: now } : a)) }));
}

async function notify(fired: PriceAlert[]): Promise<void> {
  const { lang } = getState();
  const catalog = await loadCatalog().catch(() => null);
  const lines = fired.map((a) => {
    const name = catalog?.get(a.itemId)?.name[lang] ?? `#${a.itemId}`;
    return `${name} ${t(lang, a.op === "above" ? "alertAbove" : "alertBelow")} ${formatMoney(a.price, lang)}`;
  });
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display === "granted") {
        await LocalNotifications.schedule({
          notifications: lines.map((body, i) => ({ id: (Date.now() % 1_000_000) + i, title: t(lang, "alertFired"), body })),
        });
        return;
      }
    } catch {
      // Fall through to the in-app banner.
    }
  }
  window.dispatchEvent(new CustomEvent("goldline:toast", { detail: lines.join("\n") }));
}

export function App() {
  const s = useStore();
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [offline, setOfflineState] = useState(isOffline());
  useEffect(() => onOfflineChange(setOfflineState), []);

  // Android back button: close the open search/sheet, else go back to the watchlist, else leave the app.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    void import("@capacitor/app").then(({ App: NativeApp }) =>
      NativeApp.addListener("backButton", () => {
        if (handleBack()) return;
        if (getState().tab !== "watchlist") setState({ tab: "watchlist" });
        else void NativeApp.exitApp();
      }).then((h) => (remove = () => void h.remove())),
    );
    return () => remove?.();
  }, []);

  // Keep the background runner (alerts while the app is closed) in step with the app's alerts.
  useEffect(() => {
    if (s.alerts.some((a) => a.active)) void ensureNotificationPermission();
    void loadCatalog()
      .then((catalog) => Object.fromEntries(s.alerts.map((a) => [a.itemId, catalog.get(a.itemId)?.name[s.lang] ?? `#${a.itemId}`])))
      .catch(() => ({}))
      .then((names) => syncBackgroundAlerts(s.alerts, s.lang, names));
  }, [s.alerts, s.lang]);

  useEffect(() => {
    document.documentElement.lang = s.lang;
    const dark = s.theme === "dark" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    // The window behind the status and navigation bars is always Goldline's dark background: keep their icons light.
    if (Capacitor.isNativePlatform()) void SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => {});
  }, [s.lang, s.theme]);

  useEffect(() => {
    const onToast = (e: Event) => {
      setToast((e as CustomEvent<string>).detail);
      setTimeout(() => setToast(null), 8000);
    };
    window.addEventListener("goldline:toast", onToast);
    // New snapshots arrive about hourly: refresh every 10 minutes while open, and when the app comes back.
    const tick = () => {
      bumpRefresh();
      void collectBackgroundFired();
      void checkAlerts();
    };
    const timer = setInterval(tick, 10 * 60_000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    void collectBackgroundFired();
    void checkAlerts();
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("goldline:toast", onToast);
    };
  }, []);

  // A new tab or a newly opened chart starts at the top (the scroll position of the previous screen does not carry over).
  useEffect(() => { document.querySelector(".content")?.scrollTo({ top: 0 }); }, [s.tab, s.chartItem]);

  return (
    <div class="app">
      {offline && <p class="offline-bar" role="status">{t(s.lang, "offline")}</p>}
      <main class="content">
        {s.tab === "watchlist" && <WatchlistScreen onSearch={() => setSearching(true)} />}
        {s.tab === "chart" && <ChartScreen />}
        {s.tab === "explore" && <ExploreScreen />}
        {s.tab === "alerts" && <AlertsScreen />}
        {s.tab === "menu" && <MenuScreen />}
      </main>
      <nav class="tabbar" aria-label="Goldline">
        {TABS.map((tab) => (
          <button type="button" class={tab.id === s.tab ? "on" : ""} aria-current={tab.id === s.tab ? "page" : undefined} onClick={() => setState({ tab: tab.id })}>
            <Icon name={tab.icon} />
            <span>{t(s.lang, tab.label)}</span>
            {tab.id === "alerts" && s.alerts.some((a) => !a.active && a.triggeredAt && a.triggeredAt > Date.now() / 1000 - 86_400) && <i class="badge" />}
          </button>
        ))}
      </nav>
      {searching && <SearchScreen onClose={() => setSearching(false)} />}
      {!s.onboarded && <Onboarding />}
      {toast && (
        <div class="toast" role="status" onClick={() => setToast(null)}>
          <b>{t(s.lang, "alertFired")}</b>
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
