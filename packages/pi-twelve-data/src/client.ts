/**
 * src/client.ts — Twelve Data REST 클라이언트 (직접 fetch, 의존성 0).
 *
 * 인증: apikey 쿼리 파라미터 (https://api.twelvedata.com). 키는 시크릿 스토어
 * 우선, 셸 env TWELVE_API_KEY 폴백 (src/secret.ts).
 *
 * 레이트리밋: 전역 8 req/min (무료) — src/ratelimit.ts 단일 그룹(DEFAULT)으로 직렬화.
 * 캐시: 엔드포인트별 TTL (quote 15s / chart 60s / search 10m / exchange_rate 60s),
 *   TWELVE_DISABLE_CACHE=1 이면 캐시 off (src/cache.ts).
 *
 * 에러: Twelve Data 응답 { "code": <http>, "message": "...", "status": "error" } →
 *   명확한 한국어 메시지의 Error로 변환 (401=키 오류, 404=심볼 없음, 429=한도).
 */
import { TtlCache, cached } from "./cache.ts";
import { withRateLimit } from "./ratelimit.ts";
import { getKeys } from "./secret.ts";

export const TWELVE_BASE = "https://api.twelvedata.com";

// ── 엔드포인트별 TTL 캐시 ─────────────────────────────────────────────────

export const quoteCache = new TtlCache(15_000);
export const chartCache = new TtlCache(60_000);
export const searchCache = new TtlCache(600_000);
export const exchangeRateCache = new TtlCache(60_000);

export interface TwelveRequestOptions {
	query?: Record<string, string | number | undefined>;
	/** 응답 캐시 (지정 시 키 = 경로+쿼리). 미지정 시 캐시 없음. */
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

async function fetchJson<T>(path: string, query: Record<string, string | number | undefined>): Promise<T> {
	const { apiKey } = getKeys();
	if (!apiKey) {
		throw new Error("Twelve Data API 키가 없습니다. /twelve-key로 등록하거나 TWELVE_API_KEY 환경변수를 설정하세요.");
	}
	let res: Response;
	try {
		res = await fetch(`${TWELVE_BASE}${path}${buildQuery({ ...query, apikey: apiKey })}`);
	} catch (e) {
		throw new Error(`Twelve Data API 요청 실패 (네트워크): ${(e as Error).message}`);
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
	const body = (json ?? {}) as { code?: number; message?: string; status?: string };
	if (res.status >= 400 || body.status === "error") {
		const code = body.code ?? res.status;
		const hint =
			code === 401
				? " — API 키가 잘못되었습니다 (/twelve-key로 재등록)"
				: code === 404
					? " — 심볼을 찾을 수 없습니다"
					: code === 429
						? " — 요청 한도를 초과했습니다 (잠시 후 재시도)"
						: "";
		throw new Error(`Twelve Data 오류 (HTTP ${code}): ${body.message ?? text.slice(0, 200)}${hint}`);
	}
	return json as T;
}

/** Twelve Data API 호출 — 레이트리밋(DEFAULT 그룹) + 선택 캐시 적용. */
export function twelveRequest<T>(path: string, opts: TwelveRequestOptions = {}): Promise<T> {
	const query = opts.query ?? {};
	const fn = () => withRateLimit("DEFAULT", () => fetchJson<T>(path, query));
	if (!opts.cache) return fn();
	const key = `${path}${buildQuery(query)}`;
	return cached(opts.cache, key, fn);
}
