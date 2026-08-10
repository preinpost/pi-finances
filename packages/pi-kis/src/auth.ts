/**
 * src/auth.ts — KIS (Korea Investment) Open API authentication.
 *
 * - Keys are read from the active secret store (OS keyring preferred, file
 *   fallback), with shell env fallback (KIS_APP_KEY etc.) per field.
 * - Access tokens are cached in the same store keyed by env (real/paper) +
 *   appkey hash. Token issuance sends an SMS alert (알림톡), so we reuse
 *   cached tokens and only re-issue when expired.
 */
import { createHash } from "node:crypto";
import { getKeys, getTokenCache, keysPath, saveTokenCache, store } from "./secret.ts";
import type { KisKeys, TokenCache } from "./secret.ts";

export type { KisKeys, TokenCache } from "./secret.ts";
export { keysPath } from "./secret.ts";

export type KisEnv = "real" | "paper";
export type EnvArg = KisEnv | "auto";

export const REAL_BASE = "https://openapi.koreainvestment.com:9443";
export const PAPER_BASE = "https://openapivts.koreainvestment.com:29443";

export function baseUrl(env: KisEnv): string {
	return env === "paper" ? PAPER_BASE : REAL_BASE;
}

/**
 * 계좌번호를 KIS 포맷(CANO 8자리 + ACNT_PRDT_CD 2자리)으로 파싱.
 * 입력은 "12345678-01", "12345678", "1234-5678-01" 등 모두 허용 —
 * 구분자(-, 공백) 제거 후 앞 8자리가 CANO, 나머지 2자리가 상품코드(기본 01).
 */
export function parseAccount(raw: string | undefined): { cano?: string; prdtCd?: string } {
	if (!raw) return {};
	const digits = String(raw).replace(/[\s-]/g, "");
	const m = digits.match(/^(\d{8})(\d{2})?$/);
	if (m) return { cano: m[1], prdtCd: m[2] ?? "01" };
	return { cano: String(raw).trim() }; // 형식 불명 — 원본 유지 (API 단계에서 실패)
}

/** Load keys: active secret store first, shell env as fallback per field. */
export function loadKeys(): KisKeys {
	const file = getKeys();
	const env = process.env;
	const real = parseAccount(file.acctStock ?? env.KIS_ACCT_STOCK);
	const paper = parseAccount(file.paperStock ?? env.KIS_PAPER_STOCK);
	return {
		appKey: file.appKey ?? env.KIS_APP_KEY,
		appSecret: file.appSecret ?? env.KIS_APP_SECRET,
		paperAppKey: file.paperAppKey ?? env.KIS_PAPER_APP_KEY,
		paperAppSecret: file.paperAppSecret ?? env.KIS_PAPER_APP_SECRET,
		htsId: file.htsId ?? env.KIS_HTS_ID,
		acctStock: real.cano,
		acctStockPrdtCd: real.prdtCd,
		acctFuture: file.acctFuture ?? env.KIS_ACCT_FUTURE,
		paperStock: paper.cano,
		paperStockPrdtCd: paper.prdtCd,
		paperFuture: file.paperFuture ?? env.KIS_PAPER_FUTURE,
	};
}

/** Resolve "auto" to real/paper based on which keys are available. */
export function resolveEnv(env: EnvArg): KisEnv {
	if (env === "real" || env === "paper") return env;
	const keys = loadKeys();
	return keys.paperAppKey && keys.paperAppSecret ? "paper" : "real";
}

export function keysFor(env: KisEnv): { appKey: string; appSecret: string } {
	const k = loadKeys();
	const appKey = env === "paper" ? k.paperAppKey : k.appKey;
	const appSecret = env === "paper" ? k.paperAppSecret : k.appSecret;
	if (!appKey || !appSecret) {
		throw new Error(
			`KIS ${env} API keys missing. Run /kis-key to register them ` +
			`(stored in ${store.backend === "keyring" ? "OS keyring" : keysPath}). ` +
			`Fallback: set ${env === "paper" ? "KIS_PAPER_APP_KEY/KIS_PAPER_APP_SECRET" : "KIS_APP_KEY/KIS_APP_SECRET"}.`,
		);
	}
	return { appKey, appSecret };
}

function readTokenCache(): TokenCache {
	return getTokenCache();
}

async function writeTokenCache(cache: TokenCache): Promise<void> {
	await saveTokenCache(cache);
}

function appKeyHash(appKey: string): string {
	return createHash("sha256").update(appKey).digest("hex").slice(0, 16);
}

/** Issue a fresh access token. Valid ~24h; issuance triggers an SMS alert. */
export async function issueToken(env: KisEnv): Promise<string> {
	const { appKey, appSecret } = keysFor(env);
	const res = await fetch(`${baseUrl(env)}/oauth2/tokenP`, {
		method: "POST",
		headers: { "content-type": "application/json; charset=UTF-8" },
		body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
	});
	const text = await res.text();
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`KIS token issuance failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
	}
	const token = json.access_token;
	if (typeof token !== "string" || !token) {
		throw new Error(`KIS token issuance failed: ${text.slice(0, 300)}`);
	}
	const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 86400;
	const cache = readTokenCache();
	cache[env] = { token, appKeyHash: appKeyHash(appKey), expiresAt: Date.now() + (expiresIn - 60) * 1000 };
	await writeTokenCache(cache);
	return token;
}

/** Get a valid token, re-issuing only when the cached one is expired. */
export async function getToken(env: KisEnv): Promise<string> {
	const { appKey } = keysFor(env);
	const cached = readTokenCache()[env];
	if (cached && cached.token && cached.appKeyHash === appKeyHash(appKey) && cached.expiresAt > Date.now() + 30_000) {
		return cached.token;
	}
	return issueToken(env);
}

export async function clearTokenCache(env: KisEnv): Promise<void> {
	const cache = readTokenCache();
	delete cache[env];
	await writeTokenCache(cache);
}

/**
 * Last token issuance time per env, for /kis-status.
 * Returns seconds until expiry, or null when no cached token.
 */
export function tokenAge(env: KisEnv): number | null {
	const cached = readTokenCache()[env];
	if (!cached) return null;
	return Math.round((cached.expiresAt - Date.now()) / 1000);
}
