import { describe, expect, it } from "vitest";
import { compareVersions, planUpdate, type UpdateManifest } from "../src/app/updates";

const m = (over: Partial<UpdateManifest> = {}): UpdateManifest => ({
  version: "0.8.1", versionCode: 801, minNativeBuild: 800, bundleUrl: "b", bundleSha256: "x", apkUrl: "a", ...over,
});

describe("app updates", () => {
  it("compares versions numerically", () => {
    expect(compareVersions("0.10.0", "0.9.3")).toBe(1);
    expect(compareVersions("0.8.0", "0.8.0")).toBe(0);
    expect(compareVersions("0.8.0", "0.8.1")).toBe(-1);
  });

  it("offers a web bundle when this native app can run it", () => {
    expect(planUpdate(m(), { jsVersion: "0.8.0", nativeBuild: 800, channel: "sideload" })).toEqual({ kind: "bundle", version: "0.8.1" });
    expect(planUpdate(m(), { jsVersion: "0.8.0", nativeBuild: 800, channel: "play" })).toEqual({ kind: "bundle", version: "0.8.1" });
    expect(planUpdate(m(), { jsVersion: "0.8.1", nativeBuild: 800, channel: "sideload" })).toEqual({ kind: "none" });
  });

  it("needs a new app when the bundle requires newer native code: APK when sideloaded, Play otherwise", () => {
    const native = m({ version: "0.9.0", versionCode: 900, minNativeBuild: 900 });
    expect(planUpdate(native, { jsVersion: "0.8.1", nativeBuild: 800, channel: "sideload" })).toEqual({ kind: "apk", version: "0.9.0" });
    expect(planUpdate(native, { jsVersion: "0.8.1", nativeBuild: 800, channel: "play" })).toEqual({ kind: "play", version: "0.9.0" });
    expect(planUpdate(native, { jsVersion: "0.9.0", nativeBuild: 900, channel: "sideload" })).toEqual({ kind: "none" });
    expect(planUpdate(native, { jsVersion: "0.8.0", nativeBuild: 800, channel: "web" })).toEqual({ kind: "none" });
  });
});
