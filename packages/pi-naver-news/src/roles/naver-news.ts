/**
 * src/roles/naver-news.ts — 네이버 검색 API(뉴스) 도메인 역할.
 *
 * 공식 오픈API (https://openapi.naver.com/v1/search/news.json) typed wrapper.
 * 인증은 X-Naver-Client-Id/Secret 헤더 (client.ts), 레이트리밋은 전 호출 공통
 * (DEFAULT 300ms), TTL 캐시 60s (뉴스 freshness 유지).
 *
 * 정규화:
 *  - title/description — 검색어 하이라이트 `<b>` 태그 제거 + HTML 엔티티 디코딩
 *  - pubDate — RFC 822 ("Mon, 26 Sep 2016 07:50:00 +0900") → ISO 8601 병기
 *  - days 옵션 — API에 날짜 필터가 없어 pubDate 기준 클라이언트 필터 제공
 *
 * 정식 스펙: https://developers.naver.com/docs/serviceapi/search/news/news.md
 */
import { cached, TtlCache } from "../cache.ts";
import { naverRequest } from "../client.ts";

// ── TTL 캐시 ───────────────────────────────────────────────────────────────
const searchCache = new TtlCache(60_000); // 검색 60s

// ── 타입 ───────────────────────────────────────────────────────────────────

export interface NaverNewsSearchParams {
	/** 검색어 (UTF-8) — 종목명·종목코드·키워드, 예: "삼성전자", "005930", "코스피" */
	query: string;
	/** 한 번에 표시할 개수 (기본 10, 최대 100) */
	display?: number;
	/** 검색 시작 위치 (기본 1, 최대 1000) */
	start?: number;
	/** 정렬: sim=정확도순(기본), date=날짜순 내림차순 */
	sort?: "sim" | "date";
}

export interface NaverNewsSearchOptions {
	/** 최근 N일 이내 기사만 필터 (기본 0 = 필터 없음, API에 날짜 필터가 없어 클라이언트 필터) */
	days?: number;
}

/** 정규화된 뉴스 기사 1건. */
export interface NaverNewsItem {
	/** 기사 제목 (하이라이트 <b> 태그·HTML 엔티티 제거됨) */
	title: string;
	/** 기사 요약 (동일 정규화) */
	description: string;
	/** 기사 원문 URL */
	originallink: string;
	/** 네이버 뉴스 URL (네이버 미제공 기사는 원문 URL) */
	link: string;
	/** 발행 시각 — RFC 822 원문 ("Mon, 26 Sep 2016 07:50:00 +0900") */
	pubDate: string;
	/** 발행 시각 — ISO 8601 (날짜 필터·정렬용) */
	publishedAt: string;
}

/** 정규화된 검색 결과. */
export interface NaverNewsSearchResult {
	/** 검색 결과 생성 시각 (RFC 822) */
	lastBuildDate: string;
	/** 총 검색 결과 개수 */
	total: number;
	/** 검색 시작 위치 */
	start: number;
	/** 요청한 표시 개수 */
	display: number;
	/** 정렬 방식 */
	sort: "sim" | "date";
	/** days 필터 적용 후 남은 기사 수 (필터 없으면 items.length와 동일) */
	matchedCount: number;
	/** days 필터 옵션 (0 = 필터 없음) */
	days: number;
	items: NaverNewsItem[];
}

// ── 정규화 유틸 ────────────────────────────────────────────────────────────

/** `<b>` 등 태그 제거 + HTML 엔티티 디코딩 + 공백 정리 (&amp;는 마지막에 — 이중 디코딩 방지). */
export function decodeHtml(s: string): string {
	return s
		.replace(/<[^>]*>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

// ── 검색 ───────────────────────────────────────────────────────────────────

interface NaverRawItem {
	title?: string;
	originallink?: string;
	link?: string;
	description?: string;
	pubDate?: string;
}

interface NaverRawResponse {
	lastBuildDate?: string;
	total?: number;
	start?: number;
	display?: number;
	items?: NaverRawItem[];
}

/**
 * 네이버 뉴스 검색 — 정규화 + days 필터 적용.
 *
 * @param params 검색 조건 (query 필수, display 1~100, start 1~1000)
 * @param opts   days: 최근 N일 필터 (0 = 없음)
 */
export async function searchNews(
	params: NaverNewsSearchParams,
	opts: NaverNewsSearchOptions = {},
): Promise<NaverNewsSearchResult> {
	const query = params.query.trim();
	if (!query) throw new Error("query(검색어)가 비어 있습니다.");
	const display = Math.min(Math.max(params.display ?? 10, 1), 100);
	const start = Math.min(Math.max(params.start ?? 1, 1), 1000);
	const sort = params.sort ?? "sim";
	const days = Math.max(opts.days ?? 0, 0);

	const cacheKey = `search:${query}|${display}|${start}|${sort}`;
	const raw = await cached(searchCache, cacheKey, async () => {
		return naverRequest<NaverRawResponse>("GET", "/search/news.json", {
			query: { query, display, start, sort },
		});
	});

	const total = raw.total ?? 0;
	const items: NaverNewsItem[] = [];
	for (const it of raw.items ?? []) {
		const pubDate = (it.pubDate ?? "").trim();
		const ts = pubDate ? Date.parse(pubDate) : NaN;
		const publishedAt = Number.isFinite(ts) ? new Date(ts).toISOString() : "";
		if (days > 0 && publishedAt) {
			const ageMs = Date.now() - Date.parse(publishedAt);
			if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > days * 86_400_000) continue;
		}
		items.push({
			title: decodeHtml(it.title ?? ""),
			description: decodeHtml(it.description ?? ""),
			originallink: it.originallink ?? "",
			link: it.link ?? "",
			pubDate,
			publishedAt,
		});
	}

	return {
		lastBuildDate: raw.lastBuildDate ?? "",
		total,
		start: raw.start ?? start,
		display: raw.display ?? display,
		sort,
		matchedCount: items.length,
		days,
		items,
	};
}
