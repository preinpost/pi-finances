/**
 * 웹챗 차트 카드 payload — 툴은 OHLCV를 details에 실고, UI가 렌더한다.
 * LLM content에는 넣지 않는다 (토큰). HTML 생성 없음.
 */
import type { Bar } from "./indicators.ts";

export interface ChartCardMeta {
	name: string;
	symbol: string;
	period: string;
	price: number;
	change: number;
	changePct: number;
}

export type ChartCardTemplate =
	| "candle"
	| "rsi"
	| "ichimoku"
	| "bollinger"
	| "macd"
	| "stochastic"
	| "atr"
	| "drawdown"
	| "adx";

export interface ChartCardDetails {
	kind: "chart-card";
	template?: ChartCardTemplate;
	meta: ChartCardMeta;
	bars: Bar[];
}

const PERIOD_LABEL: Record<string, string> = {
	D: "일봉",
	"0": "일봉",
	"1d": "일봉",
	"1day": "일봉",
	W: "주봉",
	"1w": "주봉",
	"1week": "주봉",
	M: "월봉",
	"1month": "월봉",
	Y: "년봉",
};

export function chartPeriodLabel(period: string): string {
	return PERIOD_LABEL[period] ?? PERIOD_LABEL[period.toLowerCase()] ?? (period || "일봉");
}

export function chartCardDetails(opts: {
	symbol: string;
	name?: string;
	period: string;
	template?: ChartCardTemplate;
	bars: Bar[];
	price?: number;
	change?: number;
	changePct?: number;
}): ChartCardDetails | undefined {
	if (opts.bars.length === 0) return undefined;
	const last = opts.bars[opts.bars.length - 1];
	const prev = opts.bars.length > 1 ? opts.bars[opts.bars.length - 2] : undefined;
	if (!last) return undefined;
	const change = opts.change ?? (prev ? last.close - prev.close : 0);
	const changePct = opts.changePct ?? (prev && prev.close !== 0 ? (change / prev.close) * 100 : 0);
	return {
		kind: "chart-card",
		...(opts.template ? { template: opts.template } : {}),
		meta: {
			name: (opts.name ?? "").trim() || opts.symbol,
			symbol: opts.symbol,
			period: opts.period,
			price: opts.price ?? last.close,
			change,
			changePct,
		},
		bars: opts.bars.map((b) => ({
			date: b.date,
			open: b.open,
			high: b.high,
			low: b.low,
			close: b.close,
			volume: b.volume,
		})),
	};
}
