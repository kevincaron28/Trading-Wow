import type { PricePoint } from "./candles";
import { percentChange } from "./money";

export interface Summary {
  last: PricePoint | null;
  /** Market price change against the newest point at least 24 hours older. */
  change24h: number | null;
  /** Average market price over the last 7 days. */
  avg7d: number | null;
}

export function summarize(points: readonly PricePoint[]): Summary {
  if (points.length === 0) return { last: null, change24h: null, avg7d: null };
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const last = sorted.at(-1)!;
  const dayAgo = [...sorted].reverse().find((p) => p.time <= last.time - 86_400);
  const week = sorted.filter((p) => p.time > last.time - 7 * 86_400);
  const avg7d = Math.round(week.reduce((sum, p) => sum + p.market, 0) / week.length);
  return {
    last,
    change24h: dayAgo ? percentChange(dayAgo.market, last.market) : null,
    avg7d,
  };
}
