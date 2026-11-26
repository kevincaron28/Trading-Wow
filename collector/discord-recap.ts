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
const ROWS = 5;

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
    indexes: "Indexes", risers: "Top risers", fallers: "Top fallers", traded: "Most traded", flips: "Best flips (5+ sold a day)",
    crafts: "Crafting margins", raid: "Raid consumables", highs: "New highs", lows: "New lows",
    perDay: "/day", soldDay: "sold/day", vs: "vs", none: "None", footer: "Goblin Ledger · WoW Forever auction house prices · not financial advice",
    then: "then", now: "now",
  },
  fr: {
    daily: "Récap du jour", weekly: "Récap de la semaine", monthly: "Récap du mois",
    indexes: "Indices", risers: "Plus fortes hausses", fallers: "Plus fortes baisses", traded: "Les plus échangés", flips: "Meilleures reventes (5+ ventes/jour)",
    crafts: "Marges d'artisanat", raid: "Consommables de raid", highs: "Nouveaux sommets", lows: "Nouveaux creux",
    perDay: "/jour", soldDay: "ventes/jour", vs: "contre", none: "Aucun", footer: "Goblin Ledger · Prix de l'hôtel des ventes de WoW Forever · pas un conseil financier",
    then: "alors", now: "maintenant",
  },
} as const;

export interface Names {
  item: (id: number) => string;
  index: (id: string) => string;
  house: string;
}

const trim = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const field = (name: string, lines: string[] | null) => (lines && lines.length ? { name, value: trim(lines.join("\n"), 1024), inline: false } : null);

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

/**
 * The Discord message for one recap (webhook payload_json). `images` are the attached files: the recap cards
 * (card-1.png, card-2.png...: the first embed carries the title, the notes and card 1, then one embed per card), or
 * the plain chart.png when the cards cannot be drawn, with the text fields instead.
 */
export function buildMessage(r: RecapFile, lang: Lang, names: Names, images: readonly string[], now: number = Date.now() / 1000, summary?: { text: string; source: string }): Record<string, unknown> {
  const cards = images.length > 0 && images[0] !== "chart.png";
  const T = TEXT[lang];
  const num = (n: number) => n.toLocaleString(lang === "fr" ? "fr-CA" : "en-US").replace(/ | /g, " ");
  // 1,000 gold and up: whole gold with separators ("21,220g"), else the app's short form ("2.15g", "56.3s").
  const money = (c: number) => (Math.abs(c) >= 10_000_000 ? `${num(Math.round(c / 10_000))}${lang === "fr" ? "po" : "g"}` : formatMoneyShort(c, lang));
  const pct = (v: number | null | undefined) => (v == null ? "–" : pctText(v, lang, true));
  const notes = recapSummary(r, r.kind, lang, names.item, names.index, now);
  const gl = r.indexes?.find(([id]) => id === "gl100");
  const color = gl == null ? COLORS.flat : gl[3] >= 0.5 ? COLORS.up : gl[3] <= -0.5 ? COLORS.down : COLORS.flat;
  const rows = <R,>(list: R[] | null | undefined, fn: (x: R) => string) => (list == null ? null : list.length ? list.slice(0, ROWS).map(fn) : [T.none]);
  const idx = r.indexes ? [...r.indexes].sort((a, b) => (a[0] === "gl100" ? -1 : b[0] === "gl100" ? 1 : Math.abs(b[3]) - Math.abs(a[3]))).slice(0, 6) : null;
  const fields = [
    field(T.indexes, idx && idx.map(([id, , b, c]) => `**${names.index(id)}** ${b.toFixed(2)} (${pct(c)})`)),
    field(T.risers, rows(r.risers, (x) => `${names.item(x[0])}: ${money(x[1])} → ${money(x[2])} (**${pct(x[3])}**)`)),
    field(T.fallers, rows(r.fallers, (x) => `${names.item(x[0])}: ${money(x[1])} → ${money(x[2])} (**${pct(x[3])}**)`)),
    field(T.traded, rows(r.traded, (x) => `${names.item(x[0])}: ~${money(x[1])}${T.perDay} · ${num(x[2])} ${T.soldDay}`)),
    field(T.flips, rows(r.flips?.rows, (x) => `${names.item(x[0])}: ${money(x[2])} → ${money(x[3])} (+${money(x[4])})${x[8] != null ? ` · ${num(x[8])} ${T.soldDay}` : ""}`)),
    field(T.crafts, rows(r.crafts?.rows, (x) => `${names.item(x[0])}: ${money(x[2])} ${T.then}${x[4] != null ? `, ${money(x[4])} ${T.now} (${pct(x[5])})` : ""}`)),
    field(T.raid, r.raid ? [
      `${num(r.raid.soldPerDay)} ${T.soldDay}${r.raid.change != null ? ` (${pct(r.raid.change)} ${T.vs} ${num(r.raid.prevSoldPerDay!)})` : ""}`,
      ...r.raid.rows.slice(0, ROWS).map((x) => `${names.item(x[0])}: ${num(x[1])} ${T.soldDay} · ${money(x[2])}${x[3] != null ? ` (${pct(x[3])})` : ""}`),
    ] : null),
    field(T.highs, r.highs && r.highs.length ? r.highs.slice(0, 3).map((x) => `${names.item(x[0])}: ${money(x[1])} (${pct((x[1] / x[3] - 1) * 100)})`) : null),
    field(T.lows, r.lows && r.lows.length ? r.lows.slice(0, 3).map((x) => `${names.item(x[0])}: ${money(x[1])} (${pct((x[1] / x[3] - 1) * 100)})`) : null),
  ].filter((f): f is NonNullable<typeof f> => f != null);
  const embed: Record<string, unknown> = {
    author: { name: BRAND, icon_url: AVATAR_URL },
    title: trim(`${T[r.kind]} · ${periodLabel(r, lang)} · ${names.house}`, 256),
    // A checked AI summary first, then the notes; the template summary is the notes themselves.
    description: trim(summary && summary.source !== "template" ? `${summary.text}\n\n${notes.map((l) => `• ${l}`).join("\n")}` : notes.join("\n"), 4000),
    color,
    fields: cards ? [] : fields,
    footer: { text: T.footer },
    timestamp: new Date(r.end * 1000).toISOString(),
  };
  if (images[0]) embed.image = { url: `attachment://${images[0]}` };
  // Discord's limit is 6000 characters for all embeds of a message: drop the last fields until it fits.
  const size = () => JSON.stringify([embed.title, embed.description, (embed.fields as unknown[]), embed.footer]).length;
  while (size() > 5800 && (embed.fields as unknown[]).length) (embed.fields as unknown[]).pop();
  // Discord takes up to 10 embeds a message: each further card is its own embed, so it shows full width.
  const more = cards ? images.slice(1, 10).map((f) => ({ color, image: { url: `attachment://${f}` } })) : [];
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
      item: (id) => (lang === "fr" ? items[id]?.[1] || items[id]?.[0] : items[id]?.[0]) ?? `#${id}`,
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
      const catalog = Object.values(items).map((r) => (lang === "fr" ? r[1] || r[0] : r[0]));
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
      const payload = buildMessage(recap, lang, names, files.map((f) => f.name), now, summary);
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
