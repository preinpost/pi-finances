/**
 * pi-kis-trading
 * ==============
 * Korea Investment (KIS) Open API client for pi — direct REST calls, no MCP
 * server, no dynamic code download.
 *
 * 계층 구조 (에이전트 통합 친화적):
 *   src/core/   — transport/protocol (REST/WS/인증/시크릿, 338개 API 스펙)
 *   src/roles/  — 도메인 역할 (market/portfolio/trading) — 에이전트가 직접 import
 *   src/agent/  — pi 통합 (툴 kis_* 6개, 커맨드 /kis-key·/kis-status)
 *
 * Tools:
 *   - kis_api             generic dispatch: api(v2 키) + params + env + tr_id + pages
 *   - kis_list_apis       discover available APIs (by category)
 *   - kis_realtime        실시간 시세 (WebSocket) — tr_id + tr_key 구독 (예: H0STCNT0/005930)
 *   - kis_overseas_price  해외주식 현재체결가 (v1_해외주식-009, HHDFS00000300)
 *   - kis_overseas_chart  해외주식 기간별시세 (v1_해외주식-010, HHDFS76240000)
 *   - kis_domestic_price  국내주식 현재가 (v1_국내주식-008, FHKST01010100)
 *   - kis_domestic_chart  국내주식 기간별시세 (v1_국내주식-016, FHKST03010100)
 *
 * Commands:
 *   - /kis-key    register API keys → OS keyring (또는 0600 파일 폴백)
 *   - /kis-status diagnose keys / token cache / approval-key cache / api count
 */
import registerExtension from "./src/agent/extension.ts";

export default registerExtension;
