/**
 * src/secret.ts — CoinGecko 시크릿 뷰 (pi-finance-core 공용 스토어 위).
 *
 * pi-coingecko **전용 네임스페이스**("pi-coingecko")를 사용한다 — pi-kis/pi-toss와
 * 분리된 키 공간. 저장은 반드시 mergeWrite (타 필드 보존).
 *
 * Env controls (공용): KIS_SECRET_STORE=file|keyring, KIS_KEYS_FILE=경로.
 * 셸 env 폴백: COINGECKO_API_KEY.
 */
import { createSecretStore, mergeWrite, type SecretBlob } from "pi-finance-core";

export interface CoingeckoKeys {
	/** CoinGecko API key — 무료 Demo 키(x_cg_demo_...) 또는 Pro 키(CG-...). 없으면 공개 API 사용. */
	apiKey?: string;
}

/** pi-coingecko 전용 스토어 (네임스페이스/설정 변경 시 키 무효화). */
export const store = createSecretStore({
	namespace: "pi-coingecko",
	envVar: "KIS_SECRET_STORE",
	keysFileEnv: "KIS_KEYS_FILE",
});

export const keysPath = store.files.keys;

// ── 타입드 뷰 ──────────────────────────────────────────────────────────────

/** CoinGecko 키 — 스토어 우선, 셸 env 폴백. */
export function getKeys(): CoingeckoKeys {
	const k = (store.read("keys") ?? {}) as Record<string, unknown>;
	return {
		apiKey: (k.apiKey as string | undefined) ?? process.env.COINGECKO_API_KEY,
	};
}

export async function saveKeys(keys: CoingeckoKeys): Promise<void> {
	await mergeWrite(store, "keys", keys as SecretBlob);
}
