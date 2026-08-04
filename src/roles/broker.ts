/**
 * src/roles/broker.ts — 브로커 중립 퍼사드 + 폴백 (KIS/Toss).
 *
 * "같은 시장 데이터"(현재가·차트)만 폴백 대상이다. 계좌·주문·자산은 증권사별
 * 계좌에 묶여 있어 폴백할 수 없다 — 각 브로커 툴(kis_*, toss_*)을 명시적으로
 * 선택해 호출해야 한다.
 *
 * 폴백 규칙:
 *  - 등록된 키가 있는 브로커만 후보 (keysRegistered)
 *  - 기본 우선순위: KIS > Toss (KIS가 API가 많고 주봉/월봉 보유)
 *  - 첫 브로커 실패/데이터 없음 → 다음 브로커 (source: "fallback" 표시)
 */
import { loadKeys, type EnvArg } from "../core/auth.ts";
import { getDomesticChart, getDomesticPrice, getOverseasChart, getOverseasPrice } from "./market.ts";
import { getCandles as tossGetCandles, getPrices as tossGetPrices } from "./toss.ts";
import { normalizeDomesticChart, normalizeOverseasChart, type Bar } from "./indicators.ts";

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

/** 해당 브로커의 키가 등록돼 있는지. */
export function keysRegistered(broker: BrokerId): boolean {
	const k = loadKeys();
	return broker === "kis" ? !!k.appKey : !!k.tossClientId;
}

/** 국내 종목(6자리 숫자) 여부 — 그 외(영문 티커 등)는 해외로 간주. */
export function isDomesticSymbol(symbol: string): boolean {
	return /^\d{6}$/.test(symbol);
}

/** 등록된 브로커만 우선순위(prefer → 상대)로 반환. */
function candidates(prefer?: BrokerId): BrokerId[] {
	const order: BrokerId[] = prefer ? [prefer, prefer === "kis" ? "toss" : "kis"] : ["kis", "toss"];
	return order.filter(keysRegistered);
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

// ── 현재가 폴백 ───────────────────────────────────────────────────────────

export interface BrokerPriceOptions {
	prefer?: BrokerId;
	env?: EnvArg;
}

/** 현재가 조회 — 등록된 브로커 우선, 실패/데이터 없음 시 상대 브로커로 폴백. */
export async function getPrice(symbol: string, opts: BrokerPriceOptions = {}): Promise<BrokerPrice> {
	const list = candidates(opts.prefer);
	if (list.length === 0) {
		throw new Error("KIS/Toss 키가 모두 미등록입니다. /kis-key 또는 /toss-key로 등록하세요.");
	}
	const domestic = isDomesticSymbol(symbol);
	let lastErr: unknown;

	for (let i = 0; i < list.length; i++) {
		const broker = list[i];
		try {
			if (broker === "kis") {
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
				if (q) return { broker, symbol, price: q.price, currency: q.currency, source: i === 0 ? "primary" : "fallback", quote: raw ?? q };
				lastErr = last ?? new Error(`KIS 현재가 데이터 없음 (${symbol})`);
			} else {
				const prices = await tossGetPrices([symbol]);
				const p = prices[0];
				if (p && p.lastPrice) {
					return { broker, symbol, price: p.lastPrice, currency: p.currency, source: i === 0 ? "primary" : "fallback" };
				}
				lastErr = new Error(`Toss 현재가 데이터 없음 (${symbol})`);
			}
		} catch (e) {
			lastErr = e;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(`현재가 조회 실패 (${symbol})`);
}

// ── 차트 폴백 ─────────────────────────────────────────────────────────────

export type BrokerCandlePeriod = "D" | "W" | "M" | "1d" | "1m";

export interface BrokerCandlesOptions {
	period?: BrokerCandlePeriod;
	/** 조회 봉 수 (토스에서 사용, 최대 200). 기본 100. */
	count?: number;
	prefer?: BrokerId;
	env?: EnvArg;
}

/**
 * 차트 조회 (폴백):
 *  - D/1d: KIS 일봉 → Toss 1d 폴백
 *  - W/M: KIS 전용 (Toss는 주봉/월봉 없음 — 폴백 불가)
 *  - 1m: Toss 전용 (KIS 분봉은 미구현)
 */
export async function getCandles(symbol: string, opts: BrokerCandlesOptions = {}): Promise<BrokerCandles> {
	const period = opts.period ?? "D";
	const list = candidates(opts.prefer);
	if (list.length === 0) {
		throw new Error("KIS/Toss 키가 모두 미등록입니다. /kis-key 또는 /toss-key로 등록하세요.");
	}
	let lastErr: unknown;

	// W/M: KIS 전용
	if (period === "W" || period === "M") {
		if (!keysRegistered("kis")) throw new Error(`주봉/월봉(${period})은 KIS 전용입니다 — /kis-key로 KIS 키를 등록하세요.`);
		const bars = isDomesticSymbol(symbol)
			? await kisDomesticCandles(symbol, period, opts.env)
			: await kisOverseasCandles(symbol, period, opts.env);
		if (bars.length === 0) throw new Error(`KIS 차트 데이터 없음 (${symbol}, ${period})`);
		return { broker: "kis", period, bars, source: "primary" };
	}

	// 1m: Toss 전용
	if (period === "1m") {
		if (!keysRegistered("toss")) throw new Error("1분봉은 Toss 전용입니다 — /toss-key로 토스 키를 등록하세요.");
		const page = await tossGetCandles(symbol, { interval: "1m", count: opts.count ?? 100 });
		if (page.bars.length === 0) throw new Error(`Toss 차트 데이터 없음 (${symbol}, 1m)`);
		return { broker: "toss", period, bars: page.bars, source: "primary" };
	}

	// D/1d: KIS → Toss 폴백
	for (let i = 0; i < list.length; i++) {
		const broker = list[i];
		try {
			if (broker === "kis") {
				const bars = isDomesticSymbol(symbol)
					? await kisDomesticCandles(symbol, "D", opts.env)
					: await kisOverseasCandles(symbol, "D", opts.env);
				if (bars.length > 0) return { broker: "kis", period, bars, source: i === 0 ? "primary" : "fallback" };
				lastErr = new Error(`KIS 차트 데이터 없음 (${symbol})`);
			} else {
				const page = await tossGetCandles(symbol, { interval: "1d", count: opts.count ?? 100 });
				if (page.bars.length > 0) return { broker: "toss", period, bars: page.bars, source: i === 0 ? "primary" : "fallback" };
				lastErr = new Error(`Toss 차트 데이터 없음 (${symbol})`);
			}
		} catch (e) {
			lastErr = e;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(`차트 조회 실패 (${symbol})`);
}
