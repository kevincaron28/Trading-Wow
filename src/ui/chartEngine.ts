import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "../lib/candles";
import type { Lang } from "../lib/i18n";
import { bollinger, ema, heikinAshi, macd, rsi, sma } from "../lib/indicators";
import { formatMoneyAxis } from "../lib/money";
import { visibleRange, type ChartRange } from "../lib/ranges";
import type { ChartType, IndicatorKey } from "../app/store";

export interface ChartInput {
  candles: Candle[];
  compare: { candles: Candle[]; label: string } | null;
  chartType: ChartType;
  indicators: readonly IndicatorKey[];
  lang: Lang;
  lines: number[];
  range: ChartRange;
  logScale: boolean;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const ts = (t: number) => t as UTCTimestamp;

/** Owns one lightweight-charts instance; `render` rebuilds every series (cheap at these sizes). */
export class ChartEngine {
  private chart: IChartApi;
  private series: ISeriesApi<SeriesType>[] = [];
  private input: ChartInput | null = null;
  private onHover: (c: Candle | null) => void;

  private placing = false;
  private onPlace: ((price: number) => void) | null;

  constructor(container: HTMLElement, onHover: (c: Candle | null) => void, onPlace?: (price: number) => void) {
    this.onHover = onHover;
    this.onPlace = onPlace ?? null;
    this.chart = createChart(container, {
      autoSize: true,
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 3 },
      handleScale: { axisPressedMouseMove: true, pinch: true },
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false },
    });
    this.chart.subscribeClick((p) => {
      if (!this.placing || !p.point || this.input?.compare) return;
      const price = this.series[0]?.coordinateToPrice(p.point.y);
      if (price == null || !(price > 0)) return;
      this.onPlace?.(Math.round(price));
    });
    this.chart.subscribeCrosshairMove((p) => {
      const time = p.time as number | undefined;
      const shown = this.shownCandles();
      this.onHover(time === undefined ? null : (shown.find((c) => c.time === time) ?? null));
    });
  }

  setPlacing(on: boolean): void {
    this.placing = on;
  }

  private shownCandles(): Candle[] {
    if (!this.input) return [];
    return this.input.chartType === "heikin" ? heikinAshi(this.input.candles) : this.input.candles;
  }

  destroy(): void {
    this.chart.remove();
  }

  render(input: ChartInput): void {
    this.input = input;
    for (const s of this.series) this.chart.removeSeries(s);
    this.series = [];
    const up = css("--up");
    const down = css("--down");
    const accent = css("--accent");
    const fmt = (p: number) => formatMoneyAxis(p, input.lang);
    const comparing = input.compare !== null;
    this.chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: css("--chart-bg") },
        textColor: css("--muted"),
        fontFamily: css("--font-ui"),
        panes: { separatorColor: css("--border") },
      },
      grid: { vertLines: { color: css("--grid") }, horzLines: { color: css("--grid") } },
      rightPriceScale: { borderVisible: false, mode: comparing ? PriceScaleMode.Percentage : input.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderVisible: false },
      localization: { locale: input.lang === "fr" ? "fr-CA" : "en-US", priceFormatter: comparing ? undefined : fmt },
    });

    const candles = this.shownCandles();
    const priceFormat = comparing
      ? { type: "percent" as const }
      : { type: "custom" as const, minMove: 1, formatter: fmt };
    const add = <T extends SeriesType>(series: ISeriesApi<T>) => {
      this.series.push(series as unknown as ISeriesApi<SeriesType>);
      return series;
    };

    // Main price series.
    if (input.chartType === "line" || input.chartType === "area") {
      const s =
        input.chartType === "line"
          ? add(this.chart.addSeries(LineSeries, { color: accent, lineWidth: 2, priceFormat }))
          : add(this.chart.addSeries(AreaSeries, { lineColor: accent, topColor: css("--accent-soft"), bottomColor: "rgba(0,0,0,0)", lineWidth: 2, priceFormat }));
      s.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
    } else {
      const s =
        input.chartType === "bars"
          ? add(this.chart.addSeries(BarSeries, { upColor: up, downColor: down, priceFormat }))
          : add(this.chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat }));
      s.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    }

    // Comparison line (both on a percent scale from the first visible bar).
    if (input.compare) {
      const s = add(this.chart.addSeries(LineSeries, { color: css("--compare"), lineWidth: 2, title: input.compare.label, priceFormat }));
      s.setData(input.compare.candles.map((c) => ({ time: ts(c.time), value: c.close })));
    }

    const closes = input.candles.map((c) => c.close);
    const line = (values: (number | null)[], color: string, width: 1 | 2 = 1, pane = 0, title = "") => {
      const s = add(this.chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: pane > 0, crosshairMarkerVisible: false, title, priceFormat: pane > 0 ? { type: "price", precision: 2, minMove: 0.01 } : priceFormat }, pane));
      s.setData(input.candles.flatMap((c, i) => (values[i] == null ? [] : [{ time: ts(c.time), value: values[i]! }])));
      return s;
    };
    const on = (k: IndicatorKey) => input.indicators.includes(k);
    if (!comparing) {
      if (on("sma20")) line(sma(closes, 20), css("--ind-1"), 2);
      if (on("ema50")) line(ema(closes, 50), css("--ind-2"), 2);
      if (on("bb")) {
        const b = bollinger(closes, 20, 2);
        line(b.upper, css("--ind-3"));
        line(b.middle, css("--ind-3"));
        line(b.lower, css("--ind-3"));
      }
    }
    if (on("volume")) {
      const v = add(this.chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }));
      this.chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      v.setData(input.candles.map((c) => ({ time: ts(c.time), value: c.volume, color: c.close >= c.open ? css("--up-soft") : css("--down-soft") })));
    }
    let pane = 1;
    if (on("rsi")) {
      const s = line(rsi(closes, 14), css("--ind-2"), 1, pane, "RSI");
      s.createPriceLine({ price: 70, color: css("--border"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      s.createPriceLine({ price: 30, color: css("--border"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      pane++;
    }
    if (on("macd")) {
      const m = macd(closes);
      const h = add(this.chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } }, pane));
      h.setData(input.candles.flatMap((c, i) => (m.histogram[i] == null ? [] : [{ time: ts(c.time), value: m.histogram[i]!, color: m.histogram[i]! >= 0 ? css("--up-soft") : css("--down-soft") }])));
      line(m.macd, css("--ind-1"), 1, pane, "MACD");
      line(m.signal, css("--ind-2"), 1, pane);
      pane++;
    }
    // Drop panes left over from indicators that were switched off, then size the indicator panes.
    const panes = this.chart.panes();
    for (let i = panes.length - 1; i >= pane; i--) this.chart.removePane(i);
    this.chart.panes().forEach((p, i) => i > 0 && p.setHeight(90));

    // User horizontal lines on the main price series (not meaningful on a percent scale).
    const mainSeries = this.series[0];
    if (mainSeries && !comparing) {
      for (const price of input.lines) {
        mainSeries.createPriceLine({ price, color: accent, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" });
      }
    }

    const applyRange = () => {
      const r = visibleRange(input.range, input.candles.at(-1)?.time);
      if (r) this.chart.timeScale().setVisibleRange({ from: ts(r.from), to: ts(r.to) });
      else this.chart.timeScale().fitContent();
    };
    applyRange();
    requestAnimationFrame(applyRange);
    this.onHover(null);
  }
}
