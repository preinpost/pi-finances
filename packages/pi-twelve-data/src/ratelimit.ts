/**
 * src/ratelimit.ts — Twelve Data API 레이트 리밋 (스로틀).
 *
 * Twelve Data 무료 티어는 **8 req/min** (전역 — API 키당). 모든 엔드포인트가
 * 하나의 한도를 공유하므로 단일 그룹(DEFAULT)으로 직렬화한다.
 *
 * 동작: pi-toss와 동일한 promise 체인(tail) 패턴 —
 * "호출 시작 시각" 기준 그룹별 최소 간격, 병렬 호출자 직렬화, fn 실패와
 * 무관하게 간격 유지.
 *
 * 환경변수:
 *  - TWELVE_RATE_LIMIT_MULTIPLIER: 기본 간격(7600ms) 배율 (기본 1.0).
 *    2.0이면 간격 2배, 0이면 스로틀 해제.
 */

/** Twelve Data 기본 최소 간격(ms) — 무료 8 req/min → 60000/8 = 7500 + 여유. */
export const TWELVE_GROUP_INTERVALS_MS: Record<string, number> = {
	DEFAULT: 7600,
};

interface GroupState {
	tail: Promise<void>;
	lastStartAt: number;
}

const states = new Map<string, GroupState>();

/** 배율 적용 최종 간격(ms). 0이면 스로틀 해제. */
export function groupIntervalMs(group: string): number {
	const base = TWELVE_GROUP_INTERVALS_MS[group] ?? 7600;
	const raw = process.env.TWELVE_RATE_LIMIT_MULTIPLIER;
	const mult = raw !== undefined && raw.trim() !== "" ? Number(raw) : 1;
	if (!Number.isFinite(mult) || mult <= 0) return 0; // 0/음수 → 해제
	return Math.round(base * mult);
}

/** 스로틀 상태 초기화 (테스트/동적 설정용). */
export function resetRateLimit(): void {
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
export async function withRateLimit<T>(group: string, fn: () => Promise<T>): Promise<T> {
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
