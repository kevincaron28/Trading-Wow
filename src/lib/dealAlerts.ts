/**
 * Deal alerts: watch a whole watchlist in one auction house and report items whose lowest buyout falls well under their
 * 7-day average. public/runners/alerts.js repeats these rules for the checks made while the app is closed;
 * tests/deal-alerts.test.ts holds both to the same answers.
 */
import type { Quote } from "./quotes";

export interface DealWatch {
  id: string;
  /** Watchlist watched: its items at the time of each check. */
  listId: string;
  house: number;
  /** Report a lowest buyout at least this many percent under the 7-day average. */
  pct: number;
  /** Items already reported and when (seconds). An item can be reported again once it has recovered. */
  reported: Record<string, number>;
  createdAt: number;
}

export interface DealHit {
  itemId: number;
  price: number;
  avg: number;
  /** Percent under the 7-day average. */
  discount: number;
}

/** Thresholds offered, percent. */
export const DEAL_STEPS: readonly number[] = [20, 30, 50];
/** An item has recovered when its discount is this many points inside the threshold. */
export const RECOVERY_POINTS = 5;
/** The least time between two reports of one item, seconds. */
export const REPORT_AGAIN_S = 12 * 3600;
/** The least saved against the average, copper (10 silver): cheaper finds are not worth a notification. */
export const MIN_SAVING = 1_000;
/** An average more than this many times today's market price comes from a spike or a launch price, not a usual price. */
export const MAX_AVG_OVER_MARKET = 3;

/** The deal an item offers at a threshold, or null. It must sell at least once a day. */
export function dealOf(quote: Quote, pct: number): DealHit | null {
  if (quote.min <= 0 || quote.avg7d <= 0 || quote.market <= 0) return null;
  if ((quote.soldAvg7d ?? quote.soldPerDay ?? 0) < 1) return null;
  if (quote.avg7d > MAX_AVG_OVER_MARKET * quote.market) return null;
  const discount = (1 - quote.min / quote.avg7d) * 100;
  if (discount < pct || quote.avg7d - quote.min < MIN_SAVING) return null;
  return { itemId: quote.id, price: quote.min, avg: quote.avg7d, discount };
}

/**
 * Check one watch against fresh quotes: new deals (best first) and the updated record of what was reported. Items that
 * are no longer in the list are forgotten; items that are not listed right now keep their record. `watch` comes back
 * unchanged (the same object) when there is nothing to record.
 */
export function evaluateDealWatch(watch: DealWatch, itemIds: readonly number[], quotes: ReadonlyMap<number, Quote>, now: number): { watch: DealWatch; hits: DealHit[] } {
  const reported: Record<string, number> = {};
  const hits: DealHit[] = [];
  let changed = false;
  for (const [id, at] of Object.entries(watch.reported)) {
    const quote = quotes.get(Number(id));
    const recovered = !!quote && quote.avg7d > 0 && (1 - quote.min / quote.avg7d) * 100 < watch.pct - RECOVERY_POINTS;
    if (!itemIds.includes(Number(id)) || (recovered && now - at >= REPORT_AGAIN_S)) changed = true;
    else reported[id] = at;
  }
  for (const id of itemIds) {
    const quote = quotes.get(id);
    if (!quote || reported[id] != null) continue;
    const hit = dealOf(quote, watch.pct);
    if (!hit) continue;
    hits.push(hit);
    reported[id] = now;
    changed = true;
  }
  hits.sort((a, b) => b.discount - a.discount);
  return { watch: changed ? { ...watch, reported } : watch, hits };
}

/** Add records of reports made elsewhere (the background runner), keeping the later time for each item. */
export function mergeReported(watches: readonly DealWatch[], extra: Record<string, Record<string, number>>): DealWatch[] {
  return watches.map((w) => {
    const add = extra[w.id];
    if (!add || Object.keys(add).length === 0) return w;
    const reported = { ...w.reported };
    for (const [id, at] of Object.entries(add)) reported[id] = Math.max(at, reported[id] ?? 0);
    return { ...w, reported };
  });
}
