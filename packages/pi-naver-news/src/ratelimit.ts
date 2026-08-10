/**
 * src/ratelimit.ts — 네이버 검색 API 레이트 리밋 (스로틀) + 일일 호출 카운터.
 *
 * 네이버 검색 API의 공식 한도는 **하루 25,000회** (클라이언트 ID별 합산) —
 * 초당 한도는 문서에 없어 방어적으로 기본 간격 300ms (~3.3 req/s)로 직렬화한다.
 *
 * 동작: pi-coingecko와 동일한 promise 체인(tail) 패턴 —
 * "호출 시작 시각" 기준 최소 간격, 병렬 호출자 직렬화, fn 실패와 무관하게 간격 유지.
 *
 * 일일 카운터: recordCall()이 호출 시마다 증가, 자정(로컬)에 리셋.
 * /naver-news-status 에서 오늘 사용량을 보여준다 (25,000회 한도 모니터링).
 *
 * 환경변수:
 *  - NAVER_NEWS_RATE_LIMIT_MULTIPLIER: 기본 간격 배율 (기본 1.0).
 *    2.0이면 간격 2배, 0이면 스로틀 해제. KIS(KIS_RATE_LIMIT_MS)/TOSS와 분리.
 */

/** 네이버 그룹 → 기본 최소 간격(ms). (문서상 일일 25,000회 → 방어적 300ms) */
export const NAVER_NEWS_GROUP_INTERVALS_MS: Record<string, number> = {
	DEFAULT: 300,
};

interface GroupState {
	tail: Promise<void>;
	lastStartAt: number;
}

const states = new Map<string, GroupState>();

/** 배율 적용 최종 간격(ms). 0이면 스로틀 해제. */
export function groupIntervalMs(group: string): number {
	const base = NAVER_NEWS_GROUP_INTERVALS_MS[group] ?? 300;
	const raw = process.env.NAVER_NEWS_RATE_LIMIT_MULTIPLIER;
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

// ── 일일 호출 카운터 (25,000회/일 한도 모니터링) ───────────────────────────

let currentDay = localDayKey();
let dayCalls = 0;

function localDayKey(): string {
	// 로컬 타임존 기준 YYYY-MM-DD (sv locale이 ISO 형식을 준다)
	return new Date().toLocaleDateString("sv");
}

/** API 호출 직전에 기록 — 일일 한도(25,000회) 추적. */
export function recordCall(): void {
	const today = localDayKey();
	if (today !== currentDay) {
		currentDay = today;
		dayCalls = 0;
	}
	dayCalls++;
}

/** 오늘(로컬 기준) 누적 호출 수 — 자정에 자동 리셋. */
export function todayCalls(): number {
	const today = localDayKey();
	if (today !== currentDay) {
		currentDay = today;
		dayCalls = 0;
	}
	return dayCalls;
}
