/**
 * src/roles/spot.ts — 현물 REST 보강 (공식 rest-api.md 카탈로그).
 *
 * 공개: 호가·체결·평균가·북티커·거래소 규칙·롤링 티커
 * 서명: 전체 주문이력·수수료·미체결 한도·계정 필터
 * 주문리스트: OCO / OTO / OTOCO (현물 전용)
 *
 * 제외: SOR, OPO/OPOCO, pegged, amend-keep-priority, cancelReplace, 출금/이체
 */
import { binanceRequest } from "../client.ts";
import { compact, normalizeSymbol, type CallOpts } from "./binance.ts";

function toNum(v: unknown): number | null {
	if (v === undefined || v === null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function pickFilter(filters: unknown[], type: string): Record<string, unknown> | undefined {
	const rows = Array.isArray(filters) ? filters : [];
	const hit = rows.find((f) => f && typeof f === "object" && (f as { filterType?: string }).filterType === type);
	return hit && typeof hit === "object" ? compact(hit as Record<string, unknown>) : undefined;
}

// ── 공개 시세 ─────────────────────────────────────────────────────────────

export async function getDepth(symbol: string, limit = 20, opts: CallOpts = {}): Promise<unknown> {
	const lim = Math.min(Math.max(Math.round(limit), 5), 100);
	const raw = await binanceRequest<Record<string, unknown>>("spot", "GET", "/api/v3/depth", {
		query: { symbol: normalizeSymbol(symbol), limit: lim },
		group: "MARKET",
		env: opts.env,
	});
	const bids = Array.isArray(raw.bids) ? (raw.bids as unknown[]).slice(0, lim) : [];
	const asks = Array.isArray(raw.asks) ? (raw.asks as unknown[]).slice(0, lim) : [];
	return compact({
		symbol: normalizeSymbol(symbol),
		lastUpdateId: raw.lastUpdateId,
		bids: bids.map((r) => {
			const row = Array.isArray(r) ? r : [];
			return { price: toNum(row[0]), qty: toNum(row[1]) };
		}),
		asks: asks.map((r) => {
			const row = Array.isArray(r) ? r : [];
			return { price: toNum(row[0]), qty: toNum(row[1]) };
		}),
	});
}

export async function getRecentTrades(symbol: string, limit = 20, opts: CallOpts = {}): Promise<unknown> {
	const lim = Math.min(Math.max(Math.round(limit), 1), 100);
	const raw = await binanceRequest<Array<Record<string, unknown>>>("spot", "GET", "/api/v3/trades", {
		query: { symbol: normalizeSymbol(symbol), limit: lim },
		group: "MARKET",
		env: opts.env,
	});
	const rows = Array.isArray(raw) ? raw : [];
	return compact(
		rows.map((r) => ({
			id: r.id,
			price: toNum(r.price),
			qty: toNum(r.qty),
			quoteQty: toNum(r.quoteQty),
			time: r.time,
			isBuyerMaker: r.isBuyerMaker,
		})),
	);
}

export async function getAvgPrice(symbol: string, opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<Record<string, unknown>>("spot", "GET", "/api/v3/avgPrice", {
		query: { symbol: normalizeSymbol(symbol) },
		group: "MARKET",
		env: opts.env,
	});
	return compact({ symbol: normalizeSymbol(symbol), mins: toNum(raw.mins), price: toNum(raw.price), closeTime: raw.closeTime });
}

export async function getBookTicker(symbol: string, opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<Record<string, unknown>>("spot", "GET", "/api/v3/ticker/bookTicker", {
		query: { symbol: normalizeSymbol(symbol) },
		group: "MARKET",
		env: opts.env,
	});
	return compact({
		symbol: raw.symbol,
		bidPrice: toNum(raw.bidPrice),
		bidQty: toNum(raw.bidQty),
		askPrice: toNum(raw.askPrice),
		askQty: toNum(raw.askQty),
	});
}

export async function getRollingTicker(symbol: string, windowSize = "1h", opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<Record<string, unknown>>("spot", "GET", "/api/v3/ticker", {
		query: { symbol: normalizeSymbol(symbol), windowSize },
		group: "MARKET",
		env: opts.env,
	});
	return compact({
		symbol: raw.symbol,
		windowSize,
		lastPrice: toNum(raw.lastPrice),
		priceChange: toNum(raw.priceChange),
		priceChangePercent: toNum(raw.priceChangePercent),
		highPrice: toNum(raw.highPrice),
		lowPrice: toNum(raw.lowPrice),
		volume: toNum(raw.volume),
		quoteVolume: toNum(raw.quoteVolume),
		openPrice: toNum(raw.openPrice),
	});
}

export async function getExchangeInfo(symbol: string, opts: CallOpts = {}): Promise<unknown> {
	const sym = normalizeSymbol(symbol);
	const raw = await binanceRequest<Record<string, unknown>>("spot", "GET", "/api/v3/exchangeInfo", {
		query: { symbol: sym },
		group: "MARKET",
		env: opts.env,
	});
	const symbols = Array.isArray(raw.symbols) ? (raw.symbols as Array<Record<string, unknown>>) : [];
	const s = symbols[0] ?? {};
	const filters = Array.isArray(s.filters) ? s.filters : [];
	return compact({
		symbol: s.symbol ?? sym,
		status: s.status,
		baseAsset: s.baseAsset,
		quoteAsset: s.quoteAsset,
		orderTypes: s.orderTypes,
		priceFilter: pickFilter(filters, "PRICE_FILTER"),
		lotSize: pickFilter(filters, "LOT_SIZE"),
		notional: pickFilter(filters, "NOTIONAL") ?? pickFilter(filters, "MIN_NOTIONAL"),
	});
}

// ── 계정 조회 보강 ─────────────────────────────────────────────────────────

export async function getAllOrders(symbol: string, opts: CallOpts & { limit?: number } = {}): Promise<unknown> {
	const limit = Math.min(Math.max(Math.round(opts.limit ?? 50), 1), 200);
	const raw = await binanceRequest<Array<Record<string, unknown>>>("spot", "GET", "/api/v3/allOrders", {
		query: { symbol: normalizeSymbol(symbol), limit },
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	const rows = Array.isArray(raw) ? raw : [];
	return compact({
		symbol: normalizeSymbol(symbol),
		count: rows.length,
		orders: rows.map((r) => ({
			orderId: r.orderId,
			clientOrderId: r.clientOrderId,
			price: r.price,
			origQty: r.origQty,
			executedQty: r.executedQty,
			status: r.status,
			type: r.type,
			side: r.side,
			stopPrice: r.stopPrice,
			time: r.time,
			updateTime: r.updateTime,
		})),
	});
}

export async function getCommission(symbol: string, opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<Record<string, unknown>>("spot", "GET", "/api/v3/account/commission", {
		query: { symbol: normalizeSymbol(symbol) },
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	return compact(raw);
}

export async function getUnfilledOrderCount(opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<unknown>("spot", "GET", "/api/v3/rateLimit/order", {
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	return compact(raw);
}

export async function getMyFilters(symbol: string, opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<unknown>("spot", "GET", "/api/v3/myFilters", {
		query: { symbol: normalizeSymbol(symbol) },
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	return compact(raw);
}

// ── 주문 리스트 (OCO / OTO / OTOCO) ──────────────────────────────────────

export interface SpotOcoRequest {
	symbol: string;
	side: "BUY" | "SELL";
	quantity: string;
	aboveType: string;
	belowType: string;
	abovePrice?: string;
	aboveStopPrice?: string;
	aboveTimeInForce?: string;
	belowPrice?: string;
	belowStopPrice?: string;
	belowTimeInForce?: string;
	env?: CallOpts["env"];
}

export interface SpotOtoRequest {
	symbol: string;
	workingType: "LIMIT" | "LIMIT_MAKER";
	workingSide: "BUY" | "SELL";
	workingPrice: string;
	workingQuantity: string;
	workingTimeInForce?: string;
	pendingType: string;
	pendingSide: "BUY" | "SELL";
	pendingQuantity: string;
	pendingPrice?: string;
	pendingStopPrice?: string;
	pendingTimeInForce?: string;
	env?: CallOpts["env"];
}

export interface SpotOtocoRequest extends SpotOtoRequest {
	pendingAboveType: string;
	pendingAbovePrice?: string;
	pendingAboveStopPrice?: string;
	pendingAboveTimeInForce?: string;
	pendingBelowType?: string;
	pendingBelowPrice?: string;
	pendingBelowStopPrice?: string;
	pendingBelowTimeInForce?: string;
}

export async function placeOco(req: SpotOcoRequest): Promise<unknown> {
	const symbol = normalizeSymbol(req.symbol);
	if (!req.quantity) throw new Error("OCO는 quantity가 필요합니다.");
	const raw = await binanceRequest<Record<string, unknown>>("spot", "POST", "/api/v3/orderList/oco", {
		query: {
			symbol,
			side: req.side,
			quantity: req.quantity,
			aboveType: req.aboveType,
			belowType: req.belowType,
			abovePrice: req.abovePrice,
			aboveStopPrice: req.aboveStopPrice,
			aboveTimeInForce: req.aboveTimeInForce,
			belowPrice: req.belowPrice,
			belowStopPrice: req.belowStopPrice,
			belowTimeInForce: req.belowTimeInForce,
		},
		signed: true,
		group: "ORDER",
		env: req.env,
	});
	return compact({
		orderListId: raw.orderListId,
		contingencyType: raw.contingencyType,
		listStatusType: raw.listStatusType,
		listOrderStatus: raw.listOrderStatus,
		symbol: raw.symbol,
		orders: raw.orders,
		orderReports: raw.orderReports,
	});
}

export async function placeOto(req: SpotOtoRequest): Promise<unknown> {
	const symbol = normalizeSymbol(req.symbol);
	const raw = await binanceRequest<Record<string, unknown>>("spot", "POST", "/api/v3/orderList/oto", {
		query: {
			symbol,
			workingType: req.workingType,
			workingSide: req.workingSide,
			workingPrice: req.workingPrice,
			workingQuantity: req.workingQuantity,
			workingTimeInForce: req.workingType === "LIMIT" ? (req.workingTimeInForce ?? "GTC") : req.workingTimeInForce,
			pendingType: req.pendingType,
			pendingSide: req.pendingSide,
			pendingQuantity: req.pendingQuantity,
			pendingPrice: req.pendingPrice,
			pendingStopPrice: req.pendingStopPrice,
			pendingTimeInForce: req.pendingTimeInForce,
		},
		signed: true,
		group: "ORDER",
		env: req.env,
	});
	return compact({
		orderListId: raw.orderListId,
		contingencyType: raw.contingencyType,
		listStatusType: raw.listStatusType,
		symbol: raw.symbol,
		orders: raw.orders,
		orderReports: raw.orderReports,
	});
}

export async function placeOtoco(req: SpotOtocoRequest): Promise<unknown> {
	const symbol = normalizeSymbol(req.symbol);
	const raw = await binanceRequest<Record<string, unknown>>("spot", "POST", "/api/v3/orderList/otoco", {
		query: {
			symbol,
			workingType: req.workingType,
			workingSide: req.workingSide,
			workingPrice: req.workingPrice,
			workingQuantity: req.workingQuantity,
			workingTimeInForce: req.workingType === "LIMIT" ? (req.workingTimeInForce ?? "GTC") : req.workingTimeInForce,
			pendingSide: req.pendingSide,
			pendingQuantity: req.pendingQuantity,
			pendingAboveType: req.pendingAboveType,
			pendingAbovePrice: req.pendingAbovePrice,
			pendingAboveStopPrice: req.pendingAboveStopPrice,
			pendingAboveTimeInForce: req.pendingAboveTimeInForce,
			pendingBelowType: req.pendingBelowType,
			pendingBelowPrice: req.pendingBelowPrice,
			pendingBelowStopPrice: req.pendingBelowStopPrice,
			pendingBelowTimeInForce: req.pendingBelowTimeInForce,
		},
		signed: true,
		group: "ORDER",
		env: req.env,
	});
	return compact({
		orderListId: raw.orderListId,
		contingencyType: raw.contingencyType,
		listStatusType: raw.listStatusType,
		symbol: raw.symbol,
		orders: raw.orders,
		orderReports: raw.orderReports,
	});
}

export async function cancelOrderList(symbol: string, orderListId: string, opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<unknown>("spot", "DELETE", "/api/v3/orderList", {
		query: { symbol: normalizeSymbol(symbol), orderListId },
		signed: true,
		group: "ORDER",
		env: opts.env,
	});
	return compact(raw);
}

export async function getOpenOrderLists(opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<unknown>("spot", "GET", "/api/v3/openOrderList", {
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	return compact(raw);
}

export async function getOrderList(orderListId: string, opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<unknown>("spot", "GET", "/api/v3/orderList", {
		query: { orderListId },
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	return compact(raw);
}

export async function getAllOrderLists(opts: CallOpts & { limit?: number } = {}): Promise<unknown> {
	const raw = await binanceRequest<unknown>("spot", "GET", "/api/v3/allOrderList", {
		query: { limit: Math.min(Math.max(Math.round(opts.limit ?? 50), 1), 200) },
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	return compact(raw);
}
