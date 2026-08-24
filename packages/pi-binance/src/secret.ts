/**
 * src/secret.ts — Binance 시크릿 뷰 (pi-finance-core 공용 스토어 위).
 *
 * pi-binance **전용 네임스페이스**("pi-binance") — pi-kis/pi-toss와 분리된 키 공간.
 * 저장은 반드시 mergeWrite (타 필드 보존).
 *
 * Env controls (공용): KIS_SECRET_STORE=file|keyring, KIS_KEYS_FILE=경로.
 * 셸 env 폴백: BINANCE_API_KEY / BINANCE_API_SECRET / BINANCE_ENV.
 */
import { createSecretStore, mergeWrite, type SecretBlob } from "pi-finance-core";

export type BinanceEnv = "live" | "testnet";

export interface BinanceKeys {
	/** Binance API Key (공개 식별자). */
	apiKey?: string;
	/** Binance API Secret (HMAC 서명용 — 출금 권한 없는 키를 쓸 것). */
	apiSecret?: string;
	/** live(실전, 기본) / testnet (현물·선물 테스트넷 키가 서로 다름). */
	env?: BinanceEnv;
}

/** pi-binance 전용 스토어 (네임스페이스/설정 변경 시 키 무효화). */
export const store = createSecretStore({
	namespace: "pi-binance",
	envVar: "KIS_SECRET_STORE",
	keysFileEnv: "KIS_KEYS_FILE",
});

export const keysPath = store.files.keys;

export function parseBinanceEnv(raw: string | undefined): BinanceEnv {
	const v = (raw ?? "").trim().toLowerCase();
	if (v === "testnet" || v === "test" || v === "demo") return "testnet";
	return "live";
}

/** Binance 키 — 스토어 우선, 셸 env 폴백. */
export function getKeys(): BinanceKeys {
	const k = (store.read("keys") ?? {}) as Record<string, unknown>;
	const envRaw = (k.env as string | undefined) ?? process.env.BINANCE_ENV;
	return {
		apiKey: (k.apiKey as string | undefined) ?? process.env.BINANCE_API_KEY,
		apiSecret: (k.apiSecret as string | undefined) ?? process.env.BINANCE_API_SECRET,
		env: parseBinanceEnv(envRaw),
	};
}

export async function saveKeys(keys: BinanceKeys): Promise<void> {
	await mergeWrite(store, "keys", keys as SecretBlob);
}
