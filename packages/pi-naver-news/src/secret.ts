/**
 * src/secret.ts — 네이버 시크릿 뷰 (pi-finance-core 공용 스토어 위).
 *
 * pi-naver-news **전용 네임스페이스**("pi-naver-news")를 사용한다 — pi-kis/pi-toss와
 * 분리된 키 공간. 저장은 반드시 mergeWrite (타 필드 보존).
 *
 * Env controls (공용): KIS_SECRET_STORE=file|keyring, KIS_KEYS_FILE=경로.
 * 셸 env 폴백: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET.
 */
import { createSecretStore, mergeWrite, type SecretBlob } from "pi-finance-core";

export interface NaverNewsKeys {
	/** 네이버 애플리케이션 Client ID (X-Naver-Client-Id 헤더). */
	clientId?: string;
	/** 네이버 애플리케이션 Client Secret (X-Naver-Client-Secret 헤더). */
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

/** 네이버 키 — 스토어 우선, 셸 env 폴백. */
export function getKeys(): NaverNewsKeys {
	const k = (store.read("keys") ?? {}) as Record<string, unknown>;
	return {
		clientId: (k.clientId as string | undefined) ?? process.env.NAVER_CLIENT_ID,
		clientSecret: (k.clientSecret as string | undefined) ?? process.env.NAVER_CLIENT_SECRET,
	};
}

export async function saveKeys(keys: NaverNewsKeys): Promise<void> {
	await mergeWrite(store, "keys", keys as SecretBlob);
}
