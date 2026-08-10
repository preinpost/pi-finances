/**
 * src/ratelimit.ts — KIS Open API 전역 레이트 리밋 (스로틀).
 *
 * KIS는 초당 호출 제한이 있으며 초과 시 rt_cd=EGW00013("초당 거래건수를
 * 초과") 등의 에러를 반환한다. core transport 계층에서 env(real/paper)별
 * 최소 호출 간격을 보장해, 모든 경로(툴 → roles → core)와 벌크 루프
 * (섹터 스크리닝, 차트 페이징 등)가 동일하게 조절되게 한다.
 *
 * 동작:
 *  - "호출 시작 시각" 기준 최소 간격 (기본 300ms, 주문 600ms)
 *  - env별 promise 체인(tail)으로 직렬화 — 병렬 호출자들이 간격만큼
 *    대기한 뒤 순차 실행. 레이스 없음.
 *  - fn이 실패해도 간격은 유지 (타임스탬프는 fn 호출 전에 갱신).
 *
 * 환경변수:
 *  - KIS_RATE_LIMIT_MS: 기본 간격(ms). 명시 0이면 스로틀 해제. 미설정 시 300.
 */
import type { KisEnv } from "./auth.ts";

export const DEFAULT_INTERVAL_MS = 300;
export const DEFAULT_ORDER_INTERVAL_MS = 600;

interface EnvState {
	tail: Promise<void>;
	lastStartAt: number;
}

const states = new Map<KisEnv, EnvState>();

export interface RateLimitOptions {
	/** 일반(조회) 호출 최소 간격(ms). 기본 300. 0이면 해제. */
	intervalMs?: number;
	/** 주문 등 민감 호출 최소 간격(ms). 기본 600. */
	minOrderIntervalMs?: number;
	/** 주문 호출 여부 — true면 minOrderIntervalMs 사용. */
	isOrder?: boolean;
}

/** 환경변수/옵션에서 기본 간격을 결정한다. 0이면 스로틀 해제. */
function baseIntervalMs(opts: RateLimitOptions | undefined): number {
	const raw = process.env.KIS_RATE_LIMIT_MS;
	// 빈 문자열/공백은 미설정으로 취급 (Number("")=0이 스로틀을 끄는 것 방지)
	const configured = raw !== undefined && raw.trim() !== "" ? Number(raw) : NaN;
	if (Number.isFinite(configured)) {
		if (configured === 0) return 0; // 명시 해제
		if (configured > 0) return configured;
	}
	return opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
}

/** env + 옵션 기준 실제 적용 간격(ms). 0이면 스로틀 해제. */
export function rateLimitIntervalMs(env: KisEnv, opts?: RateLimitOptions): number {
	const base = baseIntervalMs(opts);
	if (base <= 0) return 0;
	if (opts?.isOrder) return Math.max(base, opts.minOrderIntervalMs ?? DEFAULT_ORDER_INTERVAL_MS);
	return base;
}

/** 스로틀 상태 초기화 (테스트/동적 설정용). */
export function resetRateLimit(): void {
	states.clear();
}

function stateFor(env: KisEnv): EnvState {
	let st = states.get(env);
	if (!st) {
		st = { tail: Promise.resolve(), lastStartAt: 0 };
		states.set(env, st);
	}
	return st;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * env별 최소 간격을 지켜 fn을 실행한다.
 * - 간격이 0(해제)이면 fn을 그대로 실행하되, 기존 tail 직렬화는 유지.
 * - 병렬 호출: promise 체인으로 직렬화되어 각각 간격만큼 떨어진 시점에 시작.
 * - 타임스탬프는 fn 실행 직전에 갱신 — fn 실패와 무관하게 간격이 유지된다.
 */
export async function withRateLimit<T>(
	env: KisEnv,
	opts: RateLimitOptions | undefined,
	fn: () => Promise<T>,
): Promise<T> {
	const interval = rateLimitIntervalMs(env, opts);
	const st = stateFor(env);

	// 이번 호출의 "대기 완료"를 tail에 연결 (다음 호출자와 직렬화)
	const run = st.tail.then(async () => {
		if (interval <= 0) return;
		const now = Date.now();
		const wait = st.lastStartAt + interval - now;
		if (wait > 0) await sleep(wait);
	});
	// tail은 항상 resolve 상태로 유지 — 호출자 개별 실패가 체인을 끊지 않게
	st.tail = run.catch(() => {});

	await run;
	st.lastStartAt = Date.now();
	return fn();
}
