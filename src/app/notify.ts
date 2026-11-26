/**
 * Notifications for price and deal alerts: the phone's on Android, the browser's on the website. Whatever cannot be
 * shown that way is left to the in-app banner.
 */
import { Capacitor } from "@capacitor/core";

/**
 * Ask the browser for permission to notify. Call it from a tap (browsers ignore or block requests made on their own).
 * Does nothing in the Android app, which asks through ensureNotificationPermission (src/app/background.ts).
 */
export function requestWebNotifications(): void {
  if (Capacitor.isNativePlatform() || typeof Notification === "undefined" || Notification.permission !== "default") return;
  try {
    void Notification.requestPermission().catch(() => {});
  } catch {
    // Old browsers without a promise form: the in-app banner still works.
  }
}

/** Show phone or browser notifications; false when none could be shown. */
export async function systemNotify(title: string, bodies: readonly string[]): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== "granted") return false;
      await LocalNotifications.schedule({ notifications: bodies.map((body, i) => ({ id: (Date.now() % 1_000_000) + i, title, body })) });
      return true;
    } catch {
      return false;
    }
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    for (const body of bodies) {
      const note = new Notification(title, { body, icon: "./icon-192.png" });
      note.onclick = () => window.focus();
    }
    return true;
  } catch {
    // Some phone browsers only allow notifications from a service worker, which this site does not have.
    return false;
  }
}
