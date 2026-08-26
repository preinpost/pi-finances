import { HistogramSeries, LineSeries, type Time } from "lightweight-charts";
import { macd } from "../../lib/chartIndicators";
import { lineData, watermark, type ChartDrawCtx } from "./shared";

/** MACD(12,26,9) — MACD선, signal, histogram */
export function drawMacd(ctx: ChartDrawCtx): void {
  const { macd: line, signal, hist } = macd(ctx.closes);
  const macdLine = ctx.chart.addSeries(LineSeries, {
    color: "#2563eb",
    lineWidth: 2,
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: { type: "custom", minMove: 0.01, formatter: (n: number) => n.toFixed(2) },
  }, 0);
  macdLine.setData(lineData(ctx.times, line));
  const sig = ctx.chart.addSeries(LineSeries, {
    color: "#d97706",
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: { type: "custom", minMove: 0.01, formatter: (n: number) => n.toFixed(2) },
  }, 0);
  sig.setData(lineData(ctx.times, signal));
  const histSeries = ctx.chart.addSeries(HistogramSeries, {
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: { type: "custom", minMove: 0.01, formatter: (n: number) => n.toFixed(2) },
  }, 0);
  histSeries.setData(
    hist.flatMap((value, i) =>
      value == null
        ? []
        : [{
            time: ctx.times[i] as Time,
            value,
            color: value >= 0 ? "rgba(22,163,74,0.75)" : "rgba(212,60,54,0.75)",
          }],
    ),
  );
  watermark(ctx.chart, 0, "MACD (12, 26, 9)", ctx.fontSize);
}
