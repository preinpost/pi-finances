import { LineSeries } from "lightweight-charts";
import { bollinger } from "../../lib/chartIndicators";
import { addCandles, lineData, priceLine, watermark, type ChartDrawCtx } from "./shared";

/** 볼린저밴드(20, 2) 단독 카드 — 캔들 + 상/중/하단 */
export function drawBollinger(ctx: ChartDrawCtx): void {
  addCandles(ctx, 0);
  const bb = bollinger(ctx.closes, 20, 2);
  const bands = [
    { values: bb.upper, color: "#2563eb" },
    { values: bb.mid, color: "#d97706" },
    { values: bb.lower, color: "#2563eb" },
  ];
  for (const band of bands) {
    const series = ctx.chart.addSeries(LineSeries, priceLine(band.color), 0);
    series.setData(lineData(ctx.times, band.values));
  }
  watermark(ctx.chart, 0, "볼린저밴드 (20, 2)", ctx.fontSize);
}
