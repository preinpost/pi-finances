/**
 * src/roles/indicators.ts — 기술적 지표 계산 (순수 함수, 네트워크·상태 없음).
 *
 * 차트 OHLCV 데이터(Bar[])를 받아 이동평균/RSI/ATR/볼린저/지지저항/추세를
 * 결정적으로 계산한다. 매수/매도 결론은 내리지 않는다 — 결론은
 * skills/timing 스킬 지침 + 모델 추론이 담당하고, 이 모듈은 계산만 제공한다.
 */

export interface Bar {
	date: string; // YYYYMMDD
	open: number;
	high: number;
	low: number;
	close: number;
	volume?: number;
}

// ── 차트 응답 → Bar[] 정규화 ──────────────────────────────────────────────

function toNum(v: unknown): number | null {
	if (v === undefined || v === null) return null;
	const s = String(v).replace(/,/g, "").trim();
	if (s === "") return null; // 빈 문자열 → null (0가격 왜곡 방지)
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

function buildBar(date: unknown, o: unknown, h: unknown, l: unknown, c: unknown, v?: unknown): Bar | null {
	const d = String(date ?? "").trim();
	const open = toNum(o);
	const high = toNum(h);
	const low = toNum(l);
	const close = toNum(c);
	if (!d || open === null || high === null || low === null || close === null) return null;
	const volume = toNum(v) ?? undefined;
	return { date: d, open, high, low, close, volume };
}

/**
 * 국내 기간별시세(v1_국내주식-016, FHKST03010100) output1 행 → Bar[] (날짜 오름차순).
 * 필드: stck_bsop_date/stck_oprc/stck_hgpr/stck_lwpr/stck_clpr/acml_vol.
 */
export function normalizeDomesticChart(output1: Record<string, unknown>[]): Bar[] {
	const rows = Array.isArray(output1) ? output1 : [];
	const bars: Bar[] = [];
	for (const r of rows) {
		const b = buildBar(r.stck_bsop_date, r.stck_oprc, r.stck_hgpr, r.stck_lwpr, r.stck_clpr, r.acml_vol);
		if (b) bars.push(b);
	}
	bars.sort((a, b) => a.date.localeCompare(b.date));
	return bars;
}

/**
 * 해외 기간별시세(v1_해외주식-010, HHDFS76240000) 행 → Bar[] (날짜 오름차순).
 * 필드: xymd/open/high/low/clos/tvol (KIS 실응답 — clos, tvol). 구버전 close/vol도 허용.
 */
export function normalizeOverseasChart(rows: Record<string, unknown>[]): Bar[] {
	const bars: Bar[] = [];
	for (const r of rows) {
		const b = buildBar(r.xymd, r.open, r.high, r.low, r.clos ?? r.close, r.tvol ?? r.vol);
		if (b) bars.push(b);
	}
	bars.sort((a, b) => a.date.localeCompare(b.date));
	return bars;
}

// ── 지표 ──────────────────────────────────────────────────────────────────

/** 단순 이동평균 — period 미만 구간은 null. */
export function sma(values: number[], period: number): (number | null)[] {
	const out: (number | null)[] = new Array(values.length).fill(null);
	if (period <= 0 || values.length === 0) return out;
	let sum = 0;
	for (let i = 0; i < values.length; i++) {
		sum += values[i];
		if (i >= period) sum -= values[i - period];
		if (i >= period - 1) out[i] = sum / period;
	}
	return out;
}

/** 지수 이동평균 — 첫 값은 단순평균(period개) 시드, 이후 EMA = prev + k*(val-prev), k=2/(period+1). */
export function ema(values: number[], period: number): number[] {
	const out: number[] = [];
	if (period <= 0 || values.length === 0) return out;
	const k = 2 / (period + 1);
	const seedLen = Math.min(period, values.length);
	let seed = 0;
	for (let i = 0; i < seedLen; i++) seed += values[i];
	seed /= seedLen;
	let prev = seed;
	out.push(prev);
	for (let i = 1; i < values.length; i++) {
		prev = prev + k * (values[i] - prev);
		out.push(prev);
	}
	return out;
}

/**
 * RSI — Wilder 평활. 첫 평균 손익은 단순 평균, 이후 Wilder 갱신.
 * 상승만 있으면 100, 하락만이면 0, 완전 보합이면 50.
 */
export function rsi(closes: number[], period = 14): (number | null)[] {
	const out: (number | null)[] = new Array(closes.length).fill(null);
	if (closes.length <= period) return out; // 변화량 계산에 period+1개 필요
	let gain = 0;
	let loss = 0;
	for (let i = 1; i <= period; i++) {
		const diff = closes[i] - closes[i - 1];
		if (diff >= 0) gain += diff;
		else loss += -diff;
	}
	let avgGain = gain / period;
	let avgLoss = loss / period;
	const rsiAt = (g: number, l: number): number => {
		if (g === 0 && l === 0) return 50;
		if (l === 0) return 100;
		return 100 - 100 / (1 + g / l);
	};
	out[period] = rsiAt(avgGain, avgLoss);
	for (let i = period + 1; i < closes.length; i++) {
		const diff = closes[i] - closes[i - 1];
		const g = diff > 0 ? diff : 0;
		const l = diff < 0 ? -diff : 0;
		avgGain = (avgGain * (period - 1) + g) / period;
		avgLoss = (avgLoss * (period - 1) + l) / period;
		out[i] = rsiAt(avgGain, avgLoss);
	}
	return out;
}

/**
 * ATR — Wilder 평활. TR = max(H-L, |H-prevC|, |L-prevC|), 첫 ATR은 단순 평균.
 */
export function atr(bars: Bar[], period = 14): (number | null)[] {
	const out: (number | null)[] = new Array(bars.length).fill(null);
	if (bars.length <= period) return out;
	const trs: number[] = [];
	for (let i = 0; i < bars.length; i++) {
		if (i === 0) {
			trs.push(bars[i].high - bars[i].low);
		} else {
			const prevC = bars[i - 1].close;
			trs.push(
				Math.max(
					bars[i].high - bars[i].low,
					Math.abs(bars[i].high - prevC),
					Math.abs(bars[i].low - prevC),
				),
			);
		}
	}
	let prev = 0;
	for (let i = 0; i < period; i++) prev += trs[i];
	prev /= period;
	out[period - 1] = prev;
	for (let i = period; i < bars.length; i++) {
		prev = (prev * (period - 1) + trs[i]) / period;
		out[i] = prev;
	}
	return out;
}

/** 볼린저 밴드 — 중단 SMA(period), 상/하단 ± mult×모집단표준편차. */
export function bollinger(
	closes: number[],
	period = 20,
	mult = 2,
): { mid: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
	const mid = sma(closes, period);
	const upper: (number | null)[] = new Array(closes.length).fill(null);
	const lower: (number | null)[] = new Array(closes.length).fill(null);
	for (let i = period - 1; i < closes.length; i++) {
		const m = mid[i];
		if (m === null) continue;
		let variance = 0;
		for (let j = i - period + 1; j <= i; j++) {
			const d = closes[j] - m;
			variance += d * d;
		}
		const sd = Math.sqrt(variance / period);
		upper[i] = m + mult * sd;
		lower[i] = m - mult * sd;
	}
	return { mid, upper, lower };
}

/** 지지/저항 — 최근 lookback(기본 20)봉의 저점 최소 / 고점 최대. */
export function supportResistance(bars: Bar[], lookback = 20): { support: number | null; resistance: number | null } {
	if (bars.length === 0) return { support: null, resistance: null };
	const n = Math.min(lookback, bars.length);
	let support = Infinity;
	let resistance = -Infinity;
	for (let i = bars.length - n; i < bars.length; i++) {
		if (bars[i].low < support) support = bars[i].low;
		if (bars[i].high > resistance) resistance = bars[i].high;
	}
	return {
		support: Number.isFinite(support) ? support : null,
		resistance: Number.isFinite(resistance) ? resistance : null,
	};
}

/**
 * 추세 판별: MA5>MA20>MA60 정배열=상승, 역배열=하락, 그 외 횡보.
 * 데이터가 60봉 미만이면 가용한 MA(5/20) 쌍으로 판단, 5봉 미만이면 횡보.
 */
export function trend(bars: Bar[]): "상승" | "하락" | "횡보" {
	if (bars.length === 0) return "횡보";
	const closes = bars.map((b) => b.close);
	const last = closes.length - 1;
	const ma5 = sma(closes, Math.min(5, closes.length))[last];
	const ma20 = sma(closes, Math.min(20, closes.length))[last];
	const ma60 = sma(closes, 60)[last]; // 고정 period — n<60이면 null → 아래 MA5/MA20 쌍 분기
	if (ma5 === null || ma20 === null) return "횡보";
	if (ma60 === null) {
		// 60봉 미만 — MA5/MA20 쌍으로 판단
		return ma5 > ma20 ? "상승" : ma5 < ma20 ? "하락" : "횡보";
	}
	if (ma5 > ma20 && ma20 > ma60) return "상승";
	if (ma5 < ma20 && ma20 < ma60) return "하락";
	return "횡보";
}

// ── 종합 분석 ─────────────────────────────────────────────────────────────

export interface IndicatorResult {
	bars: number;
	last: { date: string; close: number };
	ma: { ma5: number | null; ma20: number | null; ma60: number | null };
	rsi14: number | null;
	atr14: number | null;
	bollinger: { upper: number | null; mid: number | null; lower: number | null };
	support: number | null;
	resistance: number | null;
	trend: "상승" | "하락" | "횡보";
	signals: string[];
}

/** 지표 종합 — 계산만 하며 판단(매수/매도/관망)은 하지 않는다. */
export function analyze(bars: Bar[]): IndicatorResult {
	const n = bars.length;
	const lastIdx = n - 1;
	const closes = bars.map((b) => b.close);
	const last = n > 0 ? { date: bars[lastIdx].date, close: closes[lastIdx] } : { date: "", close: 0 };

	const ma5 = sma(closes, 5)[lastIdx] ?? null;
	const ma20 = sma(closes, 20)[lastIdx] ?? null;
	const ma60 = sma(closes, 60)[lastIdx] ?? null;
	const rsi14 = rsi(closes, 14)[lastIdx] ?? null;
	const atr14 = atr(bars, 14)[lastIdx] ?? null;
	const bb = bollinger(closes, 20, 2);
	const sr = supportResistance(bars, 20);
	const tr = trend(bars);

	const signals: string[] = [];
	if (n >= 5) {
		const close = closes[lastIdx];
		if (ma5 !== null && ma20 !== null) {
			signals.push(ma5 > ma20 ? "골든크로스(MA5>MA20)" : "데드크로스(MA5<MA20)");
		}
		if (rsi14 !== null) {
			if (rsi14 > 70) signals.push("RSI 과매수(>70)");
			else if (rsi14 < 30) signals.push("RSI 과매도(<30)");
		}
		if (sr.resistance !== null && close >= sr.resistance) signals.push("저항선 근접/돌파");
		if (sr.support !== null && close <= sr.support) signals.push("지지선 근접/이탈");
		const up = bb.upper[lastIdx];
		const low = bb.lower[lastIdx];
		if (up !== null && close >= up) signals.push("볼린저 상단 터치");
		if (low !== null && close <= low) signals.push("볼린저 하단 터치");
	}

	return {
		bars: n,
		last,
		ma: { ma5, ma20, ma60 },
		rsi14,
		atr14,
		bollinger: { upper: bb.upper[lastIdx] ?? null, mid: bb.mid[lastIdx] ?? null, lower: bb.lower[lastIdx] ?? null },
		support: sr.support,
		resistance: sr.resistance,
		trend: tr,
		signals,
	};
}
