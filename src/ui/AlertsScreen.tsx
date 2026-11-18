import { t } from "../lib/i18n";
import { REALM_GROUPS, openChart, setState, useStore } from "../app/store";
import { useCatalog, useMeta } from "./data";
import { Icon, ItemIcon, Money } from "./parts";

function houseLabel(house: number, lang: "en" | "fr"): string {
  for (const g of REALM_GROUPS) {
    for (const [faction, id] of Object.entries(g.houses)) {
      if (id === house) return `${g.label[lang]} · ${t(lang, faction === "blackwater" ? "blackwaterShort" : (faction as "alliance" | "horde"))}`;
    }
  }
  return `#${house}`;
}

export function AlertsScreen() {
  const s = useStore();
  const catalog = useCatalog();
  const meta = useMeta();
  const alerts = [...s.alerts].sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt - a.createdAt);
  return (
    <section class="screen">
      <header class="topbar"><h1 class="title">{t(s.lang, "alerts")}</h1></header>
      {alerts.length === 0 ? (
        <p class="state-msg">{t(s.lang, "alertsEmpty")}</p>
      ) : (
        <ul class="rows">
          {alerts.map((a) => {
            const item = catalog.data?.get(a.itemId);
            return (
              <li key={a.id} class={`row ${a.active ? "" : "inactive"}`}>
                <button type="button" class="row-main" onClick={() => openChart(a.itemId)}>
                  <ItemIcon item={item} meta={meta.data} />
                  <span class="row-name">
                    <span class={`name q${item?.quality ?? 1}`}>{item?.name[s.lang] ?? `#${a.itemId}`}</span>
                    <span class="sub">
                      {t(s.lang, a.field === "market" ? "market" : "minBuyout")} {t(s.lang, a.op === "above" ? "alertAbove" : "alertBelow")} <Money copper={a.price} lang={s.lang} short /> · {houseLabel(a.house, s.lang)}
                    </span>
                  </span>
                  <span class={`pill ${a.active ? "flat" : "up"}`}>{t(s.lang, a.active ? "alertActive" : "alertTriggered")}</span>
                </button>
                {!a.active && (
                  <button type="button" class="icon-btn" aria-label={t(s.lang, "alertActive")} onClick={() => setState((st) => ({ alerts: st.alerts.map((x) => (x.id === a.id ? { ...x, active: true, triggeredAt: undefined } : x)) }))}>
                    <Icon name="refresh" size={20} />
                  </button>
                )}
                <button type="button" class="icon-btn danger" aria-label={t(s.lang, "remove")} onClick={() => setState((st) => ({ alerts: st.alerts.filter((x) => x.id !== a.id) }))}>
                  <Icon name="trash" size={20} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p class="hint">{t(s.lang, "alertNote")}</p>
    </section>
  );
}
