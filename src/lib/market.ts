/**
 * Market value formulas for one item's listings in one snapshot (prices in copper per unit, weighted by quantity).
 * `cheapest15` is what Goldline used up to 0.7; collector/backtest-formulas.ts compares them on live snapshots.
 */
export interface UnitListing {
  unitPrice: number;
  quantity: number;
}
export type Unitlist = readonly UnitListing[];

function sortedValid(listings: Unitlist): UnitListing[] {
  return listings.filter((l) => l.unitPrice > 0 && l.quantity > 0).sort((a, b) => a.unitPrice - b.unitPrice);
}

/** Units in price order, cut at `count` units (the last listing partly taken). */
function cheapestUnits(sorted: UnitListing[], count: number): UnitListing[] {
  const out: UnitListing[] = [];
  let taken = 0;
  for (const l of sorted) {
    if (taken >= count) break;
    const take = Math.min(l.quantity, count - taken);
    out.push({ unitPrice: l.unitPrice, quantity: take });
    taken += take;
  }
  return out;
}

const total = (ls: Unitlist) => ls.reduce((s, l) => s + l.quantity, 0);
const mean = (ls: Unitlist) => Math.round(ls.reduce((s, l) => s + l.unitPrice * l.quantity, 0) / Math.max(1, total(ls)));

/** Price at which `share` of the quantity is reached. */
export function quantile(sorted: Unitlist, share: number): number {
  const target = Math.max(1, Math.ceil(total(sorted) * share));
  let taken = 0;
  for (const l of sorted) {
    taken += l.quantity;
    if (taken >= target) return l.unitPrice;
  }
  return sorted.at(-1)?.unitPrice ?? 0;
}

/** Up to 0.7: average price of the cheapest 15% of the listed quantity (at least one unit). */
export function cheapest15(listings: Unitlist): number {
  const sorted = sortedValid(listings);
  if (!sorted.length) return 0;
  return mean(cheapestUnits(sorted, Math.max(1, Math.ceil(total(sorted) * 0.15))));
}

/**
 * TSM AuctionDB style: the cheapest 15% of units, extended up to 30% while each step costs less than 20% more than the
 * previous unit; then units more than 1.5 standard deviations from the mean are dropped and the rest averaged.
 */
export function tsmStyle(listings: Unitlist): number {
  const sorted = sortedValid(listings);
  if (!sorted.length) return 0;
  const units: number[] = [];
  for (const l of sorted) for (let i = 0; i < l.quantity && units.length < 100_000; i++) units.push(l.unitPrice);
  const lo = Math.max(1, Math.ceil(units.length * 0.15));
  const hi = Math.max(lo, Math.ceil(units.length * 0.3));
  let n = lo;
  while (n < hi && units[n]! < units[n - 1]! * 1.2) n++;
  const set = units.slice(0, n);
  const m = set.reduce((s, v) => s + v, 0) / set.length;
  const sd = Math.sqrt(set.reduce((s, v) => s + (v - m) ** 2, 0) / set.length);
  const kept = set.filter((v) => Math.abs(v - m) <= 1.5 * sd || sd === 0);
  return Math.round(kept.reduce((s, v) => s + v, 0) / kept.length);
}

/** Undermine style: quantity-weighted median of the cheapest 30% of units. */
export function median30(listings: Unitlist): number {
  const sorted = sortedValid(listings);
  if (!sorted.length) return 0;
  return quantile(cheapestUnits(sorted, Math.max(1, Math.ceil(total(sorted) * 0.3))), 0.5);
}

/**
 * Robust (Goldline 0.8): take the cheapest 30% of units (at least 3 when there are 3), find their quantity-weighted
 * median m, keep only units priced between 0.5 m and 1.5 m (drops lone undercuts and overpriced junk), and average the
 * cheaper half of what is left, by quantity. One stray listing can no longer set the price on a thin market.
 */
export function robust(listings: Unitlist): number {
  const sorted = sortedValid(listings);
  if (!sorted.length) return 0;
  const units = total(sorted);
  const window = cheapestUnits(sorted, Math.min(units, Math.max(3, Math.ceil(units * 0.3))));
  const m = quantile(window, 0.5);
  const kept = window.filter((l) => l.unitPrice >= 0.5 * m && l.unitPrice <= 1.5 * m);
  const base = kept.length ? kept : window;
  return mean(cheapestUnits(base, Math.max(1, Math.ceil(total(base) * 0.5))));
}

export const FORMULAS: Record<string, (l: Unitlist) => number> = { cheapest15, tsmStyle, median30, robust };
