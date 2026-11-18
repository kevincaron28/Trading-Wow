import { useMemo, useState } from "preact/hooks";
import { houseUpdated } from "../data/live";
import { BUILT_IN_WATCHLISTS } from "../data/watchlists";
import { t } from "../lib/i18n";
import { change24h } from "../lib/quotes";
import { REALM_GROUPS, activeWatchlist, houseId, openChart, setState, toggleInList, useStore } from "../app/store";
import { bumpRefresh, useCatalog, useMeta, useQuotes } from "./data";
import { ChangePill, ErrorMsg, Icon, ItemIcon, Loading, Money, Sheet, relativeTime } from "./parts";

type Sort = "list" | "name" | "price" | "change";

export function HouseBadge() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const realm = REALM_GROUPS.find((r) => r.id === s.realm) ?? REALM_GROUPS[0]!;
  const factionLabel = s.faction === "blackwater" ? t(s.lang, "blackwaterShort") : t(s.lang, s.faction);
  return (
    <>
      <button type="button" class={`house-badge ${s.faction}`} onClick={() => setOpen(true)}>
        {realm.label[s.lang]} · {factionLabel} <Icon name="chevron" size={16} />
      </button>
      {open && (
        <Sheet title={t(s.lang, "house")} onClose={() => setOpen(false)}>
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
            {(["alliance", "horde", "blackwater"] as const).map((f) => (
              <button type="button" class={f === s.faction ? `on ${f}` : f} aria-pressed={f === s.faction} onClick={() => setState({ faction: f })}>
                {t(s.lang, f)}
              </button>
            ))}
          </div>
          <button type="button" class="btn wide" onClick={() => setOpen(false)}>{t(s.lang, "done")}</button>
        </Sheet>
      )}
    </>
  );
}

export function WatchlistScreen({ onSearch }: { onSearch: () => void }) {
  const s = useStore();
  const list = activeWatchlist(s);
  const house = houseId(s);
  const quotes = useQuotes(house);
  const catalog = useCatalog();
  const meta = useMeta();
  const [sort, setSort] = useState<Sort>("list");
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);

  const rows = useMemo(() => {
    const items = list.items.map((id) => ({ id, item: catalog.data?.get(id), quote: quotes.data?.get(id) }));
    const name = (r: (typeof items)[number]) => r.item?.name[s.lang] ?? String(r.id);
    if (sort === "name") items.sort((a, b) => name(a).localeCompare(name(b), s.lang));
    if (sort === "price") items.sort((a, b) => (b.quote?.[s.priceField] ?? -1) - (a.quote?.[s.priceField] ?? -1));
    if (sort === "change") items.sort((a, b) => (b.quote ? (change24h(b.quote) ?? -1e9) : -2e9) - (a.quote ? (change24h(a.quote) ?? -1e9) : -2e9));
    return items;
  }, [list, catalog.data, quotes.data, sort, s.lang, s.priceField]);

  const builtIn = BUILT_IN_WATCHLISTS.find((w) => w.id === list.id);
  const snapshot = houseUpdated(meta.data?.houses.find((h) => h.id === house));

  return (
    <section class="screen">
      <header class="topbar">
        <button type="button" class="list-switch" onClick={() => setPicker(true)}>
          <span>{list.name[s.lang]}</span> <Icon name="chevron" size={18} />
        </button>
        <div class="topbar-actions">
          <button type="button" class="icon-btn" onClick={() => setEditing(!editing)} aria-label={t(s.lang, editing ? "done" : "edit")}>
            <Icon name={editing ? "check" : "edit"} />
          </button>
          <button type="button" class="icon-btn" onClick={onSearch} aria-label={t(s.lang, "search")}>
            <Icon name="search" />
          </button>
        </div>
      </header>
      <div class="subbar">
        <HouseBadge />
        {snapshot ? <span class="muted small">{t(s.lang, "updated")} {relativeTime(snapshot, s.lang)}</span> : null}
      </div>
      <div class="table-head">
        <button type="button" onClick={() => setSort(sort === "name" ? "list" : "name")} class={sort === "name" ? "on" : ""}>{t(s.lang, "sortName")}</button>
        <span />
        <button type="button" onClick={() => setSort(sort === "price" ? "list" : "price")} class={sort === "price" ? "on" : ""}>{t(s.lang, "sortPrice")}</button>
        <button type="button" onClick={() => setState({ changeMode: s.changeMode === "pct" ? "abs" : "pct" })} onDblClick={() => setSort(sort === "change" ? "list" : "change")} class={sort === "change" ? "on" : ""}>
          {t(s.lang, "sortChange")} {s.changeMode === "pct" ? "%" : "±"}
        </button>
      </div>
      {quotes.error && !quotes.data ? (
        <ErrorMsg text={t(s.lang, "loadError")} retry={bumpRefresh} retryLabel={t(s.lang, "retry")} />
      ) : !quotes.data || !catalog.data ? (
        <Loading text={t(s.lang, "loading")} />
      ) : rows.length === 0 ? (
        <p class="state-msg">{t(s.lang, "emptyList")}</p>
      ) : (
        <ul class="rows">
          {rows.map(({ id, item, quote }) => {
            const pct = quote ? change24h(quote) : null;
            const abs = quote?.prev24h ? quote.market - quote.prev24h : null;
            return (
              <li key={id} class="row">
                <button type="button" class="row-main" onClick={() => !editing && openChart(id)}>
                  <ItemIcon item={item} meta={meta.data} />
                  <span class="row-name">
                    <span class={`name q${item?.quality ?? 1}`}>{item?.name[s.lang] ?? `#${id}`}</span>
                    <span class="sub">{quote ? `${quote.listed.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US")} · ${quote.auctions}` : t(s.lang, "notListed")}</span>
                  </span>
                  <span class="row-price"><Money copper={quote?.[s.priceField]} lang={s.lang} short /></span>
                  <ChangePill pct={pct} abs={abs} mode={s.changeMode} lang={s.lang} />
                </button>
                {editing && (
                  <button type="button" class="icon-btn danger" onClick={() => toggleInList(list.id, id)} aria-label={t(s.lang, "remove")}>
                    <Icon name="trash" size={20} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <div class="edit-bar">
          {builtIn && (
            <button type="button" class="btn ghost" onClick={() => setState((st) => ({ watchlists: st.watchlists.map((w) => (w.id === list.id ? { ...w, items: [...builtIn.items] } : w)) }))}>
              {t(s.lang, "resetList")}
            </button>
          )}
          {!builtIn && (
            <>
              <button type="button" class="btn ghost" onClick={() => {
                const name = prompt(t(s.lang, "renameList"), list.name[s.lang])?.trim();
                if (name) setState((st) => ({ watchlists: st.watchlists.map((w) => (w.id === list.id ? { ...w, name: { en: name, fr: name } } : w)) }));
              }}>{t(s.lang, "renameList")}</button>
              <button type="button" class="btn ghost danger" onClick={() => {
                if (confirm(t(s.lang, "deleteListConfirm"))) {
                  setState((st) => ({ watchlists: st.watchlists.filter((w) => w.id !== list.id), activeList: st.watchlists[0]!.id }));
                  setEditing(false);
                }
              }}>{t(s.lang, "deleteList")}</button>
            </>
          )}
        </div>
      )}
      {picker && (
        <Sheet title={t(s.lang, "lists")} onClose={() => setPicker(false)}>
          <ul class="menu-list">
            {s.watchlists.map((w) => (
              <li key={w.id}>
                <button type="button" class={w.id === list.id ? "on" : ""} onClick={() => { setState({ activeList: w.id }); setPicker(false); }}>
                  <span>{w.name[s.lang]}</span>
                  <span class="muted">{w.items.length}</span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" class="accent" onClick={() => {
                const name = prompt(t(s.lang, "newListPrompt"))?.trim();
                if (!name) return;
                const id = `custom-${Date.now().toString(36)}`;
                setState((st) => ({ watchlists: [...st.watchlists, { id, name: { en: name, fr: name }, items: [] }], activeList: id }));
                setPicker(false);
              }}>
                <Icon name="plus" size={18} /> {t(s.lang, "newList")}
              </button>
            </li>
          </ul>
        </Sheet>
      )}
    </section>
  );
}
