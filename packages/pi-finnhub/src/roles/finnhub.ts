/**
 * src/roles/finnhub.ts — Finnhub 도메인 역할 (현재가/차트/뉴스/펀더멘털).
 *
 * Finnhub 공식 API (https://finnhub.io/docs/api) typed wrapper —
 * 인증은 쿼리 `token` (client.ts), 레이트리밋은 무료 60 req/min
 * (ratelimit.ts 1100ms), 엔드포인트별 TTL 캐시 (client.ts).
 *
 * 모든 응답은 정규화(compact 대상 — null/undefined/빈 문자열 제거 후
 * JSON 문자열로 반환)되며, 차트는 공용 Bar[] (indicators.ts 호환)로 변환한다.
 */
import type { Bar } from "pi-finance-core";
import { chartCache, finnhubRequest, fundamentalsCache, newsCache, quoteCache } from "../client.ts";

// ── 공통 타입 ──────────────────────────────────────────────────────────────

export const FINNHUB_RESOLUTIONS = ["1", "5", "15", "30", "60", "D", "W", "M"] as const;
export type FinnhubResolution = (typeof FINNHUB_RESOLUTIONS)[number];

/** /quote 응답 → 정규화 (c→price, d→change, dp→changePercent, h/l/o/pc, t→ISO). */
export interface FinnhubQuote {
	symbol: string;
	price: number;
	change?: number;
	changePercent?: number;
	high?: number;
	low?: number;
	open?: number;
	previousClose?: number;
	timestamp?: string; // ISO 8601
}

export interface FinnhubCandleOptions {
	resolution?: FinnhubResolution;
	/** 시작일 YYYY-MM-DD (또는 unix 초). 미지정 시 기본: 일봉 이상 1년 전, 분봉 5일 전. */
	from?: string;
	/** 종료일 YYYY-MM-DD (또는 unix 초). 미지정 시 오늘. */
	to?: string;
}

export interface FinnhubCandleMeta {
	symbol: string;
	resolution: string;
	count: number;
}

/** /company-news 응답 → 정규화 (최대 20건, summary 200자 내외). */
export interface FinnhubNewsItem {
	headline: string;
	url: string;
	source?: string;
	category?: string;
	datetime?: string; // ISO 8601
	summary?: string;
}

export interface FinnhubFundamentals {
	symbol: string;
	profile?: Record<string, unknown>;
	metrics?: Record<string, unknown>;
	recommendation?: Record<string, unknown>;
}

// ── 헬퍼 ───────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" 또는 unix 초 문자열 → unix 초. */
function toUnixSec(v: string): number {
	const trimmed = v.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		const ms = Date.parse(trimmed); // 날짜만 → UTC 자정
		if (Number.isNaN(ms)) throw new Error(`날짜 형식 오류: ${v} — YYYY-MM-DD 형식이어야 합니다.`);
		return Math.floor(ms / 1000);
	}
	if (/^\d+$/.test(trimmed)) return Number(trimmed); // 이미 unix 초
	throw new Error(`날짜 형식 오류: ${v} — YYYY-MM-DD 또는 unix 초여야 합니다.`);
}

/** 오늘 기준 offsetDays 전 날짜 (YYYY-MM-DD, UTC). */
function dateStr(offsetDays: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - offsetDays);
	return d.toISOString().slice(0, 10);
}

/** unix 초 → "YYYYMMDD" (Bar.date). */
function unixToBarDate(ts: number): string {
	return new Date(ts * 1000).toISOString().slice(0, 10).replaceAll("-", "");
}

/** summary 200자 내외 클리핑 — 빈 값이면 undefined. */
function clipSummary(s: unknown, max = 200): string | undefined {
	if (s === undefined || s === null) return undefined;
	const t = String(s).trim();
	if (!t) return undefined;
	return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 객체에서 지정 키만 pick (없거나 null이면 스킵). */
function pick(obj: Record<string, unknown> | null | undefined, keys: string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (!obj || typeof obj !== "object") return out;
	for (const k of keys) {
		const v = obj[k];
		if (v !== undefined && v !== null) out[k] = v;
	}
	return out;
}

const PROFILE_KEYS = [
	"country",
	"currency",
	"exchange",
	"ipo",
	"marketCapitalization",
	"name",
	"shareOutstanding",
	"ticker",
	"weburl",
	"finnhubIndustry",
	"logo",
];

const METRIC_KEYS = [
	"beta",
	"marketCapitalization",
	"peBasicExclExtraTTM",
	"peTTM",
	"forwardPE",
	"priceToBookTTM",
	"dividendYieldIndicatedAnnual",
	"dividendYieldTTM",
	"epsTTM",
	"revenueTTM",
	"grossMarginTTM",
	"operatingMarginTTM",
	"profitMarginTTM",
	"roeTTM",
	"roaTTM",
	"freeCashFlowTTM",
];

// ── 현재가 (quote 15s 캐시) ───────────────────────────────────────────────

/** GET /quote — 심볼당 1회 호출. c(현재가)가 없으면 데이터 없음 에러. */
export async function getQuote(symbol: string): Promise<FinnhubQuote> {
	const raw = await finnhubRequest<Record<string, unknown>>("/quote", {
		query: { symbol },
		cache: quoteCache,
	});
	const price = typeof raw.c === "number" ? raw.c : null;
	if (price === null) {
		throw new Error(`현재가 데이터 없음 — "${symbol}" 심볼을 확인하세요 (무료 티어는 미국 종목만, 대문자 티커).`);
	}
	return {
		symbol,
		price,
		change: typeof raw.d === "number" ? raw.d : undefined,
		changePercent: typeof raw.dp === "number" ? raw.dp : undefined,
		high: typeof raw.h === "number" ? raw.h : undefined,
		low: typeof raw.l === "number" ? raw.l : undefined,
		open: typeof raw.o === "number" ? raw.o : undefined,
		previousClose: typeof raw.pc === "number" ? raw.pc : undefined,
		timestamp: typeof raw.t === "number" ? new Date(raw.t * 1000).toISOString() : undefined,
	};
}

// ── 차트 (chart 60s 캐시) ─────────────────────────────────────────────────

interface FinnhubCandleResponse {
	s?: string;
	t?: number[];
	o?: number[];
	h?: number[];
	l?: number[];
	c?: number[];
	v?: number[];
}

/**
 * GET /stock/candle — resolution: 1|5|15|30|60(분봉)/D(기본)/W/M.
 * 기본 기간: 분봉 = 최근 5일, 일봉 이상 = 최근 1년.
 * 응답 → 공용 Bar[] (날짜 오름차순, OHLC 유효 행만), meta는 캐시 대상.
 */
export async function getCandles(
	symbol: string,
	opts: FinnhubCandleOptions = {},
): Promise<{ bars: Bar[]; meta: FinnhubCandleMeta }> {
	const resolution = opts.resolution ?? "D";
	const intraday = ["1", "5", "15", "30", "60"].includes(resolution);
	const now = Math.floor(Date.now() / 1000);
	const from = opts.from !== undefined ? toUnixSec(opts.from) : now - (intraday ? 5 * 24 * 3600 : 365 * 24 * 3600);
	const to = opts.to !== undefined ? toUnixSec(opts.to) : now;
	if (from >= to) {
		throw new Error(`조회 기간 오류 — from(${opts.from ?? "기본"})이 to(${opts.to ?? "오늘"})보다 이후입니다.`);
	}

	const raw = await finnhubRequest<FinnhubCandleResponse>("/stock/candle", {
		query: { symbol, resolution, from, to },
		cache: chartCache,
	});
	if (raw.s === "no_data") {
		throw new Error(`차트 데이터 없음 — 조회 기간(${opts.from ?? "기본"}~${opts.to ?? "오늘"})에 거래일이 없거나 미지원 심볼입니다.`);
	}
	if (raw.s !== "ok") {
		throw new Error(`차트 응답 오류 — status=${raw.s}`);
	}

	const bars: Bar[] = [];
	const ts = Array.isArray(raw.t) ? raw.t : [];
	for (let i = 0; i < ts.length; i++) {
		const t = ts[i];
		if (typeof t !== "number") continue;
		const open = Number(raw.o?.[i]);
		const high = Number(raw.h?.[i]);
		const low = Number(raw.l?.[i]);
		const close = Number(raw.c?.[i]);
		if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
			continue;
		}
		const volume = Number(raw.v?.[i]);
		bars.push({
			date: unixToBarDate(t),
			open,
			high,
			low,
			close,
			volume: Number.isFinite(volume) ? volume : undefined,
		});
	}
	bars.sort((a, b) => a.date.localeCompare(b.date));
	return { bars, meta: { symbol, resolution, count: bars.length } };
}

// ── 뉴스 (news 5m 캐시) ───────────────────────────────────────────────────

/**
 * GET /company-news — 기본 from=오늘-7일, to=오늘.
 * 정규화: headline/source/category/datetime(ISO)/url/summary(200자), 최대 20건.
 */
export async function getNews(symbol: string, opts: { from?: string; to?: string } = {}): Promise<FinnhubNewsItem[]> {
	const from = opts.from ?? dateStr(7);
	const to = opts.to ?? dateStr(0);
	const rows = await finnhubRequest<Record<string, unknown>[]>("/company-news", {
		query: { symbol, from, to },
		cache: newsCache,
	});
	const items: FinnhubNewsItem[] = [];
	for (const r of Array.isArray(rows) ? rows.slice(0, 20) : []) {
		const headline = typeof r.headline === "string" ? r.headline.trim() : "";
		const url = typeof r.url === "string" ? r.url.trim() : "";
		if (!headline && !url) continue;
		items.push({
			headline,
			url,
			source: typeof r.source === "string" ? r.source : undefined,
			category: typeof r.category === "string" ? r.category : undefined,
			datetime: typeof r.datetime === "number" ? new Date(r.datetime * 1000).toISOString() : undefined,
			summary: clipSummary(r.summary, 200),
		});
	}
	return items;
}

// ── 펀더멘털 종합 (fundamentals 30m 캐시, 3회 병렬) ───────────────────────

/**
 * 프로필 + 밸류에이션 메트릭 + 애널리스트 컨센서스 (Promise.all 병렬 3회).
 * - /company-profile2 → profile (country~finnhubIndustry, 있으면 logo)
 * - /stock/metrics?metric=all → metric에서 METRIC_KEYS만 pick (series 제외)
 * - /stock/recommendation → 최신 1건(첫 항목)만
 */
export async function getFundamentals(symbol: string): Promise<FinnhubFundamentals> {
	const [profile, metrics, rec] = await Promise.all([
		finnhubRequest<Record<string, unknown>>("/company-profile2", {
			query: { symbol },
			cache: fundamentalsCache,
		}),
		finnhubRequest<Record<string, unknown>>("/stock/metrics", {
			query: { symbol, metric: "all" },
			cache: fundamentalsCache,
		}),
		finnhubRequest<Record<string, unknown>[]>("/stock/recommendation", {
			query: { symbol },
			cache: fundamentalsCache,
		}),
	]);

	const metric = pick(metrics?.metric as Record<string, unknown> | undefined, METRIC_KEYS);
	const profileOut = pick(profile, PROFILE_KEYS);
	const recRow = Array.isArray(rec) && rec.length > 0 ? rec[0] : undefined;
	const recommendation = pick(recRow, ["symbol", "period", "strongBuy", "buy", "hold", "sell", "strongSell"]);

	return {
		symbol,
		profile: Object.keys(profileOut).length > 0 ? profileOut : undefined,
		metrics: Object.keys(metric).length > 0 ? metric : undefined,
		recommendation: Object.keys(recommendation).length > 0 ? recommendation : undefined,
	};
}
