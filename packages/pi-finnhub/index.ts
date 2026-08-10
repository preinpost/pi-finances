/**
 * pi-finnhub
 * ==============
 * Finnhub (공식 API) client for pi — 미국 주식 시세·차트·뉴스·펀더멘털·컨센서스.
 * REST 직접 호출, MCP 서버 없음, 의존성 0 (직접 fetch + TTL 캐시 + 레이트리밋).
 *
 *   src/cache.ts        — TTL 메모리 캐시 (quote 15s / chart 60s / news 5m / fundamentals 30m)
 *   src/client.ts       — 전송 계층 (fetch + token 쿼리 + 레이트리밋 + 캐시)
 *   src/secret.ts       — 공용 시크릿 스토어 위 pi-finnhub 키 뷰
 *   src/ratelimit.ts    — 무료 60 req/min 스로틀 (기본 간격 1100ms)
 *   src/roles/          — Finnhub 도메인 역할 (정규화 + Bar 변환)
 *   src/agent/          — pi 통합 (finnhub_* 4툴, /finnhub-key, /finnhub-status)
 *
 * Tools:
 *   - finnhub_price        현재가 (최대 10종목, 심볼당 /quote 1회)
 *   - finnhub_chart        캔들 차트 + 공용 지표 (1/5/15/30/60분·D/W/M)
 *   - finnhub_news         기업 뉴스 (최근 7일 기본, 최대 20건)
 *   - finnhub_fundamentals 프로필 + 밸류에이션 메트릭 + 애널리스트 컨센서스
 *
 * Commands:
 *   - /finnhub-key     register API token → 공용 키 저장소
 *   - /finnhub-status  키/레이트리밋/캐시/백엔드 진단
 *
 * 인증: Finnhub API token (쿼리 `token` 파라미터 — https://finnhub.io/api/v1).
 * 무료 티어는 **미국 종목만** (AAPL/MSFT 등), 60 req/min.
 * 키 등록: finnhub.io 무료 가입 → dashboard → API token.
 */
import registerExtension from "./src/agent/extension.ts";

export default registerExtension;
