import { useState } from "preact/hooks";
import { REALM_GROUPS, activeWatchlist, houseId, openChart, setState, useStore, type Faction } from "../app/store";
import { requestWebNotifications } from "../app/notify";
import { newAlertId } from "../lib/alerts";
import { DEAL_STEPS } from "../lib/dealAlerts";
import { t } from "../lib/i18n";
import { useCatalog, useMeta, useQuotes } from "./data";
import { houseLabel } from "./AlertsScreen";
import { Icon, ItemIcon, Money } from "./parts";

/** The realm and faction of an auction house. */
function realmOf(house: number): { realm: string; faction: Faction } | null {
  for (const g of REALM_GROUPS) {
    for (const [faction, id] of Object.entries(g.houses)) if (id === house) return { realm: g.id, faction: faction as Faction };
  }
  return null;
}

/** The Alerts tab's second half: watch a whole watchlist for deals, and what each watch found lately. */
export function DealAlerts() {
  const s = useStore();
  const [listId, setListId] = useState(() => activeWatchlist(s).id);
  const [pct, setPct] = useState(30);
  const watches = s.dealWatches.filter((w) => s.watchlists.some((l) => l.id === w.listId));

  const add = () => {
    requestWebNotifications();
    setState((st) => {
      const house = houseId(st);
      // One watch per list and auction house: choosing it again changes the threshold and starts afresh.
      const others = st.dealWatches.filter((w) => w.listId !== listId || w.house !== house);
      return { dealWatches: [...others, { id: newAlertId(), listId, house, pct, reported: {}, createdAt: Math.floor(Date.now() / 1000) }] };
    });
  };

  return (
    <div class="deals">
      <p class="section-label">{t(s.lang, "dealAlerts")}</p>
      <div class="deals-form">
        <p class="small muted">{t(s.lang, "dealAlertsHint")}</p>
        <label class="field">
          <span>{t(s.lang, "dealList")}</span>
          <select value={listId} onChange={(e) => setListId((e.target as HTMLSelectElement).value)}>
            {s.watchlists.map((l) => <option value={l.id}>{l.name[s.lang]}</option>)}
          </select>
        </label>
        <p class="sheet-label">{t(s.lang, "dealThreshold")}</p>
        <div class="seg" role="group">
          {DEAL_STEPS.map((n) => (
            <button type="button" class={n === pct ? "on" : ""} aria-pressed={n === pct} onClick={() => setPct(n)}>{n}%</button>
          ))}
        </div>
        <button type="button" class="btn wide" onClick={add}>{t(s.lang, "dealWatch")} · {houseLabel(houseId(s), s.lang)}</button>
      </div>
      {watches.map((w) => <Watch key={w.id} id={w.id} />)}
    </div>
  );
}

function Watch({ id }: { id: string }) {
  const s = useStore();
  const watch = s.dealWatches.find((w) => w.id === id)!;
  const catalog = useCatalog();
  const meta = useMeta();
  const quotes = useQuotes(watch.house);
  const list = s.watchlists.find((l) => l.id === watch.listId)!;
  const since = Date.now() / 1000 - 86_400;
  const hits = Object.entries(watch.reported).filter(([, at]) => at > since).sort((a, b) => b[1] - a[1]).map(([itemId]) => Number(itemId));

  /** Open an item in the watch's auction house, so the chart shows the price that was reported. */
  const open = (itemId: number) => {
    setState(realmOf(watch.house) ?? {});
    openChart(itemId);
  };

  return (
    <div class="deal-watch">
      <div class="row">
        <div class="row-main">
          <span class="row-name">
            <span class="name">{list.name[s.lang]}</span>
            <span class="sub">{houseLabel(watch.house, s.lang)} · {t(s.lang, "dealUnder").replace("{n}", String(watch.pct))}</span>
          </span>
        </div>
        <button type="button" class="icon-btn danger" aria-label={`${t(s.lang, "remove")} ${list.name[s.lang]}`} onClick={() => setState((st) => ({ dealWatches: st.dealWatches.filter((x) => x.id !== id) }))}>
          <Icon name="trash" size={20} />
        </button>
      </div>
      {hits.length === 0 ? (
        <p class="hint">{t(s.lang, "dealNone")}</p>
      ) : (
        <>
          <p class="hint">{t(s.lang, "dealRecent")}</p>
          <ul class="rows deal-hits">
            {hits.map((itemId) => {
              const item = catalog.data?.get(itemId);
              const quote = quotes.data?.get(itemId);
              return (
                <li key={itemId} class="row">
                  <button type="button" class="row-main no-pill" onClick={() => open(itemId)}>
                    <ItemIcon item={item} meta={meta.data} />
                    <span class="row-name">
                      <span class={`name q${item?.quality ?? 1}`}>{item?.name[s.lang] ?? `#${itemId}`}</span>
                      <span class="sub">{t(s.lang, "avg7dShort")} <Money copper={quote?.avg7d} lang={s.lang} short /></span>
                    </span>
                    <span class="row-price"><Money copper={quote?.min} lang={s.lang} short /></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
