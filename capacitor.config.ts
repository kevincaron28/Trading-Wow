/// <reference types="@capacitor/background-runner" />
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "top.kcaron.goldline",
  appName: "Goldline",
  webDir: "dist",
  android: {
    backgroundColor: "#11141b",
  },
  plugins: {
    // Over-the-air web bundles, self-hosted on our GitHub releases (src/app/updates.ts). Capgo's cloud is never used:
    // no automatic update checks and no statistics are sent anywhere.
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: "",
      channelUrl: "",
      updateUrl: "",
      appReadyTimeout: 15000,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      resetWhenUpdate: true,
    },
    // Checks price alerts while the app is closed (public/runners/alerts.js). Android runs it about every 30 minutes.
    BackgroundRunner: {
      label: "top.kcaron.goldline.alerts",
      src: "runners/alerts.js",
      event: "checkAlerts",
      repeat: true,
      interval: 30,
      autoStart: true,
    },
  },
};

export default config;
