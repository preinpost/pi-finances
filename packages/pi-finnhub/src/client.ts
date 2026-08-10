/**
 * src/client.ts — Finnhub 공식 API REST 클라이언트.
 *
 * 인증: API token을 쿼리 파라미터 `token`으로 전달 (OAuth 없음, 헤더 없음).
 *   https://finnhub.io/api/v1/...?token=KEY
 *
 * 레이트리밋: src/ratelimit.ts — 무료 60 req/min → 기본 간격 1100ms.
 * 캐시: TTL 메모리 캐시 (src/cache.ts) — quote 15s / chart 60s /
 *   news 5m / fundamentals 30m. 캐시 키 = path + query (token 제외 —
 *   시크릿이 캐시 키에 남지 않게).
 *
 * 에러: HTTP 401(키 오류)/403(무료 티어 미지원 종목 등)/429(레이트 초과),
 *   본문 { "error": "..." } → FinnhubError (status 부착, 한글 안내).
 */
import { getKeys } from "./secret.ts";
import { withGroupRateLimit } from "./ratelimit.ts";
import { cached, TtlCache } from "./cache.ts";

export const FINNHUB_BASE = "https://finnhub.io/api/v1";

export interface FinnhubError extends Error {
	finnhub: { status: number };
}

function makeFinnhubError(message: string, status: number): FinnhubError {
	return Object.assign(new Error(message), { finnhub: { status } });
}

/** 엔드포인트별 TTL 캐시 — API 호출 절약 (60 req/min 대응). */
export const quoteCache = new TtlCache(15_000); // 15s
export const chartCache = new TtlCache(60_000); // 60s
export const newsCache = new TtlCache(5 * 60_000); // 5m
export const fundamentalsCache = new TtlCache(30 * 60_000); // 30m

export interface FinnhubRequestOptions {
	query?: Record<string, string | number | undefined>;
	/** 지정 시 이 캐시로 TTL 재사용 (키 = path + query, token 제외). */
	cache?: TtlCache;
}

function buildQuery(query: Record<string, string | number | undefined>): string {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v === undefined || v === null) continue;
		params.set(k, String(v));
	}
	const s = params.toString();
	return s ? `?${s}` : "";
}

/** HTTP 에러 상태 → 한글 안내 FinnhubError. */
function finnhubHttpError(status: number, json: unknown): FinnhubError {
	const errMsg =
		json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
			? (json as { error: string }).error
			: undefined;
	const detail = errMsg ? ` — ${errMsg}` : "";
	if (status === 401) {
		return makeFinnhubError(`Finnhub API 키 오류 (401) — /finnhub-key로 키를 다시 등록하세요${detail}`, status);
	}
	if (status === 403) {
		return makeFinnhubError(`Finnhub 접근 거부 (403) — 무료 티어는 미국 종목만 지원합니다${detail}`, status);
	}
	if (status === 429) {
		return makeFinnhubError(`Finnhub 레이트 리밋 초과 (429) — 무료 60 req/min, 잠시 후 재시도하세요${detail}`, status);
	}
	return makeFinnhubError(`Finnhub API 오류 (HTTP ${status})${detail}`, status);
}

/**
 * Finnhub API 호출 (레이트리밋 + 선택적 TTL 캐시 + 에러 envelope).
 * 캐시 히트 시 네트워크/레이트리밋을 전혀 소모하지 않는다.
 */
export async function finnhubRequest<T>(path: string, opts: FinnhubRequestOptions = {}): Promise<T> {
	const { finnhubApiKey } = getKeys();
	if (!finnhubApiKey) {
		throw new Error("Finnhub API key missing. Run /finnhub-key to register (or set FINNHUB_API_KEY).");
	}
	const query = { token: finnhubApiKey, ...opts.query };
	const url = `${FINNHUB_BASE}${path}${buildQuery(query)}`;

	const doCall = (): Promise<T> =>
		withGroupRateLimit("API", async () => {
			let res: Response;
			try {
				res = await fetch(url);
			} catch (e) {
				throw makeFinnhubError(`Finnhub API 요청 실패 (네트워크): ${(e as Error).message}`, 0);
			}
			const text = await res.text();
			let json: unknown = null;
			if (text) {
				try {
					json = JSON.parse(text);
				} catch {
					/* 비-JSON 응답 */
				}
			}
			if (!res.ok) throw finnhubHttpError(res.status, json);
			return json as T;
		});

	if (opts.cache) {
		return cached(opts.cache, `${path}${buildQuery(opts.query ?? {})}`, doCall);
	}
	return doCall();
}
