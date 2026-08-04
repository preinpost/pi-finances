/**
 * src/agent/tools.ts — pi 툴 등록 (kis_* 9개 + toss_* 7개).
 *
 * 툴 name/label/description/parameters/출력 형태는 변경 불가(하위 호환).
 * execute 내부만 roles/core로 위임한다:
 *  - convenience 툴(현재가/차트) → roles/market.ts
 *  - generic 툴(kis_api/kis_list_apis/kis_realtime) → core 직접 사용
 *  - toss_* 툴 → roles/toss.ts (토스증권 — 시세·자산·주문·조건주문)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { callApi, listApis } from "../core/client.ts";
import { subscribeRealtime, wsTrIds } from "../core/ws.ts";
import {
	getDomesticChart,
	getDomesticPrice,
	getOverseasChart,
	getOverseasPrice,
} from "../roles/market.ts";
import { analyze, normalizeDomesticChart, normalizeOverseasChart, type Bar } from "../roles/indicators.ts";
import {
	getAnalystConsensus,
	getFinancialRatios,
	getIncomeStatement,
	getNews,
} from "../roles/research.ts";
import {
	cancelConditionalOrder,
	cancelOrder,
	getAccounts,
	getBuyingPower,
	getCandles,
	getCommissions,
	getConditionalOrder,
	getConditionalOrders,
	getExchangeRate,
	getHoldings,
	getInvestorTrading,
	getMarketCalendar,
	getMarketIndicatorCandles,
	getMarketIndicatorPrices,
	getOrder,
	getOrderbook,
	getOrders,
	getPriceLimits,
	getPrices,
	getRankings,
	getSellableQuantity,
	getStockInfo,
	getStockWarnings,
	getTrades,
	modifyConditionalOrder,
	modifyOrder,
	placeConditionalOrder,
	placeOrder,
} from "../roles/toss.ts";
import { getCandles as brokerGetCandles, getPrice as brokerGetPrice } from "../roles/broker.ts";

/** 툴 결과 공통 래퍼 — 기존 index.ts와 동일 형태. */
export function textResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

/**
 * 차트 응답에서 output2/output1 후보를 각각 정규화해 bar가 더 많은 쪽을 선택.
 * (output1이 1행 요약 배열인 경우 등 응답 구조 차이에 강건)
 */
function pickChartBars(out: Record<string, unknown>, normalize: (rows: Record<string, unknown>[]) => Bar[]): Bar[] {
	let best: Bar[] = [];
	for (const key of ["output2", "output1"] as const) {
		const rows = out[key];
		if (!Array.isArray(rows)) continue;
		const bars = normalize(rows as Record<string, unknown>[]);
		if (bars.length > best.length) best = bars;
	}
	return best;
}

/** 오늘 기준 YYYYMMDD (daysAgo일 전). */
export function dateStr(daysAgo = 0): string {
	const d = new Date(Date.now() - daysAgo * 86_400_000);
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** execute 공통 에러 래퍼 — 기존 { ok: false, error } 형태 유지. */
function jsonResult(value: unknown) {
	return textResult(JSON.stringify(value, null, 2));
}

export function registerTools(pi: ExtensionAPI): void {
	// ── generic dispatch ────────────────────────────────────────────────
	pi.registerTool({
		name: "kis_api",
		label: "KIS API",
		description:
			"한국투자증권 OPEN API 직접 호출 (시세/차트/호가/순위/주문). " +
			`api는 v2 키 형식 "category.api_id" (예: "overseas_stock.v1_해외주식-009", "domestic_stock.v1_국내주식-008"). ` +
			"전체 목록은 kis_list_apis로 조회 (구버전 키 'overseas_stock.price' 등도 alias로 동작). " +
			"params에는 스펙의 파라미터를 소문자 이름 또는 대문자 키로 전달 (예: excd, symb 또는 EXCD, SYMB). " +
			"다중 TR_ID API(주문 등)는 tr_id 파라미터 필수 — 미지정 시 사용 가능한 tr_id 목록이 에러로 표시됩니다. " +
			"pages(기본 1, 최대 10): tr_cont 연속조회 페이지네이션, output 배열이 병합됩니다. " +
			"env: real(실전)/paper(모의)/auto(기본). POST 주문/정정/취소 API는 hashkey 자동 적용.",
		parameters: Type.Object({
			api: Type.String({ description: 'v2 키, 예: "overseas_stock.v1_해외주식-009"' }),
			params: Type.Object({}, {
				description: "API 파라미터 (소문자 이름 또는 대문자 키, 예: { excd: \"NAS\", symb: \"RKLB\" })",
				additionalProperties: Type.Unknown(),
			}),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")], {
				description: "real(실전)/paper(모의)/auto(기본: 모의 키 있으면 모의)",
			})),
			tr_id: Type.Optional(Type.String({ description: "다중 TR_ID API용 명시적 tr_id (예: \"TTTT1002U\")" })),
			pages: Type.Optional(Type.Number({ description: "tr_cont 연속조회 페이지 수 (기본 1, 최대 10)" })),
		}),
		async execute(_id, params) {
			try {
				const result = await callApi(params.api, (params.params ?? {}) as Record<string, unknown>, {
					env: params.env ?? "auto",
					trId: params.tr_id,
					pages: params.pages,
				});
				return jsonResult(result);
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── API discovery ───────────────────────────────────────────────────
	pi.registerTool({
		name: "kis_list_apis",
		label: "KIS API 목록",
		description:
			"한국투자증권 OPEN API 목록 조회 (공식 포털 스펙 기반 338개). category 지정 시 해당 카테고리만 " +
			'(예: "overseas_stock", "domestic_stock"). kis_api 도구 호출 전에 v2 키를 확인할 때 사용.',
		parameters: Type.Object({
			category: Type.Optional(Type.String({ description: '카테고리 필터, 예: "overseas_stock"' })),
		}),
		async execute(_id, params) {
			const names = listApis(params.category || undefined);
			const cats: Record<string, number> = {};
			for (const n of names) {
				const c = n.split(".")[0];
				cats[c] = (cats[c] ?? 0) + 1;
			}
			const wsMap = wsTrIds();
			const websocketTrIds: Record<string, string> = {};
			for (const n of names) {
				const e = wsMap[n];
				if (e) websocketTrIds[n] = e.tr_id;
			}
			return jsonResult({
				total: names.length,
				categories: cats,
				apis: names,
				websocket_tr_ids: websocketTrIds,
			});
		},
	});

	// ── realtime: 실시간 시세 (WebSocket) ─────────────────────────────
	pi.registerTool({
		name: "kis_realtime",
		label: "실시간 시세 (WebSocket)",
		description:
			"한국투자증권 실시간 시세 구독 (WebSocket, REST와 별개 인증 — 웹소켓 전용 접속키 자동 발급/캐시). " +
			"tr_id(필수): ws-tr-ids.json 기준 실시간 TR_ID, tr_key: 종목코드. " +
			'예: 국내주식 실시간체결가 { tr_id: "H0STCNT0", tr_key: "005930" } (삼성전자), ' +
			'해외주식 실시간체결가 { tr_id: "HDFSCNT0", tr_key: "DNASRKLB" } (RKLB, D+시장구분3자리+종목코드). ' +
			"호가 H0STASP0/HDFSASP0, 체결통보 H0STCNI0(tr_key=HTS ID) 등 — 전체 tr_id는 kis_list_apis 결과의 websocket_tr_ids 참고. " +
			"duration_sec 후 자동 구독해제(tr_type=2)+종료. 장 마감이면 메시지 0개여도 정상입니다.",
		parameters: Type.Object({
			tr_id: Type.String({ description: '실시간 TR_ID (예: "H0STCNT0" 국내체결, "HDFSCNT0" 해외체결)' }),
			tr_key: Type.String({ description: '구독 종목코드 (예: "005930", "DNASRKLB", HTS ID)' }),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")], {
				description: "real(실전)/paper(모의)/auto(기본: 모의 키 있으면 모의)",
			})),
			duration_sec: Type.Optional(Type.Number({ description: "구독 시간(초) — 기본 10, 최대 60" })),
			max_messages: Type.Optional(Type.Number({ description: "최대 수신 메시지 수 — 기본 20" })),
		}),
		async execute(_id, params) {
			const trId = params.tr_id.toUpperCase();
			const known = Object.values(wsTrIds()).some((e) => e.tr_id === trId);
			if (!known) {
				const list = Object.entries(wsTrIds())
					.map(([k, e]) => `${e.tr_id} : ${e.name} (${k})`)
					.sort()
					.join("\n");
				return jsonResult({
					ok: false,
					error: `알 수 없는 tr_id "${trId}" — ws-tr-ids.json 기준 사용 가능한 목록:\n${list}`,
				});
			}
			try {
				const result = await subscribeRealtime({
					trId,
					trKey: params.tr_key,
					env: params.env ?? "auto",
					durationMs: (params.duration_sec ?? 10) * 1000,
					maxMessages: params.max_messages ?? 20,
				});
				return jsonResult(result);
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── convenience: 해외주식 현재체결가 ────────────────────────────────
	pi.registerTool({
		name: "kis_overseas_price",
		label: "해외주식 현재가",
		description:
			"해외주식(미국 등) 현재체결가 조회 (v2 키: overseas_stock.v1_해외주식-009, tr_id HHDFS00000300). " +
			"excd: NAS(나스닥)/NYS(뉴욕)/AMS(아멕스), symb: 종목코드(예: RKLB, AAPL). " +
			"rt_cd=0이면 성공이며 output에 현재가/전일대비 등이 담깁니다. 실시간 시세는 유료 구독일 수 있습니다.",
		parameters: Type.Object({
			excd: Type.String({ description: "거래소: NAS(나스닥)/NYS(뉴욕)/AMS(아멕스)" }),
			symb: Type.String({ description: "종목코드, 예: RKLB, AAPL" }),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await getOverseasPrice(params.excd, params.symb, params.env ?? "auto");
				return jsonResult(result);
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── convenience: 해외주식 기간별시세 (일/주/월 차트) ────────────────
	pi.registerTool({
		name: "kis_overseas_chart",
		label: "해외주식 차트",
		description:
			"해외주식 기간별시세(일/주/월) 조회 (v2 키: overseas_stock.v1_해외주식-010, tr_id HHDFS76240000). " +
			"excd: NAS/NYS/AMS, symb: 종목코드. " +
			"gubn: 0=일별, 1=주별, 2=월별. bymd: 조회기준일(YYYYMMDD, 기본 오늘). modp: 0=미반영(기본), 1=수정주가 반영. " +
			"output2에 기간별 시세 목록(최대 100행)이 담기므로 52주 고점/저점 계산 등에 활용. " +
			"100행 초과 구간이 필요하면 bymd를 과거 날짜로 지정해 여러 번 호출. " +
			"(지수/환율용 inquire_daily_chartprice는 kis_api로 호출 가능)",
		parameters: Type.Object({
			excd: Type.String({ description: "거래소: NAS/NYS/AMS" }),
			symb: Type.String({ description: "종목코드, 예: RKLB" }),
			gubn: Type.Optional(Type.Union([Type.Literal("0"), Type.Literal("1"), Type.Literal("2")], { description: "0=일별(기본), 1=주별, 2=월별" })),
			bymd: Type.Optional(Type.String({ description: "조회기준일 YYYYMMDD (기본: 오늘)" })),
			modp: Type.Optional(Type.Union([Type.Literal("0"), Type.Literal("1")], { description: "0=미반영(기본), 1=수정주가 반영" })),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await getOverseasChart(params.excd, params.symb, {
					gubn: params.gubn ?? "0",
					bymd: params.bymd ?? dateStr(),
					modp: params.modp ?? "0",
					env: params.env ?? "auto",
				});
				return jsonResult(result);
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── convenience: 국내주식 현재가 ────────────────────────────────────
	pi.registerTool({
		name: "kis_domestic_price",
		label: "국내주식 현재가",
		description:
			"국내주식 현재가 조회 (v2 키: domestic_stock.v1_국내주식-008, tr_id FHKST01010100). " +
			"symb: 6자리 종목코드 (예: 005930=삼성전자). " +
			"output에 현재가/전일대비/등락률 등이 담깁니다.",
		parameters: Type.Object({
			symb: Type.String({ description: "6자리 종목코드, 예: 005930" }),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await getDomesticPrice(params.symb, params.env ?? "auto");
				return jsonResult(result);
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── convenience: 국내주식 기간별시세 (일/주/월/년 차트) ─────────────
	pi.registerTool({
		name: "kis_domestic_chart",
		label: "국내주식 차트",
		description:
			"국내주식 기간별시세(일/주/월/년) 조회 (v2 키: domestic_stock.v1_국내주식-016, tr_id FHKST03010100). " +
			"symb: 6자리 종목코드 (예: 005930), period: D=일봉(기본)/W=주봉/M=월봉/Y=년봉. " +
			"date1/date2: 조회 기간 YYYYMMDD (기본: 최근 150일 ~ 오늘, 최대 100개 데이터). " +
			"output1에 기간별 시세 목록이 담깁니다.",
		parameters: Type.Object({
			symb: Type.String({ description: "6자리 종목코드, 예: 005930" }),
			period: Type.Optional(Type.Union([Type.Literal("D"), Type.Literal("W"), Type.Literal("M"), Type.Literal("Y")], { description: "D=일봉(기본), W=주봉, M=월봉, Y=년봉" })),
			date1: Type.Optional(Type.String({ description: "조회 시작일자 YYYYMMDD (기본: 오늘-150일)" })),
			date2: Type.Optional(Type.String({ description: "조회 종료일자 YYYYMMDD (기본: 오늘)" })),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await getDomesticChart(params.symb, {
					period: params.period ?? "D",
					date1: params.date1 ?? dateStr(150),
					date2: params.date2 ?? dateStr(),
					env: params.env ?? "auto",
				});
				return jsonResult(result);
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── research: 재무/뉴스/컨센서스 ──────────────────────────────────
	pi.registerTool({
		name: "kis_research",
		label: "주식 리서치 (재무/뉴스/컨센서스)",
		description:
			"국내주식 리서치 데이터 조회 — 재무제표(손익계산서 v1_국내주식-079/FHKST66430200, 재무비율 v1_국내주식-080/FHKST66430300), " +
			"뉴스(국내주식-141/FHKST01011800), 애널리스트 컨센서스(국내주식-187/HHKST668300C0). " +
			"분기 데이터는 연단위 누적합산 기준이며, 컨센서스는 한국투자 리서치 커버 약 160개 기업 한정(빈 응답 가능 — '커버 안 됨' 표기).",
		parameters: Type.Object({
			kind: Type.Union(
				[Type.Literal("income"), Type.Literal("ratios"), Type.Literal("news"), Type.Literal("consensus")],
				{ description: "income=손익계산서, ratios=재무비율, news=뉴스, consensus=애널리스트 컨센서스" },
			),
			symb: Type.String({ description: "6자리 종목코드, 예: 005930" }),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")], {
				description: "real(실전)/paper(모의)/auto(기본: 모의 키 있으면 모의)",
			})),
		}),
		async execute(_id, params) {
			try {
				const env = params.env ?? "auto";
				const result =
					params.kind === "income" ? await getIncomeStatement(params.symb, env)
					: params.kind === "ratios" ? await getFinancialRatios(params.symb, env)
					: params.kind === "news" ? await getNews(params.symb, env)
					: await getAnalystConsensus(params.symb, env);
				return jsonResult(result);
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── technical: 기술적 분석 (타점) ───────────────────────────────────
	pi.registerTool({
		name: "kis_technical",
		label: "기술적 분석 (타점)",
		description:
			"매수/매도 타점용 기술적 지표 계산 — 차트(국내 v1_국내주식-016 / 해외 v1_해외주식-010)를 조회해 " +
			"MA5/20/60, RSI(14), ATR(14), 볼린저(20,2), 지지/저항(최근 20봉), 추세(정배열/역배열)를 계산하고 " +
			"신호 라벨(골든크로스, RSI 과매수/과매도, 저항 돌파, 볼린저 터치 등)을 반환합니다. " +
			"국내는 최대 100봉, 해외는 최대 100행 한계 — 장기(200일 MA 등) 지표가 필요하면 기간을 나눠 여러 번 호출해 합산하세요. " +
			"참고용 분석이며 투자 결정의 책임은 사용자에게 있습니다.",
		parameters: Type.Object({
			symb: Type.String({ description: "6자리 국내 종목코드(예: 005930) 또는 해외 티커(예: RKLB)" }),
			market: Type.Union([Type.Literal("domestic"), Type.Literal("overseas")], { description: "domestic=국내, overseas=해외" }),
			period: Type.Optional(Type.Union([Type.Literal("D"), Type.Literal("W"), Type.Literal("M")], { description: "D=일봉(기본), W=주봉, M=월봉" })),
			excd: Type.Optional(Type.String({ description: "해외 거래소: NAS(기본)/NYS/AMS (market=overseas일 때 사용)" })),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")], {
				description: "real(실전)/paper(모의)/auto(기본: 모의 키 있으면 모의)",
			})),
		}),
		async execute(_id, params) {
			try {
				const env = params.env ?? "auto";
				const period = params.period ?? "D";
				if (params.market === "domestic") {
					const res = await getDomesticChart(params.symb, {
						period,
						date1: dateStr(250),
						date2: dateStr(),
						env,
					});
					const out = res.data as Record<string, unknown>;
					const bars = pickChartBars(out, normalizeDomesticChart);
					if (bars.length === 0) {
						return jsonResult({ ok: false, error: "차트 데이터 없음 — 종목코드/기간을 확인하거나 장 마감 후 재시도하세요." });
					}
					return jsonResult({ ok: true, market: "domestic", symb: params.symb, period, ...analyze(bars) });
				}
				const res = await getOverseasChart(params.excd ?? "NAS", params.symb, {
					gubn: period === "D" ? "0" : period === "W" ? "1" : "2",
					bymd: dateStr(),
					env,
				});
				const out = res.data as Record<string, unknown>;
				const bars = pickChartBars(out, normalizeOverseasChart);
				if (bars.length === 0) {
					return jsonResult({ ok: false, error: "차트 데이터 없음 — 티커/거래소(excd)를 확인하거나 장 마감 후 재시도하세요." });
				}
				return jsonResult({ ok: true, market: "overseas", symb: params.symb, excd: params.excd ?? "NAS", period, ...analyze(bars) });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── toss: 현재가 ─────────────────────────────────────────────────────
	pi.registerTool({
		name: "toss_price",
		label: "토스 현재가",
		description:
			"토스증권 현재가 조회 (국내 KRX 6자리 / 해외 US 티커). symbols: 최대 200개 콤마 구분 " +
			"(예: \"005930,000660\" 또는 \"AAPL,MSFT\"). 응답: [{ symbol, timestamp, lastPrice, currency }]. " +
			"토스 키 등록 필요 (/toss-key에서 client_id/secret). 실시간 시세는 아니며 조회 시점 스냅샷입니다.",
		parameters: Type.Object({
			symbols: Type.String({ description: "종목 심볼 콤마 구분 (최대 200), 예: 005930,000660 또는 AAPL,MSFT" }),
		}),
		async execute(_id, params) {
			try {
				const prices = await getPrices(params.symbols.split(",").map((s) => s.trim()).filter(Boolean));
				return jsonResult({ ok: true, prices });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── toss: 캔들 차트 + 지표 ───────────────────────────────────────────
	pi.registerTool({
		name: "toss_chart",
		label: "토스 차트·지표",
		description:
			"토스증권 캔들 차트 조회 후 공용 지표(MA/RSI/ATR/볼린저/지지저항/추세) 계산 — kis_technical과 동일 로직(공용 indicators). " +
			"interval: 1d(일봉, 기본)/1m(1분봉) — 토스는 **주봉/월봉 미지원** (필요 시 일봉을 주 단위로 집계). " +
			"count 최대 200 (기본 100). adjusted: 수정주가 반영 여부. 참고용 분석이며 투자 결정의 책임은 사용자에게 있습니다.",
		parameters: Type.Object({
			symbol: Type.String({ description: "종목 심볼, 예: 005930 또는 AAPL" }),
			interval: Type.Optional(Type.Union([Type.Literal("1m"), Type.Literal("1d")], { description: "1d=일봉(기본), 1m=1분봉" })),
			count: Type.Optional(Type.Number({ description: "조회 봉 수 (기본 100, 최대 200)" })),
			adjusted: Type.Optional(Type.Boolean({ description: "수정주가 반영 여부 (미지정 시 서버 기본 — 수정주가 반영)" })),
		}),
		async execute(_id, params) {
			try {
				const { bars, nextBefore } = await getCandles(params.symbol, {
					interval: params.interval ?? "1d",
					count: params.count,
					adjusted: params.adjusted,
				});
				if (bars.length === 0) {
					return jsonResult({ ok: false, error: "차트 데이터 없음 — 심볼을 확인하거나 장 마감 후 재시도하세요." });
				}
				return jsonResult({ ok: true, broker: "toss", symbol: params.symbol, interval: params.interval ?? "1d", nextBefore, ...analyze(bars) });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── toss: 비겹침 시장 데이터 ─────────────────────────────────────────
	pi.registerTool({
		name: "toss_market",
		label: "토스 시장 데이터",
		description:
			"토스증권 전용 시장 데이터 조회 (KIS와 비겹침 — 인사이트 보강용): " +
			"exchange-rate(환율), calendar-KR/calendar-US(장운영시간: KRX·NXT·미국 프리/정규/애프터), " +
			"rankings(랭킹), indicator-prices(국내 지수·국채), investor-trading(코스피/코스닥 투자자별 매매대금), " +
			"stock-info(종목 기본정보), warnings(매수 유의사항: 정리매매/과열/투자경고/VI). " +
			"rankings는 type(거래대금/거래량/상승·하락률)+marketCountry(KR/US)+duration(기간) 필수. " +
			"토스 키 등록 필요 (/toss-key).",
		parameters: Type.Object({
			kind: Type.Union(
				[
					Type.Literal("exchange-rate"),
					Type.Literal("calendar-KR"),
					Type.Literal("calendar-US"),
					Type.Literal("rankings"),
					Type.Literal("indicator-prices"),
					Type.Literal("investor-trading"),
					Type.Literal("stock-info"),
					Type.Literal("warnings"),
				],
				{ description: "조회 종류 (exchange-rate/calendar-KR/calendar-US/rankings/indicator-prices/investor-trading/stock-info/warnings)" },
			),
			symbol: Type.Optional(Type.String({ description: "investor-trading은 KOSPI/KOSDAQ, 그 외 종목 심볼 (indicator-prices는 콤마 구분)" })),
			rankingsType: Type.Optional(
				Type.Union(
					[
						Type.Literal("MARKET_TRADING_AMOUNT"),
						Type.Literal("MARKET_TRADING_VOLUME"),
						Type.Literal("TOP_GAINERS"),
						Type.Literal("TOP_LOSERS"),
						Type.Literal("TOSS_SECURITIES_TRADING_AMOUNT"),
						Type.Literal("TOSS_SECURITIES_TRADING_VOLUME"),
					],
					{ description: "rankings 종류" },
				),
			),
			rankingsMarket: Type.Optional(Type.Union([Type.Literal("KR"), Type.Literal("US")], { description: "rankings 시장 (KR/US)" })),
			rankingsDuration: Type.Optional(
				Type.Union(
					[
						Type.Literal("realtime"),
						Type.Literal("1d"),
						Type.Literal("1w"),
						Type.Literal("1mo"),
						Type.Literal("3mo"),
						Type.Literal("6mo"),
						Type.Literal("1y"),
					],
					{ description: "rankings 누적 기간 (realtime/1d/1w/1mo/3mo/6mo/1y)" },
				),
			),
			interval: Type.Optional(Type.Union([Type.Literal("1d"), Type.Literal("1w"), Type.Literal("1mo"), Type.Literal("1y")], { description: "investor-trading 집계 기간 (기본 1d)" })),
		}),
		async execute(_id, params) {
			try {
				switch (params.kind) {
					case "exchange-rate":
						return jsonResult({ ok: true, kind: params.kind, data: await getExchangeRate() });
					case "calendar-KR":
						return jsonResult({ ok: true, kind: params.kind, data: await getMarketCalendar("KR") });
					case "calendar-US":
						return jsonResult({ ok: true, kind: params.kind, data: await getMarketCalendar("US") });
					case "rankings":
						if (!params.rankingsType || !params.rankingsMarket || !params.rankingsDuration) {
							return jsonResult({ ok: false, error: "rankings는 rankingsType/rankingsMarket(KR·US)/rankingsDuration 모두 필요합니다." });
						}
						return jsonResult({
							ok: true,
							kind: params.kind,
							data: await getRankings({
								type: params.rankingsType,
								marketCountry: params.rankingsMarket,
								duration: params.rankingsDuration,
							}),
						});
					case "indicator-prices":
						if (!params.symbol) {
							return jsonResult({ ok: false, error: "indicator-prices는 symbol(콤마 구분 가능) 필요합니다." });
						}
						return jsonResult({ ok: true, kind: params.kind, data: await getMarketIndicatorPrices(params.symbol.split(",").map((s) => s.trim())) });
					case "investor-trading":
						if (params.symbol !== "KOSPI" && params.symbol !== "KOSDAQ") {
							return jsonResult({ ok: false, error: "investor-trading은 symbol=KOSPI 또는 KOSDAQ만 지원합니다." });
						}
						return jsonResult({ ok: true, kind: params.kind, data: await getInvestorTrading(params.symbol, { interval: params.interval ?? "1d" }) });
					case "stock-info":
						if (!params.symbol) return jsonResult({ ok: false, error: "stock-info는 symbol 필요합니다." });
						return jsonResult({ ok: true, kind: params.kind, data: await getStockInfo(params.symbol) });
					case "warnings":
						if (!params.symbol) return jsonResult({ ok: false, error: "warnings는 symbol 필요합니다." });
						return jsonResult({ ok: true, kind: params.kind, data: await getStockWarnings(params.symbol) });
				}
				return jsonResult({ ok: false, error: `알 수 없는 kind: ${params.kind}` });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── toss: 자산 종합 ──────────────────────────────────────────────────
	pi.registerTool({
		name: "toss_balance",
		label: "토스 자산 종합",
		description:
			"토스증권 자산 종합 조회 — 계좌 목록 + 보유종목(평가금액·손익) + 매수 가능 금액(KRW·USD) + 매매 수수료. " +
			"KIS와 비겹침 데이터(수수료율 등) 포함. accountSeq 미지정 시 첫 계좌 사용. 토스 키 등록 필요 (/toss-key).",
		parameters: Type.Object({
			accountSeq: Type.Optional(Type.Number({ description: "계좌 식별 키 (미지정 시 첫 계좌 자동)" })),
		}),
		async execute(_id, params) {
			try {
				const [accounts, holdings, buyingPowerKRW, buyingPowerUSD, commissions] = await Promise.all([
					getAccounts(),
					getHoldings(undefined, params.accountSeq),
					getBuyingPower("KRW", params.accountSeq),
					getBuyingPower("USD", params.accountSeq),
					getCommissions(params.accountSeq),
				]);
				return jsonResult({
					ok: true,
					accounts,
					holdings,
					buyingPower: { KRW: buyingPowerKRW, USD: buyingPowerUSD },
					commissions,
				});
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── toss: 주문 ───────────────────────────────────────────────────────
	pi.registerTool({
		name: "toss_order",
		label: "토스 주문",
		description:
			"토스증권 주문 생성 (실전 — **사용자 확인 후에만 호출**). side: BUY/SELL, orderType: LIMIT(지정가, price 필요)/MARKET(시장가). " +
			"수량 주문(quantity) 기본 — US 금액 매수는 orderType=MARKET + orderAmount(USD). " +
			"1억원 이상 주문은 confirmHighValueOrder=true 필수 (기본 false → 거부). " +
			"clientOrderId 멱등키 자동 생성(중복 주문 방지). 응답: { orderId, clientOrderId }. accountSeq 미지정 시 첫 계좌.",
		parameters: Type.Object({
			symbol: Type.String({ description: "종목 심볼, 예: 005930 또는 AAPL" }),
			side: Type.Union([Type.Literal("BUY"), Type.Literal("SELL")], { description: "매수/매도" }),
			orderType: Type.Union([Type.Literal("LIMIT"), Type.Literal("MARKET")], { description: "LIMIT=지정가, MARKET=시장가" }),
			quantity: Type.Optional(Type.String({ description: "수량 (주 단위) — LIMIT/MARKET 공용" })),
			price: Type.Optional(Type.String({ description: "지정가 주문 가격 (orderType=LIMIT 필수)" })),
			orderAmount: Type.Optional(Type.String({ description: "금액 주문 (US MARKET 매수 전용, USD)" })),
			timeInForce: Type.Optional(Type.Union([Type.Literal("DAY"), Type.Literal("CLS")], { description: "DAY=당일, CLS=체결시까지 (기본 DAY)" })),
			accountSeq: Type.Optional(Type.Number({ description: "계좌 식별 키 (미지정 시 첫 계좌 자동)" })),
			confirmHighValueOrder: Type.Optional(Type.Boolean({ description: "1억원 이상 주문 동의 (기본 false)" })),
		}),
		async execute(_id, params) {
			try {
				const res = await placeOrder({
					symbol: params.symbol,
					side: params.side,
					orderType: params.orderType,
					quantity: params.quantity,
					price: params.price,
					orderAmount: params.orderAmount,
					timeInForce: params.timeInForce,
					accountSeq: params.accountSeq,
					confirmHighValueOrder: params.confirmHighValueOrder,
				});
				return jsonResult({ ok: true, ...res });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── toss: 주문 조회/정정/취소 ────────────────────────────────────────
	pi.registerTool({
		name: "toss_orders",
		label: "토스 주문 관리",
		description:
			"토스증권 주문 목록/상세/정정/취소. action: list(목록, status=OPEN/CLOSED 기본 OPEN)/detail(상세, orderId 필요)/modify(정정, orderId 필요 — orderType/quantity/price)/cancel(취소, orderId 필요). " +
			"정정·취소는 실전 주문이므로 **사용자 확인 후에만** 호출. accountSeq 미지정 시 첫 계좌.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("detail"), Type.Literal("modify"), Type.Literal("cancel")], { description: "동작" }),
			orderId: Type.Optional(Type.String({ description: "주문 식별자 (detail/modify/cancel 필수)" })),
			status: Type.Optional(Type.Union([Type.Literal("OPEN"), Type.Literal("CLOSED")], { description: "list 필터 (기본 OPEN)" })),
			symbol: Type.Optional(Type.String({ description: "list 필터 — 종목 심볼" })),
			from: Type.Optional(Type.String({ description: "list 필터 — 조회 시작일 (KST)" })),
			to: Type.Optional(Type.String({ description: "list 필터 — 조회 종료일 (KST)" })),
			orderType: Type.Optional(Type.Union([Type.Literal("LIMIT"), Type.Literal("MARKET")], { description: "modify 대상 호가 유형" })),
			quantity: Type.Optional(Type.String({ description: "modify 수량" })),
			price: Type.Optional(Type.String({ description: "modify 가격 (LIMIT)" })),
			accountSeq: Type.Optional(Type.Number({ description: "계좌 식별 키 (미지정 시 첫 계좌 자동)" })),
		}),
		async execute(_id, params) {
			try {
				switch (params.action) {
					case "list":
						return jsonResult({ ok: true, action: params.action, data: await getOrders({ status: params.status, symbol: params.symbol, from: params.from, to: params.to, accountSeq: params.accountSeq }) });
					case "detail":
						if (!params.orderId) return jsonResult({ ok: false, error: "detail은 orderId 필요합니다." });
						return jsonResult({ ok: true, action: params.action, data: await getOrder(params.orderId, params.accountSeq) });
					case "modify":
						if (!params.orderId) return jsonResult({ ok: false, error: "modify는 orderId 필요합니다." });
						if (!params.orderType) return jsonResult({ ok: false, error: "modify는 orderType(LIMIT/MARKET) 필요합니다." });
						return jsonResult({ ok: true, action: params.action, data: await modifyOrder(params.orderId, { orderType: params.orderType, quantity: params.quantity, price: params.price }, params.accountSeq) });
					case "cancel":
						if (!params.orderId) return jsonResult({ ok: false, error: "cancel은 orderId 필요합니다." });
						return jsonResult({ ok: true, action: params.action, data: await cancelOrder(params.orderId, params.accountSeq) });
				}
				return jsonResult({ ok: false, error: `알 수 없는 action: ${params.action}` });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── toss: 조건주문 (토스 강점) ───────────────────────────────────────
	pi.registerTool({
		name: "toss_conditional",
		label: "토스 조건주문",
		description:
			"토스증권 조건주문 (KIS에 없는 강점 기능) — type: SINGLE(1조건)/OCO(둘 중 하나 체결 시 나머지 취소)/OTO(부모 체결 후 자식). " +
			"create/modify: side(BUY/SELL) + triggerPrice(트리거 가격) 필수, orderPrice(지정가, LIMIT 시), expireDate(YYYY-MM-DD). " +
			"OCO/OTO는 secondTriggerPrice/secondOrderPrice로 두번째 조건 지정 (지정가 LIMIT만 허용). " +
			"list(기본 OPEN)/detail/cancel은 conditionalOrderId 필요. 실전 주문 — **사용자 확인 후에만** 호출. " +
			"confirmHighValueOrder: 1억원 이상 동의 (기본 false).",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("create"), Type.Literal("list"), Type.Literal("detail"), Type.Literal("modify"), Type.Literal("cancel")], { description: "동작" }),
			type: Type.Optional(Type.Union([Type.Literal("SINGLE"), Type.Literal("OCO"), Type.Literal("OTO")], { description: "create/modify: 조건주문 타입 (기본 SINGLE)" })),
			symbol: Type.Optional(Type.String({ description: "종목 심볼, 예: 005930 또는 AAPL (create 필수)" })),
			side: Type.Optional(Type.Union([Type.Literal("BUY"), Type.Literal("SELL")], { description: "조건 매매 유형 (create/modify 필수, OCO/OTO는 동일 적용)" })),
			quantity: Type.Optional(Type.String({ description: "수량 (주 단위, 그룹 공통) (create/modify 필수)" })),
			orderType: Type.Optional(Type.Union([Type.Literal("LIMIT"), Type.Literal("MARKET")], { description: "호가 유형 (create/modify 필수, OCO/OTO는 LIMIT만)" })),
			expireDate: Type.Optional(Type.String({ description: "만료일 YYYY-MM-DD (create/modify 필수)" })),
			triggerPrice: Type.Optional(Type.String({ description: "첫번째 조건 트리거 가격 (create/modify 필수)" })),
			orderPrice: Type.Optional(Type.String({ description: "첫번째 조건 지정가 (orderType=LIMIT)" })),
			secondTriggerPrice: Type.Optional(Type.String({ description: "두번째 조건 트리거 가격 (OCO/OTO 필수)" })),
			secondOrderPrice: Type.Optional(Type.String({ description: "두번째 조건 지정가 (OCO/OTO, LIMIT)" })),
			conditionalOrderId: Type.Optional(Type.String({ description: "조건주문 식별자 (detail/modify/cancel 필수)" })),
			status: Type.Optional(Type.Union([Type.Literal("OPEN"), Type.Literal("CLOSED")], { description: "list 필터 (기본 OPEN)" })),
			confirmHighValueOrder: Type.Optional(Type.Boolean({ description: "1억원 이상 주문 동의 (기본 false)" })),
			accountSeq: Type.Optional(Type.Number({ description: "계좌 식별 키 (미지정 시 첫 계좌 자동)" })),
		}),
		async execute(_id, params) {
			try {
				switch (params.action) {
					case "create": {
						if (!params.symbol || !params.side || !params.quantity || !params.orderType || !params.expireDate || !params.triggerPrice) {
							return jsonResult({ ok: false, error: "create는 symbol/side/quantity/orderType/expireDate/triggerPrice가 필요합니다." });
						}
						const first = {
							orderSide: params.side,
							triggerPrice: params.triggerPrice,
							orderPrice: params.orderPrice,
						};
						const second =
							params.secondTriggerPrice !== undefined
								? { orderSide: params.side, triggerPrice: params.secondTriggerPrice, orderPrice: params.secondOrderPrice }
								: undefined;
						const data = await placeConditionalOrder({
							symbol: params.symbol,
							type: params.type ?? "SINGLE",
							quantity: params.quantity,
							orderType: params.orderType,
							expireDate: params.expireDate,
							first,
							second,
							confirmHighValueOrder: params.confirmHighValueOrder,
							accountSeq: params.accountSeq,
						});
						return jsonResult({ ok: true, action: params.action, ...data });
					}
					case "list":
						return jsonResult({ ok: true, action: params.action, data: await getConditionalOrders({ status: params.status, symbol: params.symbol, accountSeq: params.accountSeq }) });
					case "detail":
						if (!params.conditionalOrderId) return jsonResult({ ok: false, error: "detail은 conditionalOrderId 필요합니다." });
						return jsonResult({ ok: true, action: params.action, data: await getConditionalOrder(params.conditionalOrderId, params.accountSeq) });
					case "modify":
						if (!params.conditionalOrderId || !params.type || !params.side || !params.quantity || !params.orderType || !params.expireDate || !params.triggerPrice) {
							return jsonResult({ ok: false, error: "modify는 conditionalOrderId/type/side/quantity/orderType/expireDate/triggerPrice가 필요합니다." });
						}
						return jsonResult({
							ok: true,
							action: params.action,
							data: await modifyConditionalOrder(
								params.conditionalOrderId,
								{
									type: params.type,
									quantity: params.quantity,
									orderType: params.orderType,
									expireDate: params.expireDate,
									first: { orderSide: params.side, triggerPrice: params.triggerPrice, orderPrice: params.orderPrice },
									second:
										params.secondTriggerPrice !== undefined
											? { orderSide: params.side, triggerPrice: params.secondTriggerPrice, orderPrice: params.secondOrderPrice }
											: undefined,
									confirmHighValueOrder: params.confirmHighValueOrder,
								},
								params.accountSeq,
							),
						});
					case "cancel":
						if (!params.conditionalOrderId) return jsonResult({ ok: false, error: "cancel은 conditionalOrderId 필요합니다." });
						await cancelConditionalOrder(params.conditionalOrderId, params.accountSeq);
						return jsonResult({ ok: true, action: params.action, cancelled: params.conditionalOrderId });
				}
				return jsonResult({ ok: false, error: `알 수 없는 action: ${params.action}` });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── broker: KIS/Toss 자동 폴백 (시세·차트만) ────────────────────────
	pi.registerTool({
		name: "broker_price",
		label: "현재가 (KIS/Toss 자동 폴백)",
		description:
			"현재가 조회 — KIS/Toss 자동 폴백 (등록된 브로커 우선, 실패 시 상대 브로커). " +
			"국내 6자리(005930) 또는 해외 티커(RKLB) 모두 지원. 응답에 source: primary/fallback 표시. " +
			"시세 전용 — 계좌·주문은 각 브로커 툴(kis_*/toss_*)을 명시적으로 사용하세요. " +
			"KIS/Toss 키가 모두 없으면 /kis-key 또는 /toss-key 안내.",
		parameters: Type.Object({
			symbol: Type.String({ description: "종목 심볼: 6자리 국내코드 또는 해외 티커, 예: 005930 / RKLB" }),
			prefer: Type.Optional(Type.Union([Type.Literal("kis"), Type.Literal("toss")], { description: "우선 브로커 (기본: 등록된 브로커 중 KIS 우선)" })),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")], {
				description: "real(실전)/paper(모의)/auto(기본) — KIS 호출에만 적용",
			})),
		}),
		async execute(_id, params) {
			try {
				const price = await brokerGetPrice(params.symbol, { prefer: params.prefer, env: params.env ?? "auto" });
				return jsonResult({ ok: true, ...price });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	pi.registerTool({
		name: "broker_chart",
		label: "차트·지표 (KIS/Toss 자동 폴백)",
		description:
			"차트 조회 + 기술지표 — KIS/Toss 자동 폴백. period: D=일봉(KIS→Toss 폴백), W/M=주/월봉(KIS 전용), " +
			"1m=Toss 1분봉 (1d는 D와 동일 — KIS 등록 시 KIS가 우선). bars는 공용 지표(MA/RSI/ATR/볼린저/지지저항/추세)로 계산해 함께 반환합니다. " +
			"참고용 분석이며 투자 결정의 책임은 사용자에게 있습니다.",
		parameters: Type.Object({
			symbol: Type.String({ description: "종목 심볼: 6자리 국내코드 또는 해외 티커, 예: 005930 / RKLB" }),
			period: Type.Optional(Type.Union([Type.Literal("D"), Type.Literal("W"), Type.Literal("M"), Type.Literal("1d"), Type.Literal("1m")], { description: "봉 단위 (기본 D)" })),
			count: Type.Optional(Type.Number({ description: "조회 봉 수 (토스, 최대 200, 기본 100)" })),
			prefer: Type.Optional(Type.Union([Type.Literal("kis"), Type.Literal("toss")], { description: "우선 브로커 (기본: 등록된 브로커 중 KIS 우선)" })),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")], {
				description: "real(실전)/paper(모의)/auto(기본) — KIS 호출에만 적용",
			})),
		}),
		async execute(_id, params) {
			try {
				const result = await brokerGetCandles(params.symbol, {
					period: params.period ?? "D",
					count: params.count,
					prefer: params.prefer,
					env: params.env ?? "auto",
				});
				const indicators = analyze(result.bars);
				return jsonResult({ ok: true, broker: result.broker, period: result.period, source: result.source, bars: result.bars, indicators });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});
}
