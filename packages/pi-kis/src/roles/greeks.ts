/**
 * src/roles/greeks.ts — 순수 Black-Scholes 옵션 그릭스 (네트워크/상태 없음).
 *
 * 해외옵션 현재가(KIS)에는 그릭스가 없어서 옵션 시장가 + 기초선물가 + 행사가 + 만기 +
 * 무위험금리로 직접 계산한다. IV(내재변동성)는 시장가에서 Newton-Raphson으로 역산하고,
 * 발산 시 이분법으로 폴백한다.
 *
 * 표기:
 *  - T: 연 단위 (일수/365)
 *  - theta: 연 단위 (thetaPerDay = theta/365 제공)
 *  - 무위험금리(r)는 호출자가 결정 (기본 4% 가정 — 사용자/호출부에서 "(가정)" 표기)
 *
 * 공식 (Black-Scholes, 무배당):
 *  d1 = (ln(S/K) + (r + σ²/2)·T) / (σ·√T),  d2 = d1 − σ·√T
 *  call = S·N(d1) − K·e^(−rT)·N(d2) / put = K·e^(−rT)·N(−d2) − S·N(−d1)
 *  delta: call = N(d1), put = N(d1) − 1
 *  gamma = φ(d1) / (S·σ·√T)
 *  vega  = S·φ(d1)·√T
 *  theta(연): call = −S·φ(d1)·σ/(2√T) − r·K·e^(−rT)·N(d2)
 *             put  = −S·φ(d1)·σ/(2√T) + r·K·e^(−rT)·N(−d2)
 *  rho: call = K·T·e^(−rT)·N(d2), put = −K·T·e^(−rT)·N(−d2)
 */

export type OptionSide = "call" | "put";

/** 표준정규분포 PDF — φ(x) = exp(−x²/2)/√(2π). */
export function normPdf(x: number): number {
	return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * 표준정규분포 CDF — N(x) = 0.5·(1 + erf(x/√2)). Abramowitz–Stegun 7.1.26 근사 (오차 < 1.5e-7).
 */
export function normCdf(x: number): number {
	const sign = x < 0 ? -1 : 1;
	const ax = Math.abs(x) / Math.SQRT2; // erf 인자: x/√2
	const t = 1 / (1 + 0.3275911 * ax);
	const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
	const y = 1 - poly * Math.exp(-ax * ax);
	return 0.5 * (1 + sign * y);
}

export interface BlackScholesResult {
	price: number;
	delta: number;
	gamma: number;
	/** 연 단위 세타. */
	theta: number;
	vega: number;
	rho: number;
}

/**
 * Black-Scholes 가격 + 그릭스.
 * @param type "call" | "put"
 * @param S 기초자산(선물) 가격
 * @param K 행사가
 * @param T 만기까지 연 단위 (T>0)
 * @param r 무위험금리 (연, 예: 0.04)
 * @param sigma 변동성 (연, 예: 0.2)
 */
export function blackScholes(type: OptionSide, S: number, K: number, T: number, r: number, sigma: number): BlackScholesResult {
	if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0 || !Number.isFinite(S) || !Number.isFinite(K) || !Number.isFinite(T) || !Number.isFinite(r) || !Number.isFinite(sigma)) {
		throw new Error(`blackScholes: 유효하지 않은 입력 (S=${S}, K=${K}, T=${T}, r=${r}, σ=${sigma})`);
	}
	const sqrtT = Math.sqrt(T);
	const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
	const d2 = d1 - sigma * sqrtT;
	const phi = normPdf(d1);
	const disc = Math.exp(-r * T);

	let price: number;
	let delta: number;
	let theta: number;
	let rho: number;
	if (type === "call") {
		const nd1 = normCdf(d1);
		const nd2 = normCdf(d2);
		price = S * nd1 - K * disc * nd2;
		delta = nd1;
		theta = (-S * phi * sigma) / (2 * sqrtT) - r * K * disc * nd2;
		rho = K * T * disc * nd2;
	} else {
		const nmd1 = normCdf(-d1);
		const nmd2 = normCdf(-d2);
		price = K * disc * nmd2 - S * nmd1;
		delta = normCdf(d1) - 1;
		theta = (-S * phi * sigma) / (2 * sqrtT) + r * K * disc * nmd2;
		rho = -K * T * disc * nmd2;
	}
	const gamma = phi / (S * sigma * sqrtT);
	const vega = S * phi * sqrtT;
	return { price, delta, gamma, theta, vega, rho };
}

export interface ImpliedVolOptions {
	/** Newton-Raphson 초기값 (기본 0.3). */
	guess?: number;
	maxIter?: number;
	/** 시그마 수렴 허용 오차 (기본 1e-6). */
	tol?: number;
}

/**
 * 내재변동성(IV) 역산 — Newton-Raphson, 발산 시 이분법([1e-4, 5.0]) 폴백.
 * 시장가가 σ→0 또는 σ=5.0 범위 밖이면 throw (데이터 오류 가능성).
 */
export function impliedVol(type: OptionSide, marketPrice: number, S: number, K: number, T: number, r: number, opts?: ImpliedVolOptions): number {
	if (marketPrice <= 0 || S <= 0 || K <= 0 || T <= 0) {
		throw new Error(`impliedVol: 유효하지 않은 입력 (price=${marketPrice}, S=${S}, K=${K}, T=${T})`);
	}
	const guess = opts?.guess ?? 0.3;
	const maxIter = opts?.maxIter ?? 100;
	const priceTol = 1e-6; // 가격(절대) 허용 오차
	const sigmaTol = opts?.tol ?? 1e-6;

	// 1) Newton-Raphson
	let sigma = guess;
	for (let i = 0; i < maxIter; i++) {
		if (sigma <= 1e-8 || sigma > 10) break;
		const bs = blackScholes(type, S, K, T, r, sigma);
		const f = bs.price - marketPrice;
		if (Math.abs(f) <= priceTol || Math.abs(f) / Math.max(1, marketPrice) <= 1e-6) return sigma;
		if (bs.vega <= 1e-12) break; // vega 0 → Newton 불가 → 이분법
		const next = sigma - f / bs.vega;
		if (!Number.isFinite(next) || next <= 0) break;
		sigma = next;
	}

	// 2) 이분법 폴백 (옵션 가격은 σ에 대해 단조 증가)
	const LO = 1e-4;
	const HI = 5.0;
	let lo = LO;
	let hi = HI;
	let fLo = blackScholes(type, S, K, T, r, lo).price - marketPrice;
	const fHi = blackScholes(type, S, K, T, r, hi).price - marketPrice;
	if (fLo > 0) {
		throw new Error(`impliedVol: 시장가(${marketPrice})가 σ→0의 최소 도달 가능가보다 낮습니다 — 가격 데이터 오류 가능`);
	}
	if (fHi < 0) {
		throw new Error(`impliedVol: 시장가(${marketPrice})가 σ=5.0의 최대 도달 가능가보다 높습니다`);
	}
	for (let i = 0; i < 200; i++) {
		const mid = (lo + hi) / 2;
		const fMid = blackScholes(type, S, K, T, r, mid).price - marketPrice;
		if (Math.abs(fMid) <= priceTol || hi - lo < 1e-9) return mid;
		if ((fLo < 0) === (fMid < 0)) {
			lo = mid;
			fLo = fMid;
		} else {
			hi = mid;
		}
	}
	const sigmaOut = (lo + hi) / 2;
	if (Math.abs(blackScholes(type, S, K, T, r, sigmaOut).price - marketPrice) > 10 * priceTol && !(sigmaOut > LO && sigmaOut < HI)) {
		throw new Error(`impliedVol: 수렴 실패 — 시장가(${marketPrice})가 옵션 가격 범위 밖일 수 있습니다.`);
	}
	return sigmaOut;
}

export interface OptionGreeksOptions {
	/** IV 직접 지정 (지정 시 marketPrice 무시). */
	sigma?: number;
	/** 옵션 시장가 → IV 역산 후 그릭스 계산. */
	marketPrice?: number;
}

export interface OptionGreeksResult extends BlackScholesResult {
	sigma: number;
	/** 일 단위 세타 (연 세타/365). */
	thetaPerDay: number;
}

/**
 * IV(직접 또는 시장가 역산) 기준 그릭스 종합.
 * sigma 또는 marketPrice 중 하나는 필수.
 */
export function optionGreeks(type: OptionSide, S: number, K: number, T: number, r: number, opts?: OptionGreeksOptions): OptionGreeksResult {
	const sigma = opts?.sigma !== undefined ? opts.sigma : opts?.marketPrice !== undefined ? impliedVol(type, opts.marketPrice, S, K, T, r) : undefined;
	if (sigma === undefined) {
		throw new Error("optionGreeks: sigma 또는 marketPrice 중 하나는 필수입니다.");
	}
	const bs = blackScholes(type, S, K, T, r, sigma);
	return { ...bs, sigma, thetaPerDay: bs.theta / 365 };
}
