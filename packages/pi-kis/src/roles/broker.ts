/**
 * src/roles/broker.ts — KIS 우선 시장 데이터 퍼사드 (broker_price/broker_chart).
 *
 * v0.3.0부터 토스증권은 pi-toss 패키지로 분리됐고, pi는 패키지별 module root를
 * 분리하며 툴은 LLM이 호출한다. 따라서 pi-kis는 **코드로 다른 브로커를 호출하지 않는다** —
 * KIS 미지원/실패 시 `BrokerFallbackError`에 **구조화된 폴백 지시**
 * ({ func: "price" | "chart", args, why })를 담아 반환한다.
 *
 * 폴백 툴 발견은 **prefix_name 규칙의 suffix**를 쓴다: 동일 기능 툴은 같은 함수명
 * suffix를 공유하므로(toss_price/twelve_price/finnhub_price), tools.ts가
 * pi.getAllTools()에서 `*_{func}` 툴을 찾아 fallback.tools로 실어준다.
 * 에이전트는 그 후보 중 설치된 툴을 그대로 툴 콜한다 (툴 콜 레벨의 느슨한 결합).
 *
 * 툴 이름/파라미터 계약은 유지 (tools.ts 주석: 이름 변경 불가).
 */
import { loadKeys, type EnvArg } from "../auth.ts";
import { getDomesticChart, getDomesticPrice, getOverseasChart, getOverseasPrice } from "./market.ts";
import { normalizeDomesticChart, normalizeOverseasChart, type Bar } from "pi-finance-core";

export type BrokerId = "kis" | "toss";

export interface BrokerPrice {
	broker: BrokerId;
	symbol: string;
	price: string;
	currency?: string;
	source: "primary";
	quote?: Record<string, unknown>;
}

export interface BrokerCandles {
	broker: BrokerId;
	period: string;
	bars: Bar[];
	source: "primary";
}

/** 에이전트가 이어서 호출할 폴백 지시. func는 prefix_name 규칙의 **suffix(함수명)** —
 * 동일 기능 툴은 같은 suffix를 쓰므로(toss_price/twelve_price/finnhub_price),
 * tools.ts가 pi.getAllTools()에서 `*_{func}` 툴을 발견해 tools에 채운다. */
export interface ToolFallback {
	func: string;
	/** 설치된 `*_{func}` 툴 후보 (tools.ts가 pi.getAllTools()로 채움 — pi 비의존 유지 위해 broker.ts는 비워둠). */
	tools?: string[];
	args: Record<string, unknown>;
	why: string;
}

/** KIS 미지원/실패 — 폴백 지시를 담은 에러. tools.ts가 { fallback } 필드로 직렬화한다. */
export class BrokerFallbackError extends Error {
	fallback: ToolFallback;
	constructor(message: string, fallback: ToolFallback) {
		super(message);
		this.name = "BrokerFallbackError";
		this.fallback = fallback;
	}
}

/**
 * 등록된 툴 이름에서 `*_{func}` 후보를 고른다 (prefix_name 규칙 활용).
 * broker_*(자기 자신)와 kis_*(같은 소스라 함께 실패)는 제외.
 * 예: func="price" → ["finnhub_price", "toss_price", "twelve_price", ...]
 */
export function suggestFallbackTools(names: string[], func: string): string[] {
	return [...new Set(names)]
		.filter(
			(name) =>
				name.endsWith(`_${func}`) &&
				!name.startsWith("broker_") &&
				!name.startsWith("kis_"),
		)
		.sort();
}

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

/**
 * 현재가 조회 — KIS 우선 (해외는 NAS→NYS→AMS 순 자동 재시도).
 * KIS 불가(키 미등록·데이터 없음·API 실패) 시 toss_price 툴 콜을 지시하는
 * BrokerFallbackError를 던진다 — 에이전트가 fallback 지시대로 이어서 호출.
 */
export async function getPrice(symbol: string, opts: BrokerPriceOptions = {}): Promise<BrokerPrice> {
	if (opts.prefer === "toss") {
		throw new BrokerFallbackError(
			`broker_price는 KIS 전용입니다 — toss 우선이면 toss_price 툴을 직접 호출하세요.${TOSS_HINT}`,
			{ func: "price", args: { symbols: symbol }, why: "broker_price는 KIS 전용 — *_price 툴(toss_price 등)을 직접 호출" },
		);
	}
	if (!keysRegistered("kis")) {
		throw new BrokerFallbackError(
			`KIS 키 미등록 — /kis-key로 등록하세요.${TOSS_HINT}`,
			{ func: "price", args: { symbols: symbol }, why: "KIS 키 미등록 — *_price 툴로 재시도" },
		);
	}

	try {
		let q: { price: string; currency?: string } | null = null;
		let raw: Record<string, unknown> | undefined;
		let last: unknown;
		if (isDomesticSymbol(symbol)) {
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
		throw last instanceof Error ? last : new Error(`KIS 현재가 데이터 없음 (${symbol})`);
	} catch (e) {
		const msg = e instanceof Error ? e.message : `현재가 조회 실패 (${symbol})`;
		throw new BrokerFallbackError(
			`${msg}${TOSS_HINT}`,
			{ func: "price", args: { symbols: symbol }, why: "KIS 데이터 없음/실패 — *_price 툴(toss_price/twelve_price/finnhub_price 등)로 재시도" },
		);
	}
}

// ── 차트 (KIS 우선) ───────────────────────────────────────────────────────

export type BrokerCandlePeriod = "D" | "W" | "M" | "1d" | "1m";

export interface BrokerCandlesOptions {
	period?: BrokerCandlePeriod;
	/** 조회 봉 수 (KIS는 미사용 — toss_chart 폴백 지시에 그대로 전달). */
	count?: number;
	prefer?: BrokerId;
	env?: EnvArg;
}

/**
 * 차트 조회 — KIS 우선.
 *  - D/W/M/1d: KIS 일·주·월봉, 실패 시 toss_chart(1d) 툴 콜 지시
 *  - 1m: KIS 미지원 → toss_chart(1m) 툴 콜 지시
 *  - W/M 폴백은 toss 미지원(일봉만)이므로 why에 명시 — 에이전트가 1d로 조정 가능
 */
export async function getCandles(symbol: string, opts: BrokerCandlesOptions = {}): Promise<BrokerCandles> {
	const period = opts.period ?? "D";
	if (opts.prefer === "toss") {
		throw new BrokerFallbackError(
			`broker_chart는 KIS 전용입니다 — toss 우선이면 toss_chart 툴을 직접 호출하세요.${TOSS_HINT}`,
			{
				func: "chart",
				args: { symbol, interval: period === "1m" ? "1m" : "1d", ...(opts.count ? { count: opts.count } : {}) },
				why: "broker_chart는 KIS 전용 — *_chart 툴(toss_chart 등)을 직접 호출",
			},
		);
	}

	// 1m: Toss 전용 (KIS 분봉은 미구현)
	if (period === "1m") {
		throw new BrokerFallbackError(
			`1분봉은 KIS 미지원${TOSS_HINT}`,
			{
				func: "chart",
				args: { symbol, interval: "1m", ...(opts.count ? { count: opts.count } : {}) },
				why: "KIS는 분봉 미지원 — *_chart 툴로 1m 조회 (toss_chart 등)",
			},
		);
	}

	try {
		const bars = isDomesticSymbol(symbol)
			? await kisDomesticCandles(symbol, period === "D" || period === "1d" ? "D" : period, opts.env)
			: await kisOverseasCandles(symbol, period === "D" || period === "1d" ? "D" : period, opts.env);
		if (bars.length === 0) throw new Error(`KIS 차트 데이터 없음 (${symbol}, ${period})`);
		return { broker: "kis", period, bars, source: "primary" };
	} catch (e) {
		const msg = e instanceof Error ? e.message : `차트 조회 실패 (${symbol})`;
		const wmNote =
			period === "W" || period === "M"
				? " (참고: toss는 주봉/월봉 미지원 — 일봉이면 interval: \"1d\"로 조회)"
				: "";
		throw new BrokerFallbackError(
			`${msg}${TOSS_HINT}${wmNote}`,
			{
				func: "chart",
				args: {
					symbol,
					interval: "1d",
					...(opts.count ? { count: opts.count } : {}),
				},
				why: `KIS 차트 데이터 없음/실패 — *_chart 툴(toss_chart/twelve_chart 등)로 재시도${wmNote}`,
			},
		);
	}
}
