/**
 * App updates without reinstalling.
 *
 * - Web bundle (JS/CSS) over the air: every release publishes `web-bundle.zip` and `update.json` (version, SHA-256)
 *   on GitHub. The app checks on launch, downloads a newer bundle in the background with Capgo's open-source updater
 *   (self-hosted, checksum verified), applies it at the next start or right away with "Update now", and rolls back by
 *   itself if the new bundle does not start (notifyAppReady below).
 * - Native changes (a new APK is needed when update.json's minNativeBuild is above this app's version code):
 *   the GitHub/kcaron.top build downloads the APK and opens Android's installer ("sideload" flavor only); the Google
 *   Play build never installs APKs and shows Play's own in-app update instead.
 */
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";

export interface UpdateManifest {
  version: string;
  versionCode: number;
  minNativeBuild: number;
  bundleUrl: string;
  bundleSha256: string;
  apkUrl: string;
  apkSha256?: string;
}

export type Channel = "play" | "sideload" | "web";

export type UpdatePlan =
  | { kind: "none" }
  | { kind: "bundle"; version: string }
  | { kind: "apk"; version: string }
  | { kind: "play"; version: string };

export const UPDATE_URL: string =
  (import.meta.env.VITE_UPDATE_URL as string | undefined) ?? "https://github.com/kevincaron28/Trading-Wow/releases/latest/download/update.json";

/** -1, 0 or 1 comparing dotted versions numerically ("0.10.0" > "0.9.3"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** What to offer: a web bundle when this native app can run it, else a new app (APK or Play), else nothing. */
export function planUpdate(m: UpdateManifest, current: { jsVersion: string; nativeBuild: number; channel: Channel }): UpdatePlan {
  if (current.channel === "web") return { kind: "none" };
  const needsNative = m.minNativeBuild > current.nativeBuild;
  if (needsNative && m.versionCode > current.nativeBuild) return current.channel === "sideload" ? { kind: "apk", version: m.version } : { kind: "play", version: m.version };
  if (!needsNative && compareVersions(m.version, current.jsVersion) > 0) return { kind: "bundle", version: m.version };
  return { kind: "none" };
}

interface DistributionPlugin {
  getChannel(): Promise<{ channel: "play" | "sideload"; canInstall: boolean }>;
  installApk(options: { path: string }): Promise<{ needsPermission: boolean }>;
  /** Google Play's in-app rating window (Play build, since 1.2.0). */
  requestReview(): Promise<void>;
}
export const Distribution = registerPlugin<DistributionPlugin>("Distribution");

export type UpdateState =
  | { status: "idle" | "checking" | "current" | "error"; message?: string }
  | { status: "downloading"; version: string }
  | { status: "bundleReady"; version: string; apply: () => Promise<void> }
  | { status: "apkAvailable"; version: string; install: () => Promise<void> }
  | { status: "playAvailable"; version: string; install: () => Promise<void> };

let state: UpdateState = { status: "idle" };
const listeners = new Set<(s: UpdateState) => void>();
function setUpdateState(next: UpdateState): void {
  state = next;
  listeners.forEach((fn) => fn(next));
}
export function getUpdateState(): UpdateState {
  return state;
}
export function onUpdateState(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call once at start: tells the updater this bundle started fine (otherwise it rolls back to the previous one). */
export async function markAppReady(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.notifyAppReady();
  } catch {
    // Not available in this build.
  }
}

export async function appChannel(): Promise<Channel> {
  if (!Capacitor.isNativePlatform()) return "web";
  try {
    return (await Distribution.getChannel()).channel;
  } catch {
    return "sideload";
  }
}

let checking: Promise<void> | null = null;
/** Check update.json (and Google Play on the Play build) and prepare whatever update applies. */
export function checkForUpdates(): Promise<void> {
  checking ??= runCheck().finally(() => (checking = null));
  return checking;
}

async function runCheck(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  setUpdateState({ status: "checking" });
  try {
    const channel = await appChannel();
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    const nativeBuild = Number(info.build) || 0;
    const res = await CapacitorHttp.get({ url: `${UPDATE_URL}?t=${Date.now()}`, responseType: "json" });
    if (res.status !== 200) throw new Error(`update.json: HTTP ${res.status}`);
    const manifest = (typeof res.data === "string" ? JSON.parse(res.data) : res.data) as UpdateManifest;
    const plan = planUpdate(manifest, { jsVersion: __APP_VERSION__, nativeBuild, channel });
    if (plan.kind === "bundle") {
      setUpdateState({ status: "downloading", version: plan.version });
      const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
      const bundle = await CapacitorUpdater.download({ url: manifest.bundleUrl, version: manifest.version, checksum: manifest.bundleSha256 });
      await CapacitorUpdater.next({ id: bundle.id });
      setUpdateState({ status: "bundleReady", version: plan.version, apply: () => CapacitorUpdater.set({ id: bundle.id }) });
      return;
    }
    if (plan.kind === "apk") {
      setUpdateState({ status: "apkAvailable", version: plan.version, install: () => downloadAndInstallApk(manifest) });
      return;
    }
    if (plan.kind === "play" || channel === "play") {
      const { AppUpdate, AppUpdateAvailability } = await import("@capawesome/capacitor-app-update");
      const play = await AppUpdate.getAppUpdateInfo();
      if (play.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE) {
        setUpdateState({
          status: "playAvailable",
          version: play.availableVersionName ?? manifest.version,
          install: async () => {
            if (play.immediateUpdateAllowed) await AppUpdate.performImmediateUpdate();
            else await AppUpdate.openAppStore();
          },
        });
        return;
      }
    }
    setUpdateState({ status: "current" });
  } catch (error) {
    setUpdateState({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

async function downloadAndInstallApk(m: UpdateManifest): Promise<void> {
  setUpdateState({ status: "downloading", version: m.version });
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const file = await Filesystem.downloadFile({ url: m.apkUrl, path: `goblin-ledger-${m.version}.apk`, directory: Directory.Cache });
    if (!file.path) throw new Error("download failed");
    const result = await Distribution.installApk({ path: file.path });
    // Android asked to allow installs from Goblin Ledger first: keep the button so the user can tap Install again.
    setUpdateState({ status: "apkAvailable", version: m.version, install: () => downloadAndInstallApk(m) });
    if (!result.needsPermission) return;
  } catch (error) {
    setUpdateState({ status: "apkAvailable", version: m.version, install: () => downloadAndInstallApk(m) });
    throw error;
  }
}
