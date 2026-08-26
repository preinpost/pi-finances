import { LineSeries } from "lightweight-charts";
import { drawdown } from "../../lib/chartIndicators";
import { lineData, watermark, type ChartDrawCtx } from "./shared";

/** 고점 대비 낙폭 (분수, 보통 ≤ 0) */
export function drawDrawdown(ctx: ChartDrawCtx): void {
  const values = drawdown(ctx.closes);
  const series = ctx.chart.addSeries(LineSeries, {
    color: "#d43c36",
    lineWidth: 2,
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: { type: "custom", minMove: 0.0001, formatter: (n: number) => `${(n * 100).toFixed(1)}%` },
  }, 0);
  series.setData(lineData(ctx.times, values));
  watermark(ctx.chart, 0, "낙폭 (고점 대비)", ctx.fontSize);
}
