import type { Quote } from "./quotes";

export interface PriceAlert {
  id: string;
  itemId: number;
  house: number;
  field: "market" | "min";
  op: "above" | "below";
  price: number;
  active: boolean;
  createdAt: number;
  triggeredAt?: number;
}

export function alertMet(alert: PriceAlert, quote: Quote): boolean {
  const value = alert.field === "market" ? quote.market : quote.min;
  return alert.op === "above" ? value >= alert.price : value <= alert.price;
}

export function evaluateAlerts(
  alerts: readonly PriceAlert[],
  quotes: (house: number) => ReadonlyMap<number, Quote> | undefined,
  now: number,
): { alerts: PriceAlert[]; fired: PriceAlert[] } {
  const fired: PriceAlert[] = [];
  const next = alerts.map((alert) => {
    if (!alert.active) return { ...alert };
    const quote = quotes(alert.house)?.get(alert.itemId);
    if (!quote || !alertMet(alert, quote)) return { ...alert };
    const copy: PriceAlert = { ...alert, active: false, triggeredAt: now };
    fired.push(copy);
    return copy;
  });
  return { alerts: next, fired };
}

export function newAlertId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}
