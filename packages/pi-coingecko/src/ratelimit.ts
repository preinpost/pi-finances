/**
 * src/ratelimit.ts — CoinGecko API 레이트 리밋 (스로틀).
 *
 * CoinGecko 무료 플랜은 ~5~15 req/min (공개 API), Demo 키는 ~5~30 req/min —
 * 기본 간격 5000ms (12 req/min)로 모든 호출을 직렬화한다.
 *
 * 동작: pi-toss와 동일한 promise 체인(tail) 패턴 —
 * "호출 시작 시각" 기준 최소 간격, 병렬 호출자 직렬화, fn 실패와 무관하게 간격 유지.
 *
 * 환경변수:
 *  - COINGECKO_RATE_LIMIT_MULTIPLIER: 기본 간격 배율 (기본 1.0).
 *    2.0이면 간격 2배, 0이면 스로틀 해제. KIS(KIS_RATE_LIMIT_MS)/TOSS와 분리.
 */

/** CoinGecko 그룹 → 기본 최소 간격(ms). (무료 플랜 5~15 req/min → 5000ms = 12/min) */
export const COINGECKO_GROUP_INTERVALS_MS: Record<string, number> = {
	DEFAULT: 5000,
};

interface GroupState {
	tail: Promise<void>;
	lastStartAt: number;
}

const states = new Map<string, GroupState>();

/** 배율 적용 최종 간격(ms). 0이면 스로틀 해제. */
export function groupIntervalMs(group: string): number {
	const base = COINGECKO_GROUP_INTERVALS_MS[group] ?? 5000;
	const raw = process.env.COINGECKO_RATE_LIMIT_MULTIPLIER;
	const mult = raw !== undefined && raw.trim() !== "" ? Number(raw) : 1;
	if (!Number.isFinite(mult) || mult <= 0) return 0; // 0/음수 → 해제
	return Math.round(base * mult);
}

/** 스로틀 상태 초기화 (테스트/동적 설정용). */
export function resetGroupRateLimit(): void {
	states.clear();
}

function stateFor(group: string): GroupState {
	let st = states.get(group);
	if (!st) {
		st = { tail: Promise.resolve(), lastStartAt: 0 };
		states.set(group, st);
	}
	return st;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 그룹별 최소 간격을 지켜 fn을 실행한다.
 * - 간격 0(해제)이면 fn을 그대로 실행 (tail 직렬화는 유지).
 * - 타임스탬프는 fn 실행 직전에 갱신 — fn 실패와 무관하게 간격 유지.
 */
export async function withGroupRateLimit<T>(group: string, fn: () => Promise<T>): Promise<T> {
	const interval = groupIntervalMs(group);
	const st = stateFor(group);

	const run = st.tail.then(async () => {
		if (interval <= 0) return;
		const now = Date.now();
		const wait = st.lastStartAt + interval - now;
		if (wait > 0) await sleep(wait);
	});
	st.tail = run.catch(() => {});

	await run;
	st.lastStartAt = Date.now();
	return fn();
}
