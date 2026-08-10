/**
 * src/roles/coingecko.ts — CoinGecko 도메인 역할 (가격/차트/랭킹/상세/검색).
 *
 * CoinGecko 공식 API (https://api.coingecko.com/api/v3) typed wrapper.
 * 인증은 헤더 x-cg-demo-api-key (client.ts), 레이트리밋은 전 호출 공통
 * (DEFAULT 5000ms — 무료 플랜 5~15 req/min), TTL 캐시로 호출 절약:
 *   price 15s / chart 60s / market 2m / coin 10m / search 10m.
 *
 * 코인 식별은 **id** (bitcoin, ethereum, ...) — 심볼은 중복될 수 있어
 * coingecko_search 툴로 id를 확인한 뒤 사용한다.
 *
 * 모든 응답은 compact()로 정규화한다 (null/undefined/빈 문자열 제거).
 * 정식 스펙: https://docs.coingecko.com/reference
 */
import type { Bar } from "pi-finance-core";
import { cached, TtlCache } from "../cache.ts";
import { coingeckoRequest } from "../client.ts";

// ── TTL 캐시 (엔드포인트별) ────────────────────────────────────────────────
const priceCache = new TtlCache(15_000); // 현재가 15s
const chartCache = new TtlCache(60_000); // 차트 60s
const marketCache = new TtlCache(120_000); // 시장 랭킹 2m
const coinCache = new TtlCache(600_000); // 코인 상세 10m
const searchCache = new TtlCache(600_000); // 검색 10m

/** null/undefined/빈 문자열 재귀 제거 — 응답 정규화 공통 규칙. */
export function compact<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((v) => compact(v)) as unknown as T;
	}
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

// ── 1) 현재가 (GET /simple/price) ─────────────────────────────────────────

export interface CoingeckoPriceItem {
	id: string;
	/** 통화별 값 — 요청 vsCurrencies 순: { usd: { price, change24h?, marketCap? }, ... }. */
	prices: Record<string, { price: number; change24h?: number; marketCap?: number }>;
}

/**
 * 현재가 (캐시 15s). ids 최대 10, vsCurrencies 최대 5.
 * 응답 정규화: [{ id, prices: { usd: { price, change24h, marketCap }, ... } }].
 */
export async function getPrices(ids: string[], vsCurrencies: string[]): Promise<CoingeckoPriceItem[]> {
	const key = `price:${ids.join(",")}:${vsCurrencies.join(",")}`;
	return cached(priceCache, key, async () => {
		const raw = await coingeckoRequest<Record<string, Record<string, number>>>("GET", "/simple/price", {
			query: {
				ids: ids.join(","),
				vs_currencies: vsCurrencies.join(","),
				include_24hr_change: true,
				include_market_cap: true,
			},
		});
		const items: CoingeckoPriceItem[] = [];
		for (const [id, values] of Object.entries(raw)) {
			const prices: CoingeckoPriceItem["prices"] = {};
			for (const cur of vsCurrencies) {
				const price = values[cur];
				if (typeof price !== "number" || !Number.isFinite(price)) continue;
				const change24h = values[`${cur}_24h_change`];
				const marketCap = values[`${cur}_market_cap`];
				prices[cur] = {
					price,
					...(typeof change24h === "number" && Number.isFinite(change24h) ? { change24h } : {}),
					...(typeof marketCap === "number" && Number.isFinite(marketCap) ? { marketCap } : {}),
				};
			}
			if (Object.keys(prices).length > 0) items.push({ id, prices });
		}
		if (items.length === 0) {
			throw new Error("해당 코인 id가 응답에 포함되지 않았습니다 — coingecko_search로 정확한 id를 확인하세요.");
		}
		return compact(items);
	});
}

// ── 2) 차트 (GET /coins/{id}/ohlc) ────────────────────────────────────────

export const COINGECKO_DAYS = ["1", "7", "14", "30", "90", "180", "365", "max"] as const;
export type CoingeckoDays = (typeof COINGECKO_DAYS)[number];

export interface CoingeckoChartResult {
	id: string;
	vsCurrency: string;
	days: string;
	bars: Bar[];
	count: number;
}

/**
 * OHLC 행 → Bar[] (날짜 오름차순).
 * 행: [unix_ms, open, high, low, close] — unix_ms → "YYYYMMDD" (UTC).
 * ⚠️ OHLC 데이터라 volume 없음 — Bar.volume은 undefined (분석에 포함되지만
 * 거래량 지표는 제한적).
 */
function normalizeOhlc(rows: number[][]): Bar[] {
	const bars: Bar[] = [];
	for (const row of rows) {
		if (!Array.isArray(row) || row.length < 5) continue;
		const [ts, open, high, low, close] = row;
		if (!Number.isFinite(ts) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
			continue;
		}
		bars.push({
			date: new Date(ts).toISOString().slice(0, 10).replaceAll("-", ""),
			open,
			high,
			low,
			close,
		});
	}
	bars.sort((a, b) => a.date.localeCompare(b.date));
	return bars;
}

/**
 * OHLC 차트 (캐시 60s). days: 1|7|14|30|90|180|365|max (기본 30).
 * 응답: { id, vsCurrency, days, bars, count }.
 */
export async function getOhlc(id: string, vsCurrency = "usd", days: string = "30"): Promise<CoingeckoChartResult> {
	const key = `chart:${id}:${vsCurrency}:${days}`;
	return cached(chartCache, key, async () => {
		const rows = await coingeckoRequest<number[][]>("GET", `/coins/${encodeURIComponent(id)}/ohlc`, {
			query: { vs_currency: vsCurrency, days },
		});
		const bars = normalizeOhlc(rows);
		return { id, vsCurrency, days, bars, count: bars.length };
	});
}

// ── 3) 시장 랭킹 (GET /coins/markets) ─────────────────────────────────────

export const COINGECKO_MARKET_ORDERS = ["market_cap_desc", "volume_desc", "gecko_desc", "gecko_asc"] as const;
export type CoingeckoMarketOrder = (typeof COINGECKO_MARKET_ORDERS)[number];

export interface CoingeckoMarketItem {
	id: string;
	symbol: string;
	name: string;
	current_price: number;
	market_cap: number;
	market_cap_rank: number;
	total_volume: number;
	price_change_percentage_24h: number;
	circulating_supply: number;
	max_supply: number | null;
}

/**
 * 시장 랭킹 (캐시 2m). order: market_cap_desc(기본)/volume_desc/gecko_desc/gecko_asc,
 * perPage 기본 20 최대 50 (usd 기준, page 1).
 * 응답 정규화: [id, symbol, name, current_price, market_cap, market_cap_rank,
 * total_volume, price_change_percentage_24h, circulating_supply, max_supply] pick.
 */
export async function getMarkets(order: string = "market_cap_desc", perPage = 20): Promise<CoingeckoMarketItem[]> {
	const key = `market:${order}:${perPage}`;
	return cached(marketCache, key, async () => {
		const rows = await coingeckoRequest<Array<Record<string, unknown>>>("GET", "/coins/markets", {
			query: {
				vs_currency: "usd",
				order,
				per_page: perPage,
				page: 1,
				sparkline: false,
			},
		});
		const items: CoingeckoMarketItem[] = rows.map((r) => ({
			id: r.id as string,
			symbol: r.symbol as string,
			name: r.name as string,
			current_price: r.current_price as number,
			market_cap: r.market_cap as number,
			market_cap_rank: r.market_cap_rank as number,
			total_volume: r.total_volume as number,
			price_change_percentage_24h: r.price_change_percentage_24h as number,
			circulating_supply: r.circulating_supply as number,
			max_supply: (r.max_supply as number | null) ?? null,
		}));
		return compact(items);
	});
}

// ── 4) 코인 상세 (GET /coins/{id}) ────────────────────────────────────────

export interface CoingeckoCoinDetail {
	id: string;
	symbol: string;
	name: string;
	market_cap_rank?: number;
	current_price?: number;
	market_cap?: number;
	total_volume?: number;
	high_24h?: number;
	low_24h?: number;
	price_change_percentage_24h?: number;
	price_change_percentage_7d?: number;
	price_change_percentage_30d?: number;
	price_change_percentage_1y?: number;
	ath?: number;
	atl?: number;
	circulating_supply?: number;
	max_supply?: number;
}

/** market_data에서 { <통화>: 값 } 형태 필드의 usd 값만 pick — 숫자가 아니면 undefined (compact로 제거). */
function usdOf(md: Record<string, unknown> | undefined, key: string): number | undefined {
	const v = md?.[key] as Record<string, unknown> | undefined;
	const n = v?.usd;
	return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** market_data에서 단일 숫자 필드 pick — 숫자가 아니면 undefined (compact로 제거). */
function numOf(md: Record<string, unknown>, key: string): number | undefined {
	const v = md[key];
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * 코인 상세 (캐시 10m). market_data에서 usd 값만 pick:
 *   current_price/market_cap/total_volume/high_24h/low_24h/ath/atl(usd),
 *   price_change_percentage_24h/7d/30d/1y, circulating_supply, max_supply
 *   + id/symbol/name/market_cap_rank.
 */
export async function getCoin(id: string): Promise<CoingeckoCoinDetail> {
	const key = `coin:${id}`;
	return cached(coinCache, key, async () => {
		const raw = await coingeckoRequest<Record<string, unknown>>("GET", `/coins/${encodeURIComponent(id)}`, {
			query: {
				localization: false,
				tickers: false,
				community_data: false,
				developer_data: false,
				market_data: true,
			},
		});
		const md = (raw.market_data ?? {}) as Record<string, unknown>;
		const detail: CoingeckoCoinDetail = {
			id: raw.id as string,
			symbol: raw.symbol as string,
			name: raw.name as string,
			market_cap_rank: typeof raw.market_cap_rank === "number" ? raw.market_cap_rank : undefined,
			current_price: usdOf(md, "current_price"),
			market_cap: usdOf(md, "market_cap"),
			total_volume: usdOf(md, "total_volume"),
			high_24h: usdOf(md, "high_24h"),
			low_24h: usdOf(md, "low_24h"),
			ath: usdOf(md, "ath"),
			atl: usdOf(md, "atl"),
			price_change_percentage_24h: numOf(md, "price_change_percentage_24h"),
			price_change_percentage_7d: numOf(md, "price_change_percentage_7d"),
			price_change_percentage_30d: numOf(md, "price_change_percentage_30d"),
			price_change_percentage_1y: numOf(md, "price_change_percentage_1y"),
			circulating_supply: numOf(md, "circulating_supply"),
			max_supply: numOf(md, "max_supply"),
		};
		return compact(detail);
	});
}

// ── 5) 검색 (GET /search) ─────────────────────────────────────────────────

export interface CoingeckoSearchResult {
	id: string;
	name: string;
	symbol: string;
	market_cap_rank: number | null;
}

/**
 * 코인 검색 (캐시 10m) — 정확한 **id** 확인용 (심볼은 중복될 수 있음).
 * 응답 정규화: [{ id, name, symbol, market_cap_rank }] 최대 10개.
 */
export async function searchCoins(query: string): Promise<CoingeckoSearchResult[]> {
	const key = `search:${query}`;
	return cached(searchCache, key, async () => {
		const raw = await coingeckoRequest<{ coins?: Array<Record<string, unknown>> }>("GET", "/search", {
			query: { query },
		});
		const coins: CoingeckoSearchResult[] = (raw.coins ?? []).slice(0, 10).map((c) => ({
			id: c.id as string,
			name: c.name as string,
			symbol: c.symbol as string,
			market_cap_rank: (typeof c.market_cap_rank === "number" ? c.market_cap_rank : null) as number | null,
		}));
		return compact(coins);
	});
}
