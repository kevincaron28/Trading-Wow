import { useEffect, useState } from "preact/hooks";
import { LANGS, t, type MessageKey } from "../lib/i18n";
import { REALM_GROUPS, setState, useStore, type Faction } from "../app/store";
import { onBack } from "../app/back";
import { Icon } from "./parts";

export const TOUR_STEPS = 4;

const TABS: { icon: string; text: MessageKey }[] = [
  { icon: "pulse", text: "tourMarket" },
  { icon: "list", text: "tourWatchlist" },
  { icon: "chart", text: "tourChart" },
  { icon: "explore", text: "tourExplore" },
];

/**
 * First-run walkthrough, shown once (Help & FAQ can show it again): language, auction house, the screens, then alerts
 * and what the numbers mean. Android Back goes one step back.
 */
export function Onboarding() {
  const s = useStore();
  const [step, setStep] = useState(0);
  useEffect(() => (step > 0 ? onBack(() => setStep(step - 1)) : undefined), [step]);
  const done = () => setState({ onboarded: true });
  const last = step === TOUR_STEPS - 1;
  return (
    <div class="overlay onboarding" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div class="onboarding-body">
        {!last && <button type="button" class="link-btn onboarding-skip" onClick={done}>{t(s.lang, "skip")}</button>}
        {step === 0 && (
          <>
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
          </>
        )}
        {step === 1 && (
          <>
            <h1 id="welcome-title">{t(s.lang, "welcomeHouse")}</h1>
            <p class="small muted">{t(s.lang, "usOnly")}</p>
            <p class="sheet-label">{t(s.lang, "realm")}</p>
            <div class="seg">
              {REALM_GROUPS.map((r) => (
                <button type="button" class={r.id === s.realm ? "on" : ""} aria-pressed={r.id === s.realm} onClick={() => setState({ realm: r.id })}>
                  {r.label[s.lang]}
                </button>
              ))}
            </div>
            <p class="sheet-label">{t(s.lang, "faction")}</p>
            <div class="seg">
              {(["alliance", "horde", "blackwater"] as Faction[]).map((f) => (
                <button type="button" class={f === s.faction ? `on ${f}` : f} aria-pressed={f === s.faction} onClick={() => setState({ faction: f })}>
                  {t(s.lang, f === "blackwater" ? "blackwaterShort" : f)}
                </button>
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h1 id="welcome-title">{t(s.lang, "tourTitle")}</h1>
            <ul class="tour-list">
              {TABS.map((tab) => (
                <li key={tab.icon}><Icon name={tab.icon} size={26} /><span>{t(s.lang, tab.text)}</span></li>
              ))}
            </ul>
          </>
        )}
        {step === 3 && (
          <>
            <h1 id="welcome-title">{t(s.lang, "tourAlertsTitle")}</h1>
            <ul class="tour-list">
              <li><Icon name="bell" size={26} /><span>{t(s.lang, "tourAlerts")}</span></li>
              <li><Icon name="menu" size={26} /><span>{t(s.lang, "tourHelp")}</span></li>
            </ul>
            <ul class="onboarding-notes">
              <li>{t(s.lang, "welcomeNote1")}</li>
              <li>{t(s.lang, "welcomeNote2")}</li>
            </ul>
          </>
        )}

        <div class="tour-dots" role="img" aria-label={t(s.lang, "stepOf").replace("{n}", String(step + 1)).replace("{total}", String(TOUR_STEPS))}>
          {Array.from({ length: TOUR_STEPS }, (_, i) => <i key={i} class={i === step ? "on" : ""} />)}
        </div>
        <div class="tour-buttons">
          {step > 0 && <button type="button" class="btn ghost" onClick={() => setStep(step - 1)}>{t(s.lang, "back")}</button>}
          <button type="button" class="btn" onClick={() => (last ? done() : setStep(step + 1))}>{t(s.lang, last ? "start" : "next")}</button>
        </div>
      </div>
    </div>
  );
}
