/**
 * pi-naver-news
 * ==============
 * 네이버 뉴스 검색 API 클라이언트 for pi — REST 직접 호출 (의존성 0), MCP 서버 없음.
 *
 *   src/cache.ts       — TTL 메모리 캐시 (검색 60s)
 *   src/ratelimit.ts   — promise-chain 레이트리밋 (기본 300ms) + 호출 카운터
 *   src/secret.ts      — pi-naver-news 전용 키 스토어 (hub/legacy 모드, env 폴백)
 *   src/roles/naver-news.ts — 도메인 역할 (검색 정규화: <b>·HTML 엔티티 제거, pubDate → ISO)
 *   src/agent/         — pi 통합 (naver_news_search 툴, /naver-news-key, /naver-news-status)
 *
 * Tools:
 *   - naver_news_search  한국 뉴스 검색 (종목명/키워드 — display ≤100, start ≤1000,
 *                        sort: sim 정확도/date 최신순, days: 최근 N일 필터)
 *
 * Commands:
 *   - /naver-news-key    API Key ID / API Key 등록 (hub=NAVER API HUB 기본, legacy=개발자센터)
 *   - /naver-news-status 연동 상태 진단 (모드/키/백엔드/레이트리밋/캐시/오늘 호출 수)
 *
 * 인증 (2026-07-31 개발자센터 신규 신청 종료 — 신규 키는 NAVER API HUB):
 *   - hub (기본): NCP 콘솔 console.ncloud.com/naver-api-hub/subscription 구독 → Application 생성,
 *     헤더 X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY, 도메인 naverapihub.apigw.ntruss.com.
 *     한도: 월 775,000건 통합, 키당 50 RPS (현재 한시 무료, 향후 유료 예정).
 *   - legacy: 개발자센터 키 (X-Naver-Client-Id/Secret, openapi.naver.com) —
 *     2026-07-31 이전 발급 키만 2027-06-30까지 사용 가능.
 * 날짜 필터는 API에 없어 days 옵션으로 클라이언트 필터를 제공한다.
 */
import registerExtension from "./src/agent/extension.ts";

export default registerExtension;
