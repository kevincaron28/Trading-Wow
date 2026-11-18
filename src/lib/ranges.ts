export type ChartRange = "1d" | "1w" | "1m" | "3m" | "1y" | "all";

export const RANGES: ChartRange[] = ["1d", "1w", "1m", "3m", "1y", "all"];

const DAY = 86_400;
const SPAN: Record<Exclude<ChartRange, "all">, number> = {
  "1d": DAY,
  "1w": 7 * DAY,
  "1m": 30 * DAY,
  "3m": 90 * DAY,
  "1y": 365 * DAY,
};

/** Visible time window (unix seconds) ending at the last candle; null means fit all content. */
export function visibleRange(range: ChartRange, lastTime: number | null | undefined): { from: number; to: number } | null {
  if (range === "all" || lastTime == null || !Number.isFinite(lastTime)) return null;
  return { from: lastTime - SPAN[range], to: lastTime };
}

/** Earliest of the given times (unix seconds), ignoring missing ones; null when there are none. */
export function earliestPoint(times: readonly (number | null | undefined)[]): number | null {
  const real = times.filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t > 0);
  return real.length ? Math.min(...real) : null;
}

export const MAX_LINES = 10;

/** Add a horizontal line (copper, rounded). Ignores invalid, duplicate or beyond-limit prices. */
export function addLine(lines: readonly number[], price: number): number[] {
  const p = Math.round(price);
  if (!Number.isFinite(p) || p <= 0 || lines.includes(p) || lines.length >= MAX_LINES) return [...lines];
  return [...lines, p].sort((a, b) => a - b);
}

export function removeLine(lines: readonly number[], price: number): number[] {
  return lines.filter((l) => l !== price);
}

export function alertOpFor(line: number, current: number): "above" | "below" {
  return line > current ? "above" : "below";
}
