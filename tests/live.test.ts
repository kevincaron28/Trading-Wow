import { describe, expect, it } from "vitest";
import { countdown, nextUpdate } from "../src/lib/live";

describe("next update estimate", () => {
  const snap = 1_795_000_000;
  it("adds an hour and the observed publish delay to Blizzard's snapshot time", () => {
    expect(nextUpdate(snap, snap + 600, snap + 60)).toEqual({ at: snap + 3_600 + 600, due: false });
    expect(nextUpdate(snap, snap + 600, snap + 4_300)).toEqual({ at: snap + 4_200, due: true });
  });
  it("uses 15 minutes when the observed delay is implausible, and skips long-missed slots", () => {
    expect(nextUpdate(snap, snap - 5, snap)!.at).toBe(snap + 3_600 + 900);
    expect(nextUpdate(snap, null, snap + 5 * 3_600)!.at).toBe(snap + 4 * 3_600 + 900);
    expect(nextUpdate(null, null, snap)).toBeNull();
  });
  it("formats a countdown", () => {
    expect(countdown(125)).toBe("2:05");
    expect(countdown(-3)).toBe("0:00");
  });
});
