// Drives the debug app on a CI emulator: node android-smoke.mjs <apk> <out folder>
// Real keyboard, real Android Back and real share window; the page itself is read over the WebView's debugging port.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [apk, out] = process.argv.slice(2);
const APP = "top.kcaron.goldline";
mkdirSync(out, { recursive: true });
const lines = [];
let failed = 0;
const note = (text) => { lines.push(text); console.log(text); writeFileSync(join(out, "results.txt"), lines.join("\n") + "\n"); };
const check = (ok, what) => { if (!ok) failed++; note(`${ok ? "PASS" : "FAIL"} ${what}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const shell = (cmd) => adb("shell", cmd);
const shot = (name) => writeFileSync(join(out, `${name}.png`), execFileSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 }));
const top = () => (shell("dumpsys activity activities").match(/(?:topResumedActivity|mResumedActivity)[=:].*?\s([\w.]+\/[\w.$]+)/) ?? [])[1] ?? "";
const inApp = () => top().startsWith(`${APP}/`);
const back = async (wait = 900) => { shell("input keyevent 4"); await sleep(wait); };
const imeShown = () => /mInputShown=true/.test(shell("dumpsys input_method"));

let socket;
let nextId = 0;
const waiting = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${method} timed out`)); }, 20_000);
  waiting.set(id, (message) => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
  socket.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
async function connect() {
  for (let i = 0; i < 60; i++) {
    const pid = shell(`pidof ${APP} || true`).trim();
    if (pid && shell("cat /proc/net/unix").includes(`webview_devtools_remote_${pid}`)) {
      adb("forward", "tcp:9222", `localabstract:webview_devtools_remote_${pid}`);
      const pages = await fetch("http://127.0.0.1:9222/json").then((r) => r.json()).catch(() => []);
      const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
      if (page) {
        socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("socket failed")); });
        socket.onmessage = (e) => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); waiting.delete(m.id); };
        return;
      }
    }
    await sleep(2000);
  }
  throw new Error("the app's page never became reachable");
}
const q = JSON.stringify;
const exists = (selector) => js(`!!document.querySelector(${q(selector)})`);
async function until(expression, what, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await js(expression)) return;
    await sleep(500);
  }
  throw new Error(`waited too long for ${what}`);
}
const click = async (selector, index = 0, wait = 700) => {
  await js(`(() => { const e = [...document.querySelectorAll(${q(selector)})].at(${index}); if (!e) throw new Error("no element " + ${q(selector)}); e.click(); })()`);
  await sleep(wait);
};
const clickText = async (selector, text, wait = 900) => {
  await js(`(() => { const e = [...document.querySelectorAll(${q(selector)})].find((x) => x.textContent.trim().startsWith(${q(text)})); if (!e) throw new Error("no button " + ${q(text)}); e.scrollIntoView({ block: "center" }); e.click(); })()`);
  await sleep(wait);
};

/** Where the web page sits on the screen, in device pixels. */
function webViewOrigin() {
  for (let i = 0; i < 5; i++) {
    try {
      shell("uiautomator dump /sdcard/ui.xml");
      const m = shell("cat /sdcard/ui.xml").match(/class="android\.webkit\.WebView"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (m) return { x: Number(m[1]), y: Number(m[2]), bottom: Number(m[4]) };
    } catch { /* the screen was still moving */ }
  }
  throw new Error("the WebView was not found on screen");
}

/** Tap a field with a real touch, then check that the keyboard opened and left the field in view. */
async function keyboard(selector, name) {
  const before = await js("window.innerHeight");
  const origin = webViewOrigin();
  const at = await js(`(() => { const e = document.querySelector(${q(selector)}); e.blur(); e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: devicePixelRatio }; })()`);
  shell(`input tap ${Math.round(origin.x + at.x * at.dpr)} ${Math.round(origin.y + at.y * at.dpr)}`);
  await sleep(3500);
  const state = await js(`(() => { const e = document.querySelector(${q(selector)}); const r = e.getBoundingClientRect(); const bar = document.querySelector(".tabbar"); return { focused: document.activeElement === e, height: window.innerHeight, top: r.top, bottom: r.bottom, flag: document.documentElement.hasAttribute("data-keyboard"), tabbar: bar ? getComputedStyle(bar).display : "none" }; })()`);
  shot(`${name}-keyboard`);
  check(imeShown(), `${name}: the on-screen keyboard is open`);
  check(state.focused, `${name}: the field has the focus`);
  check(before - state.height > 150, `${name}: the page shrinks for the keyboard (${before} to ${state.height} px)`);
  check(state.top >= 0 && state.bottom <= state.height + 1, `${name}: the field is in view (${Math.round(state.top)} to ${Math.round(state.bottom)} of ${state.height})`);
  check(state.flag && state.tabbar === "none", `${name}: the tab bar is hidden while typing`);
  await back(2000);
  check(!imeShown() && inApp(), `${name}: Back closes only the keyboard`);
  await until(`window.innerHeight >= ${before - 2}`, "the page to grow back", 10_000);
  await js("document.activeElement?.blur()");
  await sleep(600);
}

async function chooser(name, open) {
  await open();
  await sleep(3000);
  const activity = top();
  shot(`${name}`);
  check(/chooser|resolver/i.test(activity), `${name}: Android's share window opened (${activity})`);
  await back(1500);
  check(inApp(), `${name}: Back returns to the app`);
}

async function main() {
  adb("install", "-r", "-g", apk);
  shell("settings put secure show_ime_with_hard_keyboard 1");
  note(`Android ${shell("getprop ro.build.version.release").trim()}, ${shell("wm size").trim()}`);
  shell("logcat -c");
  shell(`am start -W -n ${APP}/.MainActivity`);
  await connect();
  await until(`!!document.querySelector(".onboarding")`, "the first-run walkthrough");
  await sleep(2500);

  shot("tour-1");
  await clickText(".onboarding button", "Next");
  shot("tour-2");
  await clickText(".onboarding button", "Next");
  const third = await js(`document.querySelector(".onboarding").textContent`);
  await back();
  check(inApp() && (await js(`document.querySelector(".onboarding").textContent`)) !== third, "tour: Back goes one step back");
  await clickText(".onboarding button", "Next");
  shot("tour-3");
  await clickText(".onboarding button", "Next");
  shot("tour-4");
  await clickText(".onboarding button", "Start", 2000);
  check(!(await exists(".onboarding")), "tour: Start closes it");

  // Search.
  await click(".tabbar button", 1, 1500);
  await click(".topbar-actions .icon-btn", 1, 1200);
  await keyboard(".search-bar input", "search");
  await click(".search-bar .icon-btn", 0);

  // Chart: alert field and the two ways to share.
  await click(".tabbar button", 2, 1000);
  await until(`!!document.querySelector(".symbol-price .money")`, "prices on the chart");
  await sleep(3000);
  await click(".topbar-actions .icon-btn", 2, 1200);
  await keyboard(".sheet input", "alert");
  await click(".sheet-head .icon-btn", 0);
  await click(".topbar-actions .icon-btn", 1);
  shot("chart-share-sheet");
  await chooser("share-item-link", () => click(".sheet .menu-list button", 0, 200));
  await sleep(500);
  if (!(await exists(".sheet"))) await click(".topbar-actions .icon-btn", 1);
  await chooser("share-chart-picture", () => click(".sheet .menu-list button", 1, 3000));
  if (await exists(".sheet")) await click(".sheet-head .icon-btn", 0);

  // Settings and its pages.
  await click(".tabbar button", -1, 1200);
  await js(`[...document.querySelectorAll(".menu-list button")].find((x) => x.textContent.includes("Help & FAQ")).scrollIntoView({ block: "center" })`);
  await sleep(800);
  shot("settings");
  await clickText(".menu-list button", "Help & FAQ");
  shot("help");
  await back();
  check(inApp() && !(await exists(".page")), "help: Back closes the page");
  await clickText(".menu-list button", "Privacy policy");
  shot("privacy");
  check(top().startsWith(`${APP}/`) && (await exists(".policy h2")), "privacy: the policy is shown inside the app");
  await back();
  check(inApp() && !(await exists(".page")), "privacy: Back closes the page");
  await clickText(".menu-list button", "Report a problem");
  await keyboard(".feedback textarea", "feedback");
  shot("feedback");
  await back();
  check(inApp() && !(await exists(".page")), "feedback: Back closes the page");
  await chooser("share-app", () => clickText(".menu-list button", "Share this app", 200));
  const rate = await js(`[...document.querySelectorAll(".menu-list button")].some((x) => x.textContent.includes("Rate this app"))`);
  check(rate, "settings: Rate this app is listed");

  // The rating plugin answers (Play cannot show its window to an app that Play did not install).
  const channel = await js(`window.Capacitor.Plugins.Distribution.getChannel().then((r) => r.channel)`);
  check(channel === "play", `review: this is the ${channel} build`);
  const review = await js(`Promise.race([window.Capacitor.Plugins.Distribution.requestReview().then(() => "accepted", (e) => "refused: " + e.message), new Promise((r) => setTimeout(() => r("no answer in 10 s"), 10000))])`);
  note(`INFO review request: ${review}`);
  check(!/not implemented/i.test(review), "review: the native call exists");
  await sleep(1500);
  if (!inApp()) await back();

  // Leaving the app.
  await click(".tabbar button", 0, 1500);
  await back(600);
  const hint = await exists(".snackbar");
  shot("back-to-exit");
  check(inApp() && hint, "exit: first Back shows the hint and stays");
  await sleep(2800);
  await back(600);
  check(inApp(), "exit: Back after the hint expired only shows it again");
  await sleep(2800);
  shell("input keyevent 4; sleep 0.5; input keyevent 4");
  await sleep(2000);
  check(!inApp(), `exit: two quick Backs leave the app (now ${top()})`);
}

try {
  await main();
} catch (e) {
  check(false, `stopped: ${e.message}`);
  try { shot("stopped"); } catch { /* no screen */ }
}
const crashes = adb("logcat", "-d", "-b", "crash").trim();
check(!crashes.includes(APP), "no crash of the app in the log");
if (crashes) writeFileSync(join(out, "crash.txt"), crashes.slice(-20_000));
note(`${failed} failure(s)`);
socket?.close();
process.exit(failed ? 1 : 0);
