import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // Relative paths: the same build runs inside the Android app and from any web folder.
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 700,
    // recap.html: the recap share pages the Discord post screenshots (src/recap/).
    rollupOptions: { input: { main: "index.html", recap: "recap.html" } },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
  },
});
