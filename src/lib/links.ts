import type { Lang } from "./i18n";

/** The policy Google Play links to (docs/PLAY_STORE.md): the `legal` branch, English first, French further down. */
const PRIVACY_URL = "https://github.com/kevincaron28/Trading-Wow/blob/legal/PRIVACY.md";

export function privacyUrl(lang: Lang): string {
  return lang === "fr" ? `${PRIVACY_URL}#politique-de-confidentialité-de-goblin-ledger` : PRIVACY_URL;
}

export const ISSUES_URL = "https://github.com/kevincaron28/Trading-Wow/issues";
