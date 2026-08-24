/**
 * src/agent/tools.ts — pi 툴 등록 (binance_* 6개).
 *
 * 모든 응답은 roles/binance.ts에서 compact 정규화 후
 * jsonResult({ ok: true, ... }) — 실패 시 jsonResult({ ok: false, error }).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { analyze } from "pi-finance-core";
import {
	cancelAllOrders,
	cancelOrder,
	getAccount,
	getFundingRate,
	getFuturesPositions,
	getKlines,
	getMarkPremium,
	getOpenInterest,
	getOrder,
	getPrices,
	listOpenOrders,
	placeOrder,
	setLeverage,
	setMarginType,
	type BinanceMarket,
} from "../roles/binance.ts";

export function jsonResult(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: {} };
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
				});
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
			"spot: 잔고 0이 아닌 자산만. usdm: 지갑·가용·미실현손익 + 열린 포지션. " +
			"출금·이체는 이 툴에 없습니다.",
		parameters: Type.Object({
			market: Market,
			env: Env,
		}),
		async execute(_id, params) {
			try {
				const market = (params.market ?? "spot") as BinanceMarket;
				const data = await getAccount(market, { env: params.env });
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
			"LIMIT은 price+quantity, MARKET은 quantity 또는 현물 quoteOrderQty(USDT 금액). " +
			"스탑 계열은 stopPrice 필수. 선물 reduceOnly/positionSide(BOTH|LONG|SHORT, 헤지모드). " +
			"레버리지는 이 툴이 바꾸지 않음 — binance_futures kind=leverage. 출금 없음.",
		parameters: Type.Object({
			symbol: Type.String({ description: "심볼, 예: BTCUSDT" }),
			side: Type.Union([Type.Literal("BUY"), Type.Literal("SELL")], { description: "매수/매도" }),
			type: Type.Union(
				[
					Type.Literal("LIMIT"),
					Type.Literal("MARKET"),
					Type.Literal("STOP_MARKET"),
					Type.Literal("TAKE_PROFIT_MARKET"),
					Type.Literal("STOP"),
					Type.Literal("TAKE_PROFIT"),
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
			"Binance 미체결 조회/상세/취소. action: list(기본, 미체결)/detail/cancel/cancel-all. " +
			"detail·cancel은 symbol+orderId. cancel-all은 symbol 필수. " +
			"취소는 **사용자 확인 후에만**. 현물 list는 symbol 생략 시 전체 미체결(가중치 높음).",
		parameters: Type.Object({
			action: Type.Union(
				[Type.Literal("list"), Type.Literal("detail"), Type.Literal("cancel"), Type.Literal("cancel-all")],
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
