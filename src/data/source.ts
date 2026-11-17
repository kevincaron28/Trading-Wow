import type { PricePoint } from "../lib/candles";
import { generateSampleSeries } from "./sample";

/** An auction house: one region, one realm group, one faction. */
export interface House {
  region: "us" | "eu";
  realm: string;
  faction: "horde" | "alliance";
}

export function houseKey(house: House): string {
  return `${house.region}-${house.realm}-${house.faction}`.toLowerCase();
}

/**
 * Forever US auction houses, from the Blizzard probe of 17 Nov 2026
 * (`/data/wow/ruleset/{any}/auctions/{houseId}?namespace=dynamic-forever-us`: the house ID decides,
 * the ruleset number in the path does not). Houses come in groups of three (Alliance, Horde,
 * Blackwater). Group "pvp" was identified by matching house 113 against TSM's PvP-Horde prices
 * (100% of 5,186 items). The other groups are not identified yet; 112/115/118 are empty and skipped.
 */
export const REALMS: readonly { id: string; label: string; houses: { alliance: number; horde: number; blackwater: number } }[] = [
  { id: "pvp", label: "PvP", houses: { alliance: 110, horde: 113, blackwater: 116 } },
  { id: "b", label: "Realm B", houses: { alliance: 111, horde: 114, blackwater: 117 } },
  { id: "c", label: "Realm C", houses: { alliance: 119, horde: 120, blackwater: 121 } },
  { id: "d", label: "Realm D", houses: { alliance: 123, horde: 124, blackwater: 125 } },
];

export const DEFAULT_HOUSE: House = { region: "us", realm: "pvp", faction: "horde" };

/** Blizzard auction house ID for a house, or undefined if the realm is unknown. */
export function blizzardHouseId(house: House): number | undefined {
  return REALMS.find((r) => r.id === house.realm.toLowerCase())?.houses[house.faction];
}

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
