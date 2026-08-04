/**
 * src/roles/research.ts — 리서치 역할 (재무제표/뉴스/애널리스트 컨센서스).
 *
 * 국내주식 리서치 데이터 조회를 v2 키/파라미터를 몰라도 쓸 수 있도록 typed
 * wrapper로 노출한다. 검증 완료된 API (2026-08, 포털 스펙 + 실측):
 *  - 손익계산서  domestic_stock.v1_국내주식-079 (FHKST66430200)
 *  - 재무비율    domestic_stock.v1_국내주식-080 (FHKST66430300)
 *  - 뉴스        domestic_stock.국내주식-141    (FHKST01011800)
 *  - 컨센서스    domestic_stock.국내주식-187    (HHKST668300C0)
 */
import { callApi } from "../core/client.ts";
import type { EnvArg } from "../core/auth.ts";
import type { CallResult } from "../core/client.ts";

// ── 재무제표 ─────────────────────────────────────────────────────────────

/**
 * 국내주식 손익계산서 (domestic_stock.v1_국내주식-079, FHKST66430200).
 * FID_DIV_CLS_CODE=1(분기) — ⚠️ 분기 데이터는 **연단위 누적합산** 기준.
 * 응답(output): sale_account(매출) / bsop_prti(영업익) / thtr_ntin(순익).
 * 최신 분기는 실적발표 후 반영되는 시차가 있다.
 */
export function getIncomeStatement(symb: string, env?: EnvArg): Promise<CallResult> {
	return callApi(
		"domestic_stock.v1_국내주식-079",
		{ FID_DIV_CLS_CODE: "1", fid_cond_mrkt_div_code: "J", fid_input_iscd: symb },
		{ env: env ?? "auto" },
	);
}

/**
 * 국내주식 재무비율 (domestic_stock.v1_국내주식-080, FHKST66430300).
 * FID_DIV_CLS_CODE=1(분기) — ⚠️ 분기 데이터는 연단위 누적합산, roe_val은 당분기
 * 기준이므로 리포트에서는 TTM(직전 12개월)으로 재해석해 표기한다.
 * 응답(output): grs(매출증가율) / bsop_prfi_inrt(영업익증가율) / roe_val / eps / bps / lblt_rate(부채비율).
 */
export function getFinancialRatios(symb: string, env?: EnvArg): Promise<CallResult> {
	return callApi(
		"domestic_stock.v1_국내주식-080",
		{ FID_DIV_CLS_CODE: "1", fid_cond_mrkt_div_code: "J", fid_input_iscd: symb },
		{ env: env ?? "auto" },
	);
}

// ── 뉴스 ─────────────────────────────────────────────────────────────────

/**
 * 국내주식 뉴스 제목 (domestic_stock.국내주식-141, FHKST01011800).
 * 필수 필드가 전부 "공백 필수 입력" — FID_INPUT_ISCD만 종목코드(공백=전체).
 * 응답(output[]): hts_pbnt_titl_cntt(제목) / dorg(언론사) / data_dt / data_tm.
 * ⚠️ 시장 전체 뉴스가 섞여 노이즈가 있을 수 있음 — Google RSS 등 2채널 교차 권장.
 */
export function getNews(symb: string, env?: EnvArg): Promise<CallResult> {
	return callApi(
		"domestic_stock.국내주식-141",
		{
			FID_NEWS_OFER_ENTP_CODE: "",
			FID_COND_MRKT_CLS_CODE: "",
			FID_INPUT_ISCD: symb,
			FID_TITL_CNTT: "",
			FID_INPUT_DATE_1: "",
			FID_INPUT_HOUR_1: "",
			FID_RANK_SORT_CLS_CODE: "",
			FID_INPUT_SRNO: "",
		},
		{ env: env ?? "auto" },
	);
}

// ── 애널리스트 컨센서스 ───────────────────────────────────────────────────

export interface AnalystConsensusSummary {
	/** 투자의견 (예: 매수/중립). */
	rcmdName?: string;
	/** 추정일 (월초 기준 — 실적발표 후 시차 존재). */
	estDate?: string;
	/** 한국투자 리서치 커버 여부. */
	covered: boolean;
}

export interface ConsensusResult extends CallResult {
	consensus: AnalystConsensusSummary;
}

/**
 * 국내주식 종목추정실적 — 애널리스트 컨센서스 (domestic_stock.국내주식-187, HHKST668300C0).
 * ⚠️ 한국투자 리서치 커버 약 160개 기업 한정 — 중소형주는 빈 응답이 정상
 * ('커버 안 됨'으로 표기).
 * 응답 컨테이너: output1(담당 애널리스트/투자의견), output2(5개년 실적),
 * output3(밸류) + top-level rcmd_name/estdate. 포털 스펙은 컨테이너만 정의 —
 * 필드 상세는 실측 기반.
 */
export async function getAnalystConsensus(symb: string, env?: EnvArg): Promise<ConsensusResult> {
	const raw = await callApi("domestic_stock.국내주식-187", { SHT_CD: symb }, { env: env ?? "auto" });
	const rcmdName = strOrUndef(raw.data.rcmd_name);
	const estDate = strOrUndef(raw.data.estdate);
	return {
		...raw,
		consensus: { rcmdName, estDate, covered: Boolean(rcmdName || estDate) },
	};
}

function strOrUndef(v: unknown): string | undefined {
	return typeof v === "string" && v ? v : undefined;
}
