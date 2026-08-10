/**
 * src/roles/derivatives.ts — 해외 선물/옵션 파이프라인 (KIS overseas_futureoption).
 *
 * 해외옵션은 국내와 달리 월물 전광판 API가 없어 **종목코드(SRS_CD)** 단위로 조회한다.
 *   - 선물: "ESU24", "CNHU24", "6EU24" 등 (제품코드 + 월코드 + 연도 2자리)
 *   - 옵션: "OESU24 C5500" = O + 기초선물코드 + [C|P] + 행사가
 *
 * 해외옵션 현재가에는 그릭스가 없어, 옵션 시장가 + 기초선물가 + 행사가 + 만기 + 무위험금리로
 * Black-Scholes 그릭스(greeks.ts)를 계산한다. 만기는 상품기본정보의 expr_date 우선,
 * 없으면 셋째 금요일 근사.
 *
 * ⚠️ CME/SGX 등 해외 파생 시세는 **유료 구독** 필요할 수 있다 (빈 응답 = 구독 미가입 가능성).
 * ⚠️ 선물/옵션은 레버리지 상품 — 조회는 안전하지만 주문은 별도 안전 점검 필요.
 */
import type { CallResult } from "../client.ts";
import { callApi } from "../client.ts";
import type { EnvArg } from "../auth.ts";
import { optionGreeks, type OptionGreeksResult as GreeksResult } from "./greeks.ts";

/** KIS 해외 선물 월코드 → 월 (F=1월 ... Z=12월). */
const MONTH_CODES: Record<string, number> = {
	F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12,
};

export interface ParsedOptionCode {
	/** 기초선물 종목코드 (예: ESU24). */
	underlyingFuture: string;
	side: "call" | "put";
	strike: string;
}

export interface ParsedFutureCode {
	product: string;
	expiry: { monthCode: string; year: number };
}

/** "OESU24 C5500" → { underlyingFuture: "ESU24", side: "call", strike: "5500" }. 형식 불일치 시 null. */
export function parseOverseasOptionCode(code: string): ParsedOptionCode | null {
	const m = /^O([A-Z0-9]+)\s*([CP])(.+)$/i.exec(code.trim());
	if (!m) return null;
	return {
		underlyingFuture: m[1].toUpperCase(),
		side: m[2].toUpperCase() === "P" ? "put" : "call",
		strike: m[3].trim(),
	};
}

/** "ESU24" → { product: "ES", expiry: { monthCode: "U", year: 2024 } }. 형식 불일치 시 null. */
export function parseOverseasFutureCode(code: string): ParsedFutureCode | null {
	// 그리디: 월문자는 문자열 끝(2자리 연도) 직전에 고정되므로, 마지막 [월문자]+2자리로 분해하면
	// 제품코드에 숫자(6E)·월문자(CLF)가 있어도 안전하다.
	const m = /^(.+)([FGHJKMNQUVXZ])(\d{2})$/i.exec(code.trim());
	if (!m) return null;
	const month = MONTH_CODES[m[2].toUpperCase()];
	if (month === undefined) return null;
	return { product: m[1].toUpperCase(), expiry: { monthCode: m[2].toUpperCase(), year: 2000 + parseInt(m[3], 10) } };
}

/** 로컬 시간 기준 YYYY-MM-DD (toISOString은 UTC로 하루 밀릴 수 있어 사용 금지). */
function formatLocalDate(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 해당 월의 셋째 금요일 (CME 지수선물 만기 관례 근사). 파싱 실패 시 null. */
export function estimateExpiryDate(futureCode: string): Date | null {
	const parsed = parseOverseasFutureCode(futureCode);
	if (!parsed) return null;
	const { year } = parsed.expiry;
	const month = MONTH_CODES[parsed.expiry.monthCode];
	if (month === undefined) return null;
	// 첫 금요일(1~7일) + 14일 = 셋째 금요일
	const first = new Date(year, month - 1, 1);
	const day = first.getDay(); // 0=일
	const offset = (5 - day + 7) % 7; // 첫 금요일까지
	return new Date(year, month - 1, 1 + offset + 14);
}

// ── 시세 (SRS_CD 단위) ──────────────────────────────────────────────────────

/** 해외선물종목현재가 (v1_해외선물-009, HHDFC55010000). */
export function getFuturePrice(code: string, env?: EnvArg): Promise<CallResult> {
	return callApi("overseas_futureoption.v1_해외선물-009", { SRS_CD: code }, { env: env ?? "auto" });
}

/** 해외옵션종목현재가 (해외선물-035, HHDFO55010000). */
export function getOptionPrice(code: string, env?: EnvArg): Promise<CallResult> {
	return callApi("overseas_futureoption.해외선물-035", { SRS_CD: code }, { env: env ?? "auto" });
}

/** 해외옵션 호가 (해외선물-033, HHDFO86000000). */
export function getOptionQuote(code: string, env?: EnvArg): Promise<CallResult> {
	return callApi("overseas_futureoption.해외선물-033", { SRS_CD: code }, { env: env ?? "auto" });
}

// ── 상품정보 ────────────────────────────────────────────────────────────────

/** 해외선물 상품기본정보 (해외선물-023, HHDFC55200000) — 최대 32개. */
export function getFutureProductInfo(codes: string[], env?: EnvArg): Promise<CallResult> {
	const list = codes.slice(0, 32);
	const params: Record<string, string> = { QRY_CNT: String(list.length) };
	list.forEach((c, i) => {
		params[`SRS_CD_${String(i + 1).padStart(2, "0")}`] = c;
	});
	return callApi("overseas_futureoption.해외선물-023", params, { env: env ?? "auto" });
}

/** 해외옵션 상품기본정보 (해외선물-041, HHDFO55200000) — 최대 30개. 응답에 expr_date(만기일) 포함. */
export function getOptionProductInfo(codes: string[], env?: EnvArg): Promise<CallResult> {
	const list = codes.slice(0, 30);
	const params: Record<string, string> = { QRY_CNT: String(list.length) };
	list.forEach((c, i) => {
		params[`SRS_CD_${String(i + 1).padStart(2, "0")}`] = c;
	});
	return callApi("overseas_futureoption.해외선물-041", params, { env: env ?? "auto" });
}

/** 상품기본정보 응답에서 expr_date(만기일, YYYYMMDD) 추출 — top-level 또는 output2[0]. */
export function extractExprDate(result: CallResult): string | null {
	const data = result.data;
	const direct = data.expr_date;
	if (typeof direct === "string" && direct.trim() && /^\d{8}$/.test(direct.trim())) return direct.trim();
	if (Array.isArray(data.output2)) {
		for (const row of data.output2) {
			if (row && typeof row === "object") {
				const v = (row as Record<string, unknown>).expr_date;
				if (typeof v === "string" && /^\d{8}$/.test(v.trim())) return v.trim();
			}
		}
	}
	return null;
}

/** 상품기본정보 응답에서 disp_digit(표시 소수점 자리수) 추출 — top-level 또는 output2[0]. */
export function extractDispDigit(result: CallResult): number | undefined {
	const data = result.data;
	const direct = data.disp_digit;
	if (typeof direct === "string" && direct.trim() && Number.isFinite(Number(direct.trim()))) return Number(direct.trim());
	if (Array.isArray(data.output2)) {
		for (const row of data.output2) {
			if (row && typeof row === "object") {
				const v = (row as Record<string, unknown>).disp_digit;
				if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.trim()))) return Number(v.trim());
			}
		}
	}
	return undefined;
}

/**
 * KIS 해외 파생 시세 스케일 적용 — sCalcDesz(계산 소수점)만큼 나눠 해석해야 정확하다
 * (공식 스펙: 6A sCalcDesz -4 → 6882.5 = 0.68825, disp_digit=4). disp_digit 없으면 raw 유지 + 경고.
 */
function applyDispDigit(raw: number, dispDigit: number | undefined, what: string, notes: string[]): number {
	if (dispDigit === undefined || !Number.isFinite(dispDigit) || dispDigit <= 0) {
		notes.push(`${what}: disp_digit 없음 — raw 값 사용 (스케일 미적용)`);
		return raw;
	}
	notes.push(`${what}: disp_digit ${dispDigit} 적용 (${raw} → ${raw / 10 ** dispDigit})`);
	return raw / 10 ** dispDigit;
}

// ── 차트 / 장운영시간 ───────────────────────────────────────────────────────

export interface OptionChartOptions {
	/** 거래소 코드 (예: CME). 필수. */
	exchange: string;
	/** 분봉 간격 — 1=1분봉(기본), 5=5분봉 ... */
	gap?: number;
	/** 조회 봉 수 (기본 120, 최대 120). */
	count?: number;
}

/** 해외옵션 분봉조회 (해외선물-040, HHDFO55020400). */
export function getOptionChart(code: string, opts: OptionChartOptions, env?: EnvArg): Promise<CallResult> {
	return callApi(
		"overseas_futureoption.해외선물-040",
		{
			SRS_CD: code,
			EXCH_CD: opts.exchange,
			START_DATE_TIME: "",
			CLOSE_DATE_TIME: "",
			QRY_TP: "Q",
			QRY_CNT: String(Math.min(120, Math.max(1, opts.count ?? 120))),
			QRY_GAP: String(opts.gap ?? 1),
			INDEX_KEY: "",
		},
		{ env: env ?? "auto" },
	);
}

export interface DerivativesMarketTimeOptions {
	/** 거래소 — CME(기본)/EUREX/HKEx/ICE/SGX/OSE ... */
	exchange?: string;
	/** true면 옵션(OPT_YN=Y), false면 전체(%) */
	optionOnly?: boolean;
}

/** 해외선물옵션 장운영시간 (해외선물-030, OTFM2229R). */
export function getDerivativesMarketTime(opts?: DerivativesMarketTimeOptions, env?: EnvArg): Promise<CallResult> {
	return callApi(
		"overseas_futureoption.해외선물-030",
		{
			FM_PDGR_CD: "",
			FM_CLAS_CD: "",
			FM_EXCG_CD: opts?.exchange ?? "CME",
			OPT_YN: opts?.optionOnly ? "Y" : "%",
			CTX_AREA_NK200: "",
			CTX_AREA_FK200: "",
		},
		{ env: env ?? "auto" },
	);
}

// ── 가격 추출 / 그릭스 ──────────────────────────────────────────────────────

export interface FuopPrice {
	last?: string;
	bid?: string;
	ask?: string;
	sttl?: string;
}

/** 현재가 응답(data 최상위)에서 last_price/bid_price/ask_price/sttl_price 추출 (빈 값 제외). */
export function extractFuopPrice(result: CallResult): FuopPrice {
	const d = result.data as Record<string, unknown>;
	const clean = (v: unknown): string | undefined => {
		if (typeof v !== "string") return undefined;
		const t = v.trim();
		return t === "" ? undefined : t;
	};
	return {
		last: clean(d.last_price),
		bid: clean(d.bid_price),
		ask: clean(d.ask_price),
		sttl: clean(d.sttl_price),
	};
}

export interface OptionGreeksOptions {
	/** 무위험금리(연 %) — 기본 4.0 (가정값, 결과에 명시). */
	riskFreeRatePct?: number;
	env?: EnvArg;
}

export interface OptionGreeksResult {
	code: string;
	parsed: ParsedOptionCode;
	underlying: string;
	S: number;
	K: number;
	/** 연 단위 만기까지 (T = 일수/365). */
	T: number;
	/** 무위험금리 (연, 소수 — 예: 0.04). */
	r: number;
	expiry: { date: string; source: "product-info" | "estimate" };
	greeks: GreeksResult;
	/** 옵션 시장가 (그릭스 입력으로 사용). */
	marketPrice: number;
	/** 가정/데이터 출처 표기용. */
	notes: string[];
}

function toNumber(v: string | undefined, label: string): number | null {
	if (v === undefined) return null;
	const n = Number(v.replace(/,/g, ""));
	if (!Number.isFinite(n)) return null;
	return n;
}

/**
 * 해외옵션 그릭스 파이프라인:
 * 옵션 현재가 → (기초선물 현재가 + 행사가 + 만기 + 무위험금리) → IV 역산 → BS 그릭스.
 *
 * 만기: 상품기본정보(해외선물-041)의 expr_date 우선, 실패 시 셋째 금요일 근사.
 */
export async function getOptionGreeks(code: string, opts?: OptionGreeksOptions): Promise<OptionGreeksResult> {
	const parsed = parseOverseasOptionCode(code);
	if (!parsed) {
		throw new Error(`옵션 종목코드 형식 오류: "${code}" — 예: "OESU24 C5500" (O + 기초선물코드 + C/P + 행사가)`);
	}

	const notes: string[] = [];

	// 0) 상품기본정보: disp_digit(소수점 스케일) + expr_date(만기일) — 스케일은 가격 해석에 필수
	let dispDigitOpt: number | undefined;
	let expiryDate: Date | null = null;
	let source: "product-info" | "estimate" = "estimate";
	try {
		const info = await getOptionProductInfo([code], opts?.env);
		dispDigitOpt = extractDispDigit(info);
		const expr = extractExprDate(info);
		if (expr) {
			const d = new Date(Number(expr.slice(0, 4)), Number(expr.slice(4, 6)) - 1, Number(expr.slice(6, 8)));
			if (!Number.isNaN(d.getTime())) {
				expiryDate = d;
				source = "product-info";
			}
		}
	} catch {
		/* 상품정보 조회 실패 → 근사값/raw로 폴백 */
	}

	// 1) 옵션 시장가 (disp_digit 스케일 적용 — KIS 해외 파생 시세는 sCalcDesz만큼 나눠 해석해야 정확)
	const optRes = await getOptionPrice(code, opts?.env);
	const optP = extractFuopPrice(optRes);
	const last = toNumber(optP.last, "last");
	const bid = toNumber(optP.bid, "bid");
	const ask = toNumber(optP.ask, "ask");
	const rawMarket = last ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null);
	if (rawMarket === null) {
		throw new Error(`해외옵션 시세 없음 (${code}) — 유료 시세 구독 미가입이거나 종목코드 오류일 수 있습니다.`);
	}
	if (last === null && bid !== null && ask !== null) {
		notes.push("옵션가 = (매수+매도)/2 중간가 사용 (체결가 없음)");
	}
	const marketPrice = applyDispDigit(rawMarket, dispDigitOpt, "옵션가", notes);

	// 2) 기초선물 현재가 (S) — 선물 상품정보의 disp_digit 스케일 적용
	let S: number | null = null;
	let dispDigitFut: number | undefined;
	try {
		const finfo = await getFutureProductInfo([parsed.underlyingFuture], opts?.env);
		dispDigitFut = extractDispDigit(finfo);
	} catch {
		/* 상품정보 실패 → 스케일 미적용 */
	}
	const rawS = toNumber(extractFuopPrice(await getFuturePrice(parsed.underlyingFuture, opts?.env)).last, "underlying");
	if (rawS !== null) S = applyDispDigit(rawS, dispDigitFut, "기초선물가", notes);
	if (S === null) {
		throw new Error(`기초선물 시세 없음 (${parsed.underlyingFuture}) — 유료 시세 구독 미가입이거나 코드 오류일 수 있습니다.`);
	}

	// 3) 행사가 (K)
	const K = toNumber(parsed.strike, "strike");
	if (K === null) {
		throw new Error(`행사가 파싱 실패: "${parsed.strike}"`);
	}

	// 4) 만기 폴백: 상품기본정보 expr_date 없으면 셋째 금요일 근사
	if (!expiryDate) {
		expiryDate = estimateExpiryDate(parsed.underlyingFuture);
		if (expiryDate) notes.push("만기 = 기초선물 월코드 기준 셋째 금요일 근사 (상품기본정보 expr_date 확인 권장)");
	}
	if (!expiryDate) {
		throw new Error(`만기 계산 불가: "${parsed.underlyingFuture}" — 종목코드 확인 필요`);
	}

	// 5) T (연 단위)
	const now = new Date();
	const days = (expiryDate.getTime() - now.getTime()) / 86_400_000;
	if (days <= 0) {
		throw new Error(`만기 지남: ${code} (만기 ${formatLocalDate(expiryDate)})`);
	}
	const T = days / 365;

	// 6) 무위험금리 (가정)
	const rPct = opts?.riskFreeRatePct ?? 4.0;
	const r = rPct / 100;
	notes.push(`무위험금리 ${rPct}% 가정`);

	// 7) 그릭스 (IV 역산)
	const g = optionGreeks(parsed.side, S, K, T, r, { marketPrice });

	return {
		code,
		parsed,
		underlying: parsed.underlyingFuture,
		S,
		K,
		T,
		r,
		expiry: { date: formatLocalDate(expiryDate), source },
		greeks: {
			sigma: g.sigma,
			price: g.price,
			delta: g.delta,
			gamma: g.gamma,
			theta: g.theta,
			vega: g.vega,
			rho: g.rho,
			thetaPerDay: g.thetaPerDay,
		},
		marketPrice,
		notes,
	};
}

export type { OptionGreeksResult as FuopGreeksResult } from "./greeks.ts";
