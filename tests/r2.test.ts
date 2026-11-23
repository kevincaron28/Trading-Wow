import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeKey, r2ConfigFromEnv, signV4 } from "../collector/r2";
import { COMPACT_AFTER_DAYS, compactEarlyHourly, listFiles, mergeShards } from "../collector/r2-publish";

describe("R2 client", () => {
  it("signs like AWS's documented Signature Version 4 example (GET Object with Range)", () => {
    const h = signV4({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: { Range: "bytes=0-9" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      service: "s3",
      date: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h["x-amz-date"]).toBe("20130524T000000Z");
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(h.host).toBeUndefined();
  });

  it("encodes keys and reads its settings only when all four are set", () => {
    expect(encodeKey("h64/113/7.json")).toBe("h64/113/7.json");
    expect(encodeKey("a b/c(1).json")).toBe("a%20b/c%281%29.json");
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c" })).toBeNull();
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" })?.bucket).toBe("d");
  });
});

describe("R2 publisher", () => {
  it("drops early hourly prices older than the compaction window", () => {
    const now = 1_800_000_000;
    const h = Math.floor(now / 3_600);
    const rows = [[h - COMPACT_AFTER_DAYS * 24 - 1, 1, 1, 1], [h - COMPACT_AFTER_DAYS * 24 + 1, 2, 2, 2], [h, 3, 3, 3]];
    expect(compactEarlyHourly(rows, now).map((r) => r[1])).toEqual([2, 3]);
  });

  it("merges four h2 shards into one h64 file", () => {
    expect(mergeShards([{ items: { "1": "a" } }, { items: { "65": "b" } }])).toEqual({ v: 1, items: { "1": "a", "65": "b" } });
  });

  it("lists what R2 holds: h64 instead of h2 and history, compacted early hours, meta.json last", () => {
    const dir = mkdtempSync(join(tmpdir(), "r2-"));
    const put = (rel: string, value: unknown) => {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), JSON.stringify(value));
    };
    const now = 1_800_000_000;
    const hour = Math.floor(now / 3_600);
    put("meta.json", { updated: now });
    put("items.json", {});
    put("latest/113.json", { t: now, items: {} });
    put("h2/113/0.json", { v: 1, items: { "256": { h: [], d: [] } } });
    put("h2/113/64.json", { v: 1, items: { "64": { h: [], d: [] } } });
    put("h2/113/1.json", { v: 1, items: { "1": { h: [], d: [] } } });
    put("history/113/0.json", { v: 1, items: {} });
    put("tsm/x.json", {});
    put("early-h/113/0.json", { items: { "256": [[hour - 24 * 40, 1, 1, 1]], "512": [[hour - 2, 5, 5, 5]] } });
    put("early-h/113/1.json", { items: { "1": [[hour - 24 * 40, 1, 1, 1]] } });
    const files = listFiles(dir, now);
    const keys = files.map((f) => f.key);
    expect(keys).toEqual(["items.json", "latest/113.json", "early-h/113/0.json", "early-h/113/1.json", "h64/113/0.json", "h64/113/1.json", "meta.json"]);
    expect(Object.keys((JSON.parse(files[4]!.text()!) as { items: object }).items).sort()).toEqual(["256", "64"]);
    expect(JSON.parse(files[2]!.text()!)).toEqual({ items: { "512": [[hour - 2, 5, 5, 5]] } });
    // A file with nothing left after compaction is not published (and gets deleted from R2).
    expect(files[3]!.text()).toBeNull();
  });
});

describe("app data source", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("maps paths to the R2 layout", async () => {
    const { r2Path } = await import("../src/data/live");
    expect(r2Path("h2/113/200.json")).toBe("h64/113/8.json");
    expect(r2Path("latest/113.json")).toBe("latest/113.json");
    expect(r2Path("history/113/3.json")).toBeNull();
  });

  it("reads from R2 while its prices are recent, else from GitHub", async () => {
    const calls: string[] = [];
    let r2Updated = Date.now() / 1000 - 600;
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url.replace(/\?t=\d+$/, ""));
      if (url.startsWith("https://data.kcaron.top/meta.json")) return new Response(JSON.stringify({ updated: r2Updated }));
      if (url.startsWith("https://data.kcaron.top/h64/113/8.json")) return new Response("r2");
      if (url.startsWith("https://data.kcaron.top/")) return new Response("missing", { status: 404 });
      return new Response("github");
    });
    const live = await import("../src/data/live");
    expect(await live.fetchText("h2/113/200.json")).toBe("r2");
    // A file missing on R2 comes from GitHub.
    expect(await live.fetchText("latest/113.json")).toBe("github");
    expect(calls).toEqual([
      "https://data.kcaron.top/meta.json",
      "https://data.kcaron.top/h64/113/8.json",
      "https://data.kcaron.top/latest/113.json",
      "https://raw.githubusercontent.com/kevincaron28/Trading-Wow/data/latest/113.json",
    ]);
    // A stalled R2 copy is skipped after the next refresh.
    r2Updated = Date.now() / 1000 - 5 * 3600;
    live.clearCache();
    calls.length = 0;
    expect(await live.fetchText("h2/113/200.json")).toBe("github");
    expect(calls).toEqual(["https://data.kcaron.top/meta.json", "https://raw.githubusercontent.com/kevincaron28/Trading-Wow/data/h2/113/200.json"]);
  });
});
