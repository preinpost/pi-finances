/**
 * src/cache.ts — TTL 메모리 캐시 (API 호출 절약 — 일일 한도 25,000회 대응).
 *
 * 검색 캐시 TTL 60s (roles/naver-news.ts) — 뉴스는 freshness가 중요해
 * 시세보다 짧게 유지한다.
 *
 * 환경변수: NAVER_NEWS_DISABLE_CACHE=1 이면 cached()가 캐시 없이 직접 실행.
 */

/** 간단한 TTL 메모리 캐시 — API 호출 절약 (일일 한도 대응). */
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
 * 캐시 히트 시 값 반환, 아니면 fn() 실행 후 저장.
 * NAVER_NEWS_DISABLE_CACHE=1 이면 캐시를 건너뛰고 fn()을 직접 호출한다.
 */
export async function cached<T>(cache: TtlCache, key: string, fn: () => Promise<T>): Promise<T> {
	if (process.env.NAVER_NEWS_DISABLE_CACHE === "1") return fn();
	const hit = cache.get<T>(key);
	if (hit !== undefined) return hit;
	const value = await fn();
	cache.set(key, value);
	return value;
}
