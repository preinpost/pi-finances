/**
 * src/client.ts — Binance REST 클라이언트 (현물 + USDT-M 선물).
 *
 * 인증: HMAC SHA256
 *   헤더 `X-MBX-APIKEY` + query `timestamp`/`recvWindow`/`signature`.
 *   공개 시세(ticker/klines/premiumIndex 등)는 키 없이 호출 가능.
 *
 * 베이스 URL:
 *   live   spot  https://api.binance.com
 *   live   usdm  https://fapi.binance.com
 *   testnet spot https://testnet.binance.vision
 *   testnet usdm https://testnet.binancefuture.com
 *   ⚠️ 현물 테스트넷과 선물 테스트넷 API 키는 서로 다르다.
 *
 * 에러: { code: -1121, msg: "Invalid symbol." } → BinanceError.
 * 재시도:
 *   - 429: GET만 Retry-After/1s 백오프 최대 2회. POST/DELETE는 즉시 throw.
 *   - -1021(시각 오차): 서버시간 재동기화 후 1회 재시도 (주문이 거부된 경우만).
 *
 * 정식 스펙: https://binance-docs.github.io/apidocs/spot/en/
 *            https://binance-docs.github.io/apidocs/futures/en/
 */
import { createHmac } from "node:crypto";
import { getKeys, type BinanceEnv } from "./secret.ts";
import { withGroupRateLimit } from "./ratelimit.ts";

export type BinanceMarket = "spot" | "usdm";

export const BINANCE_BASES: Record<BinanceEnv, Record<BinanceMarket, string>> = {
	live: {
		spot: "https://api.binance.com",
		usdm: "https://fapi.binance.com",
	},
	testnet: {
		spot: "https://testnet.binance.vision",
		usdm: "https://testnet.binancefuture.com",
	},
};

export interface BinanceError extends Error {
	binance: { code: string | number; status: number };
}

export interface BinanceRequestOptions {
	query?: Record<string, string | number | boolean | undefined>;
	/** true면 HMAC 서명 (USER_DATA / TRADE). */
	signed?: boolean;
	/** 레이트리밋 그룹 (미지정 시 MARKET). */
	group?: string;
	/** 호출 단위 env 오버라이드 (미지정 시 저장된/env 값). */
	env?: BinanceEnv;
}

const RECV_WINDOW_MS = 5_000;

let timeOffsetMs = 0;
let timeSyncedAt = 0;

export function resetTimeSync(): void {
	timeOffsetMs = 0;
	timeSyncedAt = 0;
}

/** HMAC-SHA256 hex — Binance 서명. 스모크/회귀용으로 export. */
export function signQuery(queryString: string, secret: string): string {
	return createHmac("sha256", secret).update(queryString).digest("hex");
}

export function resolveEnv(override?: BinanceEnv): BinanceEnv {
	return override ?? getKeys().env ?? "live";
}

export function baseUrl(market: BinanceMarket, env?: BinanceEnv): string {
	return BINANCE_BASES[resolveEnv(env)][market];
}

function makeBinanceError(message: string, code: string | number, status: number): BinanceError {
	return Object.assign(new Error(message), { binance: { code, status } });
}

export function buildQuery(query: Record<string, string | number | boolean | undefined>): string {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v === undefined || v === null) continue;
		params.set(k, String(v));
	}
	return params.toString();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireKeys(): { apiKey: string; apiSecret: string } {
	const { apiKey, apiSecret } = getKeys();
	if (!apiKey || !apiSecret) {
		throw new Error(
			"Binance API keys missing. Run /binance-key to register apiKey/apiSecret " +
				"(or set BINANCE_API_KEY/BINANCE_API_SECRET). 출금 권한이 꺼진 키만 사용하세요.",
		);
	}
	return { apiKey, apiSecret };
}

interface ParsedBody {
	json: unknown;
	text: string;
}

async function parseBody(res: Response): Promise<ParsedBody> {
	const text = await res.text();
	if (!text) return { json: null, text: "" };
	try {
		return { json: JSON.parse(text), text };
	} catch {
		return { json: null, text };
	}
}

function errorFrom(json: unknown, text: string, status: number): BinanceError {
	const body = json as { code?: number; msg?: string } | null;
	const code = body?.code ?? status;
	const message = body?.msg ?? (text ? `HTTP ${status}: ${text.slice(0, 200)}` : `HTTP ${status}`);
	return makeBinanceError(message, code, status);
}

async function rawFetch(
	market: BinanceMarket,
	method: string,
	path: string,
	opts: BinanceRequestOptions,
	signedNow: boolean,
): Promise<unknown> {
	const headers: Record<string, string> = {};
	const query: Record<string, string | number | boolean | undefined> = { ...(opts.query ?? {}) };

	if (signedNow) {
		const { apiKey, apiSecret } = requireKeys();
		headers["X-MBX-APIKEY"] = apiKey;
		query.timestamp = Date.now() + timeOffsetMs;
		query.recvWindow = RECV_WINDOW_MS;
		const qs = buildQuery(query);
		const signature = signQuery(qs, apiSecret);
		const url = `${baseUrl(market, opts.env)}${path}?${qs}&signature=${signature}`;
		let res: Response;
		try {
			res = await fetch(url, { method, headers });
		} catch (e) {
			throw makeBinanceError(`Binance API 요청 실패 (네트워크): ${(e as Error).message}`, "network-error", 0);
		}
		const { json, text } = await parseBody(res);
		if (!res.ok) throw errorFrom(json, text, res.status);
		return json;
	}

	const { apiKey } = getKeys();
	if (apiKey) headers["X-MBX-APIKEY"] = apiKey;
	const qs = buildQuery(query);
	const url = `${baseUrl(market, opts.env)}${path}${qs ? `?${qs}` : ""}`;
	let res: Response;
	try {
		res = await fetch(url, { method, headers });
	} catch (e) {
		throw makeBinanceError(`Binance API 요청 실패 (네트워크): ${(e as Error).message}`, "network-error", 0);
	}
	const { json, text } = await parseBody(res);
	if (!res.ok) throw errorFrom(json, text, res.status);
	return json;
}

async function syncServerTime(market: BinanceMarket, env?: BinanceEnv): Promise<void> {
	const path = market === "usdm" ? "/fapi/v1/time" : "/api/v3/time";
	const json = (await rawFetch(market, "GET", path, { env, group: "MARKET" }, false)) as { serverTime?: number };
	const serverTime = Number(json?.serverTime);
	if (!Number.isFinite(serverTime)) {
		throw makeBinanceError("Binance 서버시간 응답이 없습니다.", "time-sync", 0);
	}
	timeOffsetMs = serverTime - Date.now();
	timeSyncedAt = Date.now();
}

async function ensureTime(market: BinanceMarket, env?: BinanceEnv): Promise<void> {
	if (Date.now() - timeSyncedAt < 60_000) return;
	await syncServerTime(market, env);
}

/**
 * Binance API 호출 (그룹별 레이트리밋 + HMAC + 에러 envelope).
 */
export async function binanceRequest<T>(
	market: BinanceMarket,
	method: string,
	path: string,
	opts: BinanceRequestOptions = {},
): Promise<T> {
	const group = opts.group ?? (opts.signed ? "ACCOUNT" : "MARKET");
	const safeRetry = method === "GET";

	const doCall = async (): Promise<T> => {
		if (opts.signed) await ensureTime(market, opts.env);
		return (await rawFetch(market, method, path, opts, Boolean(opts.signed))) as T;
	};

	for (let attempt = 0; ; attempt++) {
		try {
			return await withGroupRateLimit(group, doCall);
		} catch (e) {
			const err = e as BinanceError & { binance?: { code?: string | number; status?: number } };
			const code = err.binance?.code;
			const status = err.binance?.status;
			if (code === -1021 && attempt === 0) {
				resetTimeSync();
				try {
					await syncServerTime(market, opts.env);
				} catch {
					/* 재동기화 실패해도 한 번 더 시도 */
				}
				continue;
			}
			if (status === 429 && safeRetry && attempt < 2) {
				await sleep(1000 * (attempt + 1));
				continue;
			}
			throw e;
		}
	}
}

/** 선물 v2 실패 시 v3로 한 번 재시도 (계정/포지션 엔드포인트 이행기). */
export async function binanceFuturesSigned<T>(
	v2Path: string,
	v3Path: string,
	opts: Omit<BinanceRequestOptions, "signed"> = {},
): Promise<{ data: T; version: "v2" | "v3" }> {
	try {
		const data = await binanceRequest<T>("usdm", "GET", v2Path, { ...opts, signed: true, group: opts.group ?? "ACCOUNT" });
		return { data, version: "v2" };
	} catch (e) {
		const status = (e as BinanceError).binance?.status;
		const code = (e as BinanceError).binance?.code;
		if (status === 404 || code === -2008 || code === -2016) {
			const data = await binanceRequest<T>("usdm", "GET", v3Path, { ...opts, signed: true, group: opts.group ?? "ACCOUNT" });
			return { data, version: "v3" };
		}
		throw e;
	}
}
