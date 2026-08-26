import { HistogramSeries, LineSeries } from "lightweight-charts";
import { sma } from "../../lib/chartIndicators";
import { addCandles, fmtVol, lineData, watermark, type ChartDrawCtx } from "./shared";

/** 캔들 + MA5/20/60 + 거래량 */
export function drawCandle(ctx: ChartDrawCtx): void {
  addCandles(ctx, 0);
  const overlays = [5, 20, 60];
  const overlayColor: Record<number, string> = { 5: "#0f9d8e", 20: "#d97706", 60: "#7c3aed" };
  for (const period of overlays) {
    const series = ctx.chart.addSeries(LineSeries, {
      color: overlayColor[period] ?? "#64748b",
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: "custom", minMove: 1, formatter: (n: number) => String(Math.round(n)) },
    }, 0);
    series.setData(lineData(ctx.times, sma(ctx.closes, period)));
  }
  watermark(ctx.chart, 0, "이동평균 " + overlays.join(" · "), ctx.fontSize);

  const vol = ctx.chart.addSeries(HistogramSeries, {
    priceFormat: { type: "custom", minMove: 1, formatter: fmtVol },
    lastValueVisible: false,
    priceLineVisible: false,
  }, 1);
  vol.setData(ctx.ohlc.map((b, i) => ({
    time: b.time,
    value: ctx.volumes[i],
    color: b.close >= b.open ? "rgba(212,60,54,0.7)" : "rgba(42,114,219,0.7)",
  })));
  const volLine = ctx.chart.addSeries(LineSeries, {
    color: "#0f9d8e",
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: { type: "custom", minMove: 1, formatter: fmtVol },
  }, 1);
  volLine.setData(lineData(ctx.times, sma(ctx.volumes, 20)));
  watermark(ctx.chart, 1, "거래량", ctx.fontSize);
  ctx.chart.panes()[0]?.setStretchFactor(2.8);
  ctx.chart.panes()[1]?.setStretchFactor(1);
}
