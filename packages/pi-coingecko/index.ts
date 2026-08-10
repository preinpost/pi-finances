/**
 * pi-coingecko
 * ==============
 * CoinGecko 공식 API 클라이언트 for pi — REST 직접 호출 (의존성 0), MCP 서버 없음.
 *
 *   src/cache.ts       — TTL 메모리 캐시 (price 15s / chart 60s / market 2m / coin·search 10m)
 *   src/ratelimit.ts   — promise-chain 레이트리밋 (기본 5000ms — 무료 플랜 5~15 req/min)
 *   src/secret.ts      — pi-coingecko 전용 키 스토어 (COINGECKO_API_KEY 셸 env 폴백)
 *   src/roles/coingecko.ts — 도메인 역할 (가격/차트/랭킹/상세/검색 정규화 + Bar 변환)
 *   src/agent/         — pi 통합 (coingecko_* 5툴, /coingecko-key, /coingecko-status)
 *
 * Tools:
 *   - coingecko_price   현재가 (ids 최대 10, vsCurrencies 최대 5)
 *   - coingecko_chart   OHLC 차트 + 공용 지표 (1/7/14/30/90/180/365/max일)
 *   - coingecko_market  시장 랭킹 (market_cap_desc 등, per_page 최대 50)
 *   - coingecko_coin    코인 상세 (market_data — usd 기준 pick)
 *   - coingecko_search  코인 검색 (id 확인용 — 심볼은 중복될 수 있음)
 *
 * Commands:
 *   - /coingecko-key    CoinGecko Demo API 키 등록 (없으면 공개 API 5~15 req/min)
 *   - /coingecko-status 연동 상태 진단 (키/백엔드/레이트리밋/캐시)
 *
 * 인증: 헤더 `x-cg-demo-api-key` (무료 Demo 키, coingecko.com API 대시보드 발급).
 * 코인 식별은 **id** (bitcoin, ethereum, ...) — 심볼이 아니라 coingecko_search로 id 확인.
 */
import registerExtension from "./src/agent/extension.ts";

export default registerExtension;
