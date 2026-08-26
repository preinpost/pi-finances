import { LineSeries, LineStyle } from "lightweight-charts";
import { rsi } from "../../lib/chartIndicators";
import { lineData, watermark, type ChartDrawCtx } from "./shared";

/** RSI(14) 단독 카드 */
export function drawRsi(ctx: ChartDrawCtx): void {
  const values = rsi(ctx.closes, 14);
  const series = ctx.chart.addSeries(LineSeries, {
    color: "#7c3aed",
    lineWidth: 2,
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: { type: "custom", minMove: 0.1, formatter: (n: number) => n.toFixed(1) },
    autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
  }, 0);
  series.setData(lineData(ctx.times, values));
  series.createPriceLine({ price: 70, color: "rgba(15,23,42,0.18)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
  series.createPriceLine({ price: 50, color: "rgba(15,23,42,0.12)", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false });
  series.createPriceLine({ price: 30, color: "rgba(15,23,42,0.18)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
  watermark(ctx.chart, 0, "RSI (14)", ctx.fontSize);
}
