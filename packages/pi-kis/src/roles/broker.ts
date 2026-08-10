/**
 * src/roles/broker.ts — KIS 우선 시장 데이터 퍼사드 (broker_price/broker_chart).
 *
 * v0.3.0부터 토스증권은 pi-toss 패키지로 분리되어, 이 모듈은 **KIS만** 호출한다.
 * KIS 키 미등록/실패/미지원(1분봉) 시 에러 메시지에 폴백 힌트를 담아
 * 에이전트가 toss_* 툴(pi-toss 패키지)을 직접 호출하도록 안내한다.
 * (pi는 패키지별 module root를 분리하므로 pi-kis가 설치된 pi-toss를
 *  런타임에 import할 수 없다 — 코드 폴백 대신 에이전트 중재 폴백.)
 *
 * 툴 이름/파라미터 계약은 유지 (tools.ts 주석: 이름 변경 불가).
 */
import { loadKeys, type EnvArg } from "../core/auth.ts";
import { getDomesticChart, getDomesticPrice, getOverseasChart, getOverseasPrice } from "./market.ts";
import { normalizeDomesticChart, normalizeOverseasChart, type Bar } from "pi-finance-core";

export type BrokerId = "kis" | "toss";

export interface BrokerPrice {
	broker: BrokerId;
	symbol: string;
	price: string;
	currency?: string;
	source: "primary" | "fallback";
	quote?: Record<string, unknown>;
}

export interface BrokerCandles {
	broker: BrokerId;
	period: string;
	bars: Bar[];
	source: "primary" | "fallback";
}

/** 에이전트 중재 폴백 힌트 — pi-toss 패키지 설치 시 toss_* 툴 사용 가능. */
const TOSS_HINT = " → toss_price/toss_chart 툴 사용 (pi-toss 패키지 설치 시, /toss-key로 키 등록)";

/** KIS 키 등록 여부. */
export function keysRegistered(broker: BrokerId): boolean {
	if (broker !== "kis") return false; // toss는 pi-toss 패키지 담당
	return !!loadKeys().appKey;
}

/** 국내 종목(6자리 숫자) 여부 — 그 외(영문 티커 등)는 해외로 간주. */
export function isDomesticSymbol(symbol: string): boolean {
	return /^\d{6}$/.test(symbol);
}

/** KIS 해외 차트/가격의 거래소 후보 (NAS→NYS→AMS). */
const OVERSEAS_EXCDS = ["NAS", "NYS", "AMS"] as const;

function today(): string {
	const d = new Date();
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// ── KIS 추출 헬퍼 ─────────────────────────────────────────────────────────

/** KIS 국내 현재가(v1_국내주식-008): output.stck_prpr. */
function extractDomesticPrice(res: { data: Record<string, unknown> }): { price: string; currency: string } | null {
	const out = (res.data?.output ?? {}) as Record<string, unknown>;
	const price = out.stck_prpr;
	if (typeof price !== "string" || price === "") return null;
	return { price, currency: "KRW" };
}

/** KIS 해외 현재가(v1_해외주식-009): 최상위 last. */
function extractOverseasPrice(res: { data: Record<string, unknown> }): { price: string; currency: string } | null {
	const price = res.data?.last;
	if (typeof price !== "string" || price === "") return null;
	return { price, currency: "USD" };
}

/** KIS 차트 응답에서 output2/output1 배열 후보를 정규화해 bar가 많은 쪽 선택. */
function pickKisChartBars(out: Record<string, unknown>, normalize: (rows: Record<string, unknown>[]) => Bar[]): Bar[] {
	let best: Bar[] = [];
	for (const key of ["output2", "output1"] as const) {
		const rows = out[key];
		if (!Array.isArray(rows)) continue;
		const bars = normalize(rows as Record<string, unknown>[]);
		if (bars.length > best.length) best = bars;
	}
	return best;
}

/** KIS 국내 차트 — period D/W/M, date1=오늘-250일. */
async function kisDomesticCandles(symbol: string, period: "D" | "W" | "M", env?: EnvArg): Promise<Bar[]> {
	const now = new Date();
	const fmt = (d: Date) =>
		`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
	const res = await getDomesticChart(symbol, {
		period,
		date1: fmt(new Date(now.getTime() - 250 * 86_400_000)),
		date2: fmt(now),
		env,
	});
	return pickKisChartBars(res.data as Record<string, unknown>, normalizeDomesticChart);
}

/** KIS 해외 차트 — excd NAS→NYS→AMS 순 시도, gubn D→0/W→1/M→2. */
async function kisOverseasCandles(symbol: string, period: "D" | "W" | "M", env?: EnvArg): Promise<Bar[]> {
	const gubn = period === "D" ? "0" : period === "W" ? "1" : "2";
	let lastErr: unknown;
	for (const excd of OVERSEAS_EXCDS) {
		try {
			const res = await getOverseasChart(excd, symbol, { gubn, bymd: today(), env });
			const bars = pickKisChartBars(res.data as Record<string, unknown>, normalizeOverseasChart);
			if (bars.length > 0) return bars;
		} catch (e) {
			lastErr = e;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(`KIS 해외 차트 조회 실패 (${symbol})`);
}

// ── 현재가 (KIS 우선) ─────────────────────────────────────────────────────

export interface BrokerPriceOptions {
	prefer?: BrokerId;
	env?: EnvArg;
}

/** 현재가 조회 — KIS 우선. KIS 불가 시 toss_* 툴 사용을 안내하는 에러. */
export async function getPrice(symbol: string, opts: BrokerPriceOptions = {}): Promise<BrokerPrice> {
	if (opts.prefer === "toss") {
		throw new Error(`broker_price는 KIS 전용입니다 (v0.3.0부터 토스는 pi-toss 패키지)${TOSS_HINT}`);
	}
	if (!keysRegistered("kis")) {
		throw new Error(`KIS 키 미등록 — /kis-key로 등록하세요.${TOSS_HINT}`);
	}
	const domestic = isDomesticSymbol(symbol);
	try {
		// 해외는 NAS→NYS→AMS 순으로 시도 (차트와 동일한 순회)
		let q: { price: string; currency?: string } | null = null;
		let raw: Record<string, unknown> | undefined;
		let last: unknown;
		if (domestic) {
			const res = await getDomesticPrice(symbol, opts.env);
			q = extractDomesticPrice(res);
			raw = res.data;
		} else {
			for (const excd of OVERSEAS_EXCDS) {
				try {
					const res = await getOverseasPrice(excd, symbol, opts.env);
					q = extractOverseasPrice(res);
					if (q) {
						raw = res.data;
						break;
					}
				} catch (e) {
					last = e;
				}
			}
		}
		if (q) return { broker: "kis", symbol, price: q.price, currency: q.currency, source: "primary", quote: raw ?? q };
		throw (last instanceof Error ? last : new Error(`KIS 현재가 데이터 없음 (${symbol})`));
	} catch (e) {
		const err = e instanceof Error ? e : new Error(`현재가 조회 실패 (${symbol})`);
		if (!err.message.includes("pi-toss")) err.message += TOSS_HINT;
		throw err;
	}
}

// ── 차트 (KIS 우선) ───────────────────────────────────────────────────────

export type BrokerCandlePeriod = "D" | "W" | "M" | "1d" | "1m";

export interface BrokerCandlesOptions {
	period?: BrokerCandlePeriod;
	/** 조회 봉 수 (KIS는 미사용 — 1m는 pi-toss에서 사용). */
	count?: number;
	prefer?: BrokerId;
	env?: EnvArg;
}

/**
 * 차트 조회 (KIS 우선):
 *  - D/W/M/1d: KIS 일·주·월봉
 *  - 1m: KIS 미지원 → toss_chart 툴 안내 (pi-toss 패키지)
 */
export async function getCandles(symbol: string, opts: BrokerCandlesOptions = {}): Promise<BrokerCandles> {
	const period = opts.period ?? "D";
	if (opts.prefer === "toss") {
		throw new Error(`broker_chart는 KIS 전용입니다 (v0.3.0부터 토스는 pi-toss 패키지)${TOSS_HINT}`);
	}
	if (!keysRegistered("kis")) {
		throw new Error(`KIS 키 미등록 — /kis-key로 등록하세요.${TOSS_HINT}`);
	}

	// 1m: Toss 전용 (KIS 분봉은 미구현)
	if (period === "1m") {
		throw new Error(`1분봉은 KIS 미지원${TOSS_HINT}`);
	}

	try {
		const bars = isDomesticSymbol(symbol)
			? await kisDomesticCandles(symbol, period === "D" || period === "1d" ? "D" : period, opts.env)
			: await kisOverseasCandles(symbol, period === "D" || period === "1d" ? "D" : period, opts.env);
		if (bars.length === 0) throw new Error(`KIS 차트 데이터 없음 (${symbol}, ${period})`);
		return { broker: "kis", period, bars, source: "primary" };
	} catch (e) {
		const err = e instanceof Error ? e : new Error(`차트 조회 실패 (${symbol})`);
		if (!err.message.includes("pi-toss")) err.message += TOSS_HINT;
		throw err;
	}
}
