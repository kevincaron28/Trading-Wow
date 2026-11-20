import { useEffect, useState } from "preact/hooks";
import { useStore } from "../app/store";
import { checkForUpdates, getUpdateState, onUpdateState, type UpdateState } from "../app/updates";
import { t } from "../lib/i18n";

export function useUpdateState(): UpdateState {
  const [state, setState] = useState(getUpdateState());
  useEffect(() => onUpdateState(setState), []);
  return state;
}

/** Thin bar at the top when an update is ready: web bundle (Update now), new APK (Install) or Google Play (Update). */
export function UpdateBanner() {
  const s = useStore();
  const u = useUpdateState();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<string | null>(null);
  if (u.status !== "bundleReady" && u.status !== "apkAvailable" && u.status !== "playAvailable") return null;
  if (hidden === u.version) return null;
  const run = () => {
    setBusy(true);
    const action = u.status === "bundleReady" ? u.apply : u.install;
    void action().catch(() => {}).finally(() => setBusy(false));
  };
  const label = u.status === "bundleReady" ? t(s.lang, "updateNow") : u.status === "apkAvailable" ? t(s.lang, "installUpdate") : t(s.lang, "updateOnPlay");
  return (
    <div class="update-bar" role="status">
      <span>{t(s.lang, u.status === "bundleReady" ? "updateReady" : "newVersion")} {u.version}</span>
      <button type="button" class="btn small" disabled={busy} onClick={run}>{busy ? t(s.lang, "working") : label}</button>
      <button type="button" class="icon-btn small" aria-label={t(s.lang, "later")} onClick={() => setHidden(u.version)}>×</button>
    </div>
  );
}

/** Settings: version, update status and a manual check. */
export function UpdateSection() {
  const s = useStore();
  const u = useUpdateState();
  const text =
    u.status === "checking" ? t(s.lang, "checkingUpdates")
    : u.status === "downloading" ? `${t(s.lang, "downloadingUpdate")} ${u.version}`
    : u.status === "current" ? t(s.lang, "upToDate")
    : u.status === "error" ? t(s.lang, "updateError")
    : u.status === "idle" ? ""
    : `${t(s.lang, u.status === "bundleReady" ? "updateReady" : "newVersion")} ${"version" in u ? u.version : ""}`;
  return (
    <div class="menu-section">
      <p class="sheet-label">{t(s.lang, "appUpdates")}</p>
      <p class="small">Goblin Ledger {__APP_VERSION__}{text ? ` · ${text}` : ""}</p>
      <button type="button" class="btn" disabled={u.status === "checking" || u.status === "downloading"} onClick={() => void checkForUpdates()}>{t(s.lang, "checkUpdates")}</button>
    </div>
  );
}
