import { describe, expect, it } from "vitest";
import { alertMet, evaluateAlerts, newAlertId, type PriceAlert } from "../src/lib/alerts";
import type { Quote } from "../src/lib/quotes";

const quote: Quote = { id: 7, min: 90, market: 100, listed: 5, auctions: 2, prev24h: null, avg7d: 100, soldPerDay: null, prev1h: null, soldAvg7d: null };
const alert = (o: Partial<PriceAlert> = {}): PriceAlert => ({
  id: "a", itemId: 7, house: 1, field: "market", op: "above", price: 100, active: true, createdAt: 0, ...o,
});

describe("alertMet", () => {
  it("compares the chosen field inclusively", () => {
    expect(alertMet(alert(), quote)).toBe(true);
    expect(alertMet(alert({ price: 101 }), quote)).toBe(false);
    expect(alertMet(alert({ field: "min", op: "below", price: 90 }), quote)).toBe(true);
    expect(alertMet(alert({ field: "min", op: "below", price: 89 }), quote)).toBe(false);
  });
});

describe("evaluateAlerts", () => {
  const lookup = (house: number) => (house === 1 ? new Map([[7, quote]]) : undefined);
  it("fires, deactivates and does not mutate", () => {
    const input = [alert(), alert({ id: "b", price: 500 })];
    const snapshot = JSON.parse(JSON.stringify(input));
    const r = evaluateAlerts(input, lookup, 123);
    expect(input).toEqual(snapshot);
    expect(r.fired).toHaveLength(1);
    expect(r.fired[0]).toMatchObject({ id: "a", active: false, triggeredAt: 123 });
    expect(r.alerts[0]).toMatchObject({ active: false, triggeredAt: 123 });
    expect(r.alerts[1]).toEqual(input[1]);
  });
  it("leaves inactive and data-less alerts alone", () => {
    const input = [alert({ active: false }), alert({ id: "c", house: 2 }), alert({ id: "d", itemId: 99 })];
    const r = evaluateAlerts(input, lookup, 1);
    expect(r.fired).toEqual([]);
    expect(r.alerts).toEqual(input);
    expect(evaluateAlerts([], lookup, 1)).toEqual({ alerts: [], fired: [] });
  });
});

describe("newAlertId", () => {
  it("is short and varies", () => {
    expect(newAlertId().length).toBeGreaterThanOrEqual(6);
    expect(newAlertId()).not.toBe(newAlertId());
  });
});
