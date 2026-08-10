/**
 * src/cache.ts — 간단한 TTL 메모리 캐시 (API 호출 절약 — rate limit 대응).
 *
 * Finnhub 무료 티어는 60 req/min으로 빡빡하므로, 같은 요청은 TTL 동안
 * 재사용한다 (quote 15s, chart 60s, news 5m, fundamentals 30m — client.ts).
 *
 * Env: FINNHUB_DISABLE_CACHE=1 이면 cached()가 캐시를 거치지 않고 항상
 * fn()을 직접 호출한다 (디버깅/실시간 확인용).
 */

/** 간단한 TTL 메모리 캐시 — API 호출 절약 (rate limit 대응). */
export class TtlCache {
	private store = new Map<string, { at: number; value: unknown }>();
	constructor(private ttlMs: number) {}
	get<T>(key: string): T | undefined {
		const hit = this.store.get(key);
		if (!hit) return undefined;
		if (Date.now() - hit.at > this.ttlMs) {
			this.store.delete(key);
			return undefined;
		}
		return hit.value as T;
	}
	set(key: string, value: unknown): void {
		this.store.set(key, { at: Date.now(), value });
	}
	clear(): void {
		this.store.clear();
	}
	get size(): number {
		return this.store.size;
	}
}

/**
 * cached 헬퍼 — 캐시 히트 시 반환, 아니면 fn() 실행 후 저장.
 * FINNHUB_DISABLE_CACHE=1 이면 캐시를 아예 사용하지 않는다.
 */
export function cached<T>(cache: TtlCache, key: string, fn: () => Promise<T>): Promise<T> {
	if (process.env.FINNHUB_DISABLE_CACHE === "1") return fn();
	const hit = cache.get<T>(key);
	if (hit !== undefined) return Promise.resolve(hit);
	return fn().then((v) => {
		cache.set(key, v);
		return v;
	});
}
