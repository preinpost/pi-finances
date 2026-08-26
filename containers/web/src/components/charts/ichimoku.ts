import { LineSeries, LineStyle, type Time } from "lightweight-charts";
import { ichimoku } from "../../lib/chartIndicators";
import { addCandles, lineData, priceLine, toDay, watermark, type ChartDrawCtx } from "./shared";

/** 일목균형표 단독 카드 — 캔들 + 전환/기준/선행A·B/후행 */
export function drawIchimoku(ctx: ChartDrawCtx): void {
  addCandles(ctx, 0);
  const cloud = ichimoku(ctx.bars);

  const tenkan = ctx.chart.addSeries(LineSeries, priceLine("#d43c36"), 0);
  tenkan.setData(lineData(ctx.times, cloud.tenkan));
  const kijun = ctx.chart.addSeries(LineSeries, priceLine("#2563eb"), 0);
  kijun.setData(lineData(ctx.times, cloud.kijun));

  const addNamed = (color: string, points: { date: string; value: number }[], dashed = false) => {
    const series = ctx.chart.addSeries(LineSeries, {
      ...priceLine(color),
      lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
    }, 0);
    const seen = new Set<string>();
    series.setData(
      points
        .map((p) => ({ time: toDay(p.date) as Time, value: p.value }))
        .filter((p) => {
          const key = String(p.time);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => String(a.time).localeCompare(String(b.time))),
    );
  };
  addNamed("#16a34a", cloud.spanA, true);
  addNamed("#ea580c", cloud.spanB, true);
  addNamed("#64748b", cloud.chikou);
  watermark(ctx.chart, 0, "일목  전환·기준·선행A/B·후행", ctx.fontSize);
}
