/**
 * src/ratelimit.ts — Binance REST 그룹별 레이트 리밋 (스로틀).
 *
 * Binance는 weight 기반(현물 IP 6000/min, 선물 2400/min)이지만,
 * 에이전트 호출은 소수라 그룹별 최소 간격으로 직렬화한다.
 * POST/DELETE(주문)는 클라이언트에서 자동 재시도하지 않는다 (client.ts).
 *
 * 환경변수:
 *  - BINANCE_RATE_LIMIT_MULTIPLIER: 기본 간격 배율 (기본 1.0).
 *    2.0이면 간격 2배, 0이면 스로틀 해제.
 */

export const BINANCE_GROUP_INTERVALS_MS: Record<string, number> = {
	MARKET: 120, // public ticker/klines
	ACCOUNT: 200, // signed account / openOrders
	ORDER: 150, // place / cancel
};

interface GroupState {
	tail: Promise<void>;
	lastStartAt: number;
}

const states = new Map<string, GroupState>();

/** 배율 적용 최종 간격(ms). 0이면 스로틀 해제. */
export function groupIntervalMs(group: string): number {
	const base = BINANCE_GROUP_INTERVALS_MS[group] ?? 200;
	const raw = process.env.BINANCE_RATE_LIMIT_MULTIPLIER;
	const mult = raw !== undefined && raw.trim() !== "" ? Number(raw) : 1;
	if (!Number.isFinite(mult) || mult <= 0) return 0;
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
