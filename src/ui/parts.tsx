import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { iconUrl, type CatalogItem, type Meta } from "../data/live";
import type { Lang } from "../lib/i18n";
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
  return src ? (
    <img class={`item-icon q${item?.quality ?? 1}`} src={src} width={size} height={size} alt="" loading="lazy" />
  ) : (
    <span class="item-icon placeholder" style={{ width: size, height: size }} />
  );
}

/** Gold / silver / copper with coin colours; `short` drops copper when the price is over 10 gold. */
export function Money({ copper, lang, short = false }: { copper: number | null | undefined; lang: Lang; short?: boolean }) {
  if (copper == null || !Number.isFinite(copper)) return <span class="money">–</span>;
  const c = splitCopper(copper);
  const s = COIN_SUFFIX[lang];
  const parts: ComponentChildren[] = [];
  if (c.gold > 0) parts.push(<span class="g" key="g">{c.gold.toLocaleString(lang === "fr" ? "fr-CA" : "en-US")}{s.gold}</span>);
  if (c.silver > 0 && !(short && c.gold >= 100)) parts.push(<span class="s" key="s">{c.silver}{s.silver}</span>);
  if ((c.copper > 0 && !(short && c.gold >= 10)) || parts.length === 0) parts.push(<span class="c" key="c">{c.copper}{s.copper}</span>);
  return <span class="money">{c.negative ? "-" : ""}{parts}</span>;
}

export function formatPct(value: number | null, lang: Lang, signed = true): string {
  if (value == null || !Number.isFinite(value)) return "–";
  const text = `${signed && value > 0 ? "+" : ""}${value.toFixed(Math.abs(value) >= 100 ? 0 : 2)}%`;
  return lang === "fr" ? text.replace(".", ",").replace("%", " %") : text;
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
    return () => window.removeEventListener("keydown", onKey);
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

export function Loading({ text }: { text: string }) {
  return <p class="state-msg">{text}</p>;
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
