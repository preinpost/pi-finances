import { LineSeries, LineStyle } from "lightweight-charts";
import { adx } from "../../lib/chartIndicators";
import { lineData, watermark, type ChartDrawCtx } from "./shared";

/** ADX + +DI / −DI (14) */
export function drawAdx(ctx: ChartDrawCtx): void {
  const { adx: adxLine, plusDI, minusDI } = adx(ctx.bars, 14);
  const fmt1 = (n: number) => n.toFixed(1);
  const adxSeries = ctx.chart.addSeries(LineSeries, {
    color: "#0f172a",
    lineWidth: 2,
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: { type: "custom", minMove: 0.1, formatter: fmt1 },
  }, 0);
  adxSeries.setData(lineData(ctx.times, adxLine));
  const plus = ctx.chart.addSeries(LineSeries, {
    color: "#16a34a",
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: { type: "custom", minMove: 0.1, formatter: fmt1 },
  }, 0);
  plus.setData(lineData(ctx.times, plusDI));
  const minus = ctx.chart.addSeries(LineSeries, {
    color: "#d43c36",
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: { type: "custom", minMove: 0.1, formatter: fmt1 },
  }, 0);
  minus.setData(lineData(ctx.times, minusDI));
  adxSeries.createPriceLine({ price: 20, color: "rgba(15,23,42,0.16)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
  watermark(ctx.chart, 0, "ADX +DI −DI (14)", ctx.fontSize);
}
