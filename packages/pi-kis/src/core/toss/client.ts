/**
 * src/core/toss/client.ts — 토스증권 Open API REST 클라이언트.
 *
 * 인증: OAuth 2.0 Client Credentials — POST /oauth2/token
 *   (application/x-www-form-urlencoded: grant_type/client_id/client_secret) →
 *   { access_token, token_type, expires_in } → Bearer 토큰. 토큰은 KIS와 같은
 *   시크릿 스토어(TokenCache.toss)에 캐시, 만료 임박 시 재발급.
 *
 * 계좌/자산/주문 API는 `X-Tossinvest-Account: {accountSeq}` 헤더 필요
 * (GET /api/v1/accounts의 accountSeq — 계좌번호가 아닌 정수 식별 키).
 *
 * 응답: 모든 성공 응답은 { result: <data> } 래퍼 (OAS ApiResponse).
 * 에러: { error: { code, message, data } } → TossError (code/status 부착).
 *
 * 레이트리밋: 그룹별 최소 간격 (src/core/toss/ratelimit.ts) — 모든 호출 적용.
 *  - 429: GET(조회)만 Retry-After 기반 백오프로 최대 2회 재시도.
 *    POST/DELETE(주문·조건주문·취소)는 자동 재시도 금지 (중복 방지).
 *  - 401 expired-token/invalid-token: 캐시 무효화 → 재발급 → 1회 재시도.
 *
 * 정식 스펙: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
 * (로컬: /tmp/toss-oas.json)
 */
import { loadKeys } from "../auth.ts";
import { store } from "../secret.ts";
import { withGroupRateLimit } from "./ratelimit.ts";

export const TOSS_BASE = "https://openapi.tossinvest.com";
const TOKEN_PATH = "/oauth2/token";

export interface TossError extends Error {
	toss: { code: string; status: number };
}

export interface TossToken {
	token: string;
	expiresAt: number;
}

export interface TossRequestOptions {
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
	/** 레이트리밋 그룹 (미지정 시 MARKET_DATA). */
	group?: string;
	/** 계좌/자산/주문 API용 X-Tossinvest-Account 값 (accountSeq). */
	accountSeq?: number;
}

/** { result: ... } 래퍼 해제 — 래퍼가 없으면 body 그대로. */
function unwrap(json: unknown): unknown {
	if (json && typeof json === "object" && "result" in (json as Record<string, unknown>)) {
		return (json as { result: unknown }).result;
	}
	return json;
}

function makeTossError(message: string, code: string, status: number): TossError {
	return Object.assign(new Error(message), { toss: { code, status } });
}

/** 토큰 캐시 제거 (401 재발급 경로에서 사용). */
export async function clearTossToken(): Promise<void> {
	const cache = store.getTokenCache();
	if (cache.toss) {
		delete cache.toss;
		await store.saveTokenCache(cache);
	}
}

async function issueTossTokenOnce(): Promise<TossToken> {
	const { tossClientId, tossClientSecret } = loadKeys();
	if (!tossClientId || !tossClientSecret) {
		throw new Error(
			"Toss API keys missing. Run /kis-key to register toss client_id/client_secret " +
				"(or set TOSS_CLIENT_ID/TOSS_CLIENT_SECRET).",
		);
	}
	let res: Response;
	try {
		res = await fetch(`${TOSS_BASE}${TOKEN_PATH}`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_id: tossClientId,
				client_secret: tossClientSecret,
			}).toString(),
		});
	} catch (e) {
		throw new Error(`토스 OAuth 토큰 발급 실패 (네트워크): ${(e as Error).message}`);
	}
	const text = await res.text();
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`토스 OAuth 토큰 발급 실패 (HTTP ${res.status}): ${text.slice(0, 200)}`);
	}
	const token = json.access_token;
	if (typeof token !== "string" || !token) {
		const desc = json.error_description ?? json.error ?? text.slice(0, 200);
		throw new Error(`토스 OAuth 토큰 발급 실패 (HTTP ${res.status}): ${String(desc).slice(0, 300)}`);
	}
	const expiresIn = Number(json.expires_in ?? 3600);
	const t: TossToken = { token, expiresAt: Date.now() + expiresIn * 1000 - 60_000 };
	const cache = store.getTokenCache();
	cache.toss = t;
	await store.saveTokenCache(cache);
	return t;
}

/** 캐시된 토큰 반환, 없거나 만료 임박 시 발급 (실패 시 캐시 정리 후 1회 재시도). */
export async function getTossToken(): Promise<string> {
	const cached = store.getTokenCache().toss;
	if (cached && cached.token && cached.expiresAt > Date.now() + 60_000) return cached.token;
	try {
		return (await withGroupRateLimit("AUTH", () => issueTossTokenOnce())).token;
	} catch (e) {
		await clearTossToken().catch(() => {});
		return (await withGroupRateLimit("AUTH", () => issueTossTokenOnce())).token;
	}
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
 * 토스 API 호출 (그룹별 레이트리밋 + { result } 언랩 + 에러 envelope).
 *
 * 재시도 정책:
 *  - 401(토큰 만료/무효): 캐시 정리 → 재발급 → 1회 재시도 (모든 메서드).
 *  - 429(레이트 초과): GET만 Retry-After 기반 백오프로 최대 2회 재시도.
 *    POST/DELETE는 즉시 TossError(rate-limit-exceeded) throw.
 */
export async function tossRequest<T>(
	method: string,
	path: string,
	opts: TossRequestOptions = {},
): Promise<T> {
	const group = opts.group ?? "MARKET_DATA";
	const safeRetry = method === "GET";

	const doCall = async (): Promise<T> => {
		const token = await getTossToken();
		const headers: Record<string, string> = { authorization: `Bearer ${token}` };
		if (opts.body !== undefined) headers["content-type"] = "application/json";
		if (opts.accountSeq !== undefined) headers["x-tossinvest-account"] = String(opts.accountSeq);

		let res: Response;
		try {
			res = await fetch(`${TOSS_BASE}${path}${buildQuery(opts.query ?? {})}`, {
				method,
				headers,
				body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
			});
		} catch (e) {
			throw makeTossError(`토스 API 요청 실패 (네트워크): ${(e as Error).message}`, "network-error", 0);
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

		if (res.status === 401) {
			await clearTossToken();
			throw Object.assign(makeTossError("토스 토큰 만료/무효 (401)", "expired-token", 401), { __tossAuth: true });
		}
		if (res.status === 429) {
			const retryAfter = Number(res.headers.get("retry-after") ?? "1");
			throw Object.assign(
				makeTossError("토스 레이트 리밋 초과 (429)", "rate-limit-exceeded", 429),
				{ __tossRateLimit: true, retryAfter: Number.isFinite(retryAfter) ? retryAfter : 1 },
			);
		}
		if (res.status >= 400) {
			const errBody = json as { error?: { code?: string; message?: string; data?: unknown } } | null;
			const code = errBody?.error?.code ?? `http-${res.status}`;
			const message = errBody?.error?.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`;
			throw makeTossError(message, code, res.status);
		}
		return unwrap(json) as T;
	};

	for (let attempt = 0; ; attempt++) {
		try {
			return await withGroupRateLimit(group, doCall);
		} catch (e) {
			const err = e as { __tossAuth?: boolean; __tossRateLimit?: boolean; retryAfter?: number };
			if (err.__tossAuth && attempt === 0) continue; // 토큰 재발급 후 1회 재시도
			if (err.__tossRateLimit && safeRetry && attempt < 2) {
				await sleep(Math.max(250, (err.retryAfter ?? 1) * 1000) * (attempt + 1));
				continue;
			}
			throw e;
		}
	}
}

/** GET /api/v1/accounts → 첫 계좌의 accountSeq (계좌 API 헤더용). */
let defaultAccountSeqCache: number | null = null;

/** 기본 계좌(첫 항목 accountSeq) 조회 — 결과를 캐시 (ACCOUNT 그룹 1/s 스로틀 절약). */
export async function getDefaultAccountSeq(): Promise<number> {
	if (defaultAccountSeqCache !== null) return defaultAccountSeqCache;
	const accounts = await tossRequest<Array<{ accountSeq?: number; accountNo?: string; accountType?: string }>>(
		"GET",
		"/api/v1/accounts",
		{ group: "ACCOUNT" },
	);
	const seq = accounts.find((a) => typeof a.accountSeq === "number")?.accountSeq;
	if (seq === undefined) {
		throw makeTossError("토스 계좌가 없습니다. 앱에서 계좌 개설/연결 후 재시도하세요.", "account-not-found", 404);
	}
	defaultAccountSeqCache = seq;
	return seq;
}

/** 기본 계좌 캐시 초기화 (계좌 변경/테스트용). */
export function resetDefaultAccountSeq(): void {
	defaultAccountSeqCache = null;
}
