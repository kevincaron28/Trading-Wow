import { summarizeSnapshot, type Listing, type PricePoint } from "../lib/candles";

/**
 * Generated sample prices so the charts work before the live Blizzard feed exists. Deterministic:
 * the same item, house and end time always give the same series (stable tests and screenshots).
 */

/** Typical price in copper per unit, by item ID. Unknown items get a value derived from the ID. */
const BASE_PRICE: Record<number, number> = {
  2589: 35, // Linen Cloth
  4306: 120,
  14047: 450,
  2840: 60,
  3575: 300,
  12359: 900,
  12363: 45_000,
  13468: 250_000,
  13463: 2_200,
  13452: 18_000,
  13446: 3_500,
  8846: 4_000,
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function hashString(text: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

export interface SampleOptions {
  itemId: number;
  /** Auction house key, e.g. "us-pvp-horde": different houses get different series. */
  house: string;
  /** Unix seconds; the series ends at the hour containing this time. */
  end: number;
  hours?: number;
}

export function generateSampleSeries({ itemId, house, end, hours = 24 * 45 }: SampleOptions): PricePoint[] {
  const rand = mulberry32(hashString(`${house}:${itemId}`));
  const base = BASE_PRICE[itemId] ?? 500 + (itemId % 97) * 211;
  const endHour = Math.floor(end / 3_600) * 3_600;
  const points: PricePoint[] = [];
  let drift = 0;
  for (let h = hours - 1; h >= 0; h--) {
    const time = endHour - h * 3_600;
    const date = new Date(time * 1_000);
    // Slow random walk around the base price, pulled back toward it.
    drift = drift * 0.985 + (rand() - 0.5) * 0.06;
    // Evenings (US, around 02:00 UTC) bring more sellers and lower prices.
    const hourOfDay = date.getUTCHours();
    const evening = Math.cos(((hourOfDay - 2) / 24) * 2 * Math.PI);
    // Raid reset (Tuesday) pushes consumables up for a day.
    const raidDay = date.getUTCDay() === 2 && hourOfDay >= 15 ? 0.08 : 0;
    const level = base * Math.exp(drift - evening * 0.04 + raidDay);
    const listings: Listing[] = [];
    const count = 12 + Math.floor(rand() * 20 + (evening + 1) * 6);
    for (let i = 0; i < count; i++) {
      const markup = 1 + Math.pow(rand(), 3) * 0.6 - 0.02;
      listings.push({
        unitPrice: Math.max(1, Math.round(level * markup)),
        quantity: 1 + Math.floor(rand() * (base < 1_000 ? 20 : 3)),
      });
    }
    const point = summarizeSnapshot(time, listings);
    if (point) points.push(point);
  }
  return points;
}
