import { LineSeries, LineStyle } from "lightweight-charts";
import { stochastic } from "../../lib/chartIndicators";
import { lineData, watermark, type ChartDrawCtx } from "./shared";

/** 스토캐스틱 %K(14) / %D(3), 20/80 */
export function drawStochastic(ctx: ChartDrawCtx): void {
  const { k, d } = stochastic(ctx.bars, 14, 3);
  const kLine = ctx.chart.addSeries(LineSeries, {
    color: "#2563eb",
    lineWidth: 2,
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: { type: "custom", minMove: 0.1, formatter: (n: number) => n.toFixed(1) },
    autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
  }, 0);
  kLine.setData(lineData(ctx.times, k));
  const dLine = ctx.chart.addSeries(LineSeries, {
    color: "#d97706",
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: { type: "custom", minMove: 0.1, formatter: (n: number) => n.toFixed(1) },
  }, 0);
  dLine.setData(lineData(ctx.times, d));
  kLine.createPriceLine({ price: 80, color: "rgba(15,23,42,0.18)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
  kLine.createPriceLine({ price: 20, color: "rgba(15,23,42,0.18)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
  watermark(ctx.chart, 0, "스토캐스틱 (14, 3)", ctx.fontSize);
}
