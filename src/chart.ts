import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "./lib/candles";
import type { Lang } from "./lib/i18n";
import { INDICATORS, type IndicatorId } from "./lib/indicators";
import { formatMoney, formatMoneyShort } from "./lib/money";

export type ChartType = "candles" | "line";

export interface ChartView {
  candles: Candle[];
  chartType: ChartType;
  indicators: ReadonlySet<IndicatorId>;
  showVolume: boolean;
  lang: Lang;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The price chart: price series, listed-quantity histogram and indicator lines. */
export class PriceChart {
  private chart: IChartApi;
  private price: ISeriesApi<SeriesType> | null = null;
  private volume: ISeriesApi<"Histogram">;
  private lines = new Map<IndicatorId, ISeriesApi<"Line">>();
  private view: ChartView | null = null;

  constructor(
    container: HTMLElement,
    private onHover: (candle: Candle | null) => void,
  ) {
    this.chart = createChart(container, {
      autoSize: true,
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.24 } },
    });
    this.volume = this.chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this.chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    this.chart.subscribeCrosshairMove((param) => {
      const time = param.time as number | undefined;
      this.onHover(time === undefined ? null : (this.view?.candles.find((c) => c.time === time) ?? null));
    });
    this.applyTheme();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      this.applyTheme();
      if (this.view) this.render(this.view);
    });
  }

  private applyTheme(): void {
    this.chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: cssVar("--chart-bg") },
        textColor: cssVar("--muted"),
        fontFamily: cssVar("--font-ui"),
      },
      grid: {
        vertLines: { color: cssVar("--grid") },
        horzLines: { color: cssVar("--grid") },
      },
      rightPriceScale: { borderColor: cssVar("--border") },
      timeScale: { borderColor: cssVar("--border") },
    });
  }

  render(view: ChartView): void {
    const previousType = this.view?.chartType;
    this.view = view;
    const up = cssVar("--up");
    const down = cssVar("--down");
    const priceFormat = {
      type: "custom" as const,
      minMove: 1,
      formatter: (copper: number) => formatMoneyShort(copper, view.lang),
    };
    this.chart.applyOptions({ localization: { locale: view.lang === "fr" ? "fr-CA" : "en-US", priceFormatter: (p: number) => formatMoneyShort(p, view.lang) } });

    if (!this.price || previousType !== view.chartType) {
      if (this.price) this.chart.removeSeries(this.price);
      this.price =
        view.chartType === "candles"
          ? this.chart.addSeries(CandlestickSeries, { priceFormat })
          : this.chart.addSeries(LineSeries, { priceFormat, lineWidth: 2 });
    }
    if (view.chartType === "candles") {
      this.price.applyOptions({
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
        priceFormat,
      });
      this.price.setData(
        view.candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })),
      );
    } else {
      this.price.applyOptions({ color: cssVar("--accent"), priceFormat });
      this.price.setData(view.candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    }

    this.volume.applyOptions({ visible: view.showVolume });
    this.volume.setData(
      view.candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? cssVar("--up-soft") : cssVar("--down-soft"),
      })),
    );

    const closes = view.candles.map((c) => c.close);
    for (const id of Object.keys(INDICATORS) as IndicatorId[]) {
      const spec = INDICATORS[id];
      let series = this.lines.get(id);
      if (!view.indicators.has(id)) {
        if (series) {
          this.chart.removeSeries(series);
          this.lines.delete(id);
        }
        continue;
      }
      if (!series) {
        series = this.chart.addSeries(LineSeries, {
          color: spec.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        this.lines.set(id, series);
      }
      series.applyOptions({ priceFormat });
      const values = spec.fn(closes, spec.period);
      series.setData(
        view.candles.flatMap((c, i) => {
          const value = values[i];
          return value == null ? [] : [{ time: c.time as UTCTimestamp, value }];
        }),
      );
    }
    // Fit after layout: on first render the container may not have its final width yet.
    this.chart.timeScale().fitContent();
    requestAnimationFrame(() => this.chart.timeScale().fitContent());
  }

  /** Text for screen readers: the last candle in words. */
  describe(view: ChartView): string {
    const last = view.candles.at(-1);
    return last ? formatMoney(last.close, view.lang) : "";
  }
}
