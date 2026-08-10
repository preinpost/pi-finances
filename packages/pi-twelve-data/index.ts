/**
 * pi-twelve-data
 * ==============
 * Twelve Data (https://twelvedata.com) 공식 API 클라이언트 for pi — REST 직접 호출, MCP 서버 없음.
 *
 * 무료 키(apikey)로 전 세계 주식·지수·외환·암호화폐의 현재가/차트/심볼 검색/환율을
 * 제공한다. 의존성 0 (직접 fetch). 무료 티어는 8 req/min — 전역 레이트리밋(7.6s
 * 간격) + TTL 캐시로 호출 수를 절약한다.
 *
 *   src/cache.ts      — TTL 메모리 캐시 (quote 15s / chart 60s / search 10m / exchange_rate 60s)
 *   src/client.ts     — Twelve Data transport (apikey 쿼리 + 레이트리밋 + 캐시)
 *   src/ratelimit.ts  — promise-chain 레이트리밋 (기본 7600ms, TWELVE_RATE_LIMIT_MULTIPLIER)
 *   src/secret.ts     — 공용 시크릿 스토어 위 Twelve 키 뷰 (namespace pi-twelve-data)
 *   src/roles/        — Twelve 도메인 역할 (quote/time_series/symbol_search/exchange_rate)
 *   src/agent/        — pi 통합 (twelve_* 4툴, /twelve-key)
 *
 * Tools:
 *   - twelve_price          현재가 (콤마 구분 최대 8 — 무료 8 req/min 고려, 하나씩 /quote 호출)
 *   - twelve_chart          차트 + 공용 지표 (1min~1month, 최대 5000봉)
 *   - twelve_search         심볼 검색 (전 세계 시장)
 *   - twelve_exchange_rate  환율 (USD/KRW, EUR/USD 등)
 *
 * Commands:
 *   - /twelve-key   register apikey → 공용 시크릿 스토어
 *
 * 인증: apikey 쿼리 파라미터 (twelvedata.com 무료 가입 → 발급).
 * 키 폴백: 스토어 우선, 셸 env TWELVE_API_KEY.
 * 한도: 무료 8 req/min (호출 간격 7600ms), TWELVE_RATE_LIMIT_MULTIPLIER로 배율 조정.
 */
import registerExtension from "./src/agent/extension.ts";

export default registerExtension;
