import "./watchlist.css";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Lang } from "../lib/i18n";
import { clearCache, houseUpdated } from "../data/live";
import { PullToRefresh } from "./PullToRefresh";
import { BUILT_IN_WATCHLISTS } from "../data/watchlists";
import { t } from "../lib/i18n";
import { change24h } from "../lib/quotes";
import { REALM_GROUPS, activeWatchlist, copyToList, houseId, openChart, reorderInList, setState, toggleInList, useStore } from "../app/store";
import { bumpRefresh, useCatalog, useMeta, useQuotes } from "./data";
import { ChangePill, ErrorMsg, Icon, ItemIcon, Loading, Money, Sheet, relativeTime } from "./parts";

type Sort = "list" | "name" | "price" | "sold" | "change";

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
  const [openId, setOpenId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: number; name: string; step: "root" | "move" | "copy" } | null>(null);
  const [drag, setDrag] = useState<{ from: number; dy: number; h: number } | null>(null);
  const dragStart = useRef(0);
  const canReorder = sort === "list";
  const dropIndex = drag ? Math.max(0, Math.min(list.items.length - 1, drag.from + Math.round(drag.dy / drag.h))) : 0;
  const endDrag = () => {
    if (drag && dropIndex !== drag.from) reorderInList(list.id, drag.from, dropIndex);
    setDrag(null);
  };

  useEffect(() => {
    if (openId === null) return;
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-wl]");
      if (!el || el.getAttribute("data-wl") !== String(openId)) setOpenId(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [openId]);

  const rows = useMemo(() => {
    const items = list.items.map((id) => ({ id, item: catalog.data?.get(id), quote: quotes.data?.get(id) }));
    const name = (r: (typeof items)[number]) => r.item?.name[s.lang] ?? String(r.id);
    if (sort === "name") items.sort((a, b) => name(a).localeCompare(name(b), s.lang));
    if (sort === "price") items.sort((a, b) => (b.quote?.[s.priceField] ?? -1) - (a.quote?.[s.priceField] ?? -1));
    if (sort === "sold") items.sort((a, b) => (b.quote?.soldPerDay ?? -1) - (a.quote?.soldPerDay ?? -1));
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
        <button type="button" onClick={() => setSort(sort === "price" ? "sold" : sort === "sold" ? "list" : "price")} class={sort === "price" || sort === "sold" ? "on" : ""}>{sort === "sold" ? L[s.lang].sold : t(s.lang, "sortPrice")}</button>
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
        <PullToRefresh onRefresh={async () => { clearCache(); bumpRefresh(); await new Promise((r) => setTimeout(r, 700)); }}>
        <ul class="rows">
          {rows.map(({ id, item, quote }, i) => {
            const pct = quote ? change24h(quote) : null;
            const abs = quote?.prev24h ? quote.market - quote.prev24h : null;
            const name = item?.name[s.lang] ?? `#${id}`;
            let shift = 0;
            if (drag) {
              if (i === drag.from) shift = drag.dy;
              else if (drag.from < dropIndex && i > drag.from && i <= dropIndex) shift = -drag.h;
              else if (drag.from > dropIndex && i >= dropIndex && i < drag.from) shift = drag.h;
            }
            return (
              <li key={id} data-wl={id} class={`wl-row${drag && i === drag.from ? " dragging" : drag ? " shifting" : ""}`}>
                {!editing && (
                  <button type="button" class="wl-under" tabIndex={openId === id ? 0 : -1} onClick={() => toggleInList(list.id, id)}>
                    {L[s.lang].remove}
                  </button>
                )}
                <SwipeRow
                  editing={editing}
                  open={openId === id}
                  shiftY={shift}
                  onOpen={(o) => setOpenId(o ? id : null)}
                  onRemove={() => toggleInList(list.id, id)}
                  onMenu={() => { setOpenId(null); setMenu({ id, name, step: "root" }); }}
                  onTap={() => openChart(id)}
                >
                  {editing && canReorder && (
                    <>
                      <button
                        type="button"
                        class="wl-handle"
                        aria-label={L[s.lang].reorder}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          const h = e.currentTarget.closest("li")?.offsetHeight ?? 56;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          dragStart.current = e.clientY;
                          setDrag({ from: i, dy: 0, h });
                        }}
                        onPointerMove={(e) => drag && setDrag({ ...drag, dy: e.clientY - dragStart.current })}
                        onPointerUp={endDrag}
                        onPointerCancel={() => setDrag(null)}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h16M4 12h16M4 16h16" /></svg>
                      </button>
                      <span class="wl-move">
                        <button type="button" aria-label={L[s.lang].up} disabled={i === 0} onClick={() => reorderInList(list.id, i, i - 1)}>▲</button>
                        <button type="button" aria-label={L[s.lang].down} disabled={i === rows.length - 1} onClick={() => reorderInList(list.id, i, i + 1)}>▼</button>
                      </span>
                    </>
                  )}
                  <button type="button" class="row-main" data-main>
                    <ItemIcon item={item} meta={meta.data} />
                    <span class="row-name">
                      <span class={`name q${item?.quality ?? 1}`}>{name}</span>
                      <span class="sub">{quote ? `${quote.listed.toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US")} · ${quote.soldPerDay != null ? `~${Math.round(quote.soldPerDay).toLocaleString(s.lang === "fr" ? "fr-CA" : "en-US")} ${L[s.lang].soldPerDay}` : quote.auctions}` : t(s.lang, "notListed")}</span>
                    </span>
                    <span class="row-price"><Money copper={quote?.[s.priceField]} lang={s.lang} short /></span>
                    <ChangePill pct={pct} abs={abs} mode={s.changeMode} lang={s.lang} />
                  </button>
                  {editing && (
                    <button type="button" class="icon-btn danger" onClick={() => toggleInList(list.id, id)} aria-label={t(s.lang, "remove")}>
                      <Icon name="trash" size={20} />
                    </button>
                  )}
                </SwipeRow>
              </li>
            );
          })}
        </ul>
        </PullToRefresh>
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
      {menu && (
        <Sheet title={menu.name} onClose={() => setMenu(null)}>
          {menu.step === "root" ? (
            <ul class="menu-list">
              <li><button type="button" onClick={() => { openChart(menu.id); setMenu(null); }}>{L[s.lang].open}</button></li>
              <li><button type="button" onClick={() => setMenu({ ...menu, step: "move" })}>{L[s.lang].moveTo}</button></li>
              <li><button type="button" onClick={() => setMenu({ ...menu, step: "copy" })}>{L[s.lang].copyTo}</button></li>
              <li><button type="button" class="danger" onClick={() => { toggleInList(list.id, menu.id); setMenu(null); }}>{L[s.lang].remove}</button></li>
            </ul>
          ) : (
            <ul class="menu-list">
              {s.watchlists.filter((w) => w.id !== list.id).map((w) => (
                <li key={w.id}>
                  <button type="button" onClick={() => { copyToList(list.id, w.id, menu.id, menu.step === "move"); setMenu(null); }}>
                    <span>{w.name[s.lang]}</span>
                    <span class="muted">{w.items.includes(menu.id) ? "✓" : w.items.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
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

const L: Record<Lang, Record<"remove" | "reorder" | "up" | "down" | "open" | "moveTo" | "copyTo" | "sold" | "soldPerDay", string>> = {
  en: { remove: "Remove", reorder: "Reorder", up: "Move up", down: "Move down", open: "Open chart", moveTo: "Move to list…", copyTo: "Copy to list…", sold: "Sold", soldPerDay: "sold/day" },
  fr: { remove: "Retirer", reorder: "Réordonner", up: "Monter", down: "Descendre", open: "Ouvrir le graphique", moveTo: "Déplacer vers la liste…", copyTo: "Copier vers la liste…", sold: "Vendus", soldPerDay: "vendus/j" },
};

const REVEAL = 80;
const REMOVE_AT = 140;

/** Row wrapper: swipe left to reveal Remove, long-press / right-click for the menu, tap opens the chart. */
function SwipeRow(props: {
  editing: boolean;
  open: boolean;
  shiftY: number;
  onOpen: (open: boolean) => void;
  onRemove: () => void;
  onMenu: () => void;
  onTap: () => void;
  children: ComponentChildren;
}) {
  const { editing, open, shiftY, onOpen, onRemove, onMenu, onTap, children } = props;
  const g = useRef({ x: 0, y: 0, mode: "none" as "none" | "pending" | "swipe", timer: 0, suppress: false });
  const [dx, setDx] = useState<number | null>(null);
  const base = open ? -REVEAL : 0;
  const x = editing ? 0 : dx ?? base;
  const clear = () => window.clearTimeout(g.current.timer);

  return (
    <div
      class="row"
      style={{ transform: `translate(${x}px, ${shiftY}px)`, transition: dx !== null ? "none" : undefined }}
      onPointerDown={(e) => {
        if (editing || e.button !== 0) return;
        const gs = g.current;
        gs.x = e.clientX; gs.y = e.clientY; gs.mode = "pending"; gs.suppress = false;
        clear();
        gs.timer = window.setTimeout(() => {
          if (gs.mode === "pending") { gs.mode = "none"; gs.suppress = true; onMenu(); }
        }, 500);
      }}
      onPointerMove={(e) => {
        const gs = g.current;
        if (gs.mode === "none") return;
        const mx = e.clientX - gs.x;
        const my = e.clientY - gs.y;
        if (gs.mode === "pending") {
          if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) {
            gs.mode = "swipe"; clear();
            e.currentTarget.setPointerCapture(e.pointerId);
          } else if (Math.abs(my) > 10 || Math.abs(mx) > 10) { gs.mode = "none"; clear(); }
          return;
        }
        setDx(Math.max(-REMOVE_AT - 60, Math.min(0, base + mx)));
      }}
      onPointerUp={() => {
        const gs = g.current;
        clear();
        if (gs.mode === "swipe") {
          gs.suppress = true;
          const final = dx ?? base;
          setDx(null);
          if (final <= -REMOVE_AT) onRemove();
          else onOpen(final < -REVEAL / 2);
        }
        gs.mode = "none";
      }}
      onPointerCancel={() => { clear(); g.current.mode = "none"; setDx(null); }}
      onContextMenu={(e) => {
        if (editing) return;
        e.preventDefault(); clear();
        g.current.mode = "none"; g.current.suppress = true;
        onMenu();
      }}
      onClickCapture={(e) => {
        const gs = g.current;
        if (gs.suppress) { gs.suppress = false; e.stopPropagation(); e.preventDefault(); return; }
        if (editing) return;
        if (open) { e.stopPropagation(); e.preventDefault(); onOpen(false); return; }
        if ((e.target as HTMLElement).closest("[data-main]")) { e.stopPropagation(); onTap(); }
      }}
    >
      {children}
    </div>
  );
}
