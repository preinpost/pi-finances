/**
 * src/agent/tools.ts — pi 툴 등록 (toss_* 7개 — 토스증권 전용).
 *
 * pi-kis v0.3.0에서 분리된 패키지. 툴 name/label/description/parameters/출력
 * 형태는 pi-kis 0.2.x 시절과 동일(하위 호환) — execute 내부만 roles/toss.ts로 위임.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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
import { analyze, chartCardDetails, chartPeriodLabel } from "pi-finance-core";

/** 툴 결과 공통 래퍼 — 기존 index.ts와 동일 형태. */
export function textResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

/** execute 공통 에러 래퍼 — 기존 { ok: false, error } 형태 유지. */
function jsonResult(value: unknown, details: object = {}) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details };
}

export function registerTools(pi: ExtensionAPI): void {
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
				const interval = params.interval ?? "1d";
				const card = interval === "1d"
					? chartCardDetails({ symbol: params.symbol, period: chartPeriodLabel(interval), bars })
					: undefined;
				return jsonResult({ ok: true, broker: "toss", symbol: params.symbol, interval, nextBefore, ...analyze(bars) }, card ?? {});
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
			"토스증권 조건주문 (KIS에 없는 강점 기능) — type: SINGLE(1조건)/OCO(익절·손절, 둘 중 하나 체결 시 나머지 자동 취소)/OTO(연속주문, 부모 체결 후 자식 감시 시작). " +
			"create/modify: side(BUY/SELL) + triggerPrice(트리거 가격) 필수, orderPrice(지정가, LIMIT 시), expireDate(YYYY-MM-DD). " +
			"OCO(익절·손절)는 first/second 모두 SELL — first=익절가 > 현재가 > second=손절가. " +
			"OTO(연속주문)는 first=BUY 체결 후 second 감시 시작, second 방향은 secondSide로 지정 (예: 매수 체결 후 매도 = first BUY + secondSide SELL, OTO 필수). " +
			"OCO/OTO는 secondTriggerPrice/secondOrderPrice로 두번째 조건 지정 (지정가 LIMIT만 허용). " +
			"list(기본 OPEN)/detail/cancel은 conditionalOrderId 필요. 실전 주문 — **사용자 확인 후에만** 호출. " +
			"confirmHighValueOrder: 1억원 이상 동의 (기본 false).",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("create"), Type.Literal("list"), Type.Literal("detail"), Type.Literal("modify"), Type.Literal("cancel")], { description: "동작" }),
			type: Type.Optional(Type.Union([Type.Literal("SINGLE"), Type.Literal("OCO"), Type.Literal("OTO")], { description: "create/modify: 조건주문 타입 (기본 SINGLE)" })),
			symbol: Type.Optional(Type.String({ description: "종목 심볼, 예: 005930 또는 AAPL (create 필수)" })),
			side: Type.Optional(Type.Union([Type.Literal("BUY"), Type.Literal("SELL")], { description: "조건 매매 유형 (create/modify 필수 — first 조건 방향; OTO의 second 방향은 secondSide로 지정)" })),
			quantity: Type.Optional(Type.String({ description: "수량 (주 단위, 그룹 공통) (create/modify 필수)" })),
			orderType: Type.Optional(Type.Union([Type.Literal("LIMIT"), Type.Literal("MARKET")], { description: "호가 유형 (create/modify 필수, OCO/OTO는 LIMIT만)" })),
			expireDate: Type.Optional(Type.String({ description: "만료일 YYYY-MM-DD (create/modify 필수)" })),
			triggerPrice: Type.Optional(Type.String({ description: "첫번째 조건 트리거 가격 (create/modify 필수)" })),
			orderPrice: Type.Optional(Type.String({ description: "첫번째 조건 지정가 (orderType=LIMIT)" })),
			secondTriggerPrice: Type.Optional(Type.String({ description: "두번째 조건 트리거 가격 (OCO/OTO 필수)" })),
			secondOrderPrice: Type.Optional(Type.String({ description: "두번째 조건 지정가 (OCO/OTO, LIMIT)" })),
			secondSide: Type.Optional(Type.Union([Type.Literal("BUY"), Type.Literal("SELL")], { description: "두번째 조건 방향 (OTO 연속주문 필수 — 매수 체결 후 매도: first=BUY, secondSide=SELL. OCO는 side와 동일해야 함. 미지정 시 side 사용)" })),
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
						if (params.type === "OCO" && params.secondSide && params.secondSide !== params.side) {
							return jsonResult({ ok: false, error: "OCO(익절·손절)는 first/second 모두 같은 방향(SELL)이어야 합니다." });
						}
						if (params.type === "OTO" && !params.secondSide) {
							return jsonResult({ ok: false, error: "OTO(연속주문)는 secondSide(자식 방향) 지정이 필요합니다 — 매수 체결 후 매도면 first=BUY, secondSide=SELL." });
						}
						const first = {
							orderSide: params.side,
							triggerPrice: params.triggerPrice,
							orderPrice: params.orderPrice,
						};
						const second =
							params.secondTriggerPrice !== undefined
								? { orderSide: params.secondSide ?? params.side, triggerPrice: params.secondTriggerPrice, orderPrice: params.secondOrderPrice }
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
						if (params.type === "OCO" && params.secondSide && params.secondSide !== params.side) {
							return jsonResult({ ok: false, error: "OCO(익절·손절)는 first/second 모두 같은 방향(SELL)이어야 합니다." });
						}
						if (params.type === "OTO" && !params.secondSide) {
							return jsonResult({ ok: false, error: "OTO(연속주문)는 secondSide(자식 방향) 지정이 필요합니다 — 매수 체결 후 매도면 first=BUY, secondSide=SELL." });
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
											? { orderSide: params.secondSide ?? params.side, triggerPrice: params.secondTriggerPrice, orderPrice: params.secondOrderPrice }
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


}
