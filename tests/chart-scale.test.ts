import { describe, expect, it } from "vitest";
import { padFlatRange } from "../src/ui/chartEngine";

describe("flat price scale", () => {
  it("widens a flat range to ±2% and keeps wide ranges", () => {
    expect(padFlatRange(() => ({ priceRange: { minValue: 290_000, maxValue: 290_000 } }))!.priceRange).toEqual({ minValue: 284_200, maxValue: 295_800 });
    expect(padFlatRange(() => ({ priceRange: { minValue: 1_000, maxValue: 9_000 } }))!.priceRange).toEqual({ minValue: 1_000, maxValue: 9_000 });
    expect(padFlatRange(() => ({ priceRange: { minValue: 1, maxValue: 1 } }))!.priceRange).toEqual({ minValue: 0, maxValue: 3 });
    expect(padFlatRange(() => null)).toBeNull();
  });
});
