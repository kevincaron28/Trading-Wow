/**
 * Ratings. Settings > "Rate this app" opens the store page: Google asks apps not to start its in-app rating window from
 * a button, because Google may decide not to show it. The window itself is requested once, after an add that brings the
 * items the user added to watchlists to three or more, never at launch, and only in the Google Play build.
 */
import { Capacitor } from "@capacitor/core";
import { PLAY_URL } from "../lib/links";
import { Distribution, appChannel } from "./updates";

export const ADDS_BEFORE_REVIEW = 3;

/** True after an add made since the app opened (`atStart` is the count then) once the count is reached. */
export function reviewDue(s: { onboarded: boolean; reviewAsked: boolean; itemsAdded: number }, atStart: number): boolean {
  return s.onboarded && !s.reviewAsked && s.itemsAdded >= ADDS_BEFORE_REVIEW && s.itemsAdded > atStart;
}

/** Ask Google Play to show its rating window. True when Play took the request (it never says whether it showed). */
export async function askForReview(): Promise<boolean> {
  if ((await appChannel()) !== "play") return false;
  try {
    await Distribution.requestReview();
    return true;
  } catch {
    // An older app without this call, or Play unavailable: try again at a later add.
    return false;
  }
}

export async function openStorePage(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { AppUpdate } = await import("@capawesome/capacitor-app-update");
      await AppUpdate.openAppStore();
      return;
    } catch {
      // No store app on this phone: fall back to the web page.
    }
  }
  window.open(PLAY_URL, "_blank", "noopener");
}
