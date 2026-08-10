/**
 * src/client.ts — 네이버 검색 API REST 클라이언트 (https://openapi.naver.com/v1).
 *
 * 인증: 헤더 `X-Naver-Client-Id` + `X-Naver-Client-Secret` — developers.naver.com
 *   애플리케이션 등록 시 발급, **검색 API 활성화** 필수 (없으면 403).
 *
 * 에러 형태: {"errorMessage": "...", "errorCode": "SE01"} —
 *   SE01~SE06(파라미터), 401(인증 실패), 403(검색 API 권한 없음),
 *   429(일일 한도 초과 — 검색 API는 25,000회/일), SE99/5xx(시스템 에러).
 *
 * 레이트리밋: 전 호출 공통 그룹(DEFAULT) 최소 간격 300ms (src/ratelimit.ts) +
 * 일일 호출 카운터 (recordCall).
 *
 * 정식 스펙: https://developers.naver.com/docs/serviceapi/search/news/news.md
 */
import { getKeys } from "./secret.ts";
import { recordCall, withGroupRateLimit } from "./ratelimit.ts";

export const NAVER_NEWS_BASE = "https://openapi.naver.com/v1";

export interface NaverNewsError extends Error {
	naver: { errorCode: string; status: number };
}

export interface NaverNewsRequestOptions {
	query?: Record<string, string | number | boolean | undefined>;
}

function makeNaverNewsError(message: string, errorCode: string, status: number): NaverNewsError {
	return Object.assign(new Error(message), { naver: { errorCode, status } });
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

/** HTTP 상태 → 사용자 친화 오류 메시지 (네이버 검색 API 공통 오류 매핑). */
function errorMessageFor(status: number, errorCode: string, fallback: string): string {
	if (status === 401) {
		return "네이버 인증 실패 (401) — Client ID/Secret이 올바른지 확인하세요. (/naver-news-key 재등록)";
	}
	if (status === 403) {
		return "검색 API 권한 없음 (403) — 네이버 개발자센터 → 내 애플리케이션 → API 설정에서 '검색'을 활성화하세요.";
	}
	if (status === 429) {
		return "네이버 검색 API 일일 한도 초과 (429) — 하루 25,000회 한도입니다. 내일 재시도하세요.";
	}
	if (status >= 500) {
		return `네이버 서버 오류 (HTTP ${status}) — 잠시 후 재시도하세요. (${errorCode})`;
	}
	return fallback;
}

/**
 * 네이버 검색 API 호출 (Client ID/Secret 헤더 + 레이트리밋 + 에러 envelope).
 *
 * 오류 처리:
 *  - 400대: body의 errorMessage/errorCode를 그대로 + 401/403/429는 친화 메시지로 매핑.
 *  - 키 미등록: 스토어·env 모두 없으면 안내 오류.
 */
export async function naverRequest<T>(
	method: string,
	path: string,
	opts: NaverNewsRequestOptions = {},
): Promise<T> {
	return withGroupRateLimit("DEFAULT", async () => {
		const { clientId, clientSecret } = getKeys();
		if (!clientId || !clientSecret) {
			throw makeNaverNewsError(
				"네이버 API 키 미등록 — /naver-news-key 로 Client ID/Secret을 등록하거나 NAVER_CLIENT_ID/NAVER_CLIENT_SECRET env를 설정하세요. (developers.naver.com에서 앱 등록 후 '검색' API 활성화 필요)",
				"NO_KEY",
				0,
			);
		}

		recordCall();
		const headers: Record<string, string> = {
			"X-Naver-Client-Id": clientId,
			"X-Naver-Client-Secret": clientSecret,
		};

		let res: Response;
		try {
			res = await fetch(`${NAVER_NEWS_BASE}${path}${buildQuery(opts.query ?? {})}`, { method, headers });
		} catch (e) {
			throw makeNaverNewsError(
				`네이버 API 요청 실패 (네트워크): ${(e as Error).message}`,
				"network-error",
				0,
			);
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

		if (res.status >= 400) {
			const errBody = json as { errorMessage?: string; errorCode?: string } | null;
			const errorCode = errBody?.errorCode ?? `http-${res.status}`;
			const fallback = errBody?.errorMessage ?? `HTTP ${res.status}: ${text.slice(0, 200)}`;
			throw makeNaverNewsError(errorMessageFor(res.status, errorCode, fallback), errorCode, res.status);
		}
		if (json === null) {
			throw makeNaverNewsError(`네이버 응답 없음 (HTTP ${res.status})`, `http-${res.status}`, res.status);
		}
		return json as T;
	});
}
