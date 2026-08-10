/**
 * src/secret.ts — 토스증권 시크릿 뷰 (pi-finance-core 공용 스토어 위).
 *
 * pi-kis와 **하나의 공유 네임스페이스**("pi-kis")를 사용한다 — 분리 이전부터
 * 토스 키가 같은 저장소에 있었으므로, pi-kis 0.2.x에서 업그레이드한 사용자는
 * 키를 다시 등록할 필요가 없다. 저장은 반드시 mergeWrite (KIS 필드 보존).
 *
 * Env controls (공용): KIS_SECRET_STORE=file|keyring, KIS_KEYS_FILE=경로.
 * 셸 env 폴백: TOSS_CLIENT_ID / TOSS_CLIENT_SECRET.
 */
import { createSecretStore, mergeWrite, type SecretBlob } from "pi-finance-core";

export interface TossKeys {
	/** 토스증권 개발자센터에서 발급한 client_id (c_... 형식). */
	tossClientId?: string;
	/** 토스증권 개발자센터에서 발급한 client_secret (s_... 형식). */
	tossClientSecret?: string;
}

export interface TossTokenCache {
	/** 토스 OAuth access token (client_credentials, 브로커별 1개). */
	toss?: { token: string; expiresAt: number };
}

/** 공용 스토어 (pi-kis와 공유 — 네임스페이스/설정 변경 시 키 무효화). */
export const store = createSecretStore({
	namespace: "pi-kis",
	envVar: "KIS_SECRET_STORE",
	keysFileEnv: "KIS_KEYS_FILE",
});

export const keysPath = store.files.keys;

// ── 타입드 뷰 ──────────────────────────────────────────────────────────────

/** 토스 키 — 스토어 우선, 셸 env 폴백. */
export function getKeys(): TossKeys {
	const k = (store.read("keys") ?? {}) as Record<string, unknown>;
	return {
		tossClientId: (k.tossClientId as string | undefined) ?? process.env.TOSS_CLIENT_ID,
		tossClientSecret: (k.tossClientSecret as string | undefined) ?? process.env.TOSS_CLIENT_SECRET,
	};
}

export async function saveKeys(keys: TossKeys): Promise<void> {
	await mergeWrite(store, "keys", keys as SecretBlob);
}

export function getTokenCache(): TossTokenCache {
	return (store.read("token") ?? {}) as TossTokenCache;
}

export async function saveTokenCache(cache: TossTokenCache): Promise<void> {
	await mergeWrite(store, "token", cache as SecretBlob);
}
