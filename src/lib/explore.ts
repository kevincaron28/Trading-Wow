import { change24h, sellsAtLeast, type Quote } from "./quotes.ts";

export function topMovers(
  quotes: readonly Quote[],
  opts: { direction: "up" | "down"; minListed?: number; limit?: number },
): { quote: Quote; change: number }[] {
  const minListed = opts.minListed ?? 5;
  const limit = opts.limit ?? 25;
  const rows: { quote: Quote; change: number }[] = [];
  for (const quote of quotes) {
    if (quote.listed < minListed) continue;
    const change = change24h(quote);
    if (change === null) continue;
    if (opts.direction === "up" ? change > 0 : change < 0) rows.push({ quote, change });
  }
  rows.sort((a, b) => (opts.direction === "up" ? b.change - a.change : a.change - b.change));
  return rows.slice(0, limit);
}

export function mostListed(quotes: readonly Quote[], limit = 25): Quote[] {
  return [...quotes].sort((a, b) => b.listed - a.listed || b.auctions - a.auctions).slice(0, limit);
}

export function deals(
  quotes: readonly Quote[],
  opts: { minListed?: number; maxRatio?: number; limit?: number; minSales?: number } = {},
): { quote: Quote; discount: number }[] {
  const minListed = opts.minListed ?? 3;
  const maxRatio = opts.maxRatio ?? 0.7;
  const limit = opts.limit ?? 25;
  const rows: { quote: Quote; discount: number }[] = [];
  for (const quote of quotes) {
    if (quote.avg7d <= 0 || quote.listed < minListed || !sellsAtLeast(quote, opts.minSales ?? 0)) continue;
    if (quote.min > maxRatio * quote.avg7d) continue;
    rows.push({ quote, discount: (1 - quote.min / quote.avg7d) * 100 });
  }
  rows.sort((a, b) => b.discount - a.discount);
  return rows.slice(0, limit);
}

export function arbitrage(
  buy: ReadonlyMap<number, Quote>,
  sell: ReadonlyMap<number, Quote>,
  opts: { sellCut: number; minProfit?: number; minSellListed?: number; limit?: number },
): { id: number; buyPrice: number; sellPrice: number; profit: number; profitPct: number }[] {
  const minProfit = opts.minProfit ?? 1;
  const minSellListed = opts.minSellListed ?? 3;
  const limit = opts.limit ?? 25;
  const rows: { id: number; buyPrice: number; sellPrice: number; profit: number; profitPct: number }[] = [];
  for (const [id, b] of buy) {
    const s = sell.get(id);
    if (!s || b.min <= 0 || s.listed < minSellListed) continue;
    const buyPrice = b.min;
    const sellPrice = s.market;
    const profit = Math.round(sellPrice * (1 - opts.sellCut) - buyPrice);
    if (profit < minProfit) continue;
    rows.push({ id, buyPrice, sellPrice, profit, profitPct: (profit / buyPrice) * 100 });
  }
  rows.sort((a, b) => b.profitPct - a.profitPct);
  return rows.slice(0, limit);
}

/**
 * The Flip finder list: items to buy in one house and sell in the other, ranked by profit per unit. Thin markets,
 * near-free junk and margins over 300% (huge but fake) are left out, as are items `skip` rejects. `minSales` is the
 * least the item must sell per day in the house you sell in.
 */
export function findFlips(
  buy: ReadonlyMap<number, Quote>,
  sell: ReadonlyMap<number, Quote>,
  opts: { sellCut: number; minSales?: number; skip?: (id: number) => boolean; limit?: number },
): ReturnType<typeof arbitrage> {
  const liquid = (m: ReadonlyMap<number, Quote>, minSales: number) =>
    new Map([...m].filter(([id, q]) => q.listed >= 5 && q.auctions >= 3 && q.min >= 100 && sellsAtLeast(q, minSales) && !opts.skip?.(id)));
  return arbitrage(liquid(buy, 0), liquid(sell, opts.minSales ?? 0), { sellCut: opts.sellCut, minProfit: 1_000, minSellListed: 5, limit: Number.MAX_SAFE_INTEGER })
    .filter((f) => f.profitPct <= 300)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, opts.limit ?? 50);
}
