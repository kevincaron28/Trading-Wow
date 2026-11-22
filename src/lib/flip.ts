import type { Quote } from "./quotes";

/**
 * Flipper numbers for one item in one house (0.12). Only what the data supports: every value is null when its inputs
 * are unknown, never guessed.
 * - sold24h: our estimate of units sold in the last 24 hours;
 * - sellThrough: share of the units on offer that sold in 24 hours: sold / (sold + listed now).
 * - daysSupply: listed units / units sold per day (7-day average when known).
 * - margin: buy at the lowest buyout, resell at the market price after the house cut (copper and percent).
 */
export interface FlipStats {
  sold24h: number | null;
  soldAvg7d: number | null;
  salesTrend: number | null;
  sellThrough: number | null;
  daysSupply: number | null;
  margin: number | null;
  marginPct: number | null;
  spreadPct: number | null;
  vsAvg7d: number | null;
}

export function flipStats(q: Quote | undefined, cut: number): FlipStats {
  const own = q?.soldPerDay ?? null;
  const avg = q?.soldAvg7d ?? null;
  const perDay = avg != null && avg > 0 ? avg : own;
  const margin = q && q.min > 0 && q.market > 0 ? Math.round(q.market * (1 - cut) - q.min) : null;
  return {
    sold24h: own,
    soldAvg7d: avg,
    salesTrend: own != null && avg != null && avg >= 1 ? ((own - avg) / avg) * 100 : null,
    sellThrough: q && own != null && own + q.listed > 0 ? (own / (own + q.listed)) * 100 : null,
    daysSupply: q && perDay != null && perDay > 0 ? q.listed / perDay : null,
    margin,
    marginPct: margin != null && q!.min > 0 ? (margin / q!.min) * 100 : null,
    spreadPct: q && q.min > 0 && q.market > 0 ? ((q.market - q.min) / q.min) * 100 : null,
    vsAvg7d: q && q.avg7d > 0 ? ((q.market - q.avg7d) / q.avg7d) * 100 : null,
  };
}
