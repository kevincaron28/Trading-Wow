/**
 * Post the newest daily, weekly and monthly recaps to a Discord channel through a webhook, as Goblin Ledger.
 *
 *   node collector/discord-recap.ts <dataDir> [--dry-run]     (run by collector/publish.sh after the R2 publish)
 *
 * Settings (environment, /etc/goblin-ledger/collector.env on the VM; docs/COLLECTOR_VM.md "Discord recaps"):
 * - DISCORD_RECAP_WEBHOOK: the channel's webhook URL. Unset: nothing is posted. It is a secret: never printed, never
 *   committed, never sent anywhere but Discord.
 * - DISCORD_RECAP_HOUSES: auction houses to post, comma separated (default 113, PvP Horde).
 * - DISCORD_RECAP_LANG: fr (default) or en.
 *
 * Each recap is posted once, by the first run after its period ends (about 13:30 UTC; the weekly one on Mondays, the
 * monthly one on the 1st): an embed with the notes and the recap cards (collector/recap-card.ts, one image per page,
 * each in its own embed); without the card renderer, text fields and a chart of the Ledger 100. What was posted is kept in
 * state/discord-posted.json (on the VM, never published). A recap more than FRESH_HOURS old is not posted: after a
 * long outage the channel does not get a burst of old recaps. Branding: Goblin Ledger only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatMoneyShort } from "../src/lib/money.ts";
import { pctText, recapSummary, type RecapFile, type RecapKind, type RecapList } from "../src/lib/weekly.ts";
import type { Lang } from "../src/lib/i18n.ts";
import { lineChartPng } from "./png-chart.ts";
import { renderCards, type CardChange } from "./recap-card.ts";
import { aiConfigFromEnv, summarize } from "./recap-ai.ts";

const HOUR = 3_600;
export const BRAND = "Goblin Ledger";
/** The app icon, from the public repository. */
export const AVATAR_URL = "https://raw.githubusercontent.com/kevincaron28/Trading-Wow/main/public/icon-512.png";
const COLORS = { up: 0x3fb950, down: 0xf85149, flat: 0xd4a72c };
/** A recap older than this is not posted any more (hours after its end). */
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
  if (market) embed.url = market;
  if (images[0]) embed.image = { url: `attachment://${images[0]}` };
  // Embeds with the same URL are drawn as one embed with an image gallery (up to 4 images).
  const more = market ? images.slice(1, 4).map((f) => ({ url: market, image: { url: `attachment://${f}` } })) : images.slice(1, 10).map((f) => ({ color, image: { url: `attachment://${f}` } }));
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

async function main(): Promise<void> {
  const dataDir = process.argv[2];
  if (!dataDir) throw new Error("usage: node collector/discord-recap.ts <dataDir> [--dry-run]");
  const dry = process.argv.includes("--dry-run");
  const url = process.env.DISCORD_RECAP_WEBHOOK;
  if (!dry && !url) return; // not configured: nothing to do
  if (!dry && !validWebhook(url)) throw new Error("DISCORD_RECAP_WEBHOOK is not a Discord webhook URL (https://discord.com/api/webhooks/...)");
  const lang: Lang = process.env.DISCORD_RECAP_LANG === "en" ? "en" : "fr";
  const houses = (process.env.DISCORD_RECAP_HOUSES ?? "113").split(",").map((x) => Number(x.trim())).filter(Number.isInteger);
  const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8")) as { houses: { id: number; realm: string; faction: string }[] };
  const items = JSON.parse(readFileSync(join(dataDir, "items.json"), "utf8")) as Record<string, [string, string, number]>;
  const indexMeta = existsSync(join(dataDir, "index", "meta.json")) ? (JSON.parse(readFileSync(join(dataDir, "index", "meta.json"), "utf8")) as { indexes: { id: string; name: Record<Lang, string> }[] }) : { indexes: [] };
  const statePath = join(dataDir, "state", "discord-posted.json");
  const posted: Record<string, string> = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as Record<string, string>) : {};
  const now = Date.now() / 1000;
  const ai = aiConfigFromEnv();
  let failed = 0;
  for (const house of houses) {
    const listPath = join(dataDir, "recap", String(house), "list.json");
    if (!existsSync(listPath)) continue;
    const info = meta.houses.find((h) => h.id === house);
    const names: Names & { quality: (id: number) => number } = {
      // Item names stay in English in every language (what players type in the auction house).
      item: (id) => items[id]?.[0] ?? `#${id}`,
      quality: (id) => Number(items[id]?.[2] ?? 1),
      index: (id) => indexMeta.indexes.find((d) => d.id === id)?.name[lang] ?? id,
      house: info ? `${REALMS[info.realm]?.[lang] ?? info.realm} ${FACTIONS[info.faction]?.[lang] ?? info.faction}` : `#${house}`,
    };
    const list = JSON.parse(readFileSync(listPath, "utf8")) as RecapList;
    for (const { kind, key } of due(list, house, posted, dry ? list[KINDS[0]!][0]?.[2] ?? now : now)) {
      const recap = JSON.parse(readFileSync(join(dataDir, "recap", String(house), `${kind}-${key}.json`), "utf8")) as RecapFile;
      const indexFile = join(dataDir, "index", `${house}.json`);
      type IndexJson = { hourly: [number, number][]; changes?: { at: number; kind: "monthly" | "quarterly"; added: [number, number][]; removed: [number, number][] }[] };
      const indexes = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as { indexes: Record<string, IndexJson> }).indexes : {};
      const series = Object.fromEntries(Object.entries(indexes).map(([id, x]) => [id, x.hourly]));
      const changes: CardChange[] = Object.entries(indexes).flatMap(([id, x]) => (x.changes ?? []).map((c) => ({ index: id, at: c.at, kind: c.kind, added: c.added.map(([i]) => i), removed: c.removed.map(([i]) => i) })));
      // The market summary: the model's text when it passes the accuracy guard, else the template (never unchecked).
      const catalog = Object.values(items).map((r) => r[0]);
      const summary = await summarize(recap, { ...names, catalog }, lang, changes, ai, { now: dry ? recap.end + 1_800 : now });
      console.log(`discord: ${house} ${kind} ${key} summary from ${summary.source}${summary.problems.length ? ` (${summary.problems.slice(0, 4).join("; ")})` : ""}`);
      let files: { name: string; png: Buffer }[] = [];
      try {
        files = (renderCards({ recap, lang, names, series, changes, now, summary: summary.text }) ?? []).map((png, i) => ({ name: `card-${i + 1}.png`, png }));
      } catch (error) {
        console.error(`discord: cards not drawn (${error instanceof Error ? error.message : "error"}); posting the plain chart`);
      }
      if (!files.length) {
        const inPeriod = (series.gl100 ?? []).filter(([h]) => h >= recap.start / HOUR && h <= recap.end / HOUR).map(([, v]) => v);
        const png = lineChartPng(inPeriod, 800, 260, inPeriod[0]);
        if (png) files = [{ name: "chart.png", png }];
      }
      const payload = buildMessage(recap, lang, names, files.map((f) => f.name), now, summary, { web: process.env.GOBLIN_WEB_URL, app: process.env.GOBLIN_APP_URL });
      if (dry) {
        mkdirSync(join(dataDir, "state"), { recursive: true });
        writeFileSync(join(dataDir, "state", `discord-${house}-${kind}.json`), JSON.stringify(payload, null, 2));
        writeFileSync(join(dataDir, "state", `discord-${house}-${kind}-summary.json`), JSON.stringify(summary, null, 2));
        for (const f of files) writeFileSync(join(dataDir, "state", `discord-${house}-${kind}-${f.name}`), f.png);
        console.log(`discord (dry run): ${house} ${kind} ${key} written to state/`);
        continue;
      }
      try {
        await post(url!, payload, files);
        posted[`${house}:${kind}`] = key;
        console.log(`discord: posted ${house} ${kind} ${key}`);
      } catch (error) {
        failed++;
        console.error(`discord: ${house} ${kind} ${key} not posted (${error instanceof Error ? error.message : "error"}); retried next run`);
      }
    }
  }
  if (!dry) {
    mkdirSync(join(dataDir, "state"), { recursive: true });
    writeFileSync(statePath, JSON.stringify(posted));
  }
  if (failed) process.exit(1);
}

if (process.argv[1]?.endsWith("discord-recap.ts")) main().catch((error) => {
  // Never print the webhook URL: only the message.
  console.error(`discord: ${error instanceof Error ? error.message.replace(/https:\/\/\S+/g, "<webhook>") : "error"}`);
  process.exit(1);
});
