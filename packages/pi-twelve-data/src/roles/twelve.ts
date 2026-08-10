/**
 * src/roles/twelve.ts — Twelve Data 도메인 역할 (현재가/차트/심볼 검색/환율).
 *
 * Twelve Data 공식 API (https://api.twelvedata.com) typed wrapper.
 * 무료 티어는 8 req/min — 전역 레이트리밋(ratelimit.ts) + 엔드포인트별 TTL
 * 캐시(client.ts)로 실제 호출 수를 줄인다.
 *
 * 모든 응답은 compact (null/undefined/빈 문자열 제거) 정규화 후 반환한다.
 */
import { chartCache, exchangeRateCache, quoteCache, searchCache, twelveRequest } from "../client.ts";
import type { Bar } from "pi-finance-core";

// ── 공통 헬퍼 ─────────────────────────────────────────────────────────────

/** null/undefined/빈 문자열 필드 제거 (compact). */
export function compact<T extends Record<string, unknown>>(obj: T): T {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === null || v === undefined || v === "") continue;
		out[k] = v;
	}
	return out as T;
}

/** Twelve datetime/timestamp → Bar.date ("YYYYMMDD"). */
export function normalizeDate(raw: unknown): string {
	const s = String(raw ?? "").trim();
	if (!s) return "";
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).replaceAll("-", ""); // "YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm:ss"
	if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString().slice(0, 10).replaceAll("-", ""); // unix timestamp
	return s;
}

/** /time_series values (문자열 OHLCV) → Bar[] (날짜 오름차순, stable sort). */
export function normalizeValuesToBars(values: Record<string, unknown>[]): Bar[] {
	const bars: Bar[] = [];
	for (const v of values) {
		const open = Number(v.open);
		const high = Number(v.high);
		const low = Number(v.low);
		const close = Number(v.close);
		const date = normalizeDate(v.datetime);
		if (!date || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
			continue;
		}
		const volume = Number(v.volume);
		bars.push({ date, open, high, low, close, volume: Number.isFinite(volume) ? volume : undefined });
	}
	bars.sort((a, b) => a.date.localeCompare(b.date));
	return bars;
}

// ── 현재가 ────────────────────────────────────────────────────────────────

/** /quote 응답 필드 (선택 필드는 무료 티어에서 빠질 수 있음 — 있는 것만). */
const QUOTE_FIELDS = [
	"symbol", "name", "exchange", "currency", "datetime",
	"open", "high", "low", "close", "volume",
	"previous_close", "change", "percent_change",
	"average_volume", "market_cap", "pe_ratio", "eps",
	"fifty_two_week_high", "fifty_two_week_low",
] as const;

/** 현재가 조회 (GET /quote, 캐시 15s) — compact 정규화. */
export async function getQuote(symbol: string): Promise<Record<string, unknown>> {
	const raw = await twelveRequest<Record<string, unknown>>("/quote", { query: { symbol }, cache: quoteCache });
	const picked: Record<string, unknown> = {};
	for (const f of QUOTE_FIELDS) {
		if (raw[f] !== undefined) picked[f] = raw[f];
	}
	return compact(picked);
}

// ── 차트 ──────────────────────────────────────────────────────────────────

export interface TwelveChartOptions {
	/** 봉 단위: 1min|5min|15min|30min|45min|1h|2h|4h|1day|1week|1month (기본 1day). */
	interval?: string;
	/** 봉 수 (기본 300, 최대 5000). */
	outputsize?: number;
	/** 시작일 YYYY-MM-DD (미지정 시 최근). */
	startDate?: string;
	/** 종료일 YYYY-MM-DD. */
	endDate?: string;
}

export interface TwelveTimeSeries {
	meta: Record<string, unknown>;
	bars: Bar[];
}

/** 차트 조회 (GET /time_series, 캐시 60s) → { meta, bars }. */
export async function getTimeSeries(symbol: string, opts: TwelveChartOptions = {}): Promise<TwelveTimeSeries> {
	const raw = await twelveRequest<Record<string, unknown>>("/time_series", {
		query: {
			symbol,
			interval: opts.interval ?? "1day",
			outputsize: opts.outputsize ?? 300,
			start_date: opts.startDate,
			end_date: opts.endDate,
			order: "asc",
		},
		cache: chartCache,
	});
	const meta = raw.meta && typeof raw.meta === "object" ? (raw.meta as Record<string, unknown>) : {};
	const values = Array.isArray(raw.values) ? (raw.values as Record<string, unknown>[]) : [];
	return { meta, bars: normalizeValuesToBars(values) };
}

// ── 심볼 검색 ─────────────────────────────────────────────────────────────

/** 심볼 검색 (GET /symbol_search, 캐시 10m) → [{symbol,name,exchange,currency,type,country}]. */
export async function searchSymbols(query: string): Promise<Record<string, unknown>[]> {
	const raw = await twelveRequest<{ data?: unknown }>("/symbol_search", { query: { symbol: query }, cache: searchCache });
	const data = Array.isArray(raw.data) ? (raw.data as Record<string, unknown>[]) : [];
	return data.map((r) => compact(r));
}

// ── 환율 ──────────────────────────────────────────────────────────────────

/** 환율 조회 (GET /exchange_rate, 캐시 60s) — rate는 문자열 → Number. */
export async function getExchangeRate(symbol: string): Promise<Record<string, unknown>> {
	const raw = await twelveRequest<Record<string, unknown>>("/exchange_rate", { query: { symbol }, cache: exchangeRateCache });
	const rate = Number(raw.rate);
	return compact({
		symbol: raw.symbol,
		rate: Number.isFinite(rate) ? rate : raw.rate,
		timestamp: raw.timestamp,
		currency: raw.currency,
	});
}
