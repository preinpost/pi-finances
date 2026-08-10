/**
 * pi-naver-news
 * ==============
 * 네이버 검색 API(뉴스) 공식 오픈API 클라이언트 for pi — REST 직접 호출 (의존성 0), MCP 서버 없음.
 *
 *   src/cache.ts       — TTL 메모리 캐시 (검색 60s)
 *   src/ratelimit.ts   — promise-chain 레이트리밋 (기본 300ms) + 일일 호출 카운터 (25,000회/일)
 *   src/secret.ts      — pi-naver-news 전용 키 스토어 (NAVER_CLIENT_ID/SECRET 셸 env 폴백)
 *   src/roles/naver-news.ts — 도메인 역할 (검색 정규화: <b>·HTML 엔티티 제거, pubDate → ISO)
 *   src/agent/         — pi 통합 (naver_news_search 툴, /naver-news-key, /naver-news-status)
 *
 * Tools:
 *   - naver_news_search  한국 뉴스 검색 (종목명/키워드 — display ≤100, start ≤1000,
 *                        sort: sim 정확도/date 최신순, days: 최근 N일 필터)
 *
 * Commands:
 *   - /naver-news-key    네이버 Client ID / Client Secret 등록 (검색 API 활성 필수)
 *   - /naver-news-status 연동 상태 진단 (키/백엔드/레이트리밋/캐시/오늘 호출 수)
 *
 * 인증: 헤더 `X-Naver-Client-Id` / `X-Naver-Client-Secret` (developers.naver.com
 * 애플리케이션 등록 → 검색 API 활성화). 하루 호출 한도 25,000회 (클라이언트 ID별 합산).
 * 날짜 필터는 API에 없어 days 옵션으로 클라이언트 필터를 제공한다.
 */
import registerExtension from "./src/agent/extension.ts";

export default registerExtension;
