/**
 * src/secret.ts — Finnhub API 키 시크릿 뷰 (pi-finance-core 공용 스토어 위).
 *
 * 전용 네임스페이스("pi-finnhub")를 사용한다 (pi-kis/pi-toss와 분리).
 * 저장은 반드시 mergeWrite — 공유 스토어의 다른 필드를 보존한다.
 *
 * Env controls (공용): KIS_SECRET_STORE=file|keyring, KIS_KEYS_FILE=경로.
 * 셸 env 폴백: FINNHUB_API_KEY.
 */
import { createSecretStore, mergeWrite, type SecretBlob } from "pi-finance-core";

export interface FinnhubKeys {
	/** finnhub.io dashboard에서 발급한 API token. */
	finnhubApiKey?: string;
}

/** 공용 스토어 (네임스페이스는 패키지 전용 — 변경 시 키 무효화). */
export const store = createSecretStore({
	namespace: "pi-finnhub",
	envVar: "KIS_SECRET_STORE",
	keysFileEnv: "KIS_KEYS_FILE",
});

export const keysPath = store.files.keys;

/** Finnhub 키 — 스토어 우선, 셸 env 폴백. */
export function getKeys(): FinnhubKeys {
	const k = (store.read("keys") ?? {}) as Record<string, unknown>;
	return {
		finnhubApiKey: (k.finnhubApiKey as string | undefined) ?? process.env.FINNHUB_API_KEY,
	};
}

export async function saveKeys(keys: FinnhubKeys): Promise<void> {
	await mergeWrite(store, "keys", keys as SecretBlob);
}
