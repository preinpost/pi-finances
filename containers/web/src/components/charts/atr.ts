import { LineSeries } from "lightweight-charts";
import { atr } from "../../lib/chartIndicators";
import { fmt, lineData, watermark, type ChartDrawCtx } from "./shared";

/** ATR(14) 단독 카드 */
export function drawAtr(ctx: ChartDrawCtx): void {
  const values = atr(ctx.bars, 14);
  const series = ctx.chart.addSeries(LineSeries, {
    color: "#0f9d8e",
    lineWidth: 2,
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: { type: "custom", minMove: 0.01, formatter: fmt },
  }, 0);
  series.setData(lineData(ctx.times, values));
  watermark(ctx.chart, 0, "ATR (14)", ctx.fontSize);
}
