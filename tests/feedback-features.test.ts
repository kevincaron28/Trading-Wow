/** The features asked for after the testers' report: Back, keyboard, privacy, help, feedback, rating and sharing. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXIT_WINDOW_MS, exitOnBack, handleBack, onBack } from "../src/app/back";
import { keyboardOpen, outOfSight } from "../src/app/keyboard";
import { ADDS_BEFORE_REVIEW, reviewDue } from "../src/app/rate";
import { copyToList, getState, linkState, toggleInList } from "../src/app/store";
import { compareVersions } from "../src/app/updates";
import { HELP } from "../src/data/help";
import { DEAL_STEPS, MIN_SAVING, REPORT_AGAIN_S } from "../src/lib/dealAlerts";
import { deviceFrom, feedbackMessage } from "../src/lib/feedback";
import { appPageUrl, itemUrl, issueUrl, mailUrl } from "../src/lib/links";
import { blocks, spans } from "../src/lib/markdown";
import { formatMoney } from "../src/lib/money";
import { quickFlips } from "../src/lib/overview";
import { SUPPORT_EMAIL, policyBlocks } from "../src/lib/policy";
import { houseCut, toQuote } from "../src/lib/quotes";

describe("Android Back on the main screen", () => {
  it("warns first, and leaves on a second press within the window", () => {
    expect(exitOnBack(10_000)).toBe(false);
    expect(exitOnBack(10_000 + EXIT_WINDOW_MS)).toBe(true);
    // Having left, the next press warns again; a late second press does too.
    expect(exitOnBack(20_000)).toBe(false);
    expect(exitOnBack(20_001 + EXIT_WINDOW_MS)).toBe(false);
  });

  it("forgets the warning once Back closes something else", () => {
    expect(exitOnBack(100_000)).toBe(false);
    let closed = 0;
    onBack(() => closed++);
    expect(handleBack()).toBe(true);
    expect(closed).toBe(1);
    expect(exitOnBack(100_500)).toBe(false);
  });
});

describe("keyboard", () => {
  it("is open when a field has the focus and the page lost much of its height", () => {
    expect(keyboardOpen(450, 800, true)).toBe(true);
    expect(keyboardOpen(450, 800, false)).toBe(false);
    expect(keyboardOpen(740, 800, true)).toBe(false);
  });

  it("knows when the field is out of sight", () => {
    expect(outOfSight({ top: 100, bottom: 140 }, 450)).toBe(false);
    expect(outOfSight({ top: 430, bottom: 470 }, 450)).toBe(true);
    expect(outOfSight({ top: -20, bottom: 20 }, 450)).toBe(true);
  });

  it("shrinks the page on Android", () => {
    expect(readFileSync("android/app/src/main/AndroidManifest.xml", "utf8")).toContain('android:windowSoftInputMode="adjustResize"');
  });
});

describe("rating", () => {
  const s = { onboarded: true, reviewAsked: false, itemsAdded: ADDS_BEFORE_REVIEW };

  it("is asked after the third item added in this session, once, and never at launch", () => {
    expect(reviewDue(s, 2)).toBe(true);
    expect(reviewDue(s, 3)).toBe(false); // The app just opened.
    expect(reviewDue({ ...s, itemsAdded: 2 }, 1)).toBe(false);
    expect(reviewDue({ ...s, reviewAsked: true }, 2)).toBe(false);
    expect(reviewDue({ ...s, onboarded: false }, 2)).toBe(false);
  });

  it("counts items the user adds, not removals or moves", () => {
    const [first, second] = getState().watchlists;
    const start = getState().itemsAdded;
    toggleInList(first!.id, 900_001);
    expect(getState().itemsAdded).toBe(start + 1);
    toggleInList(first!.id, 900_001); // Removed again.
    expect(getState().itemsAdded).toBe(start + 1);
    toggleInList(first!.id, 900_002);
    copyToList(first!.id, second!.id, 900_002);
    expect(getState().itemsAdded).toBe(start + 3);
    copyToList(second!.id, first!.id, 900_002, true); // Moved.
    expect(getState().itemsAdded).toBe(start + 3);
  });

  it("uses Google Play's review library in the Play build only", () => {
    const gradle = readFileSync("android/app/build.gradle", "utf8");
    expect(gradle).toContain('playImplementation "com.google.android.play:review:');
    expect(readFileSync("android/app/src/play/java/top/kcaron/goldline/DistributionPlugin.java", "utf8")).toContain("launchReviewFlow");
    expect(readFileSync("android/app/src/sideload/java/top/kcaron/goldline/DistributionPlugin.java", "utf8")).toContain("requestReview");
  });

  it("makes a release after 1.1.2 require the new native build (package.json goldline.minNativeBuild)", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string; goldline: { minNativeBuild: number } };
    if (compareVersions(pkg.version, "1.1.2") > 0) expect(pkg.goldline.minNativeBuild).toBeGreaterThanOrEqual(10200);
  });
});

describe("shared links", () => {
  it("open the same item in the same house", () => {
    expect(itemUrl(113, 13468)).toBe("https://kcaron.top/goblin-ledger/app/?house=113&item=13468");
    expect(linkState(new URL(itemUrl(113, 13468)).search)).toMatchObject({ realm: "pvp", faction: "horde", tab: "chart", chartItem: 13468 });
  });

  it("send the app's page in the reader's language", () => {
    expect(appPageUrl("en")).toBe("https://kcaron.top/goblin-ledger/");
    expect(appPageUrl("fr")).toBe("https://kcaron.top/fr/goblin-ledger/");
  });
});

describe("feedback", () => {
  const details = { version: "1.2.0", platform: "Android app", device: "Android 15; Pixel 7", house: "PvP · Horde", lang: "fr" };

  it("carries the app details only when asked", () => {
    const full = feedbackMessage("problem", " Chart is empty\nsince noon ", details);
    expect(full.subject).toBe("Goblin Ledger problem: Chart is empty");
    expect(full.body).toBe("Chart is empty\nsince noon\n\n---\nGoblin Ledger 1.2.0 (Android app)\nAndroid 15; Pixel 7\nAuction house: PvP · Horde\nLanguage: fr");
    expect(feedbackMessage("idea", "More lists", null).body).toBe("More lists");
  });

  it("reads the phone from the user agent", () => {
    expect(deviceFrom("Mozilla/5.0 (Linux; Android 15; Pixel 7 Build/AP4A; wv) AppleWebKit/537.36")).toBe("Android 15; Pixel 7");
    expect(deviceFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("");
  });

  it("builds e-mail and GitHub links, to the support address the policy publishes", () => {
    expect(SUPPORT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+$/);
    expect(mailUrl(SUPPORT_EMAIL, "A & B", "one\ntwo")).toBe(`mailto:${SUPPORT_EMAIL}?subject=A%20%26%20B&body=one%0D%0Atwo`);
    expect(issueUrl("A & B", "x#y")).toBe("https://github.com/kevincaron28/Trading-Wow/issues/new?title=A%20%26%20B&body=x%23y");
  });
});

describe("privacy policy in the app", () => {
  it("reads the Markdown the policy uses", () => {
    expect(spans("**Nothing.** See [Google](https://g.example) or `data.kcaron.top`.")).toEqual([
      { text: "Nothing.", bold: true },
      { text: " See " },
      { text: "Google", href: "https://g.example" },
      { text: " or " },
      { text: "data.kcaron.top", code: true },
      { text: "." },
    ]);
    expect(blocks("# T\n\n## S\n\n- a\n  more\n- b")).toEqual([
      { kind: "h1", text: "T" },
      { kind: "h2", text: "S" },
      { kind: "ul", items: [[{ text: "a more" }], [{ text: "b" }]] },
    ]);
  });

  it("shows one language at a time, with the same sections, and no Markdown left over", () => {
    const en = policyBlocks("en");
    const fr = policyBlocks("fr");
    expect(en[0]).toEqual({ kind: "h1", text: "Goblin Ledger privacy policy" });
    expect(fr[0]).toEqual({ kind: "h1", text: "Politique de confidentialité de Goblin Ledger" });
    const headings = (list: typeof en) => list.filter((b) => b.kind === "h2").length;
    expect(headings(en)).toBeGreaterThanOrEqual(7);
    expect(headings(fr)).toBe(headings(en));
    for (const list of [en, fr]) {
      const text = JSON.stringify(list);
      expect(text).not.toContain("**");
      expect(text).not.toContain("](");
      expect(text).not.toContain('"#');
    }
  });
});

describe("help", () => {
  const text = (lang: "en" | "fr") => HELP[lang].flatMap((s) => s.items.flatMap((i) => [i.q, ...i.a])).join("\n");

  it("has the same sections and questions in both languages", () => {
    expect(HELP.fr.map((s) => [s.id, s.items.length])).toEqual(HELP.en.map((s) => [s.id, s.items.length]));
    expect(HELP.en.map((s) => s.id)).toEqual(["data", "indexes", "flips", "alerts", "app"]);
  });

  it("writes money in g/s/c, never po/pa/pc", () => {
    for (const lang of ["en", "fr"] as const) {
      expect(text(lang)).toMatch(/12g 50s/);
      expect(text(lang)).not.toMatch(/\d\s?(po|pa|pc)\b/);
    }
  });

  it("states the numbers the code uses", () => {
    expect(houseCut("horde")).toBe(0.05);
    expect(houseCut("blackwater")).toBe(0.15);
    // The flip example: buy at 12g 50s, resell at 15g after the 5% cut.
    const quote = toQuote(1, [125_000, 150_000, 50, 10, 0, 150_000, 10]);
    const [flip] = quickFlips([quote], () => 7, 0.05);
    expect(formatMoney(flip!.profit)).toBe("1g 75s");
    // Its rules: 3 sales a day, 15% under the average, 10% and 10s of profit.
    expect(quickFlips([toQuote(1, [125_000, 150_000, 50, 10, 0, 150_000, 2])], () => 7, 0.05)).toEqual([]);
    expect(quickFlips([toQuote(1, [129_000, 150_000, 50, 10, 0, 150_000, 10])], () => 7, 0.05)).toEqual([]);
    expect(DEAL_STEPS).toEqual([20, 30, 50]);
    expect(MIN_SAVING).toBe(1_000);
    expect(REPORT_AGAIN_S).toBe(12 * 3600);
  });
});
