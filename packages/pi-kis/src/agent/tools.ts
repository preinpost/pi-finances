/**
 * src/agent/tools.ts — pi 툴 등록 (kis_* 10개 + broker_* 2개).
 *
 * 툴 name/label/description/parameters/출력 형태는 변경 불가(하위 호환).
 * execute 내부만 roles/core로 위임한다:
 *  - convenience 툴(현재가/차트) → roles/market.ts
 *  - generic 툴(kis_api/kis_list_apis/kis_realtime) → core 직접 사용
 *  - broker_* 툴 → roles/broker.ts (KIS 우선 — 토스는 pi-toss 패키지)
 *
 * 토스증권 툴(toss_*)은 v0.3.0부터 pi-toss 패키지로 분리됨.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { callApi, listApis } from "../client.ts";
import { subscribeRealtime, wsTrIds } from "../ws.ts";
import {
	getDomesticChart,
	getDomesticPrice,
	getOverseasChart,
	getOverseasPrice,
} from "../roles/market.ts";
import { analyze, normalizeDomesticChart, normalizeOverseasChart, type Bar } from "pi-finance-core";
import {
	getAnalystConsensus,
	getFinancialRatios,
	getIncomeStatement,
	getNews,
} from "../roles/research.ts";
import { getCandles as brokerGetCandles, getPrice as brokerGetPrice } from "../roles/broker.ts";
import {
	getDerivativesMarketTime,
	getFuturePrice,
	getFutureProductInfo,
	getOptionChart,
	getOptionGreeks,
	getOptionPrice,
	getOptionProductInfo,
	getOptionQuote,
	parseOverseasOptionCode,
} from "../roles/derivatives.ts";

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
			"rt_cd=0이면 성공이며 output에 현재가/전일대비 등이 담깁니다. " +
			"⚠️ 종목이 실제 상장된 거래소 코드로만 데이터가 반환됩니다 (ORCL=NYS, AAPL=NAS) — 빈 응답이면 excd 재확인. " +
			"실시간 시세는 유료 구독일 수 있습니다. broker_price는 NAS→NYS→AMS 자동 폴백.",
		parameters: Type.Object({
			excd: Type.String({ description: "거래소: NAS(나스닥)/NYS(뉴욕)/AMS(아멕스) — 종목 상장 거래소로 지정 (ORCL=NYS)" }),
			symb: Type.String({ description: "종목코드, 예: RKLB, AAPL" }),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await getOverseasPrice(params.excd, params.symb, params.env ?? "auto");
				const out = (result.data as { output?: Record<string, unknown> })?.output ?? {};
				const values = Object.values(out).filter((v) => v !== "" && v !== null && v !== undefined);
				if (values.length === 0) {
					return jsonResult({
						ok: false,
						error:
							`KIS 해외 현재가 빈 응답 (${params.symb} @ ${params.excd}) — 상장 거래소를 확인하세요. ` +
							`예: ORCL=NYS(뉴욕), AAPL=NAS(나스닥), RKLB=NAS. broker_price로 NAS→NYS→AMS 자동 폴백 가능. ` +
							`올바른 거래소로도 빈 응답이면 해외 실시간 시세 유료 구독 미가입일 수 있습니다.`,
					});
				}
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

	// ── broker: KIS 우선 (에이전트 중재 폴백 — 토스는 pi-toss 패키지) ───
	pi.registerTool({
		name: "broker_price",
		label: "현재가 (KIS 우선)",
		description:
			"현재가 조회 — KIS 우선 (v0.3.0부터 토스는 pi-toss 패키지). " +
			"국내 6자리(005930) 또는 해외 티커(RKLB) 모두 지원. KIS 키 미등록/실패 시 에러에 toss_price 사용 안내 포함. " +
			"시세 전용 — 계좌·주문은 각 브로커 툴(kis_*/toss_*)을 명시적으로 사용하세요. " +
			"KIS 키가 없으면 /kis-key 안내.",
		parameters: Type.Object({
			symbol: Type.String({ description: "종목 심볼: 6자리 국내코드 또는 해외 티커, 예: 005930 / RKLB" }),
			prefer: Type.Optional(Type.Union([Type.Literal("kis"), Type.Literal("toss")], { description: "우선 브로커 (KIS만 지원 — toss 지정 시 안내 에러)" })),
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
		label: "차트·지표 (KIS 우선)",
		description:
			"차트 조회 + 기술지표 — KIS 우선. period: D/W/M/1d=일·주·월봉(KIS), " +
			"1m=KIS 미지원 (toss_chart 툴 안내 — pi-toss 패키지). bars는 공용 지표(MA/RSI/ATR/볼린저/지지저항/추세)로 계산해 함께 반환합니다. " +
			"참고용 분석이며 투자 결정의 책임은 사용자에게 있습니다.",
		parameters: Type.Object({
			symbol: Type.String({ description: "종목 심볼: 6자리 국내코드 또는 해외 티커, 예: 005930 / RKLB" }),
			period: Type.Optional(Type.Union([Type.Literal("D"), Type.Literal("W"), Type.Literal("M"), Type.Literal("1d"), Type.Literal("1m")], { description: "봉 단위 (기본 D, 1m는 pi-toss에서 지원)" })),
			count: Type.Optional(Type.Number({ description: "조회 봉 수 (pi-toss의 toss_chart에서 사용)" })),
			prefer: Type.Optional(Type.Union([Type.Literal("kis"), Type.Literal("toss")], { description: "우선 브로커 (KIS만 지원 — toss 지정 시 안내 에러)" })),
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

	// ── 해외 선물/옵션 (파생상품) ─────────────────────────────────────
	pi.registerTool({
		name: "kis_derivatives",
		label: "해외 선물/옵션 (파생상품)",
		description:
			"해외 선물/옵션 조회 — 종목코드(SRS_CD) 단위 (해외는 월물 전광판 API 없음). " +
			'선물 코드 예: "ESU24", "CNHU24". 옵션 코드 예: "OESU24 C5500" (O + 기초선물코드 + C/P + 행사가). ' +
			"option-greeks: 옵션 시장가 + 기초선물가 + 행사가 + 만기(상품정보 expr_date 또는 셋째 금요일 근사)로 " +
			"IV 역산 후 Black-Scholes 그릭스(델타/감마/세타/베가/로) 계산 — 무위험금리 기본 4% 가정(결과 notes에 명시). " +
			"⚠️ CME/SGX 등 해외 파생 시세는 유료 구독 필요할 수 있으며(빈 응답 = 미가입 가능성), 레버리지 상품이라 주문 시 안전 점검이 필수입니다.",
		parameters: Type.Object({
			kind: Type.Union(
				[
					Type.Literal("future-price"),
					Type.Literal("option-price"),
					Type.Literal("option-quote"),
					Type.Literal("option-greeks"),
					Type.Literal("product-info"),
					Type.Literal("chart"),
					Type.Literal("market-time"),
				],
				{ description: "조회 종류" },
			),
			code: Type.Optional(Type.String({ description: '종목코드 — 선물 "ESU24", 옵션 "OESU24 C5500" (product-info는 codes 또는 code)' })),
			codes: Type.Optional(Type.String({ description: "product-info용 — 콤마 구분 (예: \"ESU24,ESZ24\"). 옵션(O로 시작)이면 옵션 상품정보, 아니면 선물 상품정보" })),
			exchange: Type.Optional(Type.String({ description: "거래소 — CME(기본)/EUREX/HKEx/ICE/SGX (chart/market-time)" })),
			gap: Type.Optional(Type.Number({ description: "chart: 분봉 간격 — 1=1분봉(기본), 5=5분봉 ..." })),
			riskFreeRate: Type.Optional(Type.Number({ description: "option-greeks: 무위험금리 % (기본 4.0, 가정)" })),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				switch (params.kind) {
					case "future-price":
						if (!params.code) return jsonResult({ ok: false, error: "future-price는 code 필요 (예: ESU24)" });
						return jsonResult(await getFuturePrice(params.code, params.env ?? "auto"));
					case "option-price":
						if (!params.code) return jsonResult({ ok: false, error: "option-price는 code 필요 (예: OESU24 C5500)" });
						return jsonResult(await getOptionPrice(params.code, params.env ?? "auto"));
					case "option-quote":
						if (!params.code) return jsonResult({ ok: false, error: "option-quote는 code 필요" });
						return jsonResult(await getOptionQuote(params.code, params.env ?? "auto"));
					case "option-greeks":
						if (!params.code) return jsonResult({ ok: false, error: "option-greeks는 code 필요 (예: OESU24 C5500)" });
						return jsonResult(
							await getOptionGreeks(params.code, {
								riskFreeRatePct: params.riskFreeRate,
								env: params.env ?? "auto",
							}),
						);
					case "product-info": {
						const list = (params.codes ?? params.code ?? "")
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean);
						if (list.length === 0) return jsonResult({ ok: false, error: "product-info는 codes 또는 code 필요" });
						// 옵션 판별: parseOverseasOptionCode로 정확히 ("O" 시작 = 옵션이 아님 — OJ(냉동오렌지) 선물 등)
						const isOption = !!parseOverseasOptionCode(list[0]);
						return jsonResult(isOption ? await getOptionProductInfo(list, params.env ?? "auto") : await getFutureProductInfo(list, params.env ?? "auto"));
					}
					case "chart":
						if (!params.code) return jsonResult({ ok: false, error: "chart는 code 필요 (옵션 분봉, 예: OESU24 C5500)" });
						return jsonResult(
							await getOptionChart(params.code, { exchange: params.exchange ?? "CME", gap: params.gap, count: 120 }, params.env ?? "auto"),
						);
					case "market-time":
						return jsonResult(await getDerivativesMarketTime({ exchange: params.exchange, optionOnly: undefined }, params.env ?? "auto"));
				}
				return jsonResult({ ok: false, error: `알 수 없는 kind: ${params.kind}` });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});
}
