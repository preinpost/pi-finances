import type { UIChartTemplate } from "../../../shared/protocol";
import { drawAdx } from "./adx";
import { drawAtr } from "./atr";
import { drawBollinger } from "./bollinger";
import { drawCandle } from "./candle";
import { drawDrawdown } from "./drawdown";
import { drawIchimoku } from "./ichimoku";
import { drawMacd } from "./macd";
import { drawRsi } from "./rsi";
import { drawStochastic } from "./stochastic";
import type { ChartDrawCtx } from "./shared";

export type { ChartDrawCtx } from "./shared";
export { addCandles, createBaseChart, fmt, token, toDay } from "./shared";

export const CHART_TEMPLATES: Record<UIChartTemplate, (ctx: ChartDrawCtx) => void> = {
  candle: drawCandle,
  rsi: drawRsi,
  ichimoku: drawIchimoku,
  bollinger: drawBollinger,
  macd: drawMacd,
  stochastic: drawStochastic,
  atr: drawAtr,
  drawdown: drawDrawdown,
  adx: drawAdx,
};

export const TEMPLATE_LABEL: Record<UIChartTemplate, string> = {
  candle: "",
  rsi: "RSI",
  ichimoku: "일목균형표",
  bollinger: "볼린저밴드",
  macd: "MACD",
  stochastic: "스토캐스틱",
  atr: "ATR",
  drawdown: "낙폭",
  adx: "ADX",
};
