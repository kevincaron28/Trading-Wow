import { beforeEach, describe, expect, it, vi } from "vitest";
import { ahledgerMarket, clearAhledgerMemory, loadAhledger, parseAhledger } from "../src/lib/ahledger";

const answer = (headers: Record<string, string> = { "cache-control": "private, max-age=60" }) =>
  new Response(
    JSON.stringify({
      attribution: { url: "https://ahledger.com/items/2589-linen-cloth/forever.pvp.horde.us?utm_source=ahledger_api" },
      series: [
        { t: "2026-11-06T00:00:00.000Z", min: 2, median: 30 },
        { t: "2026-11-05T00:00:00.000Z", min: 10, median: 35 },
        { t: "2026-11-07T00:00:00.000Z", min: null, median: null },
      ],
    }),
    { status: 200, headers },
  );

describe("AHledger", () => {
  beforeEach(() => clearAhledgerMemory());

  it("maps faction houses to US markets and leaves Blackwater out", () => {
    expect(ahledgerMarket(113)).toBe("forever.pvp.horde.us");
    expect(ahledgerMarket(111)).toBe("forever.normal.alliance.us");
    expect(ahledgerMarket(120)).toBe("forever.rp.horde.us");
    expect(ahledgerMarket(123)).toBe("forever.rppvp.alliance.us");
    expect(ahledgerMarket(116)).toBeNull();
    expect(ahledgerMarket(125)).toBeNull();
  });

  it("parses daily points in time order, skipping empty days, and keeps the credit link", () => {
    const s = parseAhledger({ series: [{ t: "2026-11-06T00:00:00.000Z", min: 2, median: 30 }, { t: "2026-11-05T00:00:00.000Z", min: 10, median: 35 }, { t: "2026-11-07T00:00:00.000Z", min: null, median: null }], attribution: { url: "u" } }, "f");
    expect(s?.points.map((p) => p.median)).toEqual([35, 30]);
    expect(s?.points[0]!.time).toBe(Date.UTC(2026, 10, 5) / 1000);
    expect(s?.url).toBe("u");
  });

  it("asks for 90 days, falls back on a refused range, and keeps the answer only in memory", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => (url.includes("90d") ? new Response("{}", { status: 403 }) : answer()));
    const s = await loadAhledger(113, 2589, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      "https://api.ahledger.com/v1/prices/forever.pvp.horde.us/2589?range=90d",
      "https://api.ahledger.com/v1/prices/forever.pvp.horde.us/2589?range=30d",
    ]);
    expect(fetchImpl.mock.calls[0]![1]).toEqual({ cache: "no-store" });
    expect(s?.points).toHaveLength(2);
    await loadAhledger(113, 2589, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("asks again once the cache time has passed", async () => {
    const fetchImpl = vi.fn(async () => answer({ "cache-control": "max-age=0" }));
    await loadAhledger(113, 2589, fetchImpl as unknown as typeof fetch);
    await loadAhledger(113, 2589, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never calls the API for Blackwater, and survives a network failure", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); });
    expect(await loadAhledger(116, 2589, fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await loadAhledger(113, 2589, fetchImpl as unknown as typeof fetch)).toBeNull();
  });
});
