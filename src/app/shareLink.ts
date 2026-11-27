/** Share a link: the phone's share sheet, the browser's, or the clipboard when there is neither. */
import { Capacitor } from "@capacitor/core";

export type ShareResult = "shared" | "copied" | "failed";

export async function shareLink(o: { title: string; text: string; url: string }): Promise<ShareResult> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ ...o, dialogTitle: o.title });
      return "shared";
    }
    if (typeof navigator.share === "function") {
      await navigator.share(o);
      return "shared";
    }
    await navigator.clipboard.writeText(`${o.text} ${o.url}`);
    return "copied";
  } catch (e) {
    // Closing the share sheet is not a failure.
    return /cancel|abort/i.test(`${(e as Error).name} ${(e as Error).message}`) ? "shared" : "failed";
  }
}
