import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { privacyUrl } from "../src/lib/links";

describe("privacyUrl", () => {
  it("is the address given to Google Play", () => {
    expect(readFileSync("docs/PLAY_STORE.md", "utf8")).toContain(privacyUrl("en"));
  });
  it("jumps to the French heading, which exists in the policy", () => {
    const heading = readFileSync("PRIVACY.md", "utf8").match(/^# (Politique.*)$/m)![1]!;
    const anchor = heading.trim().toLowerCase().replace(/ /g, "-");
    expect(privacyUrl("fr")).toBe(`${privacyUrl("en")}#${anchor}`);
  });
});
