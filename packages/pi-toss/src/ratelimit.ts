/**
 * src/ratelimit.ts — 토스증권 Open API 그룹별 레이트 리밋 (스로틀).
 *
 * 토스는 API 그룹별 초당 요청 한도가 다르다 (공식 문서 Rate Limits Group):
 *   ACCOUNT 1/s, MARKET_DATA 10/s, ORDER 10/s, ACCOUNT/ASSET/STOCK 등 5/s 계열.
 * core transport 계층에서 그룹별 최소 호출 간격을 보장해, 모든 경로
 * (툴 → roles → transport)가 동일하게 조절되게 한다.
 *
 * 동작: src/ratelimit.ts와 동일한 promise 체인(tail) 패턴 —
 * "호출 시작 시각" 기준 그룹별 최소 간격, 병렬 호출자 직렬화, fn 실패와
 * 무관하게 간격 유지.
 *
 * 환경변수:
 *  - TOSS_RATE_LIMIT_MULTIPLIER: 전체 기본 간격 배율 (기본 1.0).
 *    2.0이면 모든 그룹 간격 2배, 0이면 스로틀 해제. KIS(KIS_RATE_LIMIT_MS)와 분리.
 */

/** 토스 API 그룹 → 기본 최소 간격(ms). (초당 한도 → 1000/한도, 여유 10~15%) */
export const TOSS_GROUP_INTERVALS_MS: Record<string, number> = {
	AUTH: 250, // 5/s
	ACCOUNT: 1100, // 1/s (가장 빡빡)
	ASSET: 250, // 5/s
	STOCK: 250, // 5/s
	MARKET_INFO: 400, // 3/s
	MARKET_DATA: 120, // 10/s
	MARKET_DATA_CHART: 250, // 5/s
	RANKING: 250, // 5/s
	MARKET_INDICATOR_PRICE: 120, // 10/s
	MARKET_INDICATOR: 120, // 10/s
	MARKET_INDICATOR_CHART: 250, // 5/s
	ORDER: 120, // 10/s
	ORDER_HISTORY: 250, // 5/s
	ORDER_INFO: 200, // 6/s
	CONDITIONAL_ORDER: 250, // 5/s
	CONDITIONAL_ORDER_HISTORY: 120, // 10/s
};

interface GroupState {
	tail: Promise<void>;
	lastStartAt: number;
}

const states = new Map<string, GroupState>();

/** 배율 적용 최종 간격(ms). 0이면 스로틀 해제. */
export function groupIntervalMs(group: string): number {
	const base = TOSS_GROUP_INTERVALS_MS[group] ?? 250;
	const raw = process.env.TOSS_RATE_LIMIT_MULTIPLIER;
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
