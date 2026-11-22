import { describe, expect, it } from "vitest";
import { coverageOf, SRC } from "../collector/coverage";
import { parseAhpriceCsv, tsmItemIds } from "../collector/audit-catalog";
import { FOREVER_LAUNCH_DAY as L } from "../collector/import-auctionator";
import { earliestPoint } from "../src/lib/ranges";

describe("history coverage", () => {
  it("reports first, last, covered days, missing days and sources since launch", () => {
    const days = new Map<number, number>([
      [L - 3, SRC.goldline],
      [L + 1, SRC.ahprice],
      [L + 2, SRC.auctionator],
      [L + 5, SRC.goldline | SRC.ahprice],
    ]);
    expect(coverageOf(days)).toEqual([L + 1, L + 5, 3, 2, SRC.goldline | SRC.ahprice | SRC.auctionator]);
    expect(coverageOf(new Map([[L - 1, 1]]))).toBeNull();
  });

  it("picks the earliest real time for 'History since'", () => {
    expect(earliestPoint([undefined, 1_795_000_000, null, 1_794_000_000, Number.NaN])).toBe(1_794_000_000);
    expect(earliestPoint([undefined, null])).toBeNull();
  });
});

describe("catalog audit sources", () => {
  it("reads item IDs and names from an ahprice.com export, including quoted names", () => {
    const csv = 'item_id,name,market_avg_copper\n35,Bent Staff,2984\n2589,"Linen Cloth, bundle",12\nbad,row\n';
    expect([...parseAhpriceCsv(csv)]).toEqual([[35, "Bent Staff"], [2589, "Linen Cloth, bundle"]]);
  });

  it("reads only item IDs from TSM's accounting logs", () => {
    const lua = [
      '["r@PvP@internalData@csvSales"] = "itemString,stackSize\\ni:13468,1\\ni:2589::-24,20",',
      '["g@ @internalData@itemDB"] = "i:999999",',
    ].join("\n");
    expect([...tsmItemIds(lua)].sort((a, b) => a - b)).toEqual([2589, 13468]);
  });

});
