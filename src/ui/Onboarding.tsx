import { LANGS, t } from "../lib/i18n";
import { REALM_GROUPS, setState, useStore, type Faction } from "../app/store";

/** First-run setup: language, auction house, and what the numbers mean. Shown once. */
export function Onboarding() {
  const s = useStore();
  return (
    <div class="overlay onboarding" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div class="onboarding-body">
        <svg class="onboarding-mark" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2.4" />
          <path d="M9.5 19.5 L13.5 15.5 L16.5 18 L21.5 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <h1 id="welcome-title">{t(s.lang, "welcomeTitle")}</h1>
        <p>{t(s.lang, "welcomeText")}</p>

        <div class="seg">
          {LANGS.map((l) => (
            <button type="button" class={l === s.lang ? "on" : ""} aria-pressed={l === s.lang} onClick={() => setState({ lang: l })}>
              {l === "en" ? "English" : "Français"}
            </button>
          ))}
        </div>

        <p class="sheet-label">{t(s.lang, "welcomeHouse")}</p>
        <p class="small muted">{t(s.lang, "realm")}</p>
        <div class="seg">
          {REALM_GROUPS.map((r) => (
            <button type="button" class={r.id === s.realm ? "on" : ""} aria-pressed={r.id === s.realm} onClick={() => setState({ realm: r.id })}>
              {r.label[s.lang]}
            </button>
          ))}
        </div>
        <p class="small muted">{t(s.lang, "faction")}</p>
        <div class="seg">
          {(["alliance", "horde", "blackwater"] as Faction[]).map((f) => (
            <button type="button" class={f === s.faction ? `on ${f}` : f} aria-pressed={f === s.faction} onClick={() => setState({ faction: f })}>
              {t(s.lang, f === "blackwater" ? "blackwaterShort" : f)}
            </button>
          ))}
        </div>

        <ul class="onboarding-notes">
          <li>{t(s.lang, "welcomeNote1")}</li>
          <li>{t(s.lang, "welcomeNote2")}</li>
        </ul>
        <button type="button" class="btn wide" onClick={() => setState({ onboarded: true })}>{t(s.lang, "start")}</button>
      </div>
    </div>
  );
}
