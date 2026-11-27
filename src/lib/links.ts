import type { Lang } from "./i18n";

/** The policy Google Play links to (docs/PLAY_STORE.md): the `legal` branch, English first, French further down. */
const PRIVACY_URL = "https://github.com/kevincaron28/Trading-Wow/blob/legal/PRIVACY.md";

export function privacyUrl(lang: Lang): string {
  return lang === "fr" ? `${PRIVACY_URL}#politique-de-confidentialité-de-goblin-ledger` : PRIVACY_URL;
}

export const ISSUES_URL = "https://github.com/kevincaron28/Trading-Wow/issues";

export const PLAY_URL = "https://play.google.com/store/apps/details?id=top.kcaron.goldline";

/** The web app on kcaron.top. An item link opens its chart there (and in any build that reads ?house=&item=). */
export const WEB_APP_URL = "https://kcaron.top/goblin-ledger/app/";

export function itemUrl(house: number, itemId: number): string {
  return `${WEB_APP_URL}?house=${house}&item=${itemId}`;
}

/** Goblin Ledger's page on kcaron.top: what "Share this app" sends. */
export function appPageUrl(lang: Lang): string {
  return lang === "fr" ? "https://kcaron.top/fr/goblin-ledger/" : "https://kcaron.top/goblin-ledger/";
}

/** A new GitHub issue with its title and text filled in (public; the user reviews and posts it). */
export function issueUrl(title: string, body: string): string {
  return `${ISSUES_URL}/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** An e-mail with its subject and text filled in, for the phone's mail app. */
export function mailUrl(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`;
}
