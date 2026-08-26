import {
  CandlestickSeries,
  ColorType,
  createChart,
  createTextWatermark,
  LineStyle,
  type IChartApi,
  type Time,
} from "lightweight-charts";
import type { UIChartBar } from "../../../shared/protocol";

export function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function fmt(n: number): string {
  return String(Math.round(n));
}

export function fmtVol(n: number): string {
  const abs = Math.abs(n);
  const trim = (v: number) =>
    v.toFixed(v >= 10 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.[1-9])0$/, "$1");
  if (abs >= 1e6) return `${trim(n / 1e6)}m`;
  if (abs >= 1e3) return `${trim(n / 1e3)}k`;
  return String(Math.round(n));
}

export function fmtTick(time: Time): string {
  if (typeof time === "string" && time.length >= 10) {
    const m = Number(time.slice(5, 7));
    const d = Number(time.slice(8, 10));
    return m && d ? `${m}/${d}` : "";
  }
  if (time && typeof time === "object" && "month" in time) {
    const m = Number((time as { month: number }).month);
    const d = Number((time as { day: number }).day);
    return m && d ? `${m}/${d}` : "";
  }
  return "";
}

export function toDay(yyyymmdd: string): string {
  const s = yyyymmdd.replace(/-/g, "");
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function lineData(times: string[], values: (number | null)[]) {
  return values.flatMap((value, i) => (value == null ? [] : [{ time: times[i] as Time, value }]));
}

export function watermark(chart: IChartApi, pane: number, text: string, size: number) {
  const p = chart.panes()[pane];
  if (!p) return;
  createTextWatermark(p, {
    horzAlign: "left",
    vertAlign: "top",
    lines: [{ text: "  " + text, color: "rgba(15, 23, 42, 0.38)", fontSize: size }],
  });
}

export type OhlcPoint = {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
};

export interface ChartDrawCtx {
  chart: IChartApi;
  bars: UIChartBar[];
  times: string[];
  ohlc: OhlcPoint[];
  closes: number[];
  volumes: number[];
  up: boolean;
  upColor: string;
  downColor: string;
  fontSize: number;
}

export function createBaseChart(el: HTMLElement, opts: { narrow: boolean; fontSize: number }): IChartApi {
  const card = token("--c-card", "#ffffff");
  const line = token("--c-line", "#e1e7f0");
  const faint = token("--c-faint", "#5d6d87");
  const grid = token("--c-inset", "#eef2f7") || "#eef2f7";
  return createChart(el, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: card },
      textColor: faint,
      fontFamily: 'ui-sans-serif, Pretendard, "Apple SD Gothic Neo", sans-serif',
      fontSize: opts.fontSize,
      attributionLogo: false,
      panes: { separatorColor: line, enableResize: false },
    },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
    timeScale: {
      borderVisible: false,
      rightOffset: 3,
      minBarSpacing: opts.narrow ? 4 : 5,
      tickMarkFormatter: fmtTick,
    },
    crosshair: {
      vertLine: { color: "rgba(15,23,42,0.18)", width: 1, style: LineStyle.Dotted, labelVisible: !opts.narrow },
      horzLine: { color: "rgba(15,23,42,0.18)", width: 1, style: LineStyle.Dotted, labelVisible: !opts.narrow },
    },
    handleScroll: { vertTouchDrag: false },
  });
}

export function addCandles(ctx: ChartDrawCtx, pane = 0) {
  const series = ctx.chart.addSeries(CandlestickSeries, {
    upColor: ctx.upColor,
    downColor: ctx.downColor,
    borderUpColor: ctx.upColor,
    borderDownColor: ctx.downColor,
    wickUpColor: ctx.upColor,
    wickDownColor: ctx.downColor,
    borderVisible: false,
    lastValueVisible: false,
    priceLineVisible: true,
    priceLineColor: ctx.up ? ctx.upColor : ctx.downColor,
    priceLineWidth: 1,
    priceLineStyle: LineStyle.Dotted,
    priceFormat: { type: "custom", minMove: 1, formatter: fmt },
  }, pane);
  series.setData(ctx.ohlc);
  return series;
}

export function priceLine(color: string) {
  return {
    color,
    lineWidth: 1 as const,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: { type: "custom" as const, minMove: 1, formatter: fmt },
  };
}
