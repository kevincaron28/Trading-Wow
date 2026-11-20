import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { iconUrl, type CatalogItem, type Meta } from "../data/live";
import { onBack } from "../app/back";
import { t, type Lang } from "../lib/i18n";
import { splitCopper, COIN_SUFFIX } from "../lib/money";

/** Simple original line icons (24px grid). */
const PATHS: Record<string, string> = {
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  chart: "M4 19V5M4 19h16M7 15l3-4 3 2 5-7",
  explore: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5-2 5-5 2 2-5z",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  menu: "M4 7h16M4 12h16M4 17h16",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20",
  plus: "M12 5v14M5 12h14",
  back: "M15 5l-7 7 7 7",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  close: "M6 6l12 12M18 6 6 18",
  chevron: "M8 10l4 4 4-4",
  chevronRight: "M10 7l5 5-5 5",
  check: "M5 12.5l4.5 4.5L19 7",
  layers: "M12 4 3 9l9 5 9-5zM3 14l9 5 9-5",
  compare: "M7 17 17 7M7 7h10v10",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  trash: "M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
};

export function Icon({ name, size = 22, filled = false }: { name: keyof typeof PATHS | string; size?: number; filled?: boolean }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

export function ItemIcon({ item, meta, size = 34 }: { item: CatalogItem | undefined; meta: Meta | null; size?: number }) {
  const src = item ? iconUrl(meta, item.icon) : "";
  const [failed, setFailed] = useState<string | null>(null);
  return src && failed !== src ? (
    <img class={`item-icon q${item?.quality ?? 1}`} src={src} width={size} height={size} alt="" loading="lazy" onError={() => setFailed(src)} />
  ) : (
    <span class={`item-icon placeholder q${item?.quality ?? 1}`} style={{ width: `${size}px`, height: `${size}px` }}>
      <svg width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 4h6l-1.5 3h-3z" /><path d="M10.5 7C6 9 4 13 4 16a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4c0-3-2-7-6.5-9" /><path d="M12 11v6M10 12.5h3a1.2 1.2 0 0 1 0 2.4h-2a1.2 1.2 0 0 0 0 2.4h3" />
      </svg>
    </span>
  );
}

/** Gold / silver / copper with coin colours; `short` drops copper when the price is over 10 gold. */
export function Money({ copper, lang, short = false }: { copper: number | null | undefined; lang: Lang; short?: boolean }) {
  if (copper == null || !Number.isFinite(copper)) return <span class="money">–</span>;
  const c = splitCopper(copper);
  const s = COIN_SUFFIX[lang];
  const parts: ComponentChildren[] = [];
  if (c.gold > 0) parts.push(<span class="g" key="g">{c.gold.toLocaleString(lang === "fr" ? "fr-CA" : "en-US")}{s.gold}</span>);
  // Silver and copper take two digits after a larger coin (13g 06s), so prices line up in a column.
  const pad = (n: number, after: boolean) => (after ? String(n).padStart(2, "0") : String(n));
  if (c.silver > 0 && !(short && c.gold >= 100)) parts.push(<span class="s" key="s">{pad(c.silver, c.gold > 0)}{s.silver}</span>);
  if ((c.copper > 0 && !(short && c.gold >= 10)) || parts.length === 0) parts.push(<span class="c" key="c">{pad(c.copper, parts.length > 0)}{s.copper}</span>);
  return <span class="money">{c.negative ? "-" : ""}{parts}</span>;
}

export function formatPct(value: number | null, lang: Lang, signed = true): string {
  if (value == null || !Number.isFinite(value)) return "–";
  const text = `${signed && value > 0 ? "+" : ""}${value.toFixed(Math.abs(value) >= 100 ? 0 : 2)}%`;
  return lang === "fr" ? text.replace(".", ",").replace("%", " %") : text;
}

/** 24h / 1h switch for price changes (the choice is saved and used everywhere). */
export function WindowToggle({ lang, value, onChange }: { lang: Lang; value: "1d" | "1h"; onChange: (w: "1d" | "1h") => void }) {
  return (
    <span class="seg mini window-toggle" role="radiogroup" aria-label={t(lang, "sortChange")}>
      {(["1d", "1h"] as const).map((w) => (
        <button type="button" role="radio" aria-checked={w === value} class={w === value ? "on" : ""} onClick={(e) => { e.stopPropagation(); onChange(w); }}>
          {t(lang, w === "1d" ? "windowDay" : "windowHour")}
        </button>
      ))}
    </span>
  );
}

export function ChangePill({ pct, abs, mode, lang }: { pct: number | null; abs: number | null; mode: "pct" | "abs"; lang: Lang }) {
  const dir = pct == null ? "flat" : pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return <span class={`pill ${dir}`}>{mode === "pct" || abs == null ? formatPct(pct, lang) : <Money copper={abs} lang={lang} short />}</span>;
}

/** Bottom sheet (modal) with a title and close button. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const offBack = onBack(onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      offBack();
    };
  }, [onClose]);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <button type="button" class="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Small original illustrations for empty screens (inline SVG, theme colours, no text). */
export function EmptyArt({ kind }: { kind: "list" | "bell" | "search" }) {
  return (
    <svg class="empty-art" width="132" height="104" viewBox="0 0 132 104" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="66" cy="94" rx="46" ry="6" fill="var(--surface-2)" />
      {kind === "list" && (
        <>
          <rect x="26" y="18" width="80" height="62" rx="10" fill="var(--surface)" stroke="var(--border)" stroke-width="2" />
          <path d="M38 64 L54 50 L66 56 L82 38 L94 44" stroke="var(--accent)" stroke-width="4" />
          <circle cx="94" cy="44" r="4" fill="var(--accent)" />
          <ellipse cx="40" cy="84" rx="12" ry="4" fill="var(--accent)" />
          <ellipse cx="40" cy="79" rx="12" ry="4" fill="var(--accent)" stroke="var(--accent-ink)" stroke-width="1" />
          <ellipse cx="40" cy="74" rx="12" ry="4" fill="var(--accent)" stroke="var(--accent-ink)" stroke-width="1" />
        </>
      )}
      {kind === "bell" && (
        <>
          <path d="M66 16 C50 16 42 28 42 44 V60 L34 72 H98 L90 60 V44 C90 28 82 16 66 16 Z" fill="var(--surface)" stroke="var(--accent)" stroke-width="3" />
          <path d="M58 78 C58 84 74 84 74 78" stroke="var(--accent)" stroke-width="3" />
          <path d="M104 22 l4 -6 M110 32 h7 M22 22 l-4 -6 M16 32 h-7" stroke="var(--muted)" stroke-width="3" />
          <path d="M52 50 L60 44 L68 48 L78 38" stroke="var(--up)" stroke-width="3" />
        </>
      )}
      {kind === "search" && (
        <>
          <circle cx="58" cy="46" r="24" fill="var(--surface)" stroke="var(--accent)" stroke-width="4" />
          <path d="M76 64 L94 82" stroke="var(--accent)" stroke-width="7" />
          <circle cx="58" cy="46" r="9" fill="none" stroke="var(--muted)" stroke-width="3" />
          <path d="M53 46 h10" stroke="var(--muted)" stroke-width="3" />
        </>
      )}
    </svg>
  );
}

export function EmptyState({ art, text }: { art: "list" | "bell" | "search"; text: string }) {
  return (
    <div class="empty-state">
      <EmptyArt kind={art} />
      <p>{text}</p>
    </div>
  );
}

export function Loading({ text }: { text: string }) {
  return (
    <div class="state-msg loading" role="status">
      <svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="24" cy="24" r="19" /><path d="M15 29 L21 23 L26 26 L33 18" /></svg>
      <p>{text}</p>
    </div>
  );
}

export function ErrorMsg({ text, retry, retryLabel }: { text: string; retry: () => void; retryLabel: string }) {
  return (
    <div class="state-msg error">
      <p>{text}</p>
      <button type="button" class="btn" onClick={retry}>{retryLabel}</button>
    </div>
  );
}

export function relativeTime(unixSeconds: number, lang: Lang): string {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - unixSeconds) / 60));
  if (minutes < 60) return lang === "fr" ? `il y a ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return lang === "fr" ? `il y a ${hours} h` : `${hours} h ago`;
}
