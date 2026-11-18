import { LANGS, t } from "../lib/i18n";
import { REALM_GROUPS, setState, useStore } from "../app/store";
import { clearCache, houseUpdated } from "../data/live";
import { bumpRefresh, useMeta } from "./data";
import { HouseBadge } from "./WatchlistScreen";
import { relativeTime } from "./parts";

export function MenuScreen() {
  const s = useStore();
  const meta = useMeta();
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
        <p class="sheet-label">{t(s.lang, "about")}</p>
        <p class="small">{t(s.lang, "aboutText")}</p>
        <p class="small muted">Goldline {__APP_VERSION__}</p>
      </div>
    </section>
  );
}
