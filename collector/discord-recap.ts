/**
 * The daily, weekly and monthly recaps on Discord, in two steps:
 *
 *   node collector/discord-recap.ts dispatch <dataDir> [--dry-run]
 *     On the collector VM, after the R2 publish (collector/publish.sh, when DISCORD_RECAP_DISPATCH=1): for each recap
 *     that is new and fresh, asks GitHub to run the "Post recap" workflow (a repository_dispatch event
 *     "recap-published" with the house, kind and key). What was sent is kept in state/discord-posted.json (on the VM,
 *     never published), so each recap is sent once. A recap more than FRESH_HOURS old is never sent: after a long
 *     outage the channel gets no burst of old recaps.
 *
 *   node collector/discord-recap.ts post <dataDir> --house 113 --kind daily --key 2026-11-26 --images <dir> [--dry-run]
 *     On GitHub Actions (.github/workflows/recap-post.yml), after scripts/render-recap.mjs drew the recap pages into
 *     <dir>: writes the summary (collector/recap-ai.ts, checked; the template otherwise) and posts the message with
 *     the images. --dry-run writes the message and the summary into <dir> instead.
 *
 * Settings (environment): DISCORD_RECAP_WEBHOOK (the channel's webhook, a secret: never printed, sent only to
 * Discord), DISCORD_RECAP_LANG (fr, default, or en), DISCORD_RECAP_HOUSES (dispatch: houses, default 113),
 * GOBLIN_LINKS_LIVE, GOBLIN_APP_URL and GOBLIN_WEB_URL (the post's links, see linksFromEnv), RECAP_AI_* (recap-ai.ts). Dispatch:
 * RECAP_DISPATCH_TOKEN or else GITHUB_TOKEN (Contents: read and write on the repository), RECAP_DISPATCH_REPO
 * (default kevincaron28/Trading-Wow). Branding: Goblin Ledger only.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatMoneyShort } from "../src/lib/money.ts";
import { pctText, recapSummary, type RecapFile, type RecapKind, type RecapList } from "../src/lib/weekly.ts";
import type { Lang } from "../src/lib/i18n.ts";
import { aiConfigFromEnv, summarize, type CardChangeLike } from "./recap-ai.ts";

const HOUR = 3_600;
export const BRAND = "Goblin Ledger";
/** The app icon, from the public repository. */
export const AVATAR_URL = "https://raw.githubusercontent.com/kevincaron28/Trading-Wow/main/public/icon-512.png";
const COLORS = { up: 0x3fb950, down: 0xf85149, flat: 0xd4a72c };
/** A recap older than this is not posted any more (hours after its end). */
/** Discord takes up to 10 MB of files a message (25 MB on boosted servers): stay under the base limit. */
const MAX_UPLOAD = 9_500_000;
export const FRESH_HOURS: Record<RecapKind, number> = { daily: 12, weekly: 24, monthly: 48 };
const KINDS: readonly RecapKind[] = ["daily", "weekly", "monthly"];

const REALMS: Record<string, Record<Lang, string>> = {
  pvp: { en: "PvP", fr: "JcJ" },
  b: { en: "Normal", fr: "Normal" },
  c: { en: "RP", fr: "JdR" },
  d: { en: "RP-PvP", fr: "JdR-JcJ" },
};
const FACTIONS: Record<string, Record<Lang, string>> = {
  alliance: { en: "Alliance", fr: "Alliance" },
  horde: { en: "Horde", fr: "Horde" },
  blackwater: { en: "Blackwater", fr: "Bourbe-Noire" },
};

const TEXT = {
  en: {
    daily: "Daily recap", weekly: "Weekly recap", monthly: "Monthly recap",
    ledger: "Ledger 100", sector: "Biggest sector move", raid: "Raid consumables", volume: "Gold traded",
    perDay: "/day", play: "Goblin Ledger on Google Play", tester: "Test Goblin Ledger (Android)", market: "Open the market",
    footer: "Goblin Ledger · WoW Forever auction house prices · not financial advice",
  },
  fr: {
    daily: "Récap du jour", weekly: "Récap de la semaine", monthly: "Récap du mois",
    ledger: "Ledger 100", sector: "Secteur le plus actif", raid: "Consommables de raid", volume: "Or échangé",
    perDay: "/j", play: "Goblin Ledger sur Google Play", tester: "Tester Goblin Ledger (Android)", market: "Ouvrir le marché",
    footer: "Goblin Ledger · Prix de l'hôtel des ventes de WoW Forever · pas un conseil financier",
  },
} as const;

export interface Names {
  item: (id: number) => string;
  index: (id: string) => string;
  house: string;
}

const trim = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** The period as people say it: "26 Nov 2026", "23–30 Nov 2026", "November 2026". */
export function periodLabel(r: Pick<RecapFile, "kind" | "start" | "end">, lang: Lang): string {
  const loc = lang === "fr" ? "fr-CA" : "en-GB";
  const d = (t: number, o: Intl.DateTimeFormatOptions) => new Date(t * 1000).toLocaleDateString(loc, { ...o, timeZone: "UTC" });
  if (r.kind === "monthly") {
    const s = d(r.start + 86_400, { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (r.kind === "daily") return d(r.end, { day: "numeric", month: "short", year: "numeric" });
  return `${d(r.start, { day: "numeric", month: "short" })} – ${d(r.end, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Goblin Ledger on Google Play, the app link once the app is public. */
export const PLAY_URL = "https://play.google.com/store/apps/details?id=top.kcaron.goldline";
/** The closed test's opt-in page: the app link until the kcaron.top tester page is live. */
export const OPT_IN_URL = "https://play.google.com/apps/testing/top.kcaron.goldline";
/** The kcaron.top pages, used once GOBLIN_LINKS_LIVE=1: the web app (item pages, the market) and the tester page. */
export const KCARON_WEB_URL = "https://kcaron.top/goblin-ledger/app/";
export const KCARON_TESTERS_URL: Record<Lang, string> = { en: "https://kcaron.top/goblin-ledger/testers/", fr: "https://kcaron.top/fr/goblin-ledger/testers/" };

/**
 * The post's links from the environment. GOBLIN_APP_URL and GOBLIN_WEB_URL win when set. Otherwise
 * GOBLIN_LINKS_LIVE=1 (once the kcaron.top pages are online) uses the kcaron.top tester page and web app; without it,
 * the closed test's opt-in page and no web links (item names in plain text), so nothing links to a missing page.
 */
export function linksFromEnv(env: Record<string, string | undefined>, lang: Lang): Links {
  const live = env.GOBLIN_LINKS_LIVE === "1";
  return {
    app: env.GOBLIN_APP_URL || (live ? KCARON_TESTERS_URL[lang] : OPT_IN_URL),
    web: env.GOBLIN_WEB_URL || (live ? KCARON_WEB_URL : undefined),
  };
}

/** Where the post's app link goes and what it says. */
export interface Links {
  /** The web app (GOBLIN_WEB_URL): item pages and the market. */
  web?: string;
  /**
   * The app link (GOBLIN_APP_URL): during the closed test, the "become a tester" page ("Tester Goblin Ledger
   * (Android)"); the day the app is public, the Play listing ("Goblin Ledger sur Google Play"). Default: the listing.
   */
  app?: string;
}

/** The app link and its label: the Play listing is named as such, any other page is the tester sign-up. */
export function appLink(url: string | undefined, lang: Lang): { label: string; url: string } {
  const T = TEXT[lang];
  const u = url && /^https:\/\/[^\s()]+$/.test(url) ? url : PLAY_URL;
  return { label: u.startsWith("https://play.google.com/store/apps/details") ? T.play : T.tester, url: u };
}

/** A page of the web app: an item's chart (?house=113&item=22457) or the Market tab. Null without a web address. */
export function webLink(base: string | undefined, house: number, item?: number): string | null {
  if (!base || !/^https:\/\/[^\s()]+$/.test(base)) return null;
  const u = new URL(base);
  u.searchParams.set("house", String(house));
  if (item != null) u.searchParams.set("item", String(item));
  else u.searchParams.set("tab", "overview");
  return u.toString();
}

/** Item names in a text, as Markdown links to their page (longest names first, each linked once). */
export function linkItems(text: string, items: { id: number; name: string }[], link: (id: number) => string | null): string {
  let out = text;
  const done = new Set<string>();
  for (const { id, name } of [...items].sort((a, b) => b.name.length - a.name.length)) {
    const url = link(id);
    if (!url || name.length < 3 || done.has(name)) continue;
    // The first mention outside a link made for a longer name ("Elixir of the Mongoose" before "Mongoose").
    let at = out.indexOf(name);
    while (at >= 0 && out.lastIndexOf("[", at) > out.lastIndexOf("]", at)) at = out.indexOf(name, at + 1);
    if (at < 0) continue;
    out = `${out.slice(0, at)}[${name}](${url})${out.slice(at + name.length)}`;
    done.add(name);
  }
  return out;
}

/**
 * The Discord message for one recap (webhook payload_json): short enough to read at a glance. A title with the period
 * and the house, the 2-3 sentence summary (item names linked to their page), four key numbers, and the links to the
 * app and the market. The details are the attached images (`images`: the recap pages, rendered from the app): the
 * first in the main embed, the others in embeds sharing its URL, which Discord shows as one gallery.
 */
export function buildMessage(r: RecapFile, lang: Lang, names: Names, images: readonly string[], now: number = Date.now() / 1000, summary?: { text: string; source: string }, links: Links = {}): Record<string, unknown> {
  const web = links.web;
  const app = appLink(links.app, lang);
  const T = TEXT[lang];
  const num = (n: number) => n.toLocaleString(lang === "fr" ? "fr-CA" : "en-US").replace(/ | /g, " ");
  // 1,000 gold and up: whole gold with separators ("21,220g"), else the app's short form ("2.15g", "56.3s").
  const money = (c: number) => (Math.abs(c) >= 10_000_000 ? `${num(Math.round(c / 10_000))}${lang === "fr" ? " po" : "g"}` : formatMoneyShort(c, lang));
  const pct = (v: number | null | undefined) => (v == null ? "" : ` (${pctText(v, lang, true)})`);
  const gl = r.indexes?.find(([id]) => id === "gl100");
  const color = gl == null ? COLORS.flat : gl[3] >= 0.5 ? COLORS.up : gl[3] <= -0.5 ? COLORS.down : COLORS.flat;
  const market = webLink(web, r.house);
  const itemLink = (id: number) => webLink(web, r.house, id);
  // Every item the recap lists can be linked where the summary names it.
  const listed = new Set<number>();
  for (const rows of [r.risers, r.fallers, r.highs, r.lows, r.traded, r.raid?.rows, r.flips?.rows, r.crafts?.rows]) for (const x of rows ?? []) listed.add(x[0]);
  const text = summary?.text ?? recapSummary(r, r.kind, lang, names.item, names.index, now).slice(0, 3).join(" ");
  const sector = r.indexes?.filter(([id]) => id !== "gl100").sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]))[0];
  const points = (v: number) => (lang === "fr" ? v.toFixed(2).replace(".", ",") : v.toFixed(2));
  type Field = { name: string; value: string; inline: boolean };
  const fields: Field[] = ([
    gl && { name: T.ledger, value: `**${points(gl[2])}**${pct(gl[3])}`, inline: true },
    sector && { name: T.sector, value: `**${names.index(sector[0])}**${pct(sector[3])}`, inline: true },
    r.raid && { name: T.raid, value: `**${num(r.raid.soldPerDay)}**${T.perDay}${pct(r.raid.change)}`, inline: true },
    r.volume && { name: T.volume, value: `**${money(r.volume.perDay)}**${T.perDay}${pct(r.volume.change)}`, inline: true },
  ] as (Field | null | undefined)[]).filter((f): f is Field => !!f);
  // Two by two: Discord puts 3 inline fields in a row, so an empty one closes the first row after two.
  if (fields.length === 4) fields.splice(2, 0, { name: "​", value: "​", inline: true });
  const linkLine = [`📱 [${app.label}](${app.url})`, market && `🌐 [${T.market}](${market})`].filter(Boolean).join("  ·  ");
  const embed: Record<string, unknown> = {
    author: { name: BRAND, icon_url: AVATAR_URL },
    title: trim(`${T[r.kind]} · ${periodLabel(r, lang)} · ${names.house}`, 256),
    description: trim(`${linkItems(text, [...listed].map((id) => ({ id, name: names.item(id) })), itemLink)}\n\n${linkLine}`, 4000),
    color,
    fields,
    footer: { text: T.footer },
    timestamp: new Date(r.end * 1000).toISOString(),
  };
  // The title opens the market, or the app page until the web app is online. Embeds with the same URL are drawn as
  // one embed with an image gallery (up to 4 images).
  const url = market ?? app.url;
  embed.url = url;
  if (images[0]) embed.image = { url: `attachment://${images[0]}` };
  const more = images.slice(1, 4).map((f) => ({ url, image: { url: `attachment://${f}` } }));
  return { username: BRAND, avatar_url: AVATAR_URL, embeds: [embed, ...more], allowed_mentions: { parse: [] } };
}

/** The webhook URL is only ever a Discord webhook: anything else is refused (and never printed). */
export function validWebhook(url: string | undefined): url is string {
  return !!url && /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url.trim());
}

/** Recaps to post now: per house and kind, the newest one when it is fresh and not posted yet. */
export function due(list: RecapList, house: number, posted: Record<string, string>, now: number): { kind: RecapKind; key: string }[] {
  const out: { kind: RecapKind; key: string }[] = [];
  for (const kind of KINDS) {
    const newest = list[kind][0];
    if (!newest) continue;
    const [key, , end] = newest;
    if (posted[`${house}:${kind}`] === key) continue;
    if (now - end > FRESH_HOURS[kind] * HOUR || now < end) continue;
    out.push({ kind, key });
  }
  return out;
}

async function post(url: string, payload: Record<string, unknown>, files: { name: string; png: Buffer }[]): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(files.length ? { ...payload, attachments: files.map((f, i) => ({ id: i, filename: f.name })) } : payload));
    files.forEach((f, i) => form.append(`files[${i}]`, new Blob([new Uint8Array(f.png)], { type: "image/png" }), f.name));
    const res = await fetch(`${url.trim()}?wait=true`, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return;
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(10, Number(((await res.json().catch(() => ({}))) as { retry_after?: number }).retry_after ?? 2));
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`Discord answered HTTP ${res.status}`);
  }
}

/** A recap event: house id, kind and key, checked (they come from a workflow input or a dispatch payload). */
export interface RecapEvent { house: number; kind: RecapKind; key: string }
export function parseEvent(house: unknown, kind: unknown, key: unknown): RecapEvent | null {
  const h = Number(house);
  if (!Number.isInteger(h) || h < 1 || h > 9999) return null;
  if (!KINDS.includes(kind as RecapKind)) return null;
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return { house: h, kind: kind as RecapKind, key };
}

/** Asks GitHub to run the "Post recap" workflow for one recap. */
async function dispatch(token: string, repo: string, e: RecapEvent): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "goblin-ledger-collector" },
    body: JSON.stringify({ event_type: "recap-published", client_payload: e }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status !== 204) throw new Error(`GitHub answered HTTP ${res.status}`);
}

/** On the VM: send each new, fresh recap to the workflow once. */
async function mainDispatch(dataDir: string, dry: boolean): Promise<void> {
  const token = process.env.RECAP_DISPATCH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.RECAP_DISPATCH_REPO || "kevincaron28/Trading-Wow";
  if (!dry && !token) throw new Error("no RECAP_DISPATCH_TOKEN or GITHUB_TOKEN to start the workflow");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("RECAP_DISPATCH_REPO is not owner/name");
  const houses = (process.env.DISCORD_RECAP_HOUSES ?? "113").split(",").map((x) => Number(x.trim())).filter(Number.isInteger);
  const statePath = join(dataDir, "state", "discord-posted.json");
  const posted: Record<string, string> = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as Record<string, string>) : {};
  const now = Date.now() / 1000;
  let failed = 0;
  for (const house of houses) {
    const listPath = join(dataDir, "recap", String(house), "list.json");
    if (!existsSync(listPath)) continue;
    const list = JSON.parse(readFileSync(listPath, "utf8")) as RecapList;
    for (const { kind, key } of due(list, house, posted, now)) {
      if (dry) {
        console.log(`discord (dry run): would start the workflow for ${house} ${kind} ${key}`);
        continue;
      }
      try {
        await dispatch(token!, repo, { house, kind, key });
        posted[`${house}:${kind}`] = key;
        console.log(`discord: workflow started for ${house} ${kind} ${key}`);
      } catch (error) {
        failed++;
        console.error(`discord: ${house} ${kind} ${key} not sent (${error instanceof Error ? error.message : "error"}); retried next run`);
      }
    }
  }
  if (!dry) {
    mkdirSync(join(dataDir, "state"), { recursive: true });
    writeFileSync(statePath, JSON.stringify(posted));
  }
  if (failed) process.exit(1);
}

/** The value after a --flag in the arguments. */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** On GitHub Actions: the summary, the message and the post, with the rendered pages. */
async function mainPost(dataDir: string, dry: boolean): Promise<void> {
  const e = parseEvent(arg("house"), arg("kind"), arg("key"));
  if (!e) throw new Error("usage: discord-recap.ts post <dataDir> --house 113 --kind daily --key 2026-11-26 --images <dir> [--dry-run]");
  const imageDir = arg("images") ?? "recap-images";
  const url = process.env.DISCORD_RECAP_WEBHOOK;
  if (!dry && !validWebhook(url)) throw new Error("DISCORD_RECAP_WEBHOOK is not set to a Discord webhook URL (https://discord.com/api/webhooks/...)");
  const lang: Lang = process.env.DISCORD_RECAP_LANG === "en" ? "en" : "fr";
  const read = <T,>(...path: string[]) => JSON.parse(readFileSync(join(dataDir, ...path), "utf8")) as T;
  const recap = read<RecapFile>("recap", String(e.house), `${e.kind}-${e.key}.json`);
  const meta = read<{ houses: { id: number; realm: string; faction: string }[] }>("meta.json");
  const items = read<Record<string, [string, string, number]>>("items.json");
  const indexMeta = existsSync(join(dataDir, "index", "meta.json")) ? read<{ indexes: { id: string; name: Record<Lang, string> }[] }>("index", "meta.json") : { indexes: [] };
  type IndexJson = { changes?: { at: number; kind: "monthly" | "quarterly"; added: [number, number][]; removed: [number, number][] }[] };
  const indexes = existsSync(join(dataDir, "index", `${e.house}.json`)) ? read<{ indexes: Record<string, IndexJson> }>("index", `${e.house}.json`).indexes : {};
  const changes: CardChangeLike[] = Object.entries(indexes).flatMap(([id, x]) => (x.changes ?? []).map((c) => ({ index: id, at: c.at, kind: c.kind, added: c.added.map(([i]) => i), removed: c.removed.map(([i]) => i) })));
  const info = meta.houses.find((h) => h.id === e.house);
  const names: Names = {
    // Item names stay in English in every language (what players type in the auction house).
    item: (id) => items[id]?.[0] ?? `#${id}`,
    index: (id) => indexMeta.indexes.find((d) => d.id === id)?.name[lang] ?? id,
    house: info ? `${REALMS[info.realm]?.[lang] ?? info.realm} ${FACTIONS[info.faction]?.[lang] ?? info.faction}` : `#${e.house}`,
  };
  const now = Date.now() / 1000;
  // The market summary: the model's text when it passes the accuracy guard, else the template (never unchecked).
  const summary = await summarize(recap, { ...names, catalog: Object.values(items).map((r) => r[0]) }, lang, changes, aiConfigFromEnv(), { now: Math.max(now, recap.end) });
  console.log(`discord: ${e.house} ${e.kind} ${e.key} summary from ${summary.source}${summary.problems.length ? ` (${summary.problems.slice(0, 4).join("; ")})` : ""}`);
  // The rendered pages, in order (render-recap.mjs names them <house>-<kind>-<key>-<n>-<page>.png). None: text only.
  const prefix = `${e.house}-${e.kind}-${e.key}-`;
  const files = existsSync(imageDir) ? readdirSync(imageDir).filter((f) => f.startsWith(prefix) && f.endsWith(".png")).sort().slice(0, 4).map((name) => ({ name, png: readFileSync(join(imageDir, name)) })) : [];
  if (!files.length) console.error(`discord: no recap images in ${imageDir}; posting the text only`);
  if (files.reduce((n, f) => n + f.png.length, 0) > MAX_UPLOAD) throw new Error("the images are over Discord's 10 MB upload limit");
  const payload = buildMessage(recap, lang, names, files.map((f) => f.name), now, summary, linksFromEnv(process.env, lang));
  if (dry) {
    mkdirSync(imageDir, { recursive: true });
    writeFileSync(join(imageDir, `${prefix}message.json`), JSON.stringify(payload, null, 2));
    writeFileSync(join(imageDir, `${prefix}summary.json`), JSON.stringify(summary, null, 2));
    console.log(`discord (dry run): ${e.house} ${e.kind} ${e.key} message written to ${imageDir}`);
    return;
  }
  await post(url!, payload, files);
  console.log(`discord: posted ${e.house} ${e.kind} ${e.key} (${files.length} images)`);
}

async function main(): Promise<void> {
  const [mode, dataDir] = process.argv.slice(2);
  const dry = process.argv.includes("--dry-run");
  if (mode === "dispatch" && dataDir) return mainDispatch(dataDir, dry);
  if (mode === "post" && dataDir) return mainPost(dataDir, dry);
  throw new Error("usage: node collector/discord-recap.ts dispatch <dataDir> | post <dataDir> --house --kind --key --images <dir> [--dry-run]");
}

if (process.argv[1]?.endsWith("discord-recap.ts")) main().catch((error) => {
  // Never print the webhook URL or a token: only the message.
  console.error(`discord: ${error instanceof Error ? error.message.replace(/https:\/\/\S+/g, "<url>") : "error"}`);
  process.exit(1);
});
