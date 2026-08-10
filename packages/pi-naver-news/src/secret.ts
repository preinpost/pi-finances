/**
 * src/secret.ts — 네이버 시크릿 뷰 (pi-finance-core 공용 스토어 위).
 *
 * pi-naver-news **전용 네임스페이스**("pi-naver-news")를 사용한다 — pi-kis/pi-toss와
 * 분리된 키 공간. 저장은 반드시 mergeWrite (타 필드 보존).
 *
 * 모드 (2026-07-31 개발자센터 신규 신청 종료 이후):
 *   - "hub" (기본): NAVER API HUB (NCP 콘솔) — naverapihub.apigw.ntruss.com,
 *     X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY 헤더. 신규 키는 모두 이 방식.
 *   - "legacy": 네이버 개발자센터 키 — openapi.naver.com, X-Naver-Client-Id/Secret.
 *     2026-07-31 이전 발급 키만 2027-06-30까지 사용 가능.
 *
 * Env controls (공용): KIS_SECRET_STORE=file|keyring, KIS_KEYS_FILE=경로.
 * 셸 env 폴백: NAVER_NEWS_API_MODE(=hub|legacy), NCP_APIGW_API_KEY_ID/NCP_APIGW_API_KEY (hub),
 *   NAVER_CLIENT_ID/NAVER_CLIENT_SECRET (legacy).
 */
import { createSecretStore, mergeWrite, type SecretBlob } from "pi-finance-core";

export type NaverNewsMode = "hub" | "legacy";

export interface NaverNewsKeys {
	/** API 모드: hub=NAVER API HUB (기본), legacy=개발자센터 (2027-06-30까지). */
	mode: NaverNewsMode;
	/** API Key ID (hub: X-NCP-APIGW-API-KEY-ID / legacy: X-Naver-Client-Id). */
	clientId?: string;
	/** API Key (hub: X-NCP-APIGW-API-KEY / legacy: X-Naver-Client-Secret). */
	clientSecret?: string;
}

/** pi-naver-news 전용 스토어 (네임스페이스/설정 변경 시 키 무효화). */
export const store = createSecretStore({
	namespace: "pi-naver-news",
	envVar: "KIS_SECRET_STORE",
	keysFileEnv: "KIS_KEYS_FILE",
});

export const keysPath = store.files.keys;

// ── 타입드 뷰 ──────────────────────────────────────────────────────────────

/**
 * 네이버 키 — 스토어 우선, 셸 env 폴백.
 * mode는 env(NAVER_NEWS_API_MODE) > 스토어 > 기본 hub 순으로 결정되고,
 * env 폴백 키는 mode에 맞는 쌍만 사용한다.
 */
export function getKeys(): NaverNewsKeys {
	const k = (store.read("keys") ?? {}) as Record<string, unknown>;
	const mode: NaverNewsMode =
		(process.env.NAVER_NEWS_API_MODE as NaverNewsMode | undefined) ??
		(k.mode as NaverNewsMode | undefined) ??
		"hub";
	const envId = mode === "hub" ? process.env.NCP_APIGW_API_KEY_ID : process.env.NAVER_CLIENT_ID;
	const envSecret = mode === "hub" ? process.env.NCP_APIGW_API_KEY : process.env.NAVER_CLIENT_SECRET;
	return {
		mode,
		clientId: (k.clientId as string | undefined) ?? envId,
		clientSecret: (k.clientSecret as string | undefined) ?? envSecret,
	};
}

export async function saveKeys(keys: NaverNewsKeys): Promise<void> {
	await mergeWrite(store, "keys", keys as unknown as SecretBlob);
}
