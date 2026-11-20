import { describe, expect, it } from "vitest";
import { BUILT_IN_WATCHLISTS, LISTS_ADDED, LISTS_VERSION, addNewListItems } from "../src/data/watchlists";

describe("built-in watchlists", () => {
  it("adds each version's new items once, and only versions after the saved one", () => {
    const saved = [{ id: "leather", items: [2318] }, { id: "mine", items: [1] }];
    const fromV2 = addNewListItems(saved, 2);
    expect(fromV2[0]!.items).toEqual([2318, ...LISTS_ADDED[3]!.leather!]);
    expect(fromV2[1]!.items).toEqual([1]);
    // A v2 list does not get the v2 additions again (the user may have removed them).
    expect(fromV2[0]!.items).not.toContain(LISTS_ADDED[2]!.leather!.find((id) => !LISTS_ADDED[3]!.leather!.includes(id)));
    expect(addNewListItems(saved, LISTS_VERSION)).toEqual(saved);
  });

  it("has no duplicate items, and every addition is in its built-in list", () => {
    for (const list of BUILT_IN_WATCHLISTS) expect(new Set(list.items).size).toBe(list.items.length);
    for (const added of Object.values(LISTS_ADDED))
      for (const [id, items] of Object.entries(added)) {
        const list = BUILT_IN_WATCHLISTS.find((w) => w.id === id)!;
        for (const item of items) expect(list.items).toContain(item);
      }
  });
});
