/**
 * src/roles/trading.ts — 주문/정정/취소 역할 (core 위에 안전 가드 포함).
 *
 * 안전 원칙 (실전 리스크 경고):
 *  - 실제 주문 호출은 **명시적 `send*` 함수로만** 수행한다. `prepare*` 함수는
 *    주문 요약(파라미터·tr_id·사전 검증 결과)만 만들고 API를 호출하지 않는다.
 *  - `order*` 편의 함수는 requireConfirmation(기본 true)일 때 주문 대신 준비된
 *    요청을 반환한다 — 에이전트는 이를 사용자에게 보여주고 확인 후
 *    `send*Order`를 호출해야 한다.
 *  - preCheck=true 시 주문 전 검증 API(매수가능/매도가능/매수가능금액)를 먼저 호출한다.
 *  - CANO/ACNT_PRDT_CD는 core buildParams가 등록 계좌로 자동 주입한다
 *    (계좌 미등록 시 명확한 에러 — /kis-key에서 등록).
 */
import { callApi } from "../client.ts";
import { resolveEnv } from "../auth.ts";
import type { EnvArg, KisEnv } from "../auth.ts";
import type { CallResult } from "../client.ts";
import type { OrderSide, PreparedCancel, PreparedOrder } from "./types.ts";

/** 실전 주문 경고 — 로그/문서용 상수. */
export const REAL_ORDER_WARNING =
	"⚠️ 실전 주문입니다. 사용자 확인을 받은 뒤 send* 함수로만 실행하세요.";

// ── 사전 검증 API ─────────────────────────────────────────────────────────

export interface BuyableOptions {
	symb: string; // 6자리 종목코드
	qty?: number;
	price?: number; // 1주당 가격 (시장가면 생략 — ORD_UNPR 공란)
	orderType?: string; // 00=지정가(기본), 01=시장가
	env?: EnvArg;
}

/** 국내 매수가능조회 (domestic_stock.v1_국내주식-007, TTTC8908R). */
export function verifyBuyable(opts: BuyableOptions): Promise<CallResult> {
	return callApi(
		"domestic_stock.v1_국내주식-007",
		{
			PDNO: opts.symb,
			ORD_UNPR: opts.price != null ? String(opts.price) : "",
			ORD_DVSN: opts.orderType ?? "00",
			CMA_EVLU_AMT_ICLD_YN: "N",
			OVRS_ICLD_YN: "N",
		},
		{ env: opts.env ?? "auto" },
	);
}

export interface SellableOptions {
	symb: string; // 6자리 종목코드
	env?: EnvArg;
}

/** 국내 매도가능수량조회 (domestic_stock.국내주식-165, TTTC8408R). */
export function verifySellable(opts: SellableOptions): Promise<CallResult> {
	return callApi("domestic_stock.국내주식-165", { PDNO: opts.symb }, { env: opts.env ?? "auto" });
}

export interface OverseasBuyableOptions {
	excd: string; // NASD/NYSE/AMEX
	symb: string;
	price?: number; // 1주당 가격 (필수 — 해외는 공란 불가)
	env?: EnvArg;
}

/** 해외 매수가능금액조회 (overseas_stock.v1_해외주식-014, TTTS3007R). */
export function verifyOverseasBuyable(opts: OverseasBuyableOptions): Promise<CallResult> {
	return callApi(
		"overseas_stock.v1_해외주식-014",
		{ OVRS_EXCG_CD: opts.excd, OVRS_ORD_UNPR: String(opts.price ?? "0"), ITEM_CD: opts.symb },
		{ env: opts.env ?? "auto" },
	);
}

/** 국내 정정취소가능주문조회 (domestic_stock.v1_국내주식-004, TTTC0084R). */
export function verifyCancelable(env?: EnvArg): Promise<CallResult> {
	return callApi(
		"domestic_stock.v1_국내주식-004",
		{ INQR_DVSN_1: "0", INQR_DVSN_2: "0" },
		{ env: env ?? "auto" },
	);
}

// ── 국내 주문 (prepare/send 2단계) ────────────────────────────────────────

export interface DomesticOrderRequest {
	side: OrderSide;
	symb: string; // 6자리 종목코드 (ETN은 7자리)
	qty: number;
	price?: number; // 1주당 가격 (시장가면 생략 → "0")
	orderType?: string; // 00=지정가(기본), 01=시장가, 02=조건부지정가, ...
}

export interface OrderOptions {
	env?: EnvArg;
	/** 주문 전 검증 API 호출 (기본 false). */
	preCheck?: boolean;
}

export interface OrderSendOptions {
	/** 실전 주문을 즉시 실행할지 (기본 false → order*는 준비 요청만 반환). */
	requireConfirmation?: boolean;
}

const DOMESTIC_ORDER_API = "domestic_stock.v1_국내주식-001";
const OVERSEAS_ORDER_API = "overseas_stock.v1_해외주식-001";

/**
 * 국내 주문 준비 (API 호출 없음 — preCheck=true면 검증 API만 호출).
 * 반환된 PreparedOrder는 sendDomesticOrder로만 실행한다.
 */
export async function prepareDomesticOrder(
	req: DomesticOrderRequest,
	opts?: OrderOptions,
): Promise<PreparedOrder> {
	const env = resolveEnv(opts?.env ?? "auto");
	const trId = req.side === "buy" ? "TTTC0011U" : "TTTC0012U";
	const params: Record<string, string> = {
		PDNO: req.symb,
		ORD_DVSN: req.orderType ?? "00",
		ORD_QTY: String(req.qty),
		ORD_UNPR: req.price != null ? String(req.price) : "0",
	};
	if (req.side === "sell") params.SLL_TYPE = "01"; // 일반매도

	let preCheck: { verified: boolean; detail?: string } = { verified: false };
	if (opts?.preCheck) {
		const res =
			req.side === "buy"
				? await verifyBuyable({ symb: req.symb, qty: req.qty, price: req.price, orderType: req.orderType, env })
				: await verifySellable({ symb: req.symb, env });
		preCheck = { verified: res.ok, detail: `rt_cd=0 — ${req.side === "buy" ? "매수가능" : "매도가능"} 조회 성공` };
	}

	return {
		kind: "order",
		market: "domestic",
		side: req.side,
		env,
		api: DOMESTIC_ORDER_API,
		tr_id: trId,
		params,
		preCheck,
		summary() {
			const side = req.side === "buy" ? "매수" : "매도";
			return (
				`[주문 준비] 국내 ${side} ${req.symb} ${req.qty}주 ` +
				`@ ${req.price != null ? req.price : "시장가"} (구분 ${req.orderType ?? "00"}) — ` +
				`env=${env}, tr_id=${trId}${preCheck.verified ? ", 사전검증 완료" : ""}`
			);
		},
	};
}

/** 준비된 국내 주문 실행 (사용자 확인 후 호출). */
export function sendDomesticOrder(prepared: PreparedOrder): Promise<CallResult> {
	if (prepared.market !== "domestic" || prepared.kind !== "order") {
		throw new Error("sendDomesticOrder: 국내 주문 준비 객체가 아닙니다.");
	}
	return callApi(prepared.api, prepared.params, { env: prepared.env, trId: prepared.tr_id });
}

/**
 * 국내 주문 편의 함수. requireConfirmation(기본 true)면 실행 없이
 * PreparedOrder를 반환하고, false면 검증 후 즉시 실행해 CallResult를 반환한다.
 */
export async function orderDomestic(
	req: DomesticOrderRequest,
	opts?: OrderOptions & OrderSendOptions,
): Promise<PreparedOrder | CallResult> {
	const prepared = await prepareDomesticOrder(req, opts);
	if (opts?.requireConfirmation !== false) return prepared;
	return sendDomesticOrder(prepared);
}

// ── 해외 주문 ─────────────────────────────────────────────────────────────

export interface OverseasOrderRequest {
	side: OrderSide;
	excd: string; // NASD/NYSE/AMEX 등
	symb: string;
	qty: number;
	price?: number; // 1주당 가격 (시장가면 "0")
	orderType?: string; // 00=지정가(기본), 32=LOO, 34=LOC ...
}

/**
 * 해외 주문 준비 (API 호출 없음 — preCheck=true면 검증 API만 호출).
 * 반환된 PreparedOrder는 sendOverseasOrder로만 실행한다.
 */
export async function prepareOverseasOrder(
	req: OverseasOrderRequest,
	opts?: OrderOptions,
): Promise<PreparedOrder> {
	const env = resolveEnv(opts?.env ?? "auto");
	const trId = req.side === "buy" ? "TTTT1002U" : "TTTT1006U";
	const params: Record<string, string> = {
		OVRS_EXCG_CD: req.excd,
		PDNO: req.symb,
		ORD_QTY: String(req.qty),
		OVRS_ORD_UNPR: req.price != null ? String(req.price) : "0",
		ORD_SVR_DVSN_CD: "0",
		ORD_DVSN: req.orderType ?? "00",
	};

	let preCheck: { verified: boolean; detail?: string } = { verified: false };
	if (opts?.preCheck) {
		const res = await verifyOverseasBuyable({ excd: req.excd, symb: req.symb, price: req.price, env });
		preCheck = { verified: res.ok, detail: "rt_cd=0 — 해외 매수가능금액 조회 성공" };
	}

	return {
		kind: "order",
		market: "overseas",
		side: req.side,
		env,
		api: OVERSEAS_ORDER_API,
		tr_id: trId,
		params,
		preCheck,
		summary() {
			const side = req.side === "buy" ? "매수" : "매도";
			return (
				`[주문 준비] 해외 ${side} ${req.excd} ${req.symb} ${req.qty}주 ` +
				`@ ${req.price != null ? req.price : "시장가"} (구분 ${req.orderType ?? "00"}) — ` +
				`env=${env}, tr_id=${trId}${preCheck.verified ? ", 사전검증 완료" : ""}`
			);
		},
	};
}

/** 준비된 해외 주문 실행 (사용자 확인 후 호출). */
export function sendOverseasOrder(prepared: PreparedOrder): Promise<CallResult> {
	if (prepared.market !== "overseas" || prepared.kind !== "order") {
		throw new Error("sendOverseasOrder: 해외 주문 준비 객체가 아닙니다.");
	}
	return callApi(prepared.api, prepared.params, { env: prepared.env, trId: prepared.tr_id });
}

/** 해외 주문 편의 함수 (requireConfirmation 기본 true → 준비 요청만 반환). */
export async function orderOverseas(
	req: OverseasOrderRequest,
	opts?: OrderOptions & OrderSendOptions,
): Promise<PreparedOrder | CallResult> {
	const prepared = await prepareOverseasOrder(req, opts);
	if (opts?.requireConfirmation !== false) return prepared;
	return sendOverseasOrder(prepared);
}

// ── 정정/취소 (prepare/send 2단계 — 원샷 함수 없음) ───────────────────────

export interface DomesticCancelRequest {
	symb: string; // 원주문 종목 (6자리)
	orgnOdno: string; // 원주문번호
	qty: number;
	price?: number; // 정정 시 새 단가 (취소면 "0")
	qtyAll?: boolean; // 전량 여부 (기본 true — 전량)
	/** 01=정정, 02=취소 (기본 02). */
	rvseCncl?: "01" | "02";
	env?: EnvArg;
}

/** 국내 정정/취소 준비 (domestic_stock.v1_국내주식-003, TTTC0013U). */
export function prepareDomesticCancel(req: DomesticCancelRequest): PreparedCancel {
	const env = resolveEnv(req.env ?? "auto");
	const rvseCncl = req.rvseCncl ?? "02";
	const params: Record<string, string> = {
		KRX_FWDG_ORD_ORGNO: "",
		ORGN_ODNO: req.orgnOdno,
		ORD_DVSN: "00",
		RVSE_CNCL_DVSN_CD: rvseCncl,
		ORD_QTY: String(req.qty),
		ORD_UNPR: req.price != null ? String(req.price) : "0",
		QTY_ALL_ORD_YN: req.qtyAll === false ? "N" : "Y",
	};
	return {
		kind: "cancel",
		market: "domestic",
		env,
		api: "domestic_stock.v1_국내주식-003",
		tr_id: "TTTC0013U",
		params,
		summary() {
			return (
				`[정정/취소 준비] 국내 ${rvseCncl === "02" ? "취소" : "정정"} ${req.symb} ` +
				`원주문 ${req.orgnOdno} ${req.qty}주 — env=${env}, tr_id=TTTC0013U`
			);
		},
	};
}

/** 준비된 국내 정정/취소 실행. */
export function sendDomesticCancel(prepared: PreparedCancel): Promise<CallResult> {
	if (prepared.market !== "domestic" || prepared.kind !== "cancel") {
		throw new Error("sendDomesticCancel: 국내 정정/취소 준비 객체가 아닙니다.");
	}
	return callApi(prepared.api, prepared.params, { env: prepared.env, trId: prepared.tr_id });
}

export interface OverseasCancelRequest {
	excd: string;
	symb: string;
	orgnOdno: string; // 원주문번호 (주문 응답 ODNO 또는 미체결내역에서)
	qty: number;
	price?: number; // 취소면 "0" (기본)
	/** 01=정정, 02=취소 (기본 02). */
	rvseCncl?: "01" | "02";
	env?: EnvArg;
}

/** 해외 정정/취소 준비 (overseas_stock.v1_해외주식-003, TTTT1004U). */
export function prepareOverseasCancel(req: OverseasCancelRequest): PreparedCancel {
	const env = resolveEnv(req.env ?? "auto");
	const rvseCncl = req.rvseCncl ?? "02";
	const params: Record<string, string> = {
		OVRS_EXCG_CD: req.excd,
		PDNO: req.symb,
		ORGN_ODNO: req.orgnOdno,
		RVSE_CNCL_DVSN_CD: rvseCncl,
		ORD_QTY: String(req.qty),
		OVRS_ORD_UNPR: req.price != null ? String(req.price) : "0",
		ORD_SVR_DVSN_CD: "0",
	};
	return {
		kind: "cancel",
		market: "overseas",
		env,
		api: "overseas_stock.v1_해외주식-003",
		tr_id: "TTTT1004U",
		params,
		summary() {
			return (
				`[정정/취소 준비] 해외 ${rvseCncl === "02" ? "취소" : "정정"} ${req.excd} ${req.symb} ` +
				`원주문 ${req.orgnOdno} ${req.qty}주 — env=${env}, tr_id=TTTT1004U`
			);
		},
	};
}

/** 준비된 해외 정정/취소 실행. */
export function sendOverseasCancel(prepared: PreparedCancel): Promise<CallResult> {
	if (prepared.market !== "overseas" || prepared.kind !== "cancel") {
		throw new Error("sendOverseasCancel: 해외 정정/취소 준비 객체가 아닙니다.");
	}
	return callApi(prepared.api, prepared.params, { env: prepared.env, trId: prepared.tr_id });
}

export type { KisEnv };
