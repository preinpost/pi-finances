/**
 * pi-binance
 * ==============
 * Binance REST 클라이언트 for pi — 현물(Spot) + USDT-M 선물.
 *
 *   src/client.ts     — HMAC SHA256 서명 + 서버시간 보정 + 레이트리밋
 *   src/secret.ts     — pi-binance 전용 키 스토어 (BINANCE_API_KEY/SECRET/ENV 폴백)
 *   src/roles/        — 시세·차트·잔고·주문·선물 전용 정규화
 *   src/agent/        — binance_* 8툴, /binance-key, /binance-status
 *
 * Tools:
 *   - binance_price     현재가·24h 변동 (현물/USDT-M, 키 없이 가능)
 *   - binance_chart     캔들 + 공용 지표 (키 없이 가능)
 *   - binance_market    현물 호가·체결·평균가·북티커·거래소규칙·롤링티커
 *   - binance_account   현물 잔고+평단가(FIFO) / 수수료·필터·미체결한도 / 선물 포지션
 *   - binance_order     주문 생성·테스트주문 (서명 — 사용자 확인 후에만)
 *   - binance_orders    미체결/상세/취소/체결/전체이력
 *   - binance_orderlist 현물 OCO/OTO/OTOCO
 *   - binance_futures   펀딩·마크가·미결제약정·레버리지·마진타입
 *
 * Commands:
 *   - /binance-key     API Key/Secret + live|testnet 등록
 *   - /binance-status  연동 상태 진단
 *
 * 인증: HMAC SHA256 (헤더 X-MBX-APIKEY + query signature).
 * 출금·내부이체·API 키 관리는 제공하지 않음.
 */
import registerExtension from "./src/agent/extension.ts";

export default registerExtension;
