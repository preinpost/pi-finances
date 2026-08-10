/**
 * pi-toss
 * ==============
 * 토스증권 Open API client for pi — REST 직접 호출, MCP 서버 없음.
 *
 * pi-kis v0.3.0에서 분리된 독립 패키지:
 *   src/core/      — 토스 transport (OAuth2 client_credentials + 그룹별 레이트리밋)
 *   src/core/secret.ts — pi-kis와 공용 키 저장소 위 토스 키 뷰
 *   src/roles/     — 토스 도메인 역할 (시세/시장/자산/주문/조건주문)
 *   src/agent/     — pi 통합 (toss_* 7툴, /toss-key)
 *
 * Tools:
 *   - toss_price        현재가 (KRX 6자리 / US 티커, 최대 200개)
 *   - toss_chart        캔들 차트 + 공용 지표 (1d/1m)
 *   - toss_market       토스 전용 시장 데이터 (환율/장운영시간/랭킹/투자자별 매매대금/종목경고)
 *   - toss_balance      자산 종합 (계좌/보유종목/매수여력/수수료)
 *   - toss_order        주문 생성 (지정가/시장가, 멱등)
 *   - toss_orders       주문 목록/상세/정정/취소
 *   - toss_conditional  조건주문 (SINGLE/OCO/OTO)
 *
 * Commands:
 *   - /toss-key   register client_id/client_secret → 공용 키 저장소
 *
 * 인증: OAuth2 Client Credentials (client_id/client_secret), 토큰 자동 캐시.
 * 실전 전용 (모의투자 없음). KIS 툴(kis_*)은 pi-kis 패키지.
 */
import registerExtension from "./src/agent/extension.ts";

export default registerExtension;
