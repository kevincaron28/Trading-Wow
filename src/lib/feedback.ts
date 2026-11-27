/** The message behind Settings > "Report a problem or send feedback". Nothing is sent by the app itself. */

export const FEEDBACK_KINDS = ["problem", "idea", "question"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface AppDetails {
  version: string;
  /** "Android app" or "Website". */
  platform: string;
  /** "Android 15; Pixel 7" from the browser's user agent, empty when unknown. */
  device: string;
  house: string;
  lang: string;
}

/** The phone model and Android version a user agent names, or "" (desktop browsers). */
export function deviceFrom(userAgent: string): string {
  const found = userAgent.match(/Android [\d.]+(?:; [^;)]+)?/)?.[0] ?? "";
  return found.replace(/ Build\/.*$/, "").replace(/; wv$/, "");
}

export function detailLines(d: AppDetails): string[] {
  return [`Goblin Ledger ${d.version} (${d.platform})`, ...(d.device ? [d.device] : []), `Auction house: ${d.house}`, `Language: ${d.lang}`];
}

export function feedbackMessage(kind: FeedbackKind, text: string, details: AppDetails | null): { subject: string; body: string } {
  const first = text.trim().split("\n")[0]!.slice(0, 60);
  return {
    subject: `Goblin Ledger ${kind}${first ? `: ${first}` : ""}`,
    body: details ? `${text.trim()}\n\n---\n${detailLines(details).join("\n")}` : text.trim(),
  };
}
