/**
 * src/agent/tools.ts — pi 툴 등록 (twelve_* 4개 — Twelve Data 현재가/차트/검색/환율).
 *
 * execute는 roles/twelve.ts로 위임. 모든 응답은 compact 정규화 후 JSON 문자열.
 * 무료 티어 8 req/min 한도 때문에 레이트리밋 + TTL 캐시를 항상 적용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { analyze } from "pi-finance-core";
import { compact, getExchangeRate, getQuote, getTimeSeries, searchSymbols } from "../roles/twelve.ts";

/** 툴 결과 공통 래퍼 — pi-toss와 동일 형태. */
export function textResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

/** execute 공통 에러 래퍼 — { ok: false, error } 형태 유지. */
function jsonResult(value: unknown) {
	return textResult(JSON.stringify(value, null, 2));
}

const TWELVE_INTERVALS = ["1min", "5min", "15min", "30min", "45min", "1h", "2h", "4h", "1day", "1week", "1month"] as const;

export function registerTools(pi: ExtensionAPI): void {
	// ── twelve: 현재가 ─────────────────────────────────────────────────
	pi.registerTool({
		name: "twelve_price",
		label: "트웰브 현재가",
		description:
			"Twelve Data 현재가 조회 (전 세계 주식·지수·외환·암호화폐). symbols: 최대 8개 콤마 구분 " +
			'(예: "AAPL,MSFT" 또는 "005930.KS") — 무료 8 req/min 한도 때문에 하나씩 /quote 호출(직렬). ' +
			"응답: { ok, quotes: [{ symbol, name, currency, close, change, percent_change, previous_close, high, low, volume, ... }] }. " +
			"키 필요 (/twelve-key, twelvedata.com 무료 가입 → apikey). 캐시 15초 적용.",
		parameters: Type.Object({
			symbols: Type.String({ description: '종목 심볼 콤마 구분 (최대 8), 예: AAPL,MSFT 또는 005930.KS' }),
		}),
		async execute(_id, params) {
			try {
				const symbols = params.symbols.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
				if (symbols.length === 0) return jsonResult({ ok: false, error: "symbols가 비어 있습니다." });
				const quotes: Record<string, unknown>[] = [];
				for (const symbol of symbols) {
					quotes.push(await getQuote(symbol));
				}
				return jsonResult({ ok: true, quotes });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── twelve: 차트 + 지표 ────────────────────────────────────────────
	pi.registerTool({
		name: "twelve_chart",
		label: "트웰브 차트·지표",
		description:
			"Twelve Data 차트 조회 후 공용 지표(MA/RSI/ATR/볼린저/지지저항/추세) 계산 (pi-finance-core). " +
			"interval: 1min|5min|15min|30min|45min|1h|2h|4h|1day|1week|1month (기본 1day). " +
			"outputsize: 봉 수 (기본 300, 최대 5000). start_date/end_date: YYYY-MM-DD (미지정 시 최근). " +
			"키 필요 (/twelve-key), 무료 8 req/min — 캐시 60초 적용. " +
			"참고용 분석이며 투자 결정의 책임은 사용자에게 있습니다.",
		parameters: Type.Object({
			symbol: Type.String({ description: "종목 심볼, 예: AAPL 또는 005930.KS" }),
			interval: Type.Optional(Type.Union([...TWELVE_INTERVALS.map((i) => Type.Literal(i))], { description: "봉 단위 (기본 1day)" })),
			outputsize: Type.Optional(Type.Number({ description: "봉 수 (기본 300, 최대 5000)" })),
			start_date: Type.Optional(Type.String({ description: "시작일 YYYY-MM-DD" })),
			end_date: Type.Optional(Type.String({ description: "종료일 YYYY-MM-DD" })),
		}),
		async execute(_id, params) {
			try {
				const interval = params.interval ?? "1day";
				const outputsize = Math.round(Math.min(Math.max(params.outputsize ?? 300, 1), 5000));
				const { meta, bars } = await getTimeSeries(params.symbol, {
					interval,
					outputsize,
					startDate: params.start_date,
					endDate: params.end_date,
				});
				if (bars.length === 0) {
					return jsonResult({ ok: false, error: "차트 데이터 없음 — 심볼/날짜 범위를 확인하세요." });
				}
				return jsonResult({
					ok: true,
					source: "twelve",
					symbol: params.symbol,
					interval,
					currency: typeof meta.currency === "string" ? meta.currency : undefined,
					meta: compact(meta),
					barCount: bars.length,
					lastBar: bars[bars.length - 1],
					recentBars: bars.slice(-10),
					...analyze(bars),
				});
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── twelve: 심볼 검색 ──────────────────────────────────────────────
	pi.registerTool({
		name: "twelve_search",
		label: "트웰브 심볼 검색",
		description:
			"Twelve Data 심볼 검색 (전 세계 주식·지수·외환·암호화폐). query 예: apple, 005930, USD. " +
			"응답: { ok, query, data: [{ symbol, name, exchange, currency, type, country }] }. " +
			"키 필요 (/twelve-key). 캐시 10분 적용. 검색 결과 symbol은 twelve_price/twelve_chart에 그대로 사용하세요.",
		parameters: Type.Object({
			query: Type.String({ description: "검색어, 예: apple 또는 005930" }),
		}),
		async execute(_id, params) {
			try {
				const data = await searchSymbols(params.query);
				return jsonResult({ ok: true, query: params.query, data });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── twelve: 환율 ───────────────────────────────────────────────────
	pi.registerTool({
		name: "twelve_exchange_rate",
		label: "트웰브 환율",
		description:
			"Twelve Data 환율 조회 — symbol: 통화쌍 (예: USD/KRW, EUR/USD, GBP/JPY). " +
			"응답: { ok, symbol, rate, timestamp, currency? } (rate는 숫자). " +
			"키 필요 (/twelve-key). 캐시 60초 적용.",
		parameters: Type.Object({
			symbol: Type.String({ description: "통화쌍, 예: USD/KRW 또는 EUR/USD" }),
		}),
		async execute(_id, params) {
			try {
				const rate = await getExchangeRate(params.symbol);
				return jsonResult({ ok: true, ...rate });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});
}
