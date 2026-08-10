/**
 * src/client.ts — CoinGecko 공식 API REST 클라이언트 (https://api.coingecko.com/api/v3).
 *
 * 인증: 헤더 `x-cg-demo-api-key: KEY` — 무료 Demo 키
 *   (coingecko.com/en/developers/dashboard 무료 가입 → demo key).
 *   키가 없으면 공개 API 사용 (5~15 req/min).
 *
 * 에러 형태: {"status": {"error_code": 429, "error_message": "..."}} —
 *   429(레이트 한도), 401(키 오류), 404(코인 id 없음).
 *
 * 레이트리밋: 전 호출 공통 그룹(DEFAULT) 최소 간격 5000ms (src/ratelimit.ts).
 *  - 429(레이트 초과): GET만 백오프로 최대 2회 재시도 (Retry-After 없으면 6s).
 *
 * 정식 스펙: https://docs.coingecko.com/reference
 */
import { getKeys } from "./secret.ts";
import { withGroupRateLimit } from "./ratelimit.ts";

export const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

export interface CoingeckoError extends Error {
	coingecko: { errorCode: string | number; status: number };
}

export interface CoingeckoRequestOptions {
	query?: Record<string, string | number | boolean | undefined>;
}

function makeCoingeckoError(message: string, errorCode: string | number, status: number): CoingeckoError {
	return Object.assign(new Error(message), { coingecko: { errorCode, status } });
}

function buildQuery(query: Record<string, string | number | boolean | undefined>): string {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v === undefined || v === null) continue;
		params.set(k, String(v));
	}
	const s = params.toString();
	return s ? `?${s}` : "";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * CoinGecko API 호출 (키 헤더 + 레이트리밋 + 에러 envelope).
 *
 * 재시도 정책:
 *  - 429(레이트 초과): Retry-After/6s 기반 백오프로 최대 2회 재시도 (GET만).
 *  - 401/404 등 4xx/5xx: envelope의 error_message를 그대로 throw.
 */
export async function coingeckoRequest<T>(
	method: string,
	path: string,
	opts: CoingeckoRequestOptions = {},
): Promise<T> {
	const doCall = async (): Promise<T> => {
		const headers: Record<string, string> = {};
		const { apiKey } = getKeys();
		if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

		let res: Response;
		try {
			res = await fetch(`${COINGECKO_BASE}${path}${buildQuery(opts.query ?? {})}`, { method, headers });
		} catch (e) {
			throw makeCoingeckoError(`CoinGecko API 요청 실패 (네트워크): ${(e as Error).message}`, "network-error", 0);
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

		if (res.status === 429) {
			const retryAfter = Number(res.headers.get("retry-after") ?? "6");
			throw Object.assign(
				makeCoingeckoError("CoinGecko 레이트 리밋 초과 (429) — 잠시 후 재시도하세요.", 429, 429),
				{ __cgRateLimit: true, retryAfter: Number.isFinite(retryAfter) ? retryAfter : 6 },
			);
		}
		if (res.status >= 400) {
			const errBody = json as { status?: { error_code?: number; error_message?: string } } | null;
			const errorCode = errBody?.status?.error_code ?? res.status;
			const message = errBody?.status?.error_message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`;
			throw makeCoingeckoError(message, errorCode, res.status);
		}
		if (json === null) {
			throw makeCoingeckoError(`CoinGecko 응답 없음 (HTTP ${res.status})`, `http-${res.status}`, res.status);
		}
		return json as T;
	};

	for (let attempt = 0; ; attempt++) {
		try {
			return await withGroupRateLimit("DEFAULT", doCall);
		} catch (e) {
			const err = e as { __cgRateLimit?: boolean; retryAfter?: number };
			if (err.__cgRateLimit && attempt < 2) {
				await sleep(Math.max(1000, (err.retryAfter ?? 6) * 1000) * (attempt + 1));
				continue;
			}
			throw e;
		}
	}
}
