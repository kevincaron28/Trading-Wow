/**
 * AHledger (ahledger.com) daily price history, read live from its public API on the device.
 *
 * Terms (https://ahledger.com/developers#terms, read 19 Nov 2026): free for community tools given to players
 * without charge, with the credit "Prices from AHledger" linked to the item's page; no archive, dataset or resale;
 * from 10 Dec 2026 answers may not be kept past their Cache-Control time, and a product that makes money from the
 * data (ads, subscriptions) needs a commercial licence. So Goldline never stores this series: it is fetched when a
 * chart opens, kept in memory for the response's max-age, and never written to the offline cache or the data branch.
 * Before Goldline shows ads or sells anything, the owner must take an AHledger licence or turn this off (AHLEDGER_ON).
 */
import type { Faction } from "../app/store";

export const AHLEDGER_ON = true;
const API = "https://api.ahledger.com/v1";

/** Goldline house id -> AHledger market id. Blackwater (neutral) houses have no AHledger market. */
const RULESET_BY_HOUSE: Record<number, [string, Faction]> = {
  110: ["pvp", "alliance"], 113: ["pvp", "horde"],
  111: ["normal", "alliance"], 114: ["normal", "horde"],
  119: ["rp", "alliance"], 120: ["rp", "horde"],
  123: ["rppvp", "alliance"], 124: ["rppvp", "horde"],
};

export function ahledgerMarket(house: number): string | null {
  const m = RULESET_BY_HOUSE[house];
  return m ? `forever.${m[0]}.${m[1]}.us` : null;
}

export interface AhledgerPoint { time: number; min: number; median: number }
export interface AhledgerSeries { points: AhledgerPoint[]; url: string }

interface Answer { series?: { t: string; min: number | null; median: number | null }[]; attribution?: { url?: string } }

const memory = new Map<string, { until: number; value: AhledgerSeries | null }>();

function maxAge(res: Response): number {
  const m = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "");
  return m ? Number(m[1]) : 60;
}

/** Parses one /v1/prices answer into daily points (seconds), skipping days without a price. */
export function parseAhledger(json: Answer, fallbackUrl: string): AhledgerSeries | null {
  const points = (json.series ?? [])
    .filter((p) => p.median != null && p.min != null && p.median > 0)
    .map((p) => ({ time: Math.floor(Date.parse(p.t) / 1000), min: p.min!, median: p.median! }))
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  return points.length ? { points, url: json.attribution?.url ?? fallbackUrl } : null;
}

/**
 * Daily history for one item, longest range first: 90 days (open to all until 10 Dec 2026), then 30 days, then 7.
 * A refused range (403) falls through to the next. Any other failure gives null; the chart simply omits the series.
 */
export async function loadAhledger(house: number, itemId: number, fetchImpl: typeof fetch = fetch): Promise<AhledgerSeries | null> {
  const market = AHLEDGER_ON ? ahledgerMarket(house) : null;
  if (!market) return null;
  const key = `${market}/${itemId}`;
  const hit = memory.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const fallbackUrl = `https://ahledger.com/items/${itemId}/${market}`;
  for (const range of ["90d", "30d", "7d"]) {
    let res: Response;
    try {
      // no-store: the WebView's disk cache must not keep the answer either; our memory copy honours max-age.
      res = await fetchImpl(`${API}/prices/${market}/${itemId}?range=${range}`, { cache: "no-store" });
    } catch {
      return null;
    }
    if (res.status === 403) continue;
    if (!res.ok) return null;
    const value = parseAhledger((await res.json()) as Answer, fallbackUrl);
    memory.set(key, { until: Date.now() + maxAge(res) * 1000, value });
    return value;
  }
  return null;
}

export function clearAhledgerMemory(): void {
  memory.clear();
}
