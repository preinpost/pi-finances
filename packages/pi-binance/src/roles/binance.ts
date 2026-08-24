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

export const BINANCE_ORDER_TYPES = [
	"LIMIT",
	"MARKET",
	"LIMIT_MAKER",
	"STOP_MARKET",
	"TAKE_PROFIT_MARKET",
	"STOP",
	"TAKE_PROFIT",
	"STOP_LOSS",
	"STOP_LOSS_LIMIT",
	"TAKE_PROFIT_LIMIT",
] as const;
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
	/** 현물 평단가 — includeCostBasis 시 myTrades FIFO로 계산. */
	costBasis?: SpotCostBasis;
}

export interface SpotTrade {
	id: number;
	time: number;
	price: number;
	qty: number;
	quoteQty: number | null;
	isBuyer: boolean;
	commission?: number;
	commissionAsset?: string;
}

export interface SpotCostBasis {
	symbol: string;
	avgPrice: number | null;
	costQuote: number | null;
	matchedQty: number;
	unexplainedQty: number;
	buyQty: number;
	sellQty: number;
	tradeCount: number;
	method: "fifo";
	note?: string;
}

const STABLE_ASSETS = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI", "EUR", "AEUR", "USD1"]);

/**
 * 현물 체결로 남은 재고 평단가 (FIFO).
 * currentQty가 체결 재구성보다 많으면 입금/컨버트 등 unexplainedQty.
 * 적으면 출금·이체로 보고 오래된 로트부터 제거해 현재 잔고에 맞춘다.
 */
export function costBasisFromTrades(
	trades: Array<{ time: number; price: number; qty: number; isBuyer: boolean }>,
	currentQty: number,
): Omit<SpotCostBasis, "symbol"> {
	const lots: { qty: number; price: number }[] = [];
	let buyQty = 0;
	let sellQty = 0;
	const sorted = [...trades].sort((a, b) => a.time - b.time);
	for (const t of sorted) {
		if (!(t.qty > 0) || !(t.price > 0)) continue;
		if (t.isBuyer) {
			lots.push({ qty: t.qty, price: t.price });
			buyQty += t.qty;
		} else {
			let left = t.qty;
			sellQty += t.qty;
			while (left > 1e-12 && lots.length > 0) {
				const lot = lots[0];
				const take = Math.min(lot.qty, left);
				lot.qty -= take;
				left -= take;
				if (lot.qty <= 1e-12) lots.shift();
			}
		}
	}
	const target = Math.max(0, currentQty);
	let remaining = lots.reduce((s, l) => s + l.qty, 0);
	if (remaining > target + 1e-12) {
		let extra = remaining - target;
		while (extra > 1e-12 && lots.length > 0) {
			const lot = lots[0];
			const take = Math.min(lot.qty, extra);
			lot.qty -= take;
			extra -= take;
			remaining -= take;
			if (lot.qty <= 1e-12) lots.shift();
		}
	}
	const matchedQty = lots.reduce((s, l) => s + l.qty, 0);
	const costQuote = lots.reduce((s, l) => s + l.qty * l.price, 0);
	const unexplainedQty = Math.max(0, target - matchedQty);
	let note: string | undefined;
	if (unexplainedQty > 1e-8) {
		note = "체결 이력으로 설명되지 않는 수량 — 입금·컨버트·다른 페어 매수 가능";
	} else if (trades.length === 0) {
		note = "해당 페어 체결 없음";
	}
	return {
		avgPrice: matchedQty > 1e-12 ? costQuote / matchedQty : null,
		costQuote: matchedQty > 1e-12 ? costQuote : null,
		matchedQty,
		unexplainedQty,
		buyQty,
		sellQty,
		tradeCount: trades.length,
		method: "fifo",
		note,
	};
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

export interface SpotAccountOpts extends CallOpts {
	/** 현물 평단가 (myTrades FIFO). 기본 true. */
	includeCostBasis?: boolean;
	/** 평단가 견적 통화 (기본 USDT). */
	quote?: string;
	/** 평단가를 계산할 자산/심볼 (예: ETH 또는 ETHUSDT). 미지정 시 비스테이블 잔고 최대 8개. */
	symbols?: string[];
}

export async function getMyTrades(
	symbol: string,
	market: BinanceMarket = "spot",
	opts: CallOpts & { maxPages?: number } = {},
): Promise<SpotTrade[]> {
	const sym = normalizeSymbol(symbol);
	const path = market === "usdm" ? "/fapi/v1/userTrades" : "/api/v3/myTrades";
	const out: SpotTrade[] = [];
	let fromId: number | undefined;
	const maxPages = Math.min(Math.max(opts.maxPages ?? 10, 1), 10);
	for (let page = 0; page < maxPages; page++) {
		const raw = await binanceRequest<Array<Record<string, unknown>>>(market, "GET", path, {
			query: { symbol: sym, limit: 1000, fromId },
			signed: true,
			group: "ACCOUNT",
			env: opts.env,
		});
		const rows = Array.isArray(raw) ? raw : [];
		if (rows.length === 0) break;
		for (const r of rows) {
			const id = Number(r.id);
			const time = Number(r.time);
			const price = toNum(r.price);
			const qty = toNum(r.qty);
			if (!Number.isFinite(id) || !Number.isFinite(time) || price === null || qty === null) continue;
			out.push(
				compact({
					id,
					time,
					price,
					qty,
					quoteQty: toNum(r.quoteQty),
					isBuyer: Boolean(r.buyer ?? r.isBuyer),
					commission: toNum(r.commission) ?? undefined,
					commissionAsset: typeof r.commissionAsset === "string" ? r.commissionAsset : undefined,
				}),
			);
		}
		if (rows.length < 1000) break;
		const lastId = Number(rows[rows.length - 1]?.id);
		if (!Number.isFinite(lastId)) break;
		fromId = lastId + 1;
	}
	return out;
}

async function attachSpotCostBasis(balances: BinanceSpotBalance[], opts: SpotAccountOpts): Promise<void> {
	const quote = (opts.quote ?? "USDT").toUpperCase();
	const requested = (opts.symbols ?? []).map((s) => s.trim()).filter(Boolean);
	const want = new Set(
		requested.map((s) => {
			const u = s.toUpperCase().replace(/[-\/\s]/g, "");
			return u.endsWith(quote) && u.length > quote.length ? u.slice(0, -quote.length) : u;
		}),
	);
	const candidates = balances.filter((b) => {
		if (STABLE_ASSETS.has(b.asset)) return false;
		if (b.asset.startsWith("LD")) return false;
		if (want.size > 0) return want.has(b.asset);
		return true;
	});
	const targets = candidates.slice(0, 8);
	for (const bal of targets) {
		const symbol = `${bal.asset}${quote}`;
		try {
			const trades = await getMyTrades(symbol, "spot", { env: opts.env });
			const qty = bal.free + bal.locked;
			bal.costBasis = compact({ symbol, ...costBasisFromTrades(trades, qty) });
		} catch (e) {
			const code = (e as { binance?: { code?: number } }).binance?.code;
			bal.costBasis = {
				symbol,
				avgPrice: null,
				costQuote: null,
				matchedQty: 0,
				unexplainedQty: bal.free + bal.locked,
				buyQty: 0,
				sellQty: 0,
				tradeCount: 0,
				method: "fifo",
				note: code === -1121 ? `${symbol} 페어 없음` : (e as Error).message,
			};
		}
	}
}

export async function getSpotAccount(opts: SpotAccountOpts = {}): Promise<{
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
	if (opts.includeCostBasis !== false) {
		await attachSpotCostBasis(balances, opts);
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

export async function getAccount(market: BinanceMarket = "spot", opts: SpotAccountOpts = {}): Promise<unknown> {
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
	/** 현물 전용 — POST /api/v3/order/test (매칭엔진에 안 넣음). */
	test?: boolean;
	env?: BinanceEnv;
}

function mapSpotType(type: BinanceOrderType): string {
	if (type === "STOP_MARKET") return "STOP_LOSS";
	if (type === "TAKE_PROFIT_MARKET") return "TAKE_PROFIT";
	if (type === "STOP") return "STOP_LOSS_LIMIT";
	if (type === "TAKE_PROFIT") return "TAKE_PROFIT_LIMIT";
	return type;
}

export async function placeOrder(req: PlaceOrderRequest): Promise<Record<string, unknown>> {
	const market = req.market ?? "spot";
	const symbol = normalizeSymbol(req.symbol);
	const type = req.type;
	const needsPrice =
		type === "LIMIT" ||
		type === "LIMIT_MAKER" ||
		type === "STOP" ||
		type === "TAKE_PROFIT" ||
		type === "STOP_LOSS_LIMIT" ||
		type === "TAKE_PROFIT_LIMIT";
	if (needsPrice) {
		if (!req.price) throw new Error(`${type} 주문은 price가 필요합니다.`);
		if (!req.quantity) throw new Error(`${type} 주문은 quantity가 필요합니다.`);
	}
	if (type === "MARKET" && !req.quantity && !req.quoteOrderQty) {
		throw new Error("MARKET 주문은 quantity 또는 quoteOrderQty가 필요합니다.");
	}
	const needsStop =
		type === "STOP_MARKET" ||
		type === "TAKE_PROFIT_MARKET" ||
		type === "STOP" ||
		type === "TAKE_PROFIT" ||
		type === "STOP_LOSS" ||
		type === "STOP_LOSS_LIMIT" ||
		type === "TAKE_PROFIT_LIMIT";
	if (needsStop && !req.stopPrice) {
		throw new Error(`${type} 주문은 stopPrice가 필요합니다.`);
	}
	if (req.test && market !== "spot") {
		throw new Error("test 주문은 현물(spot)만 지원합니다.");
	}

	const apiType = market === "spot" ? mapSpotType(type) : type;
	const tifTypes = new Set(["LIMIT", "STOP", "TAKE_PROFIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"]);
	const query: Record<string, string | number | boolean | undefined> = {
		symbol,
		side: req.side,
		type: apiType,
		quantity: req.quantity,
		quoteOrderQty: market === "spot" ? req.quoteOrderQty : undefined,
		price: req.price,
		stopPrice: req.stopPrice,
		timeInForce: tifTypes.has(type) ? (req.timeInForce ?? "GTC") : undefined,
		newClientOrderId: req.clientOrderId ?? `pi-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
	};
	if (market === "usdm") {
		query.reduceOnly = req.reduceOnly;
		query.positionSide = req.positionSide;
	}

	const path = market === "usdm" ? "/fapi/v1/order" : req.test ? "/api/v3/order/test" : "/api/v3/order";
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
