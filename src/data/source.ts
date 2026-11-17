import type { PricePoint } from "../lib/candles";
import { generateSampleSeries } from "./sample";

/** An auction house: one region, one realm, one faction (Forever realms keep faction auction houses). */
export interface House {
  region: "us" | "eu";
  realm: string;
  faction: "horde" | "alliance";
}

export function houseKey(house: House): string {
  return `${house.region}-${house.realm}-${house.faction}`.toLowerCase();
}

/**
 * Known houses. Placeholder until the Blizzard probe lists the real Forever realms: TSM's data on the
 * owner's PC names a "PvP" realm with a Horde house, so that is the default.
 */
export const REALMS: readonly { id: string; label: string }[] = [
  { id: "pvp", label: "PvP" },
  { id: "pve", label: "PvE" },
];

export const DEFAULT_HOUSE: House = { region: "us", realm: "pvp", faction: "horde" };

export interface PriceSource {
  /** True while prices are generated, so the page can say so. */
  readonly isSample: boolean;
  history(itemId: number, house: House): Promise<PricePoint[]>;
}

export function createSampleSource(now: () => number = () => Date.now() / 1_000): PriceSource {
  return {
    isSample: true,
    async history(itemId, house) {
      return generateSampleSeries({ itemId, house: houseKey(house), end: now() });
    },
  };
}
