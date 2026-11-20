import { activeZone } from "../lib/time";
import { Capacitor } from "@capacitor/core";
import { formatMoney } from "../lib/money";
import type { Lang } from "../lib/i18n";

export interface ShareChartOpts {
  itemId: number;
  name: string;
  /** Current price in copper (null when unknown). */
  price: number | null | undefined;
  houseLabel: string;
  lang: Lang;
  /** The chart screenshot canvas (ChartEngine.screenshot()). */
  chart: HTMLCanvasElement;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Draws the chart screenshot under a header strip and above a footer, returns a PNG canvas. */
export function buildChartImage(o: ShareChartOpts): HTMLCanvasElement {
  const px = Math.max(1, Math.round(o.chart.width / Math.max(1, o.chart.clientWidth || o.chart.width)));
  const headH = 64 * px;
  const footH = 32 * px;
  const out = document.createElement("canvas");
  out.width = o.chart.width;
  out.height = o.chart.height + headH + footH;
  const g = out.getContext("2d")!;
  const bg = cssVar("--bg", "#0e1116");
  const text = cssVar("--text", "#ffffff");
  const muted = cssVar("--muted", "#9aa4b2");
  const accent = cssVar("--accent", "#e0b84a");
  const pad = 14 * px;
  g.fillStyle = bg;
  g.fillRect(0, 0, out.width, out.height);
  g.textBaseline = "middle";
  g.fillStyle = text;
  g.font = `700 ${20 * px}px system-ui, sans-serif`;
  g.fillText(o.name, pad, 22 * px, out.width - pad * 2 - 140 * px);
  const priceText = o.price != null ? formatMoney(o.price, o.lang) : "-";
  g.fillStyle = accent;
  g.textAlign = "right";
  g.fillText(priceText, out.width - pad, 22 * px);
  g.textAlign = "left";
  g.fillStyle = muted;
  g.font = `${13 * px}px system-ui, sans-serif`;
  const date = new Date().toLocaleDateString(o.lang === "fr" ? "fr-CA" : "en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: activeZone() });
  g.fillText(`${o.houseLabel} · ${date}`, pad, 48 * px);
  g.drawImage(o.chart, 0, headH);
  g.fillStyle = accent;
  g.font = `700 ${14 * px}px system-ui, sans-serif`;
  g.textAlign = "right";
  g.fillText("Goblin Ledger", out.width - pad, headH + o.chart.height + footH / 2);
  return out;
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png"));
}

/** Builds the PNG and shares it (native share sheet, Web Share, or a download). */
export async function shareChart(o: ShareChartOpts): Promise<void> {
  const canvas = buildChartImage(o);
  const title = `${o.name} - Goblin Ledger`;
  const fileName = `goldline-${o.itemId}.png`;
  if (Capacitor.isNativePlatform()) {
    const data = canvas.toDataURL("image/png").split(",")[1]!;
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const result = await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache });
    await Share.share({ title, url: result.uri });
    return;
  }
  const blob = await toBlob(canvas);
  const file = new File([blob], fileName, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
    } catch (e) {
      if ((e as Error).name !== "AbortError") throw e;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
