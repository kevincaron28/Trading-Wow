import { Capacitor } from "@capacitor/core";
import type { PriceAlert } from "../lib/alerts";
import type { DealWatch } from "../lib/dealAlerts";
import type { Lang } from "../lib/i18n";

/** Must match capacitor.config.ts > plugins.BackgroundRunner.label. */
const LABEL = "top.kcaron.goldline.alerts";

/** A deal watch as the runner needs it: with its list's name and items. */
export type RunnerDealWatch = DealWatch & { listName: string; items: number[] };

/** Hand the current alerts and deal watches (and item names for the notification text) to the background runner. Native only. */
export async function syncBackgroundAlerts(alerts: PriceAlert[], lang: Lang, names: Record<number, string>, deals: RunnerDealWatch[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { BackgroundRunner } = await import("@capacitor/background-runner");
    await BackgroundRunner.dispatchEvent({ label: LABEL, event: "syncAlerts", details: { alerts, lang, names, deals } });
  } catch {
    // Background checks are a bonus; the app still checks alerts while it is open.
  }
}

/** What the background runner reported while the app was closed. */
export interface BackgroundFired {
  /** IDs of price alerts it fired. */
  fired: string[];
  /** Deals it reported: watch ID, then item ID and time. */
  deals: Record<string, Record<string, number>>;
}

/** Everything the background runner fired since the last call. Native only. */
export async function popBackgroundFired(): Promise<BackgroundFired> {
  const none: BackgroundFired = { fired: [], deals: {} };
  if (!Capacitor.isNativePlatform()) return none;
  try {
    const { BackgroundRunner } = await import("@capacitor/background-runner");
    const result = (await BackgroundRunner.dispatchEvent({ label: LABEL, event: "popFired", details: {} })) as Partial<BackgroundFired> | undefined;
    return { fired: Array.isArray(result?.fired) ? result.fired : [], deals: result?.deals ?? {} };
  } catch {
    return none;
  }
}

/** Ask for notification permission (Android 13+) when the first alert is created. */
export async function ensureNotificationPermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const status = await LocalNotifications.checkPermissions();
    if (status.display !== "granted") await LocalNotifications.requestPermissions();
  } catch {
    /* ignore */
  }
}
