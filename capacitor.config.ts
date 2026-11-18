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
