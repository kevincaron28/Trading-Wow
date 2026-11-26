import { readJson, writeJson } from "../lib/storage";

/** The filters of Explore's money lists (Flip finder, Below average, Crafts), saved on the device. */
export interface MoneyFilters {
  /** Least estimated sales per day; 0 shows everything. */
  minSales: number;
  /** Whether recipes, patterns and plans appear in the Flip finder. */
  recipes: boolean;
}

export const SALES_STEPS: readonly number[] = [0, 1, 5, 20];
const KEY = "goldline:filters";

export function loadFilters(): MoneyFilters {
  const saved = readJson<Partial<MoneyFilters> | null>(KEY, null);
  return {
    minSales: SALES_STEPS.includes(saved?.minSales as number) ? saved!.minSales! : 1,
    recipes: saved?.recipes !== false,
  };
}

export function saveFilters(filters: MoneyFilters): void {
  writeJson(KEY, filters);
}
