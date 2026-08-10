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
 * 캐시 래퍼 — 히트 시 저장값 반환, 아니면 fn() 실행 후 저장.
 * TWELVE_DISABLE_CACHE=1 이면 캐시 없이 항상 fn() 직접 호출.
 */
export async function cached<T>(cache: TtlCache, key: string, fn: () => Promise<T>): Promise<T> {
	if (process.env.TWELVE_DISABLE_CACHE === "1") return fn();
	const hit = cache.get<T>(key);
	if (hit !== undefined) return hit;
	const value = await fn();
	cache.set(key, value);
	return value;
}
