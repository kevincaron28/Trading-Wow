/** Simple moving average; null until `period` values are available. */
export function sma(values: readonly number[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("period must be a positive integer");
  const out: (number | null)[] = [];
  let sum = 0;
  values.forEach((value, i) => {
    sum += value;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  });
  return out;
}

/** Exponential moving average seeded with the SMA of the first `period` values. */
export function ema(values: readonly number[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("period must be a positive integer");
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let previous: number | null = null;
  let seed = 0;
  values.forEach((value, i) => {
    if (previous === null) {
      seed += value;
      if (i === period - 1) {
        previous = seed / period;
        out.push(previous);
      } else {
        out.push(null);
      }
      return;
    }
    previous = value * k + previous * (1 - k);
    out.push(previous);
  });
  return out;
}

export type IndicatorId = "sma20" | "ema50";

export const INDICATORS: Record<IndicatorId, { period: number; fn: typeof sma; color: string }> = {
  sma20: { period: 20, fn: sma, color: "#5eb8ff" },
  ema50: { period: 50, fn: ema, color: "#c084fc" },
};
