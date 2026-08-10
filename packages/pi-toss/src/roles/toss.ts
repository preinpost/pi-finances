/**
 * src/roles/toss.ts — 토스증권 역할 (시세/종목·시장/자산/주문/조건주문).
 *
 * 토스증권 Open API (https://openapi.tossinvest.com, OAS v1.2.9) typed wrapper.
 * KIS와 달리 **실전 전용**(paper 없음), 인증은 OAuth2 Client Credentials
 * (core/toss/client.ts — 토큰 자동 캐시/재발급). 계좌·자산·주문 API는
 * `X-Tossinvest-Account` 헤더(accountSeq, 정수) 필요 — 미지정 시 첫 계좌 자동 사용.
 *
 * 레이트리밋 그룹 (core/toss/ratelimit.ts) — 각 함수 주석에 명시:
 *   MARKET_DATA 10/s, MARKET_DATA_CHART 5/s, STOCK 5/s, MARKET_INFO 3/s,
 *   RANKING 5/s, MARKET_INDICATOR_PRICE 10/s, MARKET_INDICATOR 10/s,
 *   MARKET_INDICATOR_CHART 5/s, ACCOUNT 1/s(가장 빡빡), ASSET 5/s,
 *   ORDER 10/s, ORDER_HISTORY 5/s, ORDER_INFO 6/s,
 *   CONDITIONAL_ORDER 5/s, CONDITIONAL_ORDER_HISTORY 10/s.
 *
 * 정식 스펙: /tmp/toss-oas.json
 * (https://openapi.tossinvest.com/openapi-docs/latest/openapi.json)
 */
import { randomUUID } from "node:crypto";
import { getDefaultAccountSeq, tossRequest } from "../core/toss/client.ts";
import type { Bar } from "pi-finance-core";

// ── 공통 타입 ──────────────────────────────────────────────────────────────

export const TOSS_MARKET_COUNTRY = ["KR", "US"] as const;
export type TossMarketCountry = (typeof TOSS_MARKET_COUNTRY)[number];

export type TossOrderSide = "BUY" | "SELL";
export type TossOrderType = "LIMIT" | "MARKET";
export type TossTimeInForce = "DAY" | "CLS";
export type TossConditionalType = "SINGLE" | "OCO" | "OTO";

export interface TossPrice {
	symbol: string;
	timestamp: string | null;
	lastPrice: string;
	currency: string;
}

export interface TossCandle {
	timestamp: string;
	openPrice: string;
	highPrice: string;
	lowPrice: string;
	closePrice: string;
	volume: string;
	currency: string;
}

export interface TossCandlePage {
	candles: TossCandle[];
	nextBefore: string | null;
}

/**
 * 토스 캔들(camelCase) → 공용 Bar[] (indicators.ts 호환, 날짜 오름차순).
 * 토스는 일봉(1d)·1분봉(1m)만 제공 — 주봉/월봉 필요 시 일봉을 집계해야 한다.
 */
export function normalizeTossCandles(candles: TossCandle[]): Bar[] {
	const bars: Bar[] = [];
	for (const c of candles) {
		const open = Number(c.openPrice);
		const high = Number(c.highPrice);
		const low = Number(c.lowPrice);
		const close = Number(c.closePrice);
		if (!c.timestamp || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
			continue;
		}
		const volume = Number(c.volume);
		bars.push({ date: c.timestamp, open, high, low, close, volume: Number.isFinite(volume) ? volume : undefined });
	}
	bars.sort((a, b) => a.date.localeCompare(b.date));
	return bars;
}

/** body에서 undefined 제거 (토스는 undefined 필드를 전송하면 안 됨). */
function cleanBody(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) out[k] = v;
	}
	return out;
}

async function accountFor(accountSeq?: number): Promise<number> {
	return accountSeq ?? (await getDefaultAccountSeq());
}

// ── 시세 (MARKET_DATA / MARKET_DATA_CHART) ────────────────────────────────

/**
 * 현재가 조회 (MARKET_DATA, 10/s). symbols 최대 200개, 콤마 구분.
 * 응답: [{ symbol, timestamp, lastPrice, currency }].
 */
export function getPrices(symbols: string[]): Promise<TossPrice[]> {
	return tossRequest<TossPrice[]>("GET", "/api/v1/prices", {
		query: { symbols: symbols.join(",") },
		group: "MARKET_DATA",
	});
}

export interface TossCandleOptions {
	/** 봉 단위 — 1m(1분봉)/1d(일봉). 기본 1d. 주봉/월봉은 없음. */
	interval?: "1m" | "1d";
	/** 조회 봉 수 (최대 200). 기본 100. */
	count?: number;
	/** 수정주가 적용 여부 (기본 false). */
	adjusted?: boolean;
	/** 페이지네이션 상한(ISO 8601) — 이 시각과 같거나 이전 봉만 반환. */
	before?: string;
}

/**
 * 캔들 차트 조회 (MARKET_DATA_CHART, 5/s) → { candles, bars }.
 * bars는 공용 Bar[] (normalizeTossCandles) — indicators.analyze()와 바로 호환.
 */
export async function getCandles(
	symbol: string,
	opts: TossCandleOptions = {},
): Promise<{ candles: TossCandle[]; bars: Bar[]; nextBefore: string | null }> {
	const page = await tossRequest<TossCandlePage>("GET", "/api/v1/candles", {
		query: {
			symbol,
			interval: opts.interval ?? "1d",
			count: opts.count,
			adjusted: opts.adjusted,
			before: opts.before,
		},
		group: "MARKET_DATA_CHART",
	});
	return { candles: page.candles, bars: normalizeTossCandles(page.candles), nextBefore: page.nextBefore };
}

/** 호가 조회 (MARKET_DATA, 10/s) — { asks, bids } (price/volume/orderbookUnit 등). */
export function getOrderbook(symbol: string): Promise<Record<string, unknown>> {
	return tossRequest<Record<string, unknown>>("GET", "/api/v1/orderbook", { query: { symbol }, group: "MARKET_DATA" });
}

/** 상/하한가 조회 (MARKET_DATA, 10/s) — 가격제한 없는 시장(미국 등)은 null. */
export function getPriceLimits(symbol: string): Promise<Record<string, unknown>> {
	return tossRequest<Record<string, unknown>>("GET", "/api/v1/price-limits", { query: { symbol }, group: "MARKET_DATA" });
}

/** 최근 체결 내역 (MARKET_DATA, 10/s) — [{ price, volume, timestamp, currency }]. */
export function getTrades(symbol: string, count = 10): Promise<Record<string, unknown>[]> {
	return tossRequest<Record<string, unknown>[]>("GET", "/api/v1/trades", { query: { symbol, count }, group: "MARKET_DATA" });
}

// ── 종목·시장 (STOCK / MARKET_INFO / RANKING / MARKET_INDICATOR*) ─────────

/** 종목 기본 정보 (STOCK, 5/s) — symbol/이름/시장/통화/상장 상태. OAS는 목록 API(/api/v1/stocks?symbols=). */
export function getStockInfo(symbol: string): Promise<Record<string, unknown>[]> {
	return tossRequest<Record<string, unknown>[]>("GET", "/api/v1/stocks", {
		query: { symbols: symbol },
		group: "STOCK",
	});
}

/** 매수 유의사항 (STOCK, 5/s) — 정리매매/과열/투자경고·위험/VI/신주인수권. */
export function getStockWarnings(symbol: string): Promise<Record<string, unknown>[]> {
	return tossRequest<Record<string, unknown>[]>("GET", `/api/v1/stocks/${encodeURIComponent(symbol)}/warnings`, { group: "STOCK" });
}

/** 환율 (MARKET_INFO, 3/s) — baseCurrency 기준 quoteCurrency 표시 (예: USD→KRW). */
export function getExchangeRate(baseCurrency = "USD", quoteCurrency = "KRW"): Promise<Record<string, unknown>> {
	return tossRequest<Record<string, unknown>>("GET", "/api/v1/exchange-rate", {
		query: { baseCurrency, quoteCurrency },
		group: "MARKET_INFO",
	});
}

/** 장 운영 정보 (MARKET_INFO, 3/s) — KR: KRX·NXT 세션, US: 프리·정규·애프터. */
export function getMarketCalendar(country: "KR" | "US", date?: string): Promise<Record<string, unknown>> {
	return tossRequest<Record<string, unknown>>("GET", `/api/v1/market-calendar/${country}`, {
		query: { date },
		group: "MARKET_INFO",
	});
}

export type TossRankingType =
	| "MARKET_TRADING_AMOUNT"
	| "MARKET_TRADING_VOLUME"
	| "TOP_GAINERS"
	| "TOP_LOSERS"
	| "TOSS_SECURITIES_TRADING_AMOUNT"
	| "TOSS_SECURITIES_TRADING_VOLUME";

export type TossRankingDuration = "realtime" | "1d" | "1w" | "1mo" | "3mo" | "6mo" | "1y";

export interface TossRankingsOptions {
	type: TossRankingType;
	marketCountry: TossMarketCountry;
	duration: TossRankingDuration;
	count?: number;
	excludeInvestmentCaution?: boolean;
}

/** 랭킹 조회 (RANKING, 5/s) — type(거래대금/거래량/상승·하락률), duration 누적. */
export function getRankings(opts: TossRankingsOptions): Promise<Record<string, unknown>> {
	return tossRequest<Record<string, unknown>>("GET", "/api/v1/rankings", {
		query: { ...opts },
		group: "RANKING",
	});
}

/** 시장 지표 현재가 (MARKET_INDICATOR_PRICE, 10/s) — 국내 지수·국채 (symbols 콤마 구분). */
export function getMarketIndicatorPrices(symbols: string[]): Promise<Record<string, unknown>[]> {
	return tossRequest<Record<string, unknown>[]>("GET", "/api/v1/market-indicators/prices", {
		query: { symbols: symbols.join(",") },
		group: "MARKET_INDICATOR_PRICE",
	});
}

export interface TossIndicatorCandleOptions {
	interval?: "1m" | "1d";
	count?: number;
	before?: string;
}

/** 시장 지표 캔들 (MARKET_INDICATOR_CHART, 5/s) — 지수·국채 차트. */
export function getMarketIndicatorCandles(symbol: string, opts: TossIndicatorCandleOptions = {}): Promise<Record<string, unknown>> {
	return tossRequest<Record<string, unknown>>("GET", `/api/v1/market-indicators/${encodeURIComponent(symbol)}/candles`, {
		query: { symbol, interval: opts.interval ?? "1d", count: opts.count, before: opts.before },
		group: "MARKET_INDICATOR_CHART",
	});
}

export interface TossInvestorTradingOptions {
	interval?: "1d" | "1w" | "1mo" | "1y";
	count?: number;
	until?: string;
}

/**
 * 투자자별 매매대금 (MARKET_INDICATOR, 10/s) — KOSPI/KOSDAQ 한정.
 * records: [{ date, updatedAt, individual, foreigner, institution, otherCorporation }].
 */
export function getInvestorTrading(symbol: "KOSPI" | "KOSDAQ", opts: TossInvestorTradingOptions = {}): Promise<Record<string, unknown>> {
	return tossRequest<Record<string, unknown>>("GET", `/api/v1/market-indicators/${symbol}/investor-trading`, {
		query: { symbol, interval: opts.interval ?? "1d", count: opts.count, until: opts.until },
		group: "MARKET_INDICATOR",
	});
}

// ── 자산 (ACCOUNT 1/s / ASSET 5/s, X-Tossinvest-Account 필요) ─────────────

/** 계좌 목록 (ACCOUNT, 1/s) — [{ accountNo, accountSeq, accountType }]. 헤더 불필요. */
export function getAccounts(): Promise<Array<{ accountNo: string; accountSeq: number; accountType: string }>> {
	return tossRequest<Array<{ accountNo: string; accountSeq: number; accountType: string }>>("GET", "/api/v1/accounts", {
		group: "ACCOUNT",
	});
}

/** 보유 주식 (ASSET, 5/s) — { overview(totalPurchaseAmount/marketValue/profitLoss/...), items }. */
export async function getHoldings(symbol?: string, accountSeq?: number): Promise<Record<string, unknown>> {
	const seq = await accountFor(accountSeq);
	return tossRequest<Record<string, unknown>>("GET", "/api/v1/holdings", {
		query: { symbol },
		accountSeq: seq,
		group: "ASSET",
	});
}

/** 매수 가능 금액 (ORDER_INFO, 6/s) — { currency, cashBuyingPower }. */
export async function getBuyingPower(currency = "KRW", accountSeq?: number): Promise<Record<string, unknown>> {
	const seq = await accountFor(accountSeq);
	return tossRequest<Record<string, unknown>>("GET", "/api/v1/buying-power", {
		query: { currency },
		accountSeq: seq,
		group: "ORDER_INFO",
	});
}

/** 판매 가능 수량 (ORDER_INFO, 6/s) — { sellableQuantity }. */
export async function getSellableQuantity(symbol: string, accountSeq?: number): Promise<Record<string, unknown>> {
	const seq = await accountFor(accountSeq);
	return tossRequest<Record<string, unknown>>("GET", "/api/v1/sellable-quantity", {
		query: { symbol },
		accountSeq: seq,
		group: "ORDER_INFO",
	});
}

/** 매매 수수료 (ORDER_INFO, 6/s) — [{ marketCountry, commissionRate(%), startDate, endDate }]. */
export async function getCommissions(accountSeq?: number): Promise<Record<string, unknown>[]> {
	const seq = await accountFor(accountSeq);
	return tossRequest<Record<string, unknown>[]>("GET", "/api/v1/commissions", { accountSeq: seq, group: "ORDER_INFO" });
}

// ── 주문 (ORDER 10/s / ORDER_HISTORY 5/s / ORDER_INFO 6/s) ────────────────

export interface TossOrderRequest {
	symbol: string;
	side: TossOrderSide;
	orderType: TossOrderType;
	/** 수량 주문: 주 단위 (LIMIT/MARKET 공용). KR: 정수, US: 소수점 허용. */
	quantity?: string;
	/** LIMIT 주문 가격 (native currency). orderType=LIMIT 이면 필수. */
	price?: string;
	/** 금액 주문 (US 시장가 매수 전용) — orderAmount(USD)로 매수. */
	orderAmount?: string;
	timeInForce?: TossTimeInForce;
	/** X-Tossinvest-Account — 미지정 시 첫 계좌 자동 사용. */
	accountSeq?: number;
	/** 1억원 이상 주문 동의 (기본 false — 미동의 시 거부). */
	confirmHighValueOrder?: boolean;
	/** 멱등키 — 미지정 시 자동 생성(randomUUID). */
	clientOrderId?: string;
}

/**
 * 주문 생성 (ORDER, 10/s). clientOrderId 자동 생성(멱등성) —
 * 동일 값 재요청 시 중복 주문이 생성되지 않는다.
 * 응답: { orderId, clientOrderId }.
 */
export async function placeOrder(req: TossOrderRequest): Promise<Record<string, unknown>> {
	const seq = await accountFor(req.accountSeq);
	return tossRequest<Record<string, unknown>>("POST", "/api/v1/orders", {
		body: cleanBody({
			clientOrderId: req.clientOrderId ?? randomUUID(),
			symbol: req.symbol,
			side: req.side,
			orderType: req.orderType,
			timeInForce: req.timeInForce,
			quantity: req.quantity,
			price: req.price,
			orderAmount: req.orderAmount,
			confirmHighValueOrder: req.confirmHighValueOrder,
		}),
		accountSeq: seq,
		group: "ORDER",
	});
}

export interface TossOrderModifyRequest {
	orderType: TossOrderType;
	quantity?: string;
	price?: string;
	confirmHighValueOrder?: boolean;
}

/** 주문 정정 (ORDER, 10/s) — 응답 orderId는 새로 발급된 주문 식별자. */
export async function modifyOrder(orderId: string, req: TossOrderModifyRequest, accountSeq?: number): Promise<Record<string, unknown>> {
	const seq = await accountFor(accountSeq);
	return tossRequest<Record<string, unknown>>("POST", `/api/v1/orders/${encodeURIComponent(orderId)}/modify`, {
		body: cleanBody({ ...req }),
		accountSeq: seq,
		group: "ORDER",
	});
}

/** 주문 취소 (ORDER, 10/s). */
export async function cancelOrder(orderId: string, accountSeq?: number): Promise<Record<string, unknown>> {
	const seq = await accountFor(accountSeq);
	return tossRequest<Record<string, unknown>>("POST", `/api/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
		accountSeq: seq,
		group: "ORDER",
	});
}

export interface TossOrdersOptions {
	/** 필수 — OPEN(대기중)/CLOSED(종료). */
	status?: "OPEN" | "CLOSED";
	symbol?: string;
	from?: string;
	to?: string;
	cursor?: string;
	limit?: number;
	accountSeq?: number;
}

/** 주문 목록 (ORDER_HISTORY, 5/s) — { orders, nextCursor, hasNext }. */
export async function getOrders(opts: TossOrdersOptions = {}): Promise<Record<string, unknown>> {
	const seq = await accountFor(opts.accountSeq);
	return tossRequest<Record<string, unknown>>("GET", "/api/v1/orders", {
		query: {
			status: opts.status ?? "OPEN",
			symbol: opts.symbol,
			from: opts.from,
			to: opts.to,
			cursor: opts.cursor,
			limit: opts.limit,
		},
		accountSeq: seq,
		group: "ORDER_HISTORY",
	});
}

/** 주문 상세 (ORDER_INFO, 6/s). */
export async function getOrder(orderId: string, accountSeq?: number): Promise<Record<string, unknown>> {
	const seq = await accountFor(accountSeq);
	return tossRequest<Record<string, unknown>>("GET", `/api/v1/orders/${encodeURIComponent(orderId)}`, {
		accountSeq: seq,
		group: "ORDER_HISTORY",
	});
}

// ── 조건주문 (CONDITIONAL_ORDER 5/s / CONDITIONAL_ORDER_HISTORY 10/s) ─────

export interface TossConditionalCondition {
	/** 매매 유형 (필수) — BUY/SELL. */
	orderSide: "BUY" | "SELL";
	/** 감시 가격 (필수) — 현재가가 이 값에 닿으면 주문 생성. */
	triggerPrice: string;
	/** 지정가(LIMIT) 주문 가격 — orderType=LIMIT일 때 필수. */
	orderPrice?: string;
}

export interface TossConditionalOrderRequest {
	symbol: string;
	/** SINGLE(1조건) / OCO(둘 중 하나 체결 시 나머지 취소) / OTO(부모 체결 후 자식). */
	type: TossConditionalType;
	quantity: string;
	orderType: TossOrderType;
	/** 만료일 YYYY-MM-DD (필수) — 미충족 시 자동 만료. */
	expireDate: string;
	/** 첫번째 감시 조건 (필수) — OTO는 부모 조건. */
	first: TossConditionalCondition;
	/** 두번째 감시 조건 — OCO/OTO 필수, SINGLE은 생략. */
	second?: TossConditionalCondition;
	confirmHighValueOrder?: boolean;
	clientOrderId?: string;
	accountSeq?: number;
}

/** 조건주문 생성 (CONDITIONAL_ORDER, 5/s) — 응답: { conditionalOrderId, clientOrderId }. OCO/OTO는 second 필수 + LIMIT만 허용. */
export async function placeConditionalOrder(req: TossConditionalOrderRequest): Promise<Record<string, unknown>> {
	if ((req.type === "OCO" || req.type === "OTO") && !req.second) {
		throw new Error("OCO/OTO 조건주문은 second 조건이 필수입니다.");
	}
	if ((req.type === "OCO" || req.type === "OTO") && req.orderType !== "LIMIT") {
		throw new Error("OCO/OTO 조건주문은 지정가(LIMIT)만 지원합니다.");
	}
	const seq = await accountFor(req.accountSeq);
	return tossRequest<Record<string, unknown>>("POST", "/api/v1/conditional-orders", {
		body: cleanBody({
			clientOrderId: req.clientOrderId ?? randomUUID(),
			symbol: req.symbol,
			type: req.type,
			quantity: req.quantity,
			orderType: req.orderType,
			expireDate: req.expireDate,
			first: req.first,
			second: req.second,
			confirmHighValueOrder: req.confirmHighValueOrder,
		}),
		accountSeq: seq,
		group: "CONDITIONAL_ORDER",
	});
}

/**
 * 조건주문 수정 (CONDITIONAL_ORDER, 5/s).
 * OAS ConditionalOrderModifyRequest: type/quantity/orderType/expireDate/first 필수(+OCO/OTO는 second).
 */
export async function modifyConditionalOrder(
	conditionalOrderId: string,
	req: {
		type: TossConditionalType;
		quantity: string;
		orderType: TossOrderType;
		expireDate: string;
		first: TossConditionalCondition;
		second?: TossConditionalCondition;
		confirmHighValueOrder?: boolean;
	},
	accountSeq?: number,
): Promise<Record<string, unknown>> {
	if ((req.type === "OCO" || req.type === "OTO") && !req.second) {
		throw new Error("OCO/OTO 조건주문 수정은 second 조건이 필수입니다.");
	}
	const seq = await accountFor(accountSeq);
	return tossRequest<Record<string, unknown>>("POST", `/api/v1/conditional-orders/${encodeURIComponent(conditionalOrderId)}/modify`, {
		body: cleanBody({
			type: req.type,
			quantity: req.quantity,
			orderType: req.orderType,
			expireDate: req.expireDate,
			first: req.first,
			second: req.second,
			confirmHighValueOrder: req.confirmHighValueOrder,
		}),
		accountSeq: seq,
		group: "CONDITIONAL_ORDER",
	});
}

/** 조건주문 취소 (CONDITIONAL_ORDER, 5/s). */
export async function cancelConditionalOrder(conditionalOrderId: string, accountSeq?: number): Promise<void> {
	const seq = await accountFor(accountSeq);
	await tossRequest<unknown>("DELETE", `/api/v1/conditional-orders/${encodeURIComponent(conditionalOrderId)}`, {
		accountSeq: seq,
		group: "CONDITIONAL_ORDER",
	});
}

export interface TossConditionalOrdersOptions {
	/** 필수 — OPEN(진행 중)/CLOSED(종료). */
	status?: "OPEN" | "CLOSED";
	symbol?: string;
	cursor?: string;
	limit?: number;
	accountSeq?: number;
}

/** 조건주문 목록 (CONDITIONAL_ORDER_HISTORY, 10/s). */
export async function getConditionalOrders(opts: TossConditionalOrdersOptions = {}): Promise<Record<string, unknown>> {
	const seq = await accountFor(opts.accountSeq);
	return tossRequest<Record<string, unknown>>("GET", "/api/v1/conditional-orders", {
		query: { status: opts.status ?? "OPEN", symbol: opts.symbol, cursor: opts.cursor, limit: opts.limit },
		accountSeq: seq,
		group: "CONDITIONAL_ORDER_HISTORY",
	});
}

/** 조건주문 상세 (CONDITIONAL_ORDER_HISTORY, 10/s). */
export async function getConditionalOrder(conditionalOrderId: string, accountSeq?: number): Promise<Record<string, unknown>> {
	const seq = await accountFor(accountSeq);
	return tossRequest<Record<string, unknown>>("GET", `/api/v1/conditional-orders/${encodeURIComponent(conditionalOrderId)}`, {
		accountSeq: seq,
		group: "CONDITIONAL_ORDER_HISTORY",
	});
}
