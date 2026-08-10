/**
 * src/roles/portfolio.ts — 포트폴리오 역할 (잔고/체결/미체결 조회).
 *
 * 조회 전용 — 안전. CANO/ACNT_PRDT_CD는 core buildParams가 등록된 계좌로
 * 자동 주입하므로 계좌 미등록 시 명확한 에러를 낸다 (/kis-key에서 등록).
 */
import { callApi } from "../client.ts";
import type { EnvArg } from "../auth.ts";
import type { CallResult } from "../client.ts";
import type { Market } from "./types.ts";

function ymd(offsetDays = 0): string {
	const d = new Date(Date.now() + offsetDays * 86_400_000);
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 국내 주식잔고 조회 (domestic_stock.v1_국내주식-006, TTTC8434R).
 * 기본값은 KIS 공식 예제 기준 (AFHR_FLPR_YN=N, INQR_DVSN=01, ...).
 */
export function getBalance(env?: EnvArg): Promise<CallResult> {
	return callApi(
		"domestic_stock.v1_국내주식-006",
		{
			AFHR_FLPR_YN: "N",
			OFL_YN: "",
			INQR_DVSN: "01",
			UNPR_DVSN: "01",
			FUND_STTL_ICLD_YN: "N",
			FNCG_AMT_AUTO_RDPT_YN: "N",
			PRCS_DVSN: "00",
		},
		{ env: env ?? "auto" },
	);
}

export interface OverseasBalanceOptions {
	/** 거래소 (기본 "NASD" — 미국 전체는 NASD/NYSE/AMEX 각각 조회 필요). */
	excd?: string;
	/** 결제통화 (기본 "USD"). */
	currency?: string;
	env?: EnvArg;
}

/** 해외주식 잔고 조회 (overseas_stock.v1_해외주식-006, TTTS3012R). */
export function getOverseasBalance(opts?: OverseasBalanceOptions): Promise<CallResult> {
	return callApi(
		"overseas_stock.v1_해외주식-006",
		{ OVRS_EXCG_CD: opts?.excd ?? "NASD", TR_CRCY_CD: opts?.currency ?? "USD" },
		{ env: opts?.env ?? "auto" },
	);
}

export interface OrderFillsOptions {
	/** 조회 시장 (기본: domestic). */
	market?: Market;
	/** 조회 시작일 YYYYMMDD (기본: 오늘). */
	startDate?: string;
	/** 조회 종료일 YYYYMMDD (기본: 오늘). */
	endDate?: string;
	/** "00" 전체 / "01" 매도 / "02" 매수 (기본 전체). */
	side?: "00" | "01" | "02";
	/** "00" 전체 / "01" 체결 / "02" 미체결 (기본 전체). */
	ccld?: "00" | "01" | "02";
	env?: EnvArg;
}

/**
 * 일별 주문/체결 내역 조회.
 * - 국내: domestic_stock.v1_국내주식-005 (다중 TR_ID — 표준 tr_id TTTC0081R 지정)
 * - 해외: overseas_stock.v1_해외주식-007 (TTTS3035R)
 */
export function getOrderFills(opts?: OrderFillsOptions): Promise<CallResult> {
	const start = opts?.startDate ?? ymd();
	const end = opts?.endDate ?? ymd();
	const side = opts?.side ?? "00";
	const ccld = opts?.ccld ?? "00";
	if ((opts?.market ?? "domestic") === "domestic") {
		return callApi(
			"domestic_stock.v1_국내주식-005",
			{
				INQR_STRT_DT: start,
				INQR_END_DT: end,
				SLL_BUY_DVSN_CD: side,
				PDNO: "",
				ORD_GNO_BRNO: "",
				ODNO: "",
				CCLD_DVSN: ccld,
				INQR_DVSN: "00",
				INQR_DVSN_1: "",
				INQR_DVSN_3: "00",
				EXCG_ID_DVSN_CD: "KRX",
			},
			{ env: opts?.env ?? "auto", trId: "TTTC0081R" },
		);
	}
	return callApi(
		"overseas_stock.v1_해외주식-007",
		{
			PDNO: "%",
			ORD_STRT_DT: start,
			ORD_END_DT: end,
			SLL_BUY_DVSN: side,
			CCLD_NCCS_DVSN: ccld,
			OVRS_EXCG_CD: "%",
			SORT_SQN: "DS",
			ORD_DT: "",
			ORD_GNO_BRNO: "",
			ODNO: "",
		},
		{ env: opts?.env ?? "auto" },
	);
}

export interface PendingOrdersOptions {
	/** 거래소 (기본 "NASD" — 미국 전체 조회는 % 불가, 거래소별 조회). */
	excd?: string;
	env?: EnvArg;
}

/**
 * 미체결내역 조회 — 현재 **해외주식만** 지원 (overseas_stock.v1_해외주식-005, TTTS3018R).
 *
 * 국내는 이 스펙(338개)에 미체결 전용 API가 없어(퇴직연금용 제외) 별도 구현하지 않는다.
 * 대신 국내 미체결은 getOrderFills({ market: "domestic", ccld: "02" })로
 * 주식일별주문체결조회의 미체결 필터를 사용한다.
 */
export function getPendingOrders(opts?: PendingOrdersOptions): Promise<CallResult> {
	return callApi(
		"overseas_stock.v1_해외주식-005",
		{ OVRS_EXCG_CD: opts?.excd ?? "NASD", SORT_SQN: "DS" },
		{ env: opts?.env ?? "auto" },
	);
}

/** 국내 미체결은 전용 API가 없음을 안내하는 상수 메시지 (가이드용). */
export const DOMESTIC_PENDING_NOTICE =
	"국내 미체결 전용 API는 이 스펙에 없습니다 — getOrderFills({ market: \"domestic\", ccld: \"02\" })로 조회하세요.";
