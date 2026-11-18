import { Capacitor } from "@capacitor/core";
import type { PriceAlert } from "../lib/alerts";
import type { Lang } from "../lib/i18n";

/** Must match capacitor.config.ts > plugins.BackgroundRunner.label. */
const LABEL = "top.kcaron.goldline.alerts";

/** Hand the current alerts (and item names for the notification text) to the background runner. Native only. */
export async function syncBackgroundAlerts(alerts: PriceAlert[], lang: Lang, names: Record<number, string>): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { BackgroundRunner } = await import("@capacitor/background-runner");
    await BackgroundRunner.dispatchEvent({ label: LABEL, event: "syncAlerts", details: { alerts, lang, names } });
  } catch {
    // Background checks are a bonus; the app still checks alerts while it is open.
  }
}

/** IDs of alerts the background runner fired since the last call. Native only. */
export async function popBackgroundFired(): Promise<string[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const { BackgroundRunner } = await import("@capacitor/background-runner");
    const result = (await BackgroundRunner.dispatchEvent({ label: LABEL, event: "popFired", details: {} })) as { fired?: string[] } | undefined;
    return Array.isArray(result?.fired) ? result.fired : [];
  } catch {
    return [];
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
