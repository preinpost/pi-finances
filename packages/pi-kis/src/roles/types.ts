/**
 * src/roles/types.ts — 역할 계층 공용 타입.
 *
 * core(transport/protocol)의 타입을 재수출하고, 역할(시세/포트폴리오/주문)
 * 레이어에서 쓰는 도메인 타입을 정의한다.
 */
import type { EnvArg, KisEnv } from "../auth.ts";
export type { EnvArg, KisEnv } from "../auth.ts";
export type {
	ApiDef,
	ParamField,
	CallOptions,
	CallResult,
	TrIdOption,
	TrIdSelection,
} from "../client.ts";
export type {
	WsResult,
	WsMessage,
	WsSystemEvent,
	SubscribeOptions,
} from "../ws.ts";

/** 매수/매도 구분. */
export type OrderSide = "buy" | "sell";

/** 시장 구분. */
export type Market = "domestic" | "overseas";

/** 주문 단가 미지정 시 사용하는 주문구분 기본값 (KIS: 00=지정가). */
export const DEFAULT_ORDER_DVSN = "00";

/**
 * 준비된 주문 (실행 전 단계) — 사용자 확인용 요약과 실제 호출용 파라미터를 가진다.
 * 실제 API 호출은 `send*Order` 함수로만 수행한다 (주문 직전 확인 게이트).
 */
export interface PreparedOrder {
	kind: "order";
	market: Market;
	side: OrderSide;
	env: KisEnv;
	/** v2 API 키 (예: "domestic_stock.v1_국내주식-001"). */
	api: string;
	tr_id: string;
	params: Record<string, string>;
	/** 사전 검증 결과 (preCheck=true 시 검증 API 호출 결과). */
	preCheck: { verified: boolean; detail?: string };
	/** 사용자 확인용 한글 요약 문자열. */
	summary(): string;
}

/** 준비된 정정/취소 요청 — 실행은 `send*Cancel`으로만. */
export interface PreparedCancel {
	kind: "cancel";
	market: Market;
	env: KisEnv;
	api: string;
	tr_id: string;
	params: Record<string, string>;
	summary(): string;
}
