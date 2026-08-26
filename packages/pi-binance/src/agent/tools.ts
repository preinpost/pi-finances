/**
 * src/agent/tools.ts — pi 툴 등록 (binance_* 8개).
 *
 * 모든 응답은 roles/binance.ts에서 compact 정규화 후
 * jsonResult({ ok: true, ... }) — 실패 시 jsonResult({ ok: false, error }).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { analyze, chartCardDetails, chartPeriodLabel } from "pi-finance-core";
import {
	cancelAllOrders,
	cancelOrder,
	getAccount,
	getFundingRate,
	getFuturesPositions,
	getKlines,
	getMarkPremium,
	getOpenInterest,
	getMyTrades,
	getOrder,
	getPrices,
	listOpenOrders,
	placeOrder,
	setLeverage,
	setMarginType,
	type BinanceMarket,
} from "../roles/binance.ts";
import {
	cancelOrderList,
	getAllOrderLists,
	getAllOrders,
	getAvgPrice,
	getBookTicker,
	getCommission,
	getDepth,
	getExchangeInfo,
	getMyFilters,
	getOpenOrderLists,
	getOrderList,
	getRecentTrades,
	getRollingTicker,
	getUnfilledOrderCount,
	placeOco,
	placeOto,
	placeOtoco,
} from "../roles/spot.ts";

export function jsonResult(value: unknown, details: object = {}) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details };
}

const Market = Type.Optional(Type.Union([Type.Literal("spot"), Type.Literal("usdm")], { description: "spot=현물(기본), usdm=USDT-M 선물" }));
const Env = Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("testnet")], { description: "호출 단위 오버라이드 (기본: 저장된/BINANCE_ENV)" }));

export function registerTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "binance_price",
		label: "바이낸스 현재가",
		description:
			"Binance 24h 티커. symbols: 콤마 구분 최대 10 (BTCUSDT 또는 BTC/USDT). " +
			"market: spot(기본)/usdm. 키 없이 호출 가능. " +
			"응답: [{ symbol, market, lastPrice, priceChangePercent, highPrice, lowPrice, volume, quoteVolume }].",
		parameters: Type.Object({
			symbols: Type.String({ description: "심볼 콤마 구분 (최대 10), 예: BTCUSDT,ETHUSDT" }),
			market: Market,
			env: Env,
		}),
		async execute(_id, params) {
			try {
				const symbols = params.symbols.split(",").map((s) => s.trim()).filter(Boolean);
				const prices = await getPrices(symbols, (params.market ?? "spot") as BinanceMarket, { env: params.env });
				return jsonResult({ ok: true, source: "binance", prices });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	pi.registerTool({
		name: "binance_chart",
		label: "바이낸스 차트·지표",
		description:
			"Binance 캔들 조회 후 공용 지표(MA/RSI/ATR/볼린저/지지저항/추세) 계산. " +
			"interval: 1m/5m/15m/1h/4h/1d(기본)/1w. limit 기본 100 최대 200. " +
			"키 없이 가능. 참고용 분석이며 투자 결정의 책임은 사용자에게 있습니다.",
		parameters: Type.Object({
			symbol: Type.String({ description: "심볼, 예: BTCUSDT" }),
			market: Market,
			interval: Type.Optional(
				Type.Union(
					[
						Type.Literal("1m"),
						Type.Literal("5m"),
						Type.Literal("15m"),
						Type.Literal("1h"),
						Type.Literal("4h"),
						Type.Literal("1d"),
						Type.Literal("1w"),
					],
					{ description: "봉 단위 (기본 1d)" },
				),
			),
			limit: Type.Optional(Type.Number({ description: "봉 수 (기본 100, 최대 200)" })),
			env: Env,
		}),
		async execute(_id, params) {
			try {
				const { bars, symbol, market, interval } = await getKlines(params.symbol, {
					market: params.market ?? "spot",
					interval: params.interval ?? "1d",
					limit: params.limit,
					env: params.env,
				});
				if (bars.length === 0) {
					return jsonResult({ ok: false, error: "차트 데이터 없음 — 심볼/interval/시장을 확인하세요." });
				}
				const card = interval === "1d" || interval === "1w"
					? chartCardDetails({ symbol, period: chartPeriodLabel(interval), bars })
					: undefined;
				return jsonResult({
					ok: true,
					source: "binance",
					symbol,
					market,
					interval,
					barCount: bars.length,
					lastBar: bars[bars.length - 1],
					recentBars: bars.slice(-10),
					...analyze(bars),
				}, card ?? {});
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	pi.registerTool({
		name: "binance_market",
		label: "바이낸스 현물 시장",
		description:
			"Binance 현물 공개 시세 보강 (키 불필요). kind: depth(호가창)/trades(최근 체결)/avg-price(평균가)/ " +
			"book-ticker(최우선 호가)/exchange-info(틱·롯사이즈·최소주문)/ticker-window(롤링 변동, windowSize=1h|4h|1d). " +
			"주문 전 exchange-info로 호가단위를 확인하세요.",
		parameters: Type.Object({
			kind: Type.Union(
				[
					Type.Literal("depth"),
					Type.Literal("trades"),
					Type.Literal("avg-price"),
					Type.Literal("book-ticker"),
					Type.Literal("exchange-info"),
					Type.Literal("ticker-window"),
				],
				{ description: "조회 종류" },
			),
			symbol: Type.String({ description: "심볼, 예: ETHUSDT" }),
			limit: Type.Optional(Type.Number({ description: "depth/trades 행 수 (기본 20)" })),
			windowSize: Type.Optional(Type.String({ description: "ticker-window 구간 (기본 1h). 예: 1h, 4h, 1d" })),
			env: Env,
		}),
		async execute(_id, params) {
			try {
				const opts = { env: params.env };
				switch (params.kind) {
					case "depth":
						return jsonResult({ ok: true, kind: params.kind, data: await getDepth(params.symbol, params.limit, opts) });
					case "trades":
						return jsonResult({ ok: true, kind: params.kind, data: await getRecentTrades(params.symbol, params.limit, opts) });
					case "avg-price":
						return jsonResult({ ok: true, kind: params.kind, data: await getAvgPrice(params.symbol, opts) });
					case "book-ticker":
						return jsonResult({ ok: true, kind: params.kind, data: await getBookTicker(params.symbol, opts) });
					case "exchange-info":
						return jsonResult({ ok: true, kind: params.kind, data: await getExchangeInfo(params.symbol, opts) });
					case "ticker-window":
						return jsonResult({
							ok: true,
							kind: params.kind,
							data: await getRollingTicker(params.symbol, params.windowSize ?? "1h", opts),
						});
				}
				return jsonResult({ ok: false, error: `알 수 없는 kind: ${params.kind}` });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	pi.registerTool({
		name: "binance_account",
		label: "바이낸스 잔고·포지션",
		description:
			"Binance 계정 조회 (서명 필요 — /binance-key). " +
			"spot: 잔고 0이 아닌 자산 + **평단가(costBasis.avgPrice)** — myTrades FIFO, 기본 계산함. " +
			"평단가/원가/손익 질문이면 반드시 이 툴(market=spot). symbols로 ETH 또는 ETHUSDT 지정 가능. " +
			"usdm: 지갑·가용·미실현 + 포지션 entryPrice(선물 평단). 출금·이체 없음. " +
			"kind: summary(기본)/commission(수수료율)/filters(계정 필터)/unfilled(미체결 주문 한도) — 뒤 3개는 현물.",
		parameters: Type.Object({
			market: Market,
			kind: Type.Optional(
				Type.Union(
					[Type.Literal("summary"), Type.Literal("commission"), Type.Literal("filters"), Type.Literal("unfilled")],
					{ description: "summary=잔고(기본), commission/filters는 symbol 필요, unfilled=미체결 한도" },
				),
			),
			symbol: Type.Optional(Type.String({ description: "commission/filters용 심볼" })),
			includeCostBasis: Type.Optional(Type.Boolean({ description: "현물 평단가 계산 (기본 true). false면 잔고만" })),
			symbols: Type.Optional(Type.String({ description: "평단가 대상 자산/심볼 콤마 구분, 예: ETH 또는 ETHUSDT (미지정 시 비스테이블 최대 8개)" })),
			quote: Type.Optional(Type.String({ description: "평단가 견적 통화 (기본 USDT)" })),
			env: Env,
		}),
		async execute(_id, params) {
			try {
				const kind = params.kind ?? "summary";
				if (kind === "commission") {
					if (!params.symbol) return jsonResult({ ok: false, error: "commission은 symbol이 필요합니다." });
					return jsonResult({ ok: true, kind, data: await getCommission(params.symbol, { env: params.env }) });
				}
				if (kind === "filters") {
					if (!params.symbol) return jsonResult({ ok: false, error: "filters는 symbol이 필요합니다." });
					return jsonResult({ ok: true, kind, data: await getMyFilters(params.symbol, { env: params.env }) });
				}
				if (kind === "unfilled") {
					return jsonResult({ ok: true, kind, data: await getUnfilledOrderCount({ env: params.env }) });
				}
				const market = (params.market ?? "spot") as BinanceMarket;
				const data = await getAccount(market, {
					env: params.env,
					includeCostBasis: params.includeCostBasis,
					symbols: params.symbols?.split(",").map((s) => s.trim()).filter(Boolean),
					quote: params.quote,
				});
				return jsonResult({ ok: true, source: "binance", market, data });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	pi.registerTool({
		name: "binance_order",
		label: "바이낸스 주문",
		description:
			"Binance 주문 생성 (서명 — **사용자 확인 후에만**). " +
			"market: spot/usdm. side: BUY/SELL. type: LIMIT/MARKET/STOP_MARKET/TAKE_PROFIT_MARKET (선물 STOP/TAKE_PROFIT 지정가 스탑도 가능). " +
			"LIMIT/LIMIT_MAKER는 price+quantity, MARKET은 quantity 또는 현물 quoteOrderQty(USDT 금액). " +
			"스탑 계열은 stopPrice 필수. 현물 STOP/TAKE_PROFIT은 STOP_LOSS_LIMIT/TAKE_PROFIT_LIMIT로 매핑. " +
			"test=true 면 현물 테스트주문(체결 안 됨). 선물 reduceOnly/positionSide. 출금 없음.",
		parameters: Type.Object({
			symbol: Type.String({ description: "심볼, 예: BTCUSDT" }),
			side: Type.Union([Type.Literal("BUY"), Type.Literal("SELL")], { description: "매수/매도" }),
			type: Type.Union(
				[
					Type.Literal("LIMIT"),
					Type.Literal("MARKET"),
					Type.Literal("LIMIT_MAKER"),
					Type.Literal("STOP_MARKET"),
					Type.Literal("TAKE_PROFIT_MARKET"),
					Type.Literal("STOP"),
					Type.Literal("TAKE_PROFIT"),
					Type.Literal("STOP_LOSS"),
					Type.Literal("STOP_LOSS_LIMIT"),
					Type.Literal("TAKE_PROFIT_LIMIT"),
				],
				{ description: "주문 유형" },
			),
			market: Market,
			quantity: Type.Optional(Type.String({ description: "수량 (베이스 자산)" })),
			quoteOrderQty: Type.Optional(Type.String({ description: "현물 MARKET 금액(USDT) — quantity 대신" })),
			price: Type.Optional(Type.String({ description: "지정가 (LIMIT/STOP/TAKE_PROFIT)" })),
			stopPrice: Type.Optional(Type.String({ description: "스탑 트리거가" })),
			timeInForce: Type.Optional(Type.Union([Type.Literal("GTC"), Type.Literal("IOC"), Type.Literal("FOK")], { description: "지정가 유효기간 (기본 GTC)" })),
			reduceOnly: Type.Optional(Type.Boolean({ description: "선물 전용 — 포지션 축소만" })),
			positionSide: Type.Optional(Type.Union([Type.Literal("BOTH"), Type.Literal("LONG"), Type.Literal("SHORT")], { description: "선물 포지션 방향 (원웨이=BOTH)" })),
			clientOrderId: Type.Optional(Type.String({ description: "멱등 키 (미지정 시 자동 생성)" })),
			test: Type.Optional(Type.Boolean({ description: "현물 테스트주문 — 검증만, 체결 없음 (기본 false)" })),
			env: Env,
		}),
		async execute(_id, params) {
			try {
				const data = await placeOrder({
					market: params.market ?? "spot",
					symbol: params.symbol,
					side: params.side,
					type: params.type,
					quantity: params.quantity,
					quoteOrderQty: params.quoteOrderQty,
					price: params.price,
					stopPrice: params.stopPrice,
					timeInForce: params.timeInForce,
					reduceOnly: params.reduceOnly,
					positionSide: params.positionSide,
					clientOrderId: params.clientOrderId,
					test: params.test,
					env: params.env,
				});
				return jsonResult({ ok: true, source: "binance", ...data });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	pi.registerTool({
		name: "binance_orders",
		label: "바이낸스 주문 관리",
		description:
			"Binance 미체결 조회/상세/취소/체결이력/전체이력. action: list/detail/cancel/cancel-all/trades/history. " +
			"detail·cancel은 symbol+orderId. cancel-all·trades·history는 symbol 필수. " +
			"history: 현물 전체 주문(체결·취소 포함, GET /api/v3/allOrders). trades: 체결 이력. " +
			"취소는 **사용자 확인 후에만**. 현물 list는 symbol 생략 시 전체 미체결(가중치 높음).",
		parameters: Type.Object({
			action: Type.Union(
				[
					Type.Literal("list"),
					Type.Literal("detail"),
					Type.Literal("cancel"),
					Type.Literal("cancel-all"),
					Type.Literal("trades"),
					Type.Literal("history"),
				],
				{ description: "동작" },
			),
			symbol: Type.Optional(Type.String({ description: "심볼 (detail/cancel/cancel-all 필수, list는 선물에서 권장)" })),
			orderId: Type.Optional(Type.String({ description: "주문 ID (detail/cancel)" })),
			market: Market,
			env: Env,
		}),
		async execute(_id, params) {
			try {
				const market = (params.market ?? "spot") as BinanceMarket;
				switch (params.action) {
					case "list":
						return jsonResult({
							ok: true,
							action: params.action,
							market,
							data: await listOpenOrders(params.symbol, market, { env: params.env }),
						});
					case "detail":
						if (!params.symbol || !params.orderId) return jsonResult({ ok: false, error: "detail은 symbol+orderId가 필요합니다." });
						return jsonResult({
							ok: true,
							action: params.action,
							data: await getOrder(params.symbol, params.orderId, market, { env: params.env }),
						});
					case "cancel":
						if (!params.symbol || !params.orderId) return jsonResult({ ok: false, error: "cancel은 symbol+orderId가 필요합니다." });
						return jsonResult({
							ok: true,
							action: params.action,
							data: await cancelOrder(params.symbol, params.orderId, market, { env: params.env }),
						});
					case "cancel-all":
						if (!params.symbol) return jsonResult({ ok: false, error: "cancel-all은 symbol이 필요합니다." });
						return jsonResult({
							ok: true,
							action: params.action,
							data: await cancelAllOrders(params.symbol, market, { env: params.env }),
						});
					case "trades": {
						if (!params.symbol) return jsonResult({ ok: false, error: "trades는 symbol이 필요합니다 (예: ETHUSDT)." });
						const trades = await getMyTrades(params.symbol, market, { env: params.env });
						return jsonResult({
							ok: true,
							action: params.action,
							market,
							symbol: params.symbol,
							count: trades.length,
							recent: trades.slice(-30),
						});
					}
					case "history":
						if (!params.symbol) return jsonResult({ ok: false, error: "history는 symbol이 필요합니다." });
						if (market !== "spot") return jsonResult({ ok: false, error: "history는 현물(spot)만 지원합니다." });
						return jsonResult({
							ok: true,
							action: params.action,
							data: await getAllOrders(params.symbol, { env: params.env }),
						});
				}
				return jsonResult({ ok: false, error: `알 수 없는 action: ${params.action}` });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	pi.registerTool({
		name: "binance_orderlist",
		label: "바이낸스 현물 주문리스트",
		description:
			"현물 주문리스트 (공식 orderList). type: OCO(익절+손절 한쪽 체결 시 나머지 취소)/OTO(지정가 체결 후 다음 주문)/OTOCO(체결 후 OCO). " +
			"action: create/list/detail/cancel/history. create는 **사용자 확인 후에만**. " +
			"OCO: side+quantity+aboveType+belowType. 예: SELL + aboveType=LIMIT_MAKER(익절가)+belowType=STOP_LOSS_LIMIT(손절). " +
			"OTO: working LIMIT 매수 후 pending 매도. OTOCO: working + pendingAbove + pendingBelow. 현물 전용.",
		parameters: Type.Object({
			action: Type.Union(
				[Type.Literal("create"), Type.Literal("list"), Type.Literal("detail"), Type.Literal("cancel"), Type.Literal("history")],
				{ description: "동작" },
			),
			type: Type.Optional(Type.Union([Type.Literal("OCO"), Type.Literal("OTO"), Type.Literal("OTOCO")], { description: "create 타입 (기본 OCO)" })),
			symbol: Type.Optional(Type.String({ description: "심볼 (create/cancel 필수)" })),
			side: Type.Optional(Type.Union([Type.Literal("BUY"), Type.Literal("SELL")], { description: "OCO 방향" })),
			quantity: Type.Optional(Type.String({ description: "OCO 공통 수량 / OTO pendingQuantity 기본" })),
			aboveType: Type.Optional(Type.String({ description: "OCO 위쪽 타입 — LIMIT_MAKER/TAKE_PROFIT_LIMIT/STOP_LOSS_LIMIT 등" })),
			abovePrice: Type.Optional(Type.String({ description: "OCO 위쪽 지정가" })),
			aboveStopPrice: Type.Optional(Type.String({ description: "OCO 위쪽 스탑가" })),
			aboveTimeInForce: Type.Optional(Type.String({ description: "OCO 위쪽 TIF (LIMIT류는 GTC)" })),
			belowType: Type.Optional(Type.String({ description: "OCO 아래쪽 타입" })),
			belowPrice: Type.Optional(Type.String({ description: "OCO 아래쪽 지정가" })),
			belowStopPrice: Type.Optional(Type.String({ description: "OCO 아래쪽 스탑가" })),
			belowTimeInForce: Type.Optional(Type.String({ description: "OCO 아래쪽 TIF" })),
			workingType: Type.Optional(Type.Union([Type.Literal("LIMIT"), Type.Literal("LIMIT_MAKER")], { description: "OTO/OTOCO 작업주문 타입" })),
			workingSide: Type.Optional(Type.Union([Type.Literal("BUY"), Type.Literal("SELL")], { description: "OTO/OTOCO 작업주문 방향" })),
			workingPrice: Type.Optional(Type.String({ description: "OTO/OTOCO 작업주문 가격" })),
			workingQuantity: Type.Optional(Type.String({ description: "OTO/OTOCO 작업주문 수량" })),
			pendingType: Type.Optional(Type.String({ description: "OTO 대기주문 타입" })),
			pendingSide: Type.Optional(Type.Union([Type.Literal("BUY"), Type.Literal("SELL")], { description: "OTO/OTOCO 대기 방향" })),
			pendingQuantity: Type.Optional(Type.String({ description: "OTO/OTOCO 대기 수량" })),
			pendingPrice: Type.Optional(Type.String({ description: "OTO 대기 지정가" })),
			pendingStopPrice: Type.Optional(Type.String({ description: "OTO 대기 스탑가" })),
			pendingAboveType: Type.Optional(Type.String({ description: "OTOCO 대기 위쪽 타입" })),
			pendingAbovePrice: Type.Optional(Type.String({ description: "OTOCO 대기 위쪽 가격" })),
			pendingAboveStopPrice: Type.Optional(Type.String({ description: "OTOCO 대기 위쪽 스탑" })),
			pendingBelowType: Type.Optional(Type.String({ description: "OTOCO 대기 아래쪽 타입" })),
			pendingBelowPrice: Type.Optional(Type.String({ description: "OTOCO 대기 아래쪽 가격" })),
			pendingBelowStopPrice: Type.Optional(Type.String({ description: "OTOCO 대기 아래쪽 스탑" })),
			orderListId: Type.Optional(Type.String({ description: "detail/cancel 용 리스트 ID" })),
			env: Env,
		}),
		async execute(_id, params) {
			try {
				switch (params.action) {
					case "list":
						return jsonResult({ ok: true, action: params.action, data: await getOpenOrderLists({ env: params.env }) });
					case "history":
						return jsonResult({ ok: true, action: params.action, data: await getAllOrderLists({ env: params.env }) });
					case "detail":
						if (!params.orderListId) return jsonResult({ ok: false, error: "detail은 orderListId가 필요합니다." });
						return jsonResult({ ok: true, action: params.action, data: await getOrderList(params.orderListId, { env: params.env }) });
					case "cancel":
						if (!params.symbol || !params.orderListId) {
							return jsonResult({ ok: false, error: "cancel은 symbol+orderListId가 필요합니다." });
						}
						return jsonResult({
							ok: true,
							action: params.action,
							data: await cancelOrderList(params.symbol, params.orderListId, { env: params.env }),
						});
					case "create": {
						if (!params.symbol) return jsonResult({ ok: false, error: "create는 symbol이 필요합니다." });
						const listType = params.type ?? "OCO";
						if (listType === "OCO") {
							if (!params.side || !params.quantity || !params.aboveType || !params.belowType) {
								return jsonResult({ ok: false, error: "OCO create는 side/quantity/aboveType/belowType이 필요합니다." });
							}
							return jsonResult({
								ok: true,
								action: params.action,
								data: await placeOco({
									symbol: params.symbol,
									side: params.side,
									quantity: params.quantity,
									aboveType: params.aboveType,
									belowType: params.belowType,
									abovePrice: params.abovePrice,
									aboveStopPrice: params.aboveStopPrice,
									aboveTimeInForce: params.aboveTimeInForce,
									belowPrice: params.belowPrice,
									belowStopPrice: params.belowStopPrice,
									belowTimeInForce: params.belowTimeInForce,
									env: params.env,
								}),
							});
						}
						if (listType === "OTO") {
							if (!params.workingType || !params.workingSide || !params.workingPrice || !params.workingQuantity || !params.pendingType || !params.pendingSide) {
								return jsonResult({ ok: false, error: "OTO create는 workingType/Side/Price/Quantity + pendingType/Side가 필요합니다." });
							}
							return jsonResult({
								ok: true,
								action: params.action,
								data: await placeOto({
									symbol: params.symbol,
									workingType: params.workingType,
									workingSide: params.workingSide,
									workingPrice: params.workingPrice,
									workingQuantity: params.workingQuantity,
									pendingType: params.pendingType,
									pendingSide: params.pendingSide,
									pendingQuantity: params.pendingQuantity ?? params.quantity ?? params.workingQuantity,
									pendingPrice: params.pendingPrice,
									pendingStopPrice: params.pendingStopPrice,
									env: params.env,
								}),
							});
						}
						if (!params.workingType || !params.workingSide || !params.workingPrice || !params.workingQuantity || !params.pendingSide || !params.pendingAboveType) {
							return jsonResult({ ok: false, error: "OTOCO create는 working* + pendingSide + pendingAboveType이 필요합니다." });
						}
						return jsonResult({
							ok: true,
							action: params.action,
							data: await placeOtoco({
								symbol: params.symbol,
								workingType: params.workingType,
								workingSide: params.workingSide,
								workingPrice: params.workingPrice,
								workingQuantity: params.workingQuantity,
								pendingType: params.pendingType ?? params.pendingAboveType,
								pendingSide: params.pendingSide,
								pendingQuantity: params.pendingQuantity ?? params.quantity ?? params.workingQuantity,
								pendingAboveType: params.pendingAboveType,
								pendingAbovePrice: params.pendingAbovePrice,
								pendingAboveStopPrice: params.pendingAboveStopPrice,
								pendingBelowType: params.pendingBelowType,
								pendingBelowPrice: params.pendingBelowPrice,
								pendingBelowStopPrice: params.pendingBelowStopPrice,
								env: params.env,
						}),
					});
					}
				}
				return jsonResult({ ok: false, error: `알 수 없는 action: ${params.action}` });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	pi.registerTool({
		name: "binance_futures",
		label: "바이낸스 USDT-M 선물",
		description:
			"USDT-M 선물 전용. kind: funding(최근 펀딩)/mark(마크가·다음 펀딩)/open-interest/positions(열린 포지션)/ " +
			"leverage(레버리지 변경)/margin-type(ISOLATED|CROSSED). " +
			"funding·mark·open-interest는 키 없이 가능. positions/leverage/margin-type은 서명. " +
			"leverage·margin-type은 **사용자 확인 + confirm=true** 후에만. 레버리지 상품 — 청산 위험.",
		parameters: Type.Object({
			kind: Type.Union(
				[
					Type.Literal("funding"),
					Type.Literal("mark"),
					Type.Literal("open-interest"),
					Type.Literal("positions"),
					Type.Literal("leverage"),
					Type.Literal("margin-type"),
				],
				{ description: "조회/설정 종류" },
			),
			symbol: Type.Optional(Type.String({ description: "심볼 (positions 제외 필수)" })),
			leverage: Type.Optional(Type.Number({ description: "kind=leverage — 1~125" })),
			marginType: Type.Optional(Type.Union([Type.Literal("ISOLATED"), Type.Literal("CROSSED")], { description: "kind=margin-type" })),
			confirm: Type.Optional(Type.Boolean({ description: "leverage/margin-type 변경 동의 (기본 false → 거부)" })),
			env: Env,
		}),
		async execute(_id, params) {
			try {
				const opts = { env: params.env };
				switch (params.kind) {
					case "funding":
						if (!params.symbol) return jsonResult({ ok: false, error: "funding은 symbol이 필요합니다." });
						return jsonResult({ ok: true, kind: params.kind, data: await getFundingRate(params.symbol, opts) });
					case "mark":
						if (!params.symbol) return jsonResult({ ok: false, error: "mark는 symbol이 필요합니다." });
						return jsonResult({ ok: true, kind: params.kind, data: await getMarkPremium(params.symbol, opts) });
					case "open-interest":
						if (!params.symbol) return jsonResult({ ok: false, error: "open-interest는 symbol이 필요합니다." });
						return jsonResult({ ok: true, kind: params.kind, data: await getOpenInterest(params.symbol, opts) });
					case "positions":
						return jsonResult({ ok: true, kind: params.kind, data: await getFuturesPositions(opts) });
					case "leverage":
						if (!params.symbol || params.leverage === undefined) {
							return jsonResult({ ok: false, error: "leverage는 symbol+leverage가 필요합니다." });
						}
						if (!params.confirm) {
							return jsonResult({ ok: false, error: "레버리지 변경은 confirm=true 와 사용자 확인이 필요합니다." });
						}
						return jsonResult({ ok: true, kind: params.kind, data: await setLeverage(params.symbol, params.leverage, opts) });
					case "margin-type":
						if (!params.symbol || !params.marginType) {
							return jsonResult({ ok: false, error: "margin-type은 symbol+marginType이 필요합니다." });
						}
						if (!params.confirm) {
							return jsonResult({ ok: false, error: "마진 타입 변경은 confirm=true 와 사용자 확인이 필요합니다." });
						}
						return jsonResult({ ok: true, kind: params.kind, data: await setMarginType(params.symbol, params.marginType, opts) });
				}
				return jsonResult({ ok: false, error: `알 수 없는 kind: ${params.kind}` });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});
}
