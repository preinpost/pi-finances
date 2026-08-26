import type { UIChartBar } from "../../shared/protocol";

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  const at = (g: number, l: number) => (g === 0 && l === 0 ? 50 : l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[period] = at(avgG, avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = at(avgG, avgL);
  }
  return out;
}

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
    if (m == null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - m) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

function donchian(bars: UIChartBar[], period: number, i: number): number | null {
  if (i < period - 1) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = i - period + 1; j <= i; j++) {
    if (bars[j].high > hi) hi = bars[j].high;
    if (bars[j].low < lo) lo = bars[j].low;
  }
  return (hi + lo) / 2;
}

function nextBusinessDay(yyyymmdd: string): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(y, m - 1, d);
  do {
    dt.setDate(dt.getDate() + 1);
  } while (dt.getDay() === 0 || dt.getDay() === 6);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function shiftBusinessDays(yyyymmdd: string, n: number): string {
  let cur = yyyymmdd;
  for (let i = 0; i < n; i++) cur = nextBusinessDay(cur);
  return cur;
}

export function ichimoku(bars: UIChartBar[], displacement = 26) {
  const n = bars.length;
  const tenkan: (number | null)[] = new Array(n).fill(null);
  const kijun: (number | null)[] = new Array(n).fill(null);
  const spanA: { date: string; value: number }[] = [];
  const spanB: { date: string; value: number }[] = [];
  const chikou: { date: string; value: number }[] = [];

  for (let i = 0; i < n; i++) {
    tenkan[i] = donchian(bars, 9, i);
    kijun[i] = donchian(bars, 26, i);
    const a = tenkan[i];
    const k = kijun[i];
    if (a != null && k != null) {
      const date = i + displacement < n ? bars[i + displacement].date : shiftBusinessDays(bars[n - 1].date, i + displacement - (n - 1));
      spanA.push({ date, value: (a + k) / 2 });
    }
    const b = donchian(bars, 52, i);
    if (b != null) {
      const date = i + displacement < n ? bars[i + displacement].date : shiftBusinessDays(bars[n - 1].date, i + displacement - (n - 1));
      spanB.push({ date, value: b });
    }
    if (i >= displacement) {
      chikou.push({ date: bars[i - displacement].date, value: bars[i].close });
    }
  }

  return { tenkan, kijun, spanA, spanB, chikou };
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function emaOfNullable(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed += v;
      seedCount += 1;
      if (seedCount === period) {
        prev = seed / period;
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const line: (number | null)[] = closes.map((_, i) => {
    const a = fastE[i];
    const b = slowE[i];
    return a == null || b == null ? null : a - b;
  });
  const signal = emaOfNullable(line, signalPeriod);
  const hist: (number | null)[] = line.map((v, i) => {
    const s = signal[i];
    return v == null || s == null ? null : v - s;
  });
  return { macd: line, signal, hist };
}

export function stochastic(bars: UIChartBar[], kPeriod = 14, dPeriod = 3) {
  const k: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    if (i < kPeriod - 1) continue;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].high > hi) hi = bars[j].high;
      if (bars[j].low < lo) lo = bars[j].low;
    }
    const range = hi - lo;
    k[i] = range === 0 ? 50 : ((bars[i].close - lo) / range) * 100;
  }
  const d: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    if (i < dPeriod - 1) continue;
    let sum = 0;
    let ok = true;
    for (let j = i - dPeriod + 1; j <= i; j++) {
      const kv = k[j];
      if (kv == null) {
        ok = false;
        break;
      }
      sum += kv;
    }
    if (ok) d[i] = sum / dPeriod;
  }
  return { k, d };
}

export function atr(bars: UIChartBar[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const trs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) trs.push(bars[i].high - bars[i].low);
    else {
      const prevC = bars[i - 1].close;
      trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prevC), Math.abs(bars[i].low - prevC)));
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

export function drawdown(closes: number[]): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length === 0) return out;
  let peak = closes[0];
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] > peak) peak = closes[i];
    out[i] = peak === 0 ? 0 : (closes[i] - peak) / peak;
  }
  return out;
}

export function adx(bars: UIChartBar[], period = 14) {
  const n = bars.length;
  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);
  const adxLine: (number | null)[] = new Array(n).fill(null);
  if (n <= period * 2) return { adx: adxLine, plusDI, minusDI };

  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < n; i++) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const prevC = bars[i - 1].close;
    tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prevC), Math.abs(bars[i].low - prevC)));
  }

  let smTR = 0;
  let smP = 0;
  let smM = 0;
  for (let i = 1; i <= period; i++) {
    smTR += tr[i];
    smP += plusDM[i];
    smM += minusDM[i];
  }
  const dx: (number | null)[] = new Array(n).fill(null);
  const diAt = (p: number, m: number, t: number) => {
    const pdi = t === 0 ? 0 : (100 * p) / t;
    const mdi = t === 0 ? 0 : (100 * m) / t;
    const den = pdi + mdi;
    return { pdi, mdi, dx: den === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / den };
  };
  let first = diAt(smP, smM, smTR);
  plusDI[period] = first.pdi;
  minusDI[period] = first.mdi;
  dx[period] = first.dx;
  for (let i = period + 1; i < n; i++) {
    smTR = smTR - smTR / period + tr[i];
    smP = smP - smP / period + plusDM[i];
    smM = smM - smM / period + minusDM[i];
    first = diAt(smP, smM, smTR);
    plusDI[i] = first.pdi;
    minusDI[i] = first.mdi;
    dx[i] = first.dx;
  }
  let adxSum = 0;
  for (let i = period; i < period * 2; i++) adxSum += dx[i] ?? 0;
  let prevAdx = adxSum / period;
  adxLine[period * 2 - 1] = prevAdx;
  for (let i = period * 2; i < n; i++) {
    prevAdx = (prevAdx * (period - 1) + (dx[i] ?? 0)) / period;
    adxLine[i] = prevAdx;
  }
  return { adx: adxLine, plusDI, minusDI };
}
