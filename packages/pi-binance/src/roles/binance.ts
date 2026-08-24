/**
 * src/roles/binance.ts — Binance 도메인 역할 (시세/차트/잔고/주문/선물).
 *
 * 공개 시세는 키 없이 호출 가능. 잔고·주문·레버리지는 HMAC 서명.
 * 모든 응답은 compact()로 정규화한다 (null/undefined/빈 문자열 제거).
 */
import { randomUUID } from "node:crypto";
import type { Bar } from "pi-finance-core";
import { binanceFuturesSigned, binanceRequest, type BinanceMarket } from "../client.ts";
import type { BinanceEnv } from "../secret.ts";

export type { BinanceMarket };

export const BINANCE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"] as const;
export type BinanceInterval = (typeof BINANCE_INTERVALS)[number];

export const BINANCE_ORDER_TYPES = ["LIMIT", "MARKET", "STOP_MARKET", "TAKE_PROFIT_MARKET", "STOP", "TAKE_PROFIT"] as const;
export type BinanceOrderType = (typeof BINANCE_ORDER_TYPES)[number];

export interface CallOpts {
	env?: BinanceEnv;
}

/** BTC/USDT, btc-usdt → BTCUSDT */
export function normalizeSymbol(raw: string): string {
	const s = raw.trim().toUpperCase().replace(/[-\/\s]/g, "");
	if (!s) throw new Error("symbol이 비어 있습니다.");
	if (!/^[A-Z0-9]{4,20}$/.test(s)) {
		throw new Error(`심볼 형식이 올바르지 않습니다: ${raw} — BTCUSDT 또는 BTC/USDT`);
	}
	return s;
}

/** null/undefined/빈 문자열 재귀 제거. */
export function compact<T>(value: T): T {
	if (Array.isArray(value)) return value.map((v) => compact(v)) as unknown as T;
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (v === null || v === undefined || v === "") continue;
			out[k] = compact(v);
		}
		return out as T;
	}
	return value;
}

function toNum(v: unknown): number | null {
	if (v === undefined || v === null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function nonzero(v: unknown): boolean {
	const n = toNum(v);
	return n !== null && n !== 0;
}

// ── 시세 ──────────────────────────────────────────────────────────────────

export interface BinancePriceItem {
	symbol: string;
	market: BinanceMarket;
	lastPrice: number;
	priceChange?: number;
	priceChangePercent?: number;
	highPrice?: number;
	lowPrice?: number;
	openPrice?: number;
	volume?: number;
	quoteVolume?: number;
	weightedAvgPrice?: number;
}

function pickTicker(raw: Record<string, unknown>, market: BinanceMarket): BinancePriceItem | null {
	const symbol = String(raw.symbol ?? "").toUpperCase();
	const lastPrice = toNum(raw.lastPrice);
	if (!symbol || lastPrice === null) return null;
	return compact({
		symbol,
		market,
		lastPrice,
		priceChange: toNum(raw.priceChange) ?? undefined,
		priceChangePercent: toNum(raw.priceChangePercent) ?? undefined,
		highPrice: toNum(raw.highPrice) ?? undefined,
		lowPrice: toNum(raw.lowPrice) ?? undefined,
		openPrice: toNum(raw.openPrice) ?? undefined,
		volume: toNum(raw.volume) ?? undefined,
		quoteVolume: toNum(raw.quoteVolume) ?? undefined,
		weightedAvgPrice: toNum(raw.weightedAvgPrice) ?? undefined,
	});
}

/**
 * 24h 티커. symbols 최대 10.
 * 선물 API는 복수 심볼 배열을 지원하지 않아 순차 호출.
 */
export async function getPrices(symbols: string[], market: BinanceMarket = "spot", opts: CallOpts = {}): Promise<BinancePriceItem[]> {
	const list = symbols.map(normalizeSymbol).slice(0, 10);
	if (list.length === 0) throw new Error("symbols가 비어 있습니다.");
	const path = market === "usdm" ? "/fapi/v1/ticker/24hr" : "/api/v3/ticker/24hr";

	if (list.length === 1 || market === "usdm") {
		const items: BinancePriceItem[] = [];
		for (const symbol of list) {
			const raw = await binanceRequest<Record<string, unknown>>(market, "GET", path, {
				query: { symbol },
				group: "MARKET",
				env: opts.env,
			});
			const item = pickTicker(raw, market);
			if (item) items.push(item);
		}
		if (items.length === 0) throw new Error("티커 응답이 비었습니다 — 심볼/시장(spot|usdm)을 확인하세요.");
		return items;
	}

	const raw = await binanceRequest<Array<Record<string, unknown>>>(market, "GET", path, {
		query: { symbols: JSON.stringify(list) },
		group: "MARKET",
		env: opts.env,
	});
	const rows = Array.isArray(raw) ? raw : [];
	const items = rows.map((r) => pickTicker(r, market)).filter((x): x is BinancePriceItem => Boolean(x));
	if (items.length === 0) throw new Error("티커 응답이 비었습니다 — 심볼을 확인하세요.");
	return items;
}

// ── 차트 ──────────────────────────────────────────────────────────────────

export interface BinanceChartResult {
	symbol: string;
	market: BinanceMarket;
	interval: string;
	bars: Bar[];
	count: number;
}

function barDate(openTime: number, interval: string): string {
	const d = new Date(openTime);
	if (interval === "1d" || interval === "1w") return d.toISOString().slice(0, 10).replaceAll("-", "");
	return d.toISOString();
}

/** kline 행 → Bar[] (시간 오름차순). */
export function normalizeKlines(rows: unknown[], interval: string): Bar[] {
	const bars: Bar[] = [];
	for (const row of rows) {
		if (!Array.isArray(row) || row.length < 6) continue;
		const openTime = Number(row[0]);
		const open = toNum(row[1]);
		const high = toNum(row[2]);
		const low = toNum(row[3]);
		const close = toNum(row[4]);
		const volume = toNum(row[5]);
		if (!Number.isFinite(openTime) || open === null || high === null || low === null || close === null) continue;
		bars.push({
			date: barDate(openTime, interval),
			open,
			high,
			low,
			close,
			volume: volume ?? undefined,
		});
	}
	bars.sort((a, b) => a.date.localeCompare(b.date));
	return bars;
}

export async function getKlines(
	symbol: string,
	opts: { market?: BinanceMarket; interval?: string; limit?: number; env?: BinanceEnv } = {},
): Promise<BinanceChartResult> {
	const market = opts.market ?? "spot";
	const interval = opts.interval ?? "1d";
	const limit = Math.min(Math.max(Math.round(opts.limit ?? 100), 1), 200);
	const sym = normalizeSymbol(symbol);
	const path = market === "usdm" ? "/fapi/v1/klines" : "/api/v3/klines";
	const rows = await binanceRequest<unknown[]>(market, "GET", path, {
		query: { symbol: sym, interval, limit },
		group: "MARKET",
		env: opts.env,
	});
	const bars = normalizeKlines(Array.isArray(rows) ? rows : [], interval);
	return { symbol: sym, market, interval, bars, count: bars.length };
}

// ── 잔고 / 포지션 ─────────────────────────────────────────────────────────

export interface BinanceSpotBalance {
	asset: string;
	free: number;
	locked: number;
}

export interface BinanceFuturesPosition {
	symbol: string;
	positionAmt: number;
	entryPrice: number | null;
	markPrice: number | null;
	unrealizedProfit: number | null;
	liquidationPrice: number | null;
	leverage: number | null;
	marginType?: string;
	positionSide?: string;
	notional: number | null;
}

export async function getSpotAccount(opts: CallOpts = {}): Promise<{
	canTrade?: boolean;
	balances: BinanceSpotBalance[];
}> {
	const raw = await binanceRequest<Record<string, unknown>>("spot", "GET", "/api/v3/account", {
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	const balances: BinanceSpotBalance[] = [];
	const rows = Array.isArray(raw.balances) ? (raw.balances as Array<Record<string, unknown>>) : [];
	for (const r of rows) {
		const free = toNum(r.free) ?? 0;
		const locked = toNum(r.locked) ?? 0;
		if (free === 0 && locked === 0) continue;
		const asset = String(r.asset ?? "");
		if (!asset) continue;
		balances.push({ asset, free, locked });
	}
	return compact({
		canTrade: typeof raw.canTrade === "boolean" ? raw.canTrade : undefined,
		balances,
	});
}

function pickPosition(r: Record<string, unknown>): BinanceFuturesPosition | null {
	const symbol = String(r.symbol ?? "");
	const positionAmt = toNum(r.positionAmt);
	if (!symbol || positionAmt === null || positionAmt === 0) return null;
	return compact({
		symbol,
		positionAmt,
		entryPrice: toNum(r.entryPrice),
		markPrice: toNum(r.markPrice),
		unrealizedProfit: toNum(r.unRealizedProfit ?? r.unrealizedProfit),
		liquidationPrice: toNum(r.liquidationPrice),
		leverage: toNum(r.leverage),
		marginType: typeof r.marginType === "string" ? r.marginType : undefined,
		positionSide: typeof r.positionSide === "string" ? r.positionSide : undefined,
		notional: toNum(r.notional),
	});
}

export async function getFuturesPositions(opts: CallOpts = {}): Promise<BinanceFuturesPosition[]> {
	const { data } = await binanceFuturesSigned<Array<Record<string, unknown>>>("/fapi/v2/positionRisk", "/fapi/v3/positionRisk", {
		env: opts.env,
	});
	const rows = Array.isArray(data) ? data : [];
	return rows.map(pickPosition).filter((x): x is BinanceFuturesPosition => Boolean(x));
}

export async function getFuturesAccount(opts: CallOpts = {}): Promise<{
	totalWalletBalance: number | null;
	availableBalance: number | null;
	totalUnrealizedProfit: number | null;
	totalMarginBalance: number | null;
	assets: Array<{ asset: string; walletBalance: number; availableBalance: number; unrealizedProfit: number | null }>;
	positions: BinanceFuturesPosition[];
	apiVersion: string;
}> {
	const { data, version } = await binanceFuturesSigned<Record<string, unknown>>("/fapi/v2/account", "/fapi/v3/account", {
		env: opts.env,
	});
	const assets: Array<{ asset: string; walletBalance: number; availableBalance: number; unrealizedProfit: number | null }> = [];
	const rawAssets = Array.isArray(data.assets) ? (data.assets as Array<Record<string, unknown>>) : [];
	for (const r of rawAssets) {
		if (!nonzero(r.walletBalance) && !nonzero(r.unrealizedProfit) && !nonzero(r.availableBalance)) continue;
		const asset = String(r.asset ?? "");
		const walletBalance = toNum(r.walletBalance);
		const availableBalance = toNum(r.availableBalance);
		if (!asset || walletBalance === null || availableBalance === null) continue;
		assets.push({
			asset,
			walletBalance,
			availableBalance,
			unrealizedProfit: toNum(r.unrealizedProfit),
		});
	}
	let positions: BinanceFuturesPosition[] = [];
	try {
		positions = await getFuturesPositions(opts);
	} catch {
		const rawPos = Array.isArray(data.positions) ? (data.positions as Array<Record<string, unknown>>) : [];
		positions = rawPos.map(pickPosition).filter((x): x is BinanceFuturesPosition => Boolean(x));
	}
	return compact({
		totalWalletBalance: toNum(data.totalWalletBalance),
		availableBalance: toNum(data.availableBalance),
		totalUnrealizedProfit: toNum(data.totalUnrealizedProfit),
		totalMarginBalance: toNum(data.totalMarginBalance),
		assets,
		positions,
		apiVersion: version,
	});
}

export async function getAccount(market: BinanceMarket = "spot", opts: CallOpts = {}): Promise<unknown> {
	return market === "usdm" ? getFuturesAccount(opts) : getSpotAccount(opts);
}

// ── 주문 ──────────────────────────────────────────────────────────────────

export interface PlaceOrderRequest {
	market?: BinanceMarket;
	symbol: string;
	side: "BUY" | "SELL";
	type: BinanceOrderType;
	quantity?: string;
	quoteOrderQty?: string;
	price?: string;
	stopPrice?: string;
	timeInForce?: "GTC" | "IOC" | "FOK";
	reduceOnly?: boolean;
	positionSide?: "BOTH" | "LONG" | "SHORT";
	clientOrderId?: string;
	env?: BinanceEnv;
}

function mapSpotType(type: BinanceOrderType): string {
	if (type === "STOP_MARKET") return "STOP_LOSS";
	if (type === "TAKE_PROFIT_MARKET") return "TAKE_PROFIT";
	return type;
}

export async function placeOrder(req: PlaceOrderRequest): Promise<Record<string, unknown>> {
	const market = req.market ?? "spot";
	const symbol = normalizeSymbol(req.symbol);
	const type = req.type;
	if (type === "LIMIT" || type === "STOP" || type === "TAKE_PROFIT") {
		if (!req.price) throw new Error(`${type} 주문은 price가 필요합니다.`);
		if (!req.quantity) throw new Error(`${type} 주문은 quantity가 필요합니다.`);
	}
	if (type === "MARKET" && !req.quantity && !req.quoteOrderQty) {
		throw new Error("MARKET 주문은 quantity 또는 quoteOrderQty가 필요합니다.");
	}
	if ((type === "STOP_MARKET" || type === "TAKE_PROFIT_MARKET" || type === "STOP" || type === "TAKE_PROFIT") && !req.stopPrice) {
		throw new Error(`${type} 주문은 stopPrice가 필요합니다.`);
	}
	if (market === "spot" && (type === "STOP" || type === "TAKE_PROFIT")) {
		throw new Error("현물 STOP/TAKE_PROFIT(지정가 스탑)은 STOP_MARKET/TAKE_PROFIT_MARKET 또는 LIMIT을 사용하세요.");
	}

	const apiType = market === "spot" ? mapSpotType(type) : type;
	const query: Record<string, string | number | boolean | undefined> = {
		symbol,
		side: req.side,
		type: apiType,
		quantity: req.quantity,
		quoteOrderQty: market === "spot" ? req.quoteOrderQty : undefined,
		price: req.price,
		stopPrice: req.stopPrice,
		timeInForce: type === "LIMIT" || type === "STOP" || type === "TAKE_PROFIT" ? (req.timeInForce ?? "GTC") : undefined,
		newClientOrderId: req.clientOrderId ?? `pi-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
	};
	if (market === "usdm") {
		query.reduceOnly = req.reduceOnly;
		query.positionSide = req.positionSide;
	}

	const path = market === "usdm" ? "/fapi/v1/order" : "/api/v3/order";
	const raw = await binanceRequest<Record<string, unknown>>(market, "POST", path, {
		query,
		signed: true,
		group: "ORDER",
		env: req.env,
	});
	return compact({
		market,
		symbol,
		orderId: raw.orderId,
		clientOrderId: raw.clientOrderId,
		status: raw.status,
		side: raw.side,
		type: raw.type,
		price: raw.price,
		avgPrice: raw.avgPrice,
		origQty: raw.origQty,
		executedQty: raw.executedQty,
		cummulativeQuoteQty: raw.cummulativeQuoteQty ?? raw.cumQuote,
		reduceOnly: raw.reduceOnly,
		positionSide: raw.positionSide,
		updateTime: raw.updateTime,
		transactTime: raw.transactTime,
	});
}

export async function listOpenOrders(symbol: string | undefined, market: BinanceMarket = "spot", opts: CallOpts = {}): Promise<unknown> {
	const path = market === "usdm" ? "/fapi/v1/openOrders" : "/api/v3/openOrders";
	const raw = await binanceRequest<unknown>(market, "GET", path, {
		query: symbol ? { symbol: normalizeSymbol(symbol) } : {},
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	return compact(raw);
}

export async function getOrder(symbol: string, orderId: string, market: BinanceMarket = "spot", opts: CallOpts = {}): Promise<unknown> {
	const path = market === "usdm" ? "/fapi/v1/order" : "/api/v3/order";
	const raw = await binanceRequest<unknown>(market, "GET", path, {
		query: { symbol: normalizeSymbol(symbol), orderId },
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	return compact(raw);
}

export async function cancelOrder(symbol: string, orderId: string, market: BinanceMarket = "spot", opts: CallOpts = {}): Promise<unknown> {
	const path = market === "usdm" ? "/fapi/v1/order" : "/api/v3/order";
	const raw = await binanceRequest<unknown>(market, "DELETE", path, {
		query: { symbol: normalizeSymbol(symbol), orderId },
		signed: true,
		group: "ORDER",
		env: opts.env,
	});
	return compact(raw);
}

export async function cancelAllOrders(symbol: string, market: BinanceMarket = "spot", opts: CallOpts = {}): Promise<unknown> {
	const path = market === "usdm" ? "/fapi/v1/allOpenOrders" : "/api/v3/openOrders";
	const raw = await binanceRequest<unknown>(market, "DELETE", path, {
		query: { symbol: normalizeSymbol(symbol) },
		signed: true,
		group: "ORDER",
		env: opts.env,
	});
	return compact(raw);
}

// ── 선물 전용 ─────────────────────────────────────────────────────────────

export async function getMarkPremium(symbol: string, opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<Record<string, unknown>>("usdm", "GET", "/fapi/v1/premiumIndex", {
		query: { symbol: normalizeSymbol(symbol) },
		group: "MARKET",
		env: opts.env,
	});
	return compact({
		symbol: raw.symbol,
		markPrice: toNum(raw.markPrice),
		indexPrice: toNum(raw.indexPrice),
		lastFundingRate: toNum(raw.lastFundingRate),
		nextFundingTime: raw.nextFundingTime,
		interestRate: toNum(raw.interestRate),
		time: raw.time,
	});
}

export async function getFundingRate(symbol: string, opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<Array<Record<string, unknown>>>("usdm", "GET", "/fapi/v1/fundingRate", {
		query: { symbol: normalizeSymbol(symbol), limit: 5 },
		group: "MARKET",
		env: opts.env,
	});
	const rows = Array.isArray(raw) ? raw : [];
	return compact(
		rows.map((r) => ({
			symbol: r.symbol,
			fundingRate: toNum(r.fundingRate),
			fundingTime: r.fundingTime,
			markPrice: toNum(r.markPrice),
		})),
	);
}

export async function getOpenInterest(symbol: string, opts: CallOpts = {}): Promise<unknown> {
	const raw = await binanceRequest<Record<string, unknown>>("usdm", "GET", "/fapi/v1/openInterest", {
		query: { symbol: normalizeSymbol(symbol) },
		group: "MARKET",
		env: opts.env,
	});
	return compact({
		symbol: raw.symbol,
		openInterest: toNum(raw.openInterest),
		time: raw.time,
	});
}

export async function setLeverage(symbol: string, leverage: number, opts: CallOpts = {}): Promise<unknown> {
	const lev = Math.round(leverage);
	if (!Number.isFinite(lev) || lev < 1 || lev > 125) {
		throw new Error("leverage는 1~125 정수여야 합니다.");
	}
	const raw = await binanceRequest<Record<string, unknown>>("usdm", "POST", "/fapi/v1/leverage", {
		query: { symbol: normalizeSymbol(symbol), leverage: lev },
		signed: true,
		group: "ORDER",
		env: opts.env,
	});
	return compact({ symbol: raw.symbol, leverage: toNum(raw.leverage), maxNotionalValue: raw.maxNotionalValue });
}

export async function setMarginType(symbol: string, marginType: "ISOLATED" | "CROSSED", opts: CallOpts = {}): Promise<unknown> {
	try {
		const raw = await binanceRequest<Record<string, unknown>>("usdm", "POST", "/fapi/v1/marginType", {
			query: { symbol: normalizeSymbol(symbol), marginType },
			signed: true,
			group: "ORDER",
			env: opts.env,
		});
		return compact({ symbol: normalizeSymbol(symbol), marginType, result: raw });
	} catch (e) {
		const code = (e as { binance?: { code?: number } }).binance?.code;
		// -4046: No need to change margin type.
		if (code === -4046) return { symbol: normalizeSymbol(symbol), marginType, alreadySet: true };
		throw e;
	}
}
