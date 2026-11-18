import type { Candle } from "./candles";

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

function checkPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("period must be a positive integer");
}

/** Bollinger bands: SMA middle, +/- `mult` population standard deviations. */
export function bollinger(
  values: readonly number[],
  period = 20,
  mult = 2,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  checkPeriod(period);
  const upper: (number | null)[] = [];
  const middle: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      middle.push(null);
      lower.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j]!;
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j]! - mean) ** 2;
    const sd = Math.sqrt(sq / period);
    upper.push(mean + mult * sd);
    middle.push(mean);
    lower.push(mean - mult * sd);
  }
  return { upper, middle, lower };
}

/** Relative strength index with Wilder's smoothing; first value at index `period`. */
export function rsi(values: readonly number[], period = 14): (number | null)[] {
  checkPeriod(period);
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= period) return out;
  const toRsi = (gain: number, loss: number): number => {
    if (gain === 0 && loss === 0) return 50;
    if (loss === 0) return 100;
    return 100 - 100 / (1 + gain / loss);
  };
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = toRsi(gain, loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = toRsi(gain, loss);
  }
  return out;
}

/** MACD line, signal line and histogram, all aligned with the input. */
export function macd(
  values: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  checkPeriod(fast);
  checkPeriod(slow);
  checkPeriod(signalPeriod);
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => {
    const a = f[i];
    const b = s[i];
    return a != null && b != null ? a - b : null;
  });
  const firstIdx = line.findIndex((v) => v !== null);
  const signal: (number | null)[] = values.map(() => null);
  if (firstIdx >= 0) {
    const sig = ema(line.slice(firstIdx) as number[], signalPeriod);
    sig.forEach((v, k) => {
      signal[firstIdx + k] = v;
    });
  }
  const histogram = line.map((m, i) => {
    const sg = signal[i];
    return m != null && sg != null ? m - sg : null;
  });
  return { macd: line, signal, histogram };
}

/** Heikin-Ashi candles; time and volume are kept. */
export function heikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  candles.forEach((c, i) => {
    const close = (c.open + c.high + c.low + c.close) / 4;
    const prev = out[i - 1];
    const open = prev ? (prev.open + prev.close) / 2 : (c.open + c.close) / 2;
    out.push({
      time: c.time,
      open,
      high: Math.max(c.high, open, close),
      low: Math.min(c.low, open, close),
      close,
      volume: c.volume,
    });
  });
  return out;
}
