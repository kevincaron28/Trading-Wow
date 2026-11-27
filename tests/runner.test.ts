import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Handler = (resolve: (v?: unknown) => void, reject: (e: unknown) => void, args?: unknown) => unknown;

/** Load public/runners/alerts.js in a sandbox with fake Background Runner globals. */
function loadRunner(latest: Record<string, unknown>) {
  const kv = new Map<string, string>();
  const handlers = new Map<string, Handler>();
  const notifications: { title: string; body: string }[] = [];
  const sandbox = {
    addEventListener: (name: string, fn: Handler) => handlers.set(name, fn),
    CapacitorKV: { get: (k: string) => (kv.has(k) ? { value: kv.get(k)! } : undefined), set: (k: string, v: string) => kv.set(k, v), remove: (k: string) => kv.delete(k) },
    CapacitorNotifications: { schedule: (list: { title: string; body: string }[]) => notifications.push(...list) },
    fetch: async (url: string) => {
      const house = url.match(/latest\/(\d+)\.json/)![1]!;
      return { ok: house in latest, json: async () => latest[house] };
    },
    Date,
    Math,
    JSON,
  };
  runInNewContext(readFileSync("public/runners/alerts.js", "utf8"), sandbox);
  const fire = (name: string, args?: unknown) => new Promise((resolve, reject) => handlers.get(name)!(resolve, reject, args));
  return { kv, fire, notifications };
}

const alert = (o: Record<string, unknown>) => ({ id: "a1", itemId: 13468, house: 113, field: "market", op: "below", price: 110_000, active: true, createdAt: 0, ...o });

describe("background alert runner", () => {
  it("fires a met alert once, notifies with the item name, and reports it to the app", async () => {
    const r = loadRunner({ "113": { items: { "13468": [100_000, 105_389, 432, 126, 0, 110_000, -1] } } });
    await r.fire("syncAlerts", { alerts: [alert({}), alert({ id: "a2", op: "above", price: 200_000 })], lang: "en", names: { 13468: "Black Lotus" } });
    await r.fire("checkAlerts");
    expect(r.notifications).toHaveLength(1);
    expect(r.notifications[0]!.body).toBe("Black Lotus fell below 11g (10g 53s)");
    await r.fire("checkAlerts");
    expect(r.notifications).toHaveLength(1);
    expect(await r.fire("popFired")).toEqual({ fired: ["a1"], deals: {} });
    expect(await r.fire("popFired")).toEqual({ fired: [], deals: {} });
  });

  it("uses the lowest buyout for min alerts, French text, and ignores missing houses", async () => {
    const r = loadRunner({ "113": { items: { "13468": [100_000, 150_000, 1, 1, 0, 1, -1] } } });
    await r.fire("syncAlerts", { alerts: [alert({ field: "min", price: 100_000 }), alert({ id: "x", house: 999 })], lang: "fr", names: {} });
    await r.fire("checkAlerts");
    expect(r.notifications.map((n) => n.body)).toEqual(["#13468 descend sous 10g (10g)"]);
  });

  it("reports a watched list's deals once, even with no price alert, and hands them to the app", async () => {
    // [min, market, listed, auctions, prev24h, avg7d, sold24h, prev1h, soldAvg7d]
    const r = loadRunner({ "113": { items: { "13468": [60_000, 95_000, 40, 8, 0, 100_000, 3, 0, 4] } } });
    const deals = [{ id: "w1", listId: "mine", listName: "Herbs", house: 113, pct: 30, reported: {}, createdAt: 0, items: [13468] }];
    await r.fire("syncAlerts", { alerts: [], deals, lang: "en", names: { 13468: "Black Lotus" } });
    await r.fire("checkAlerts");
    await r.fire("checkAlerts");
    expect(r.notifications.map((n) => n.body)).toEqual(["Herbs: Black Lotus 6g (-40%)"]);
    // A sync made before the app collects the report keeps the item reported.
    await r.fire("syncAlerts", { alerts: [], deals: [{ ...deals[0], reported: {} }], lang: "en", names: {} });
    await r.fire("checkAlerts");
    expect(r.notifications).toHaveLength(1);
    const popped = (await r.fire("popFired")) as { deals: Record<string, Record<string, number>> };
    expect(Object.keys(popped.deals.w1!)).toEqual(["13468"]);
    expect(await r.fire("popFired")).toEqual({ fired: [], deals: {} });
  });

  it("does nothing without active alerts", async () => {
    const r = loadRunner({});
    await r.fire("checkAlerts");
    expect(r.notifications).toEqual([]);
  });
});
