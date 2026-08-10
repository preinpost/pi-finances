/**
 * src/client.ts — 네이버 뉴스 검색 API REST 클라이언트 (모드 듀얼 지원).
 *
 * 모드 (2026-07-31 개발자센터 신규 신청 종료 이후):
 *   - hub (기본): NAVER API HUB — https://naverapihub.apigw.ntruss.com/search/v1/news
 *     인증: X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY (NCP 콘솔 발급).
 *     한도: 월 775,000건 통합, 키당 50 RPS (현재 한시 무료, 향후 유료 예정).
 *   - legacy: 네이버 개발자센터 — https://openapi.naver.com/v1/search/news.json
 *     인증: X-Naver-Client-Id / X-Naver-Client-Secret.
 *     2026-07-31 이전 발급 키만 2027-06-30까지 사용 가능.
 *
 * 에러 형태 (두 방식 모두 대응):
 *   - 평면형: {"errorCode": "SE02", "errorMessage": "..."} (검색 파라미터 오류)
 *   - 중첩형: {"error": {"errorCode": "...", "message": "...", "details": "..."}} (게이트웨이/인증/경로 오류)
 *
 * 레이트리밋: 전 호출 공통 그룹(DEFAULT) 최소 간격 300ms (src/ratelimit.ts) +
 * 호출 카운터 (recordCall).
 *
 * 정식 스펙:
 *   HUB:   https://api.ncloud-docs.com/docs/naver-api-hub-search-news
 *   LEGACY: https://developers.naver.com/docs/serviceapi/search/news/news.md
 */
import { getKeys, type NaverNewsMode } from "./secret.ts";
import { recordCall, withGroupRateLimit } from "./ratelimit.ts";

/** NAVER API HUB (신규 기본) — NCP 콘솔 키. */
const HUB_CONFIG = {
	base: "https://naverapihub.apigw.ntruss.com",
	path: "/search/v1/news",
	headers: (clientId: string, clientSecret: string): Record<string, string> => ({
		"X-NCP-APIGW-API-KEY-ID": clientId,
		"X-NCP-APIGW-API-KEY": clientSecret,
	}),
	/** HUB는 format=json 명시 필요. */
	extraQuery: { format: "json" },
};

/** 레거시 개발자센터 (2026-07-31 이전 키만 2027-06-30까지 유효). */
const LEGACY_CONFIG = {
	base: "https://openapi.naver.com",
	path: "/v1/search/news.json",
	headers: (clientId: string, clientSecret: string): Record<string, string> => ({
		"X-Naver-Client-Id": clientId,
		"X-Naver-Client-Secret": clientSecret,
	}),
	extraQuery: {},
};

function configFor(mode: NaverNewsMode) {
	return mode === "hub" ? HUB_CONFIG : LEGACY_CONFIG;
}

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

/** HTTP 상태 → 사용자 친화 오류 메시지 (모드별 인증/한도 안내). */
function errorMessageFor(status: number, mode: NaverNewsMode, fallback: string): string {
	if (status === 401) {
		return mode === "hub"
			? "NAVER API HUB 인증 실패 (401) — NCP 콘솔에서 발급한 API Key ID/Secret이 올바른지 확인하세요. (/naver-news-key 재등록)"
			: "네이버 인증 실패 (401) — Client ID/Secret이 올바른지 확인하세요. (/naver-news-key 재등록)";
	}
	if (status === 403) {
		return mode === "hub"
			? "API 권한 없음 (403) — NCP 콘솔에서 NAVER API HUB 구독 및 Application 생성을 확인하세요."
			: "검색 API 권한 없음 (403) — 네이버 개발자센터 → 내 애플리케이션 → API 설정에서 '검색'을 활성화하세요.";
	}
	if (status === 429) {
		return mode === "hub"
			? "NAVER API HUB 호출 한도 초과 (429) — 월 775,000건/키당 50 RPS 한도입니다. 잠시 후 재시도하세요."
			: "네이버 검색 API 일일 한도 초과 (429) — 하루 25,000회 한도입니다. 내일 재시도하세요.";
	}
	if (status >= 500) {
		return `네이버 서버 오류 (HTTP ${status}) — 잠시 후 재시도하세요.`;
	}
	return fallback;
}

/**
 * 네이버 뉴스 검색 API 호출 (모드별 엔드포인트/헤더 + 레이트리밋 + 에러 envelope).
 *
 * path는 HUB 경로(`/search/v1/news`) 기준 — legacy 모드에서 자동 변환.
 * 오류 처리:
 *  - 400대: 평면형(errorCode/errorMessage)과 중첩형(error.errorCode/message) 모두 파싱,
 *    401/403/429는 모드별 친화 메시지로 매핑.
 *  - 키 미등록: 스토어·env 모두 없으면 안내 오류.
 */
export async function naverRequest<T>(
	method: string,
	path: string,
	opts: NaverNewsRequestOptions = {},
): Promise<T> {
	return withGroupRateLimit("DEFAULT", async () => {
		const keys = getKeys();
		if (!keys.clientId || !keys.clientSecret) {
			throw makeNaverNewsError(
				`네이버 API 키 미등록 — /naver-news-key 로 등록하거나 env를 설정하세요. ` +
					`(${keys.mode === "hub" ? "NAVER API HUB: NCP_APIGW_API_KEY_ID / NCP_APIGW_API_KEY" : "개발자센터: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET"})`,
				"NO_KEY",
				0,
			);
		}

		recordCall();
		const cfg = configFor(keys.mode);
		const headers: Record<string, string> = cfg.headers(keys.clientId, keys.clientSecret);
		const query = { ...cfg.extraQuery, ...(opts.query ?? {}) };
		const url = `${cfg.base}${cfg.path}${buildQuery(query)}`;

		let res: Response;
		try {
			res = await fetch(url, { method, headers });
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
			const body = json as
				| { errorCode?: string; errorMessage?: string; error?: { errorCode?: string; message?: string } }
				| null;
			const errorCode = body?.error?.errorCode ?? body?.errorCode ?? `http-${res.status}`;
			const fallback = body?.error?.message ?? body?.errorMessage ?? `HTTP ${res.status}: ${text.slice(0, 200)}`;
			throw makeNaverNewsError(errorMessageFor(res.status, keys.mode, fallback), errorCode, res.status);
		}
		if (json === null) {
			throw makeNaverNewsError(`네이버 응답 없음 (HTTP ${res.status})`, `http-${res.status}`, res.status);
		}
		return json as T;
	});
}
