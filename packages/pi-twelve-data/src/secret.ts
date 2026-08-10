/**
 * src/secret.ts — Twelve Data 시크릿 뷰 (pi-finance-core 공용 스토어 위).
 *
 * 다른 패키지와 분리된 전용 네임스페이스("pi-twelve-data")를 사용한다.
 * 저장은 반드시 mergeWrite (타 패키지 필드 보존).
 *
 * Env controls (공용): KIS_SECRET_STORE=file|keyring, KIS_KEYS_FILE=경로.
 * 셸 env 폴백: TWELVE_API_KEY.
 */
import { createSecretStore, mergeWrite, type SecretBlob } from "pi-finance-core";

export interface TwelveKeys {
	/** Twelve Data API 키 (twelvedata.com 무료 가입 → apikey). */
	apiKey?: string;
}

/** 공용 스토어 (전용 네임스페이스 — 설정 변경 시 키 무효화). */
export const store = createSecretStore({
	namespace: "pi-twelve-data",
	envVar: "KIS_SECRET_STORE",
	keysFileEnv: "KIS_KEYS_FILE",
});

export const keysPath = store.files.keys;

// ── 타입드 뷰 ──────────────────────────────────────────────────────────────

/** Twelve 키 — 스토어 우선, 셸 env 폴백. */
export function getKeys(): TwelveKeys {
	const k = (store.read("keys") ?? {}) as Record<string, unknown>;
	return {
		apiKey: (k.apiKey as string | undefined) ?? process.env.TWELVE_API_KEY,
	};
}

export async function saveKeys(keys: TwelveKeys): Promise<void> {
	await mergeWrite(store, "keys", keys as SecretBlob);
}
