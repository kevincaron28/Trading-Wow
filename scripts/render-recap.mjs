#!/usr/bin/env node
/**
 * Renders the recap share pages (recap.html, src/recap/) to PNG with headless Chromium (Playwright).
 *
 *   npm run build
 *   node scripts/render-recap.mjs --house 113 --kind daily --key 2026-11-26 --lang fr --out recap-images
 *
 * Serves `dist/` on 127.0.0.1 and screenshots one 1200 px image per page (overview, movers, raid, desk) into --out as
 * <house>-<kind>-<key>-<n>-<page>.png. The page reads the data the build was made for (VITE_DATA_R2, R2 by default);
 * --data <dir> also serves a local data folder on the next port (build with VITE_DATA_R2 and VITE_DATA_BASE set to
 * it, for mockups and tests). A page that fails to load stops the run with an error.
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const PAGES = ["overview", "movers", "raid", "desk"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

function args(argv) {
  const o = { dist: "dist", port: 4780, house: "113", kind: "daily", lang: "fr", out: "recap-images", pages: PAGES.join(",") };
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!o.key) throw new Error("--key is required (for example 2026-11-26)");
  return o;
}

/** A static file server for one folder, with CORS (the page fetches data from the other port). */
function serve(root, port) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    const file = join(base, path || "index.html");
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      if (!file.startsWith(base) || !statSync(file).isFile()) throw new Error("not a file");
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

const o = args(process.argv.slice(2));
const servers = [await serve(o.dist, Number(o.port))];
if (o.data) servers.push(await serve(o.data, Number(o.port) + 1));
mkdirSync(o.out, { recursive: true });
const browser = await chromium.launch();
const written = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error(`page error: ${e.message}`));
  const pages = o.pages.split(",");
  for (const [i, name] of pages.entries()) {
    const url = `http://127.0.0.1:${o.port}/recap.html?house=${o.house}&kind=${o.kind}&key=${o.key}&lang=${o.lang}&page=${name}`;
    await page.goto(url);
    await page.waitForSelector("body[data-ready]", { timeout: 30_000 });
    if ((await page.getAttribute("body", "data-ready")) !== "1") throw new Error(`${name}: the recap did not load (${url})`);
    const file = join(o.out, `${o.house}-${o.kind}-${o.key}-${i + 1}-${name}.png`);
    writeFileSync(file, await page.locator(".share").screenshot({ type: "png" }));
    written.push(file);
  }
} finally {
  await browser.close();
  for (const s of servers) s.close();
}
console.log(written.join("\n"));
