import { useState } from "preact/hooks";
import { Capacitor } from "@capacitor/core";
import { LANGS, t, type MessageKey } from "../lib/i18n";
import { REALM_GROUPS, setState, useStore } from "../app/store";
import { clearCache, houseUpdated } from "../data/live";
import { bumpRefresh, useMeta } from "./data";
import { HouseBadge } from "./WatchlistScreen";
import { DEVICE_TZ, TIME_ZONES, deviceZone, zoneLabel } from "../lib/time";
import { appPageUrl } from "../lib/links";
import { openStorePage } from "../app/rate";
import { shareLink } from "../app/shareLink";
import { FeedbackPage } from "./FeedbackPage";
import { HelpPage } from "./HelpPage";
import { PrivacyPage } from "./PrivacyPage";
import { Icon, relativeTime } from "./parts";
import { UpdateSection } from "./UpdateBanner";

export function MenuScreen() {
  const s = useStore();
  const meta = useMeta();
  const [page, setPage] = useState<null | "help" | "feedback" | "privacy">(null);
  const [shareNote, setShareNote] = useState("");
  const share = () => {
    setShareNote("");
    void shareLink({ title: "Goblin Ledger", text: t(s.lang, "shareAppText"), url: appPageUrl(s.lang) }).then((r) => {
      if (r !== "shared") setShareNote(t(s.lang, r === "copied" ? "linkCopied" : "shareFailed"));
    });
  };
  const entry = (label: MessageKey, onClick: () => void) => (
    <li><button type="button" onClick={onClick}><span>{t(s.lang, label)}</span><Icon name="chevronRight" size={18} /></button></li>
  );
  return (
    <section class="screen">
      <header class="topbar"><h1 class="title">{t(s.lang, "settings")}</h1></header>
      <div class="menu-section">
        <p class="sheet-label">{t(s.lang, "house")}</p>
        <HouseBadge />
        <p class="sheet-label">{t(s.lang, "language")}</p>
        <div class="seg">
          {LANGS.map((l) => (
            <button type="button" class={l === s.lang ? "on" : ""} aria-pressed={l === s.lang} onClick={() => setState({ lang: l })}>{l === "en" ? "English" : "Français"}</button>
          ))}
        </div>
        <p class="sheet-label">{t(s.lang, "theme")}</p>
        <div class="seg">
          {(["dark", "light", "system"] as const).map((th) => (
            <button type="button" class={th === s.theme ? "on" : ""} aria-pressed={th === s.theme} onClick={() => setState({ theme: th })}>
              {t(s.lang, th === "dark" ? "themeDark" : th === "light" ? "themeLight" : "themeSystem")}
            </button>
          ))}
        </div>
        <p class="sheet-label">{t(s.lang, "changeDisplay")}</p>
        <div class="seg">
          {(["1d", "1h"] as const).map((w) => (
            <button type="button" class={w === s.changeWindow ? "on" : ""} aria-pressed={w === s.changeWindow} onClick={() => setState({ changeWindow: w })}>{t(s.lang, w === "1d" ? "windowDay" : "windowHour")}</button>
          ))}
        </div>
        <div class="seg">
          {(["pct", "abs"] as const).map((m) => (
            <button type="button" class={m === s.changeMode ? "on" : ""} aria-pressed={m === s.changeMode} onClick={() => setState({ changeMode: m })}>{t(s.lang, m === "pct" ? "pctLabel" : "absLabel")}</button>
          ))}
        </div>
        <label class="field">
          <span class="sheet-label">{t(s.lang, "timeZone")}</span>
          <select value={s.timeZone} onChange={(e) => setState({ timeZone: (e.target as HTMLSelectElement).value })}>
            <option value={DEVICE_TZ}>{`${t(s.lang, "deviceZone")} (${deviceZone().replace(/_/g, " ")} · ${zoneLabel(s.lang, deviceZone())})`}</option>
            {TIME_ZONES.filter((z) => z !== deviceZone()).map((z) => <option value={z}>{`${z.replace(/_/g, " ")} · ${zoneLabel(s.lang, z)}`}</option>)}
          </select>
        </label>
        <p class="sheet-label">{t(s.lang, "priceField")}</p>
        <div class="seg">
          {(["market", "min"] as const).map((f) => (
            <button type="button" class={f === s.priceField ? "on" : ""} onClick={() => setState({ priceField: f })}>{t(s.lang, f === "market" ? "market" : "minBuyout")}</button>
          ))}
        </div>
      </div>

      <div class="menu-section">
        <p class="sheet-label">{t(s.lang, "dataStatus")}</p>
        <p class="small">{t(s.lang, "dataSource")}</p>
        {meta.data && (
          <table class="status">
            <tbody>
              {REALM_GROUPS.map((g) =>
                (["alliance", "horde", "blackwater"] as const).map((f) => {
                  const h = meta.data!.houses.find((x) => x.id === g.houses[f]);
                  return (
                    <tr>
                      <td>{g.label[s.lang]} · {t(s.lang, f === "blackwater" ? "blackwaterShort" : f)}</td>
                      <td>{h ? `${h.items.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US")}` : "–"}</td>
                      <td>{h ? relativeTime(houseUpdated(h)!, s.lang) : "–"}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        )}
        <button type="button" class="btn" onClick={() => { clearCache(); bumpRefresh(); }}>{t(s.lang, "refresh")}</button>
      </div>

      <div class="menu-section">
        <p class="sheet-label">{t(s.lang, "helpSection")}</p>
        <ul class="menu-list">
          {entry("help", () => setPage("help"))}
          {entry("reportProblem", () => setPage("feedback"))}
        </ul>
      </div>

      <div class="menu-section">
        <p class="sheet-label">Goblin Ledger</p>
        <ul class="menu-list">
          {Capacitor.isNativePlatform() && entry("rateApp", () => void openStorePage())}
          {entry("shareApp", share)}
          {entry("privacyPolicy", () => setPage("privacy"))}
        </ul>
        {shareNote && <p class="small" role="status">{shareNote}</p>}
      </div>

      <UpdateSection />

      <div class="menu-section">
        <p class="sheet-label">{t(s.lang, "about")}</p>
        <p class="small">{t(s.lang, "aboutText")}</p>
        {!Capacitor.isNativePlatform() && <p class="small muted">{t(s.lang, "webPreview")}</p>}
        <p class="small muted">{t(s.lang, "chartsBy")} <a href="https://www.tradingview.com/" target="_blank" rel="noopener">tradingview.com</a></p>
      </div>
      {page === "help" && <HelpPage onClose={() => setPage(null)} onFeedback={() => setPage("feedback")} />}
      {page === "feedback" && <FeedbackPage onClose={() => setPage(null)} />}
      {page === "privacy" && <PrivacyPage onClose={() => setPage(null)} />}
    </section>
  );
}
