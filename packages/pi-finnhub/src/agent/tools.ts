/**
 * src/agent/tools.ts — pi 툴 등록 (finnhub_* 4개 — 공식 API).
 *
 * 툴 name: <provider>_<기능> 소문자 스네이크. execute는 try/catch로
 * 감싸고 성공 시 { ok: true, ... }, 실패 시 { ok: false, error }.
 * 모든 응답은 compact (null/undefined/빈 문자열 제거) 후 JSON 문자열로 반환.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { analyze } from "pi-finance-core";
import { getCandles, getFundamentals, getNews, getQuote, type FinnhubResolution } from "../roles/finnhub.ts";

/** 툴 결과 공통 래퍼 — { content: [text] } 형태 (pi-toss와 동일). */
export function textResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function jsonResult(value: unknown) {
	return textResult(JSON.stringify(value, null, 2));
}

/** compact — null/undefined/빈 문자열 재귀 제거 (공통 응답 정규화). */
function compact(v: unknown): unknown {
	if (Array.isArray(v)) {
		return v.map((x) => compact(x)).filter((x) => x !== undefined && x !== null && x !== "");
	}
	if (v && typeof v === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
			const c = compact(val);
			if (c !== undefined && c !== null && c !== "") out[k] = c;
		}
		return out;
	}
	return v;
}

const RESOLUTION_SCHEMA = {
	description: "봉 단위: D=일봉(기본)/W=주봉/M=월봉, 1/5/15/30/60=분봉",
} as const;

export function registerTools(pi: ExtensionAPI): void {
	// ── finnhub: 현재가 ──────────────────────────────────────────────────
	pi.registerTool({
		name: "finnhub_price",
		label: "핀허브 현재가",
		description:
			"Finnhub(공식 API) 현재가 조회 — **무료 티어는 미국 종목만** (AAPL/MSFT 등). " +
			"symbols: 최대 10개 콤마 구분 (예: \"AAPL,MSFT,TSLA\"), 심볼당 /quote 1회 호출. " +
			"응답: [{ symbol, price, change, changePercent, high, low, open, previousClose, timestamp }]. " +
			"키 필요 (/finnhub-key 등록 또는 FINNHUB_API_KEY 환경변수), 무료 한도 60 req/min (quote 15초 캐시). " +
			"실시간은 아니며 조회 시점 스냅샷입니다.",
		parameters: Type.Object({
			symbols: Type.String({ description: "종목 심볼 콤마 구분 (최대 10, 무료 티어 미국 종목), 예: AAPL,MSFT" }),
		}),
		async execute(_id, params) {
			try {
				const symbols = params.symbols.split(",").map((s) => s.trim()).filter(Boolean);
				if (symbols.length === 0) return jsonResult({ ok: false, error: "symbols가 비어 있습니다." });
				if (symbols.length > 10) return jsonResult({ ok: false, error: "symbols는 최대 10개입니다." });
				const quotes = await Promise.all(symbols.map((s) => getQuote(s)));
				return jsonResult(compact({ ok: true, quotes }));
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── finnhub: 차트·지표 ───────────────────────────────────────────────
	pi.registerTool({
		name: "finnhub_chart",
		label: "핀허브 차트·지표",
		description:
			"Finnhub(공식 API) 캔들 차트 조회 후 공용 지표(MA/RSI/ATR/볼린저/지지저항/추세) 계산 — pi-finance-core analyze. " +
			"resolution: D(일봉, 기본)/W(주봉)/M(월봉) — 기본 기간 최근 1년, 1/5/15/30/60(분봉) — 기본 기간 최근 5일. " +
			"from/to는 YYYY-MM-DD (선택, 미지정 시 기본 기간). **무료 티어는 미국 종목만**. " +
			"키 필요 (/finnhub-key), 무료 60 req/min (chart 60초 캐시). 참고용 분석이며 투자 결정의 책임은 사용자에게 있습니다.",
		parameters: Type.Object({
			symbol: Type.String({ description: "종목 심볼, 예: AAPL" }),
			resolution: Type.Optional(Type.Union([Type.Literal("1"), Type.Literal("5"), Type.Literal("15"), Type.Literal("30"), Type.Literal("60"), Type.Literal("D"), Type.Literal("W"), Type.Literal("M")], RESOLUTION_SCHEMA)),
			from: Type.Optional(Type.String({ description: "시작일 YYYY-MM-DD (미지정 시 기본: 일봉 이상 1년 전, 분봉 5일 전)" })),
			to: Type.Optional(Type.String({ description: "종료일 YYYY-MM-DD (미지정 시 오늘)" })),
		}),
		async execute(_id, params) {
			try {
				const { bars, meta } = await getCandles(params.symbol, {
					resolution: params.resolution as FinnhubResolution | undefined,
					from: params.from,
					to: params.to,
				});
				if (bars.length === 0) {
					return jsonResult({ ok: false, error: "차트 데이터 없음 — 조회 기간에 거래일이 없습니다." });
				}
				return jsonResult(
					compact({
						ok: true,
						source: "finnhub",
						symbol: params.symbol,
						resolution: meta.resolution,
						barCount: bars.length,
						lastBar: bars[bars.length - 1],
						recentBars: bars.slice(-10),
						...analyze(bars),
					}),
				);
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── finnhub: 뉴스 ────────────────────────────────────────────────────
	pi.registerTool({
		name: "finnhub_news",
		label: "핀허브 뉴스",
		description:
			"Finnhub(공식 API) 기업 뉴스 조회 — 기본 최근 7일 (from=오늘-7일, to=오늘). " +
			"from/to는 YYYY-MM-DD (선택). **무료 티어는 미국 종목만**. " +
			"응답: [{ headline, source, category, datetime(ISO), url, summary(200자) }] 최대 20건. " +
			"키 필요 (/finnhub-key), 무료 60 req/min (news 5분 캐시).",
		parameters: Type.Object({
			symbol: Type.String({ description: "종목 심볼, 예: AAPL" }),
			from: Type.Optional(Type.String({ description: "시작일 YYYY-MM-DD (기본: 오늘-7일)" })),
			to: Type.Optional(Type.String({ description: "종료일 YYYY-MM-DD (기본: 오늘)" })),
		}),
		async execute(_id, params) {
			try {
				const items = await getNews(params.symbol, { from: params.from, to: params.to });
				return jsonResult(compact({ ok: true, symbol: params.symbol, count: items.length, news: items }));
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── finnhub: 펀더멘털 ────────────────────────────────────────────────
	pi.registerTool({
		name: "finnhub_fundamentals",
		label: "핀허브 펀더멘털",
		description:
			"Finnhub(공식 API) 펀더멘털 종합 — 회사 프로필(/company-profile2) + 밸류에이션 메트릭(/stock/metrics: " +
			"PE·PBR·배당수익률·EPS·마진·ROE/ROA·FCF) + 애널리스트 컨센서스(/stock/recommendation: strongBuy~strongSell). " +
			"**무료 티어는 미국 종목만**. 키 필요 (/finnhub-key), 무료 60 req/min (fundamentals 30분 캐시). " +
			"응답: { ok, symbol, profile, metrics, recommendation }.",
		parameters: Type.Object({
			symbol: Type.String({ description: "종목 심볼, 예: AAPL" }),
		}),
		async execute(_id, params) {
			try {
				const data = await getFundamentals(params.symbol);
				return jsonResult(compact({ ok: true, ...data }));
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});
}
