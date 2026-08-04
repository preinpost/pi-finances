/**
 * src/roles/market.ts — 시세 역할 (core REST/WebSocket을 typed wrapper로 확장).
 *
 * 에이전트가 v2 키/파라미터를 몰라도 시세 조회가 가능하도록, 잘 알려진
 * 시세 API를 함수로 노출한다. 원시 결과(RawResult.data)는 그대로 반환하고,
 * 편의 집계(장기 차트 합산)만 여기서 제공한다.
 */
import { callApi } from "../core/client.ts";
import type { EnvArg } from "../core/auth.ts";
import type { CallResult } from "../core/client.ts";

// ── 현재가 ────────────────────────────────────────────────────────────────

/** 국내주식 현재가 (domestic_stock.v1_국내주식-008, FHKST01010100). */
export function getDomesticPrice(symb: string, env?: EnvArg): Promise<CallResult> {
	return callApi(
		"domestic_stock.v1_국내주식-008",
		{ FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symb },
		{ env: env ?? "auto" },
	);
}

/**
 * 해외주식 현재체결가 (overseas_stock.v1_해외주식-009, HHDFS00000300).
 * excd: NAS/NYS/AMS, symb: 종목코드(예: RKLB). 실시간 시세는 유료 구독일 수 있다.
 */
export function getOverseasPrice(excd: string, symb: string, env?: EnvArg): Promise<CallResult> {
	return callApi("overseas_stock.v1_해외주식-009", { excd, symb }, { env: env ?? "auto" });
}

// ── 차트 ─────────────────────────────────────────────────────────────────

export interface DomesticChartOptions {
	period?: "D" | "W" | "M" | "Y";
	date1?: string; // YYYYMMDD (기본: 오늘-150일)
	date2?: string; // YYYYMMDD (기본: 오늘)
	env?: EnvArg;
}

/** 국내주식 기간별시세 (domestic_stock.v1_국내주식-016, FHKST03010100). */
export function getDomesticChart(symb: string, opts?: DomesticChartOptions): Promise<CallResult> {
	const now = new Date();
	const d150 = new Date(now.getTime() - 150 * 86_400_000);
	const fmt = (d: Date) =>
		`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
	return callApi(
		"domestic_stock.v1_국내주식-016",
		{
			FID_COND_MRKT_DIV_CODE: "J",
			FID_INPUT_ISCD: symb,
			FID_INPUT_DATE_1: opts?.date1 ?? fmt(d150),
			FID_INPUT_DATE_2: opts?.date2 ?? fmt(now),
			FID_PERIOD_DIV_CODE: opts?.period ?? "D",
			FID_ORG_ADJ_PRC: "0",
		},
		{ env: opts?.env ?? "auto" },
	);
}

export interface OverseasChartOptions {
	gubn?: "0" | "1" | "2"; // 0=일별(기본), 1=주별, 2=월별
	bymd?: string; // 조회기준일 YYYYMMDD (기본: 오늘)
	modp?: "0" | "1"; // 0=미반영(기본), 1=수정주가 반영
	env?: EnvArg;
}

/** 해외주식 기간별시세 (overseas_stock.v1_해외주식-010, HHDFS76240000). output2 최대 100행. */
export function getOverseasChart(excd: string, symb: string, opts?: OverseasChartOptions): Promise<CallResult> {
	const now = new Date();
	const fmt = (d: Date) =>
		`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
	return callApi(
		"overseas_stock.v1_해외주식-010",
		{ excd, symb, gubn: opts?.gubn ?? "0", bymd: opts?.bymd ?? fmt(now), modp: opts?.modp ?? "0" },
		{ env: opts?.env ?? "auto" },
	);
}

export interface OverseasChartFullOptions {
	/** 조회 종료일 YYYYMMDD (기본: 오늘). */
	endDate?: string;
	/** 역산할 일수 (기본 365 — 52주 패턴). */
	days?: number;
	env?: EnvArg;
	/** 안전장치 — 최대 연속 조회 횟수 (기본 10). */
	maxCalls?: number;
}

export interface OverseasChartFullResult {
	/** output2 합산 (오래된 순). 각 행은 xymd(YYYYMMDD), open/high/low/clos 등. */
	bars: Record<string, unknown>[];
	calls: number;
}

/**
 * 해외주식 일봉을 bymd를 과거로 되감으며 여러 번 조회해 합산한다.
 * output2가 최대 100행이므로 52주 고점/저점 등 장기 집계에 사용한다.
 * (SKILL.md의 52주 패턴을 코드화 — 주봉/월봉은 100행이면 충분해 일봉만 지원)
 */
export async function fetchOverseasChartFull(
	excd: string,
	symb: string,
	opts?: OverseasChartFullOptions,
): Promise<OverseasChartFullResult> {
	const days = Math.max(1, Math.floor(opts?.days ?? 365));
	const maxCalls = Math.max(1, Math.floor(opts?.maxCalls ?? 10));
	const now = new Date();
	const fmt = (d: Date) =>
		`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
	const end = opts?.endDate ? parseYmd(opts.endDate) : now;
	const cutoff = new Date(end.getTime() - (days - 1) * 86_400_000);

	const rows: Record<string, unknown>[] = [];
	let bymd = fmt(end);
	let calls = 0;
	const seen = new Set<string>();

	while (calls < maxCalls) {
		const res = await getOverseasChart(excd, symb, { gubn: "0", bymd, modp: "0", env: opts?.env });
		const page = (res.data.output2 as Record<string, unknown>[] | undefined) ?? [];
		calls++;
		for (const row of page) {
			const xymd = String(row.xymd ?? "");
			if (!xymd || seen.has(xymd)) continue;
			seen.add(xymd);
			rows.push(row);
		}
		if (page.length === 0) break;
		// 이번 페이지의 가장 오래된 날짜 - 1일을 다음 기준일로
		const earliest = page.reduce<string | null>((acc, r) => {
			const d = String(r.xymd ?? "");
			return d && (!acc || d < acc) ? d : acc;
		}, null);
		if (!earliest) break;
		const next = new Date(parseYmd(earliest).getTime() - 86_400_000);
		if (next < cutoff) break; // 목표 기간 도달
		bymd = fmt(next);
	}

	rows.sort((a, b) => String(a.xymd ?? "").localeCompare(String(b.xymd ?? "")));
	return { bars: rows, calls };
}

/** YYYYMMDD 문자열 → Date (파싱 실패 시 기본 오늘). */
function parseYmd(v: string): Date {
	const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
	if (!m) return new Date();
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// ── 실시간 (WebSocket) ────────────────────────────────────────────────────

export { subscribeRealtime } from "../core/ws.ts";
export type { SubscribeOptions, WsResult, WsMessage } from "../core/ws.ts";
