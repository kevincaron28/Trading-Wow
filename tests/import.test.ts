import { describe, expect, it } from "vitest";
import { AUCTIONATOR_DAY0, decodeCbor, luaStringBytes, seedRows } from "../collector/import-auctionator";

describe("Auctionator import", () => {
  it("decodes CBOR maps with byte-string keys, ints and empty arrays", () => {
    // {"15115": {"a": {"2506": 29}, "h": {"2506": 800}, "l": [], "m": 800}} with byte-string keys like Auctionator.
    const bytes = Uint8Array.from([
      0xa1, 0x45, ...Buffer.from("15115"),
      0xa4,
      0x41, 0x61, 0xa1, 0x44, ...Buffer.from("2506"), 0x18, 0x1d,
      0x41, 0x68, 0xa1, 0x44, ...Buffer.from("2506"), 0x19, 0x03, 0x20,
      0x41, 0x6c, 0x80,
      0x41, 0x6d, 0x19, 0x03, 0x20,
    ]);
    expect(decodeCbor(bytes)).toEqual({ "15115": { a: { "2506": 29 }, h: { "2506": 800 }, l: [], m: 800 } });
  });

  it("reads Lua string escapes as bytes", () => {
    // Raw Lua literal body: A \0 \195 \169 \" \\
    const body = ["A", "\\0", "\\195", "\\169", '\\"', "\\\\"].join("");
    expect([...luaStringBytes(body)]).toEqual([65, 0, 195, 169, 34, 92]);
  });

  it("makes daily rows only for scanned days, with low/high and quantity", () => {
    const rows = seedRows({
      "13468": { a: { "2503": 4, "2506": 44 }, h: { "2503": 450000, "2506": 179999 }, l: { "2506": 165000 }, m: 165000 },
      "g:123": { h: { "2506": 5 } },
      "999": { h: {}, a: {} },
    });
    expect([...rows.keys()]).toEqual([13468]);
    expect(rows.get(13468)).toEqual([
      [AUCTIONATOR_DAY0 + 2503, 450000, 450000, 4],
      [AUCTIONATOR_DAY0 + 2506, 165000, 179999, 44],
    ]);
    expect(new Date((AUCTIONATOR_DAY0 + 2506) * 86_400_000).toISOString().slice(0, 10)).toBe("2026-11-11");
  });
});
