import { useEffect, useRef } from "react";
import type { Time } from "lightweight-charts";
import type { UIChartCard, UIChartTemplate } from "../../shared/protocol";
import { CHART_TEMPLATES, TEMPLATE_LABEL, createBaseChart, fmt, token, toDay } from "./charts";

const PERIOD_LABEL: Record<string, string> = {
  D: "일봉",
  "1d": "일봉",
  "1day": "일봉",
  W: "주봉",
  "1w": "주봉",
  M: "월봉",
  Y: "년봉",
};

function periodLabel(period: string): string {
  return PERIOD_LABEL[period] ?? PERIOD_LABEL[period.toLowerCase()] ?? period;
}

function spanLabel(period: string, n: number): string {
  const p = periodLabel(period);
  if (p.includes("주") || period === "W" || period === "1w") return `${n}주`;
  if (p.includes("월") || period === "M") return `${n}개월`;
  if (p.includes("년") || period === "Y") return `${n}년`;
  return `${n}일`;
}

export function ChartCard({ data }: { data: UIChartCard }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { meta, bars } = data;
  const template: UIChartTemplate = data.template ?? "candle";
  const up = meta.change >= 0;

  useEffect(() => {
    const el = hostRef.current;
    if (!el || bars.length === 0) return;
    const narrow = el.clientWidth < 520;
    const fontSize = narrow ? 10 : 11;
    const times = bars.map((b) => toDay(b.date));
    const chart = createBaseChart(el, { narrow, fontSize });
    const draw = CHART_TEMPLATES[template] ?? CHART_TEMPLATES.candle;
    draw({
      chart,
      bars,
      times,
      ohlc: bars.map((b, i) => ({
        time: times[i] as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
      closes: bars.map((b) => b.close),
      volumes: bars.map((b) => b.volume ?? 0),
      up,
      upColor: token("--c-up", "#d43c36"),
      downColor: token("--c-down", "#2a72db"),
      fontSize,
    });
    chart.timeScale().fitContent();
    return () => {
      chart.remove();
    };
  }, [bars, up, template]);

  const typeLabel = TEMPLATE_LABEL[template];
  const titlePeriod = [periodLabel(meta.period), spanLabel(meta.period, bars.length), typeLabel]
    .filter(Boolean)
    .join(" · ");
  const tall = template === "candle";

  return (
    <article className="my-3 overflow-hidden rounded-2xl border border-line bg-card shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
      <header className="flex items-start justify-between gap-3 px-3.5 pt-3 pb-2">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold tracking-tight text-ink">
            {meta.name || meta.symbol || "차트"}
            <span className="ml-1 font-semibold text-muted">· {titlePeriod}</span>
          </div>
          {template !== "rsi" && template !== "macd" && template !== "stochastic" && template !== "atr" && template !== "drawdown" && template !== "adx" && (
            <div className="mt-0.5 hidden text-[11px] text-faint tabular-nums sm:block">
              시 <b className="font-semibold text-muted">{fmt(bars.at(-1)?.open ?? 0)}</b>
              {"  "}고 <b className="font-semibold text-muted">{fmt(bars.at(-1)?.high ?? 0)}</b>
              {"  "}저 <b className="font-semibold text-muted">{fmt(bars.at(-1)?.low ?? 0)}</b>
              {"  "}종 <b className="font-semibold text-muted">{fmt(bars.at(-1)?.close ?? 0)}</b>
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[18px] leading-tight font-extrabold tracking-tight ${up ? "text-up" : "text-down"}`}>
            {fmt(meta.price)}
          </div>
          <div className={`mt-0.5 text-[12px] font-semibold ${up ? "text-up" : "text-down"}`}>
            {up ? "+" : ""}{fmt(meta.change)} ({up ? "+" : ""}{meta.changePct.toFixed(2)}%)
          </div>
        </div>
      </header>
      <div ref={hostRef} className={tall ? "h-[240px] sm:h-[300px]" : "h-[200px] sm:h-[240px]"} />
    </article>
  );
}
