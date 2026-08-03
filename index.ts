/**
 * pi-kis-trading
 * ==============
 * Korea Investment (KIS) Open API client for pi — direct REST calls, no MCP
 * server, no dynamic code download.
 *
 * v2: 공식 포털(apiportal.koreainvestment.com) 전체 API 규격 기반 338개 API
 * (src/generated/apis.json). 키 형식 "category.api_id"
 * (예: "overseas_stock.v1_해외주식-009", "domestic_stock.v1_국내주식-008").
 * 구버전 키(예: "overseas_stock.price")는 src/generated/aliases.json으로 호환.
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
 *
 * WebSocket: REST 토큰과 별개로 웹소켓 전용 접속키(approval key, /oauth2/Approval)를
 * 발급받아 ws://ops.koreainvestment.com:21000(실전)/:31000(모의)에 연결한다.
 * tr_id 맵: src/generated/ws-tr-ids.json (WEBSOCKET 60개 중 58개 매핑).
 *
 * Keys: OS 키체인 또는 ~/.pi/agent/kis-keys.json (0600) 또는 env
 * KIS_APP_KEY / KIS_APP_SECRET (paper: KIS_PAPER_APP_KEY/_SECRET).
 * Tokens: cached in ~/.pi/agent/kis-token.json (0600); issuance sends an
 * SMS alert (알림톡) so the cache is reused until expiry (~24h).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { callApi, listApis, specStats } from "./src/client.ts";
import { keysPath, loadKeys, resolveEnv, tokenAge } from "./src/auth.ts";
import { approvalAge, subscribeRealtime, wsTrIds } from "./src/ws.ts";
import { hasPlaintextFiles, migrateSecretsToKeyring, store } from "./src/secret.ts";
import type { KisKeys } from "./src/secret.ts";

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

function masked(v: string | undefined): string {
	return v ? `${v.slice(0, 4)}***${v.length > 8 ? `(${v.length})` : ""}` : "—";
}

async function saveKeys(keys: Record<string, string>): Promise<void> {
	await store.saveKeys(keys as unknown as KisKeys);
}

function textResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

/** 오늘 기준 YYYYMMDD (daysAgo일 전). */
function dateStr(daysAgo = 0): string {
	const d = new Date(Date.now() - daysAgo * 86_400_000);
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export default async function (pi: ExtensionAPI) {
	// Migrate plaintext key/token files into the OS keyring (when active).
	await migrateSecretsToKeyring();
	// ── generic dispatch ────────────────────────────────────────────────
	pi.registerTool({
		name: "kis_api",
		label: "KIS API",
		description:
			"한국투자증권 OPEN API 직접 호출 (시세/차트/호가/순위/주문). " +
			`api는 v2 키 형식 "category.api_id" (예: "overseas_stock.v1_해외주식-009", "domestic_stock.v1_국내주식-008"). ` +
			"전체 목록은 kis_list_apis로 조회 (구버전 키 'overseas_stock.price' 등도 alias로 동작). " +
			"params에는 스펙의 파라미터를 소문자 이름 또는 대문자 키로 전달 (예: excd, symb 또는 EXCD, SYMB). " +
			"다중 TR_ID API(주문 등)는 tr_id 파라미터 필수 — 미지정 시 사용 가능한 tr_id 목록이 에러로 표시됩니다. " +
			"pages(기본 1, 최대 10): tr_cont 연속조회 페이지네이션, output 배열이 병합됩니다. " +
			"env: real(실전)/paper(모의)/auto(기본). POST 주문/정정/취소 API는 hashkey 자동 적용.",
		parameters: Type.Object({
			api: Type.String({ description: 'v2 키, 예: "overseas_stock.v1_해외주식-009"' }),
			params: Type.Object({}, {
				description: "API 파라미터 (소문자 이름 또는 대문자 키, 예: { excd: \"NAS\", symb: \"RKLB\" })",
				additionalProperties: Type.Unknown(),
			}),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")], {
				description: "real(실전)/paper(모의)/auto(기본: 모의 키 있으면 모의)",
			})),
			tr_id: Type.Optional(Type.String({ description: "다중 TR_ID API용 명시적 tr_id (예: \"TTTT1002U\")" })),
			pages: Type.Optional(Type.Number({ description: "tr_cont 연속조회 페이지 수 (기본 1, 최대 10)" })),
		}),
		async execute(_id, params) {
			try {
				const result = await callApi(params.api, params.params ?? {}, {
					env: params.env ?? "auto",
					trId: params.tr_id,
					pages: params.pages,
				});
				return textResult(JSON.stringify(result, null, 2));
			} catch (e) {
				return textResult(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2));
			}
		},
	});

	// ── API discovery ───────────────────────────────────────────────────
	pi.registerTool({
		name: "kis_list_apis",
		label: "KIS API 목록",
		description:
			"한국투자증권 OPEN API 목록 조회 (공식 포털 스펙 기반 338개). category 지정 시 해당 카테고리만 " +
			'(예: "overseas_stock", "domestic_stock"). kis_api 도구 호출 전에 v2 키를 확인할 때 사용.',
		parameters: Type.Object({
			category: Type.Optional(Type.String({ description: '카테고리 필터, 예: "overseas_stock"' })),
		}),
		async execute(_id, params) {
			const names = listApis(params.category || undefined);
			const cats: Record<string, number> = {};
			for (const n of names) {
				const c = n.split(".")[0];
				cats[c] = (cats[c] ?? 0) + 1;
			}
			const wsMap = wsTrIds();
			const websocketTrIds: Record<string, string> = {};
			for (const n of names) {
				const e = wsMap[n];
				if (e) websocketTrIds[n] = e.tr_id;
			}
			return textResult(
				JSON.stringify(
					{
						total: names.length,
						categories: cats,
						apis: names,
						websocket_tr_ids: websocketTrIds,
					},
					null,
					2,
				),
			);
		},
	});

	// ── realtime: 실시간 시세 (WebSocket) ─────────────────────────────
	pi.registerTool({
		name: "kis_realtime",
		label: "실시간 시세 (WebSocket)",
		description:
			"한국투자증권 실시간 시세 구독 (WebSocket, REST와 별개 인증 — 웹소켓 전용 접속키 자동 발급/캐시). " +
			"tr_id(필수): ws-tr-ids.json 기준 실시간 TR_ID, tr_key: 종목코드. " +
			'예: 국내주식 실시간체결가 { tr_id: "H0STCNT0", tr_key: "005930" } (삼성전자), ' +
			'해외주식 실시간체결가 { tr_id: "HDFSCNT0", tr_key: "DNASRKLB" } (RKLB, D+시장구분3자리+종목코드). ' +
			"호가 H0STASP0/HDFSASP0, 체결통보 H0STCNI0(tr_key=HTS ID) 등 — 전체 tr_id는 kis_list_apis 결과의 websocket_tr_ids 참고. " +
			"duration_sec 후 자동 구독해제(tr_type=2)+종료. 장 마감이면 메시지 0개여도 정상입니다.",
		parameters: Type.Object({
			tr_id: Type.String({ description: '실시간 TR_ID (예: "H0STCNT0" 국내체결, "HDFSCNT0" 해외체결)' }),
			tr_key: Type.String({ description: '구독 종목코드 (예: "005930", "DNASRKLB", HTS ID)' }),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")], {
				description: "real(실전)/paper(모의)/auto(기본: 모의 키 있으면 모의)",
			})),
			duration_sec: Type.Optional(Type.Number({ description: "구독 시간(초) — 기본 10, 최대 60" })),
			max_messages: Type.Optional(Type.Number({ description: "최대 수신 메시지 수 — 기본 20" })),
		}),
		async execute(_id, params) {
			const trId = params.tr_id.toUpperCase();
			const known = Object.values(wsTrIds()).some((e) => e.tr_id === trId);
			if (!known) {
				const list = Object.entries(wsTrIds())
					.map(([k, e]) => `${e.tr_id} : ${e.name} (${k})`)
					.sort()
					.join("\n");
				return textResult(
					JSON.stringify(
						{
							ok: false,
							error: `알 수 없는 tr_id "${trId}" — ws-tr-ids.json 기준 사용 가능한 목록:\n${list}`,
						},
						null,
						2,
					),
				);
			}
			try {
				const result = await subscribeRealtime({
					trId,
					trKey: params.tr_key,
					env: params.env ?? "auto",
					durationMs: (params.duration_sec ?? 10) * 1000,
					maxMessages: params.max_messages ?? 20,
				});
				return textResult(JSON.stringify(result, null, 2));
			} catch (e) {
				return textResult(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2));
			}
		},
	});

	// ── convenience: 해외주식 현재체결가 ────────────────────────────────
	pi.registerTool({
		name: "kis_overseas_price",
		label: "해외주식 현재가",
		description:
			"해외주식(미국 등) 현재체결가 조회 (v2 키: overseas_stock.v1_해외주식-009, tr_id HHDFS00000300). " +
			"excd: NAS(나스닥)/NYS(뉴욕)/AMS(아멕스), symb: 종목코드(예: RKLB, AAPL). " +
			"rt_cd=0이면 성공이며 output에 현재가/전일대비 등이 담깁니다. 실시간 시세는 유료 구독일 수 있습니다.",
		parameters: Type.Object({
			excd: Type.String({ description: "거래소: NAS(나스닥)/NYS(뉴욕)/AMS(아멕스)" }),
			symb: Type.String({ description: "종목코드, 예: RKLB, AAPL" }),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await callApi("overseas_stock.v1_해외주식-009", { excd: params.excd, symb: params.symb }, {
					env: params.env ?? "auto",
				});
				return textResult(JSON.stringify(result, null, 2));
			} catch (e) {
				return textResult(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2));
			}
		},
	});

	// ── convenience: 해외주식 기간별시세 (일/주/월 차트) ────────────────
	pi.registerTool({
		name: "kis_overseas_chart",
		label: "해외주식 차트",
		description:
			"해외주식 기간별시세(일/주/월) 조회 (v2 키: overseas_stock.v1_해외주식-010, tr_id HHDFS76240000). " +
			"excd: NAS/NYS/AMS, symb: 종목코드. " +
			"gubn: 0=일별, 1=주별, 2=월별. bymd: 조회기준일(YYYYMMDD, 기본 오늘). modp: 0=미반영(기본), 1=수정주가 반영. " +
			"output2에 기간별 시세 목록(최대 100행)이 담기므로 52주 고점/저점 계산 등에 활용. " +
			"100행 초과 구간이 필요하면 bymd를 과거 날짜로 지정해 여러 번 호출. " +
			"(지수/환율용 inquire_daily_chartprice는 kis_api로 호출 가능)",
		parameters: Type.Object({
			excd: Type.String({ description: "거래소: NAS/NYS/AMS" }),
			symb: Type.String({ description: "종목코드, 예: RKLB" }),
			gubn: Type.Optional(Type.Union([Type.Literal("0"), Type.Literal("1"), Type.Literal("2")], { description: "0=일별(기본), 1=주별, 2=월별" })),
			bymd: Type.Optional(Type.String({ description: "조회기준일 YYYYMMDD (기본: 오늘)" })),
			modp: Type.Optional(Type.Union([Type.Literal("0"), Type.Literal("1")], { description: "0=미반영(기본), 1=수정주가 반영" })),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await callApi(
					"overseas_stock.v1_해외주식-010",
					{ excd: params.excd, symb: params.symb, gubn: params.gubn ?? "0", bymd: params.bymd ?? dateStr(), modp: params.modp ?? "0" },
					{ env: params.env ?? "auto" },
				);
				return textResult(JSON.stringify(result, null, 2));
			} catch (e) {
				return textResult(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2));
			}
		},
	});

	// ── convenience: 국내주식 현재가 ────────────────────────────────────
	pi.registerTool({
		name: "kis_domestic_price",
		label: "국내주식 현재가",
		description:
			"국내주식 현재가 조회 (v2 키: domestic_stock.v1_국내주식-008, tr_id FHKST01010100). " +
			"symb: 6자리 종목코드 (예: 005930=삼성전자). " +
			"output에 현재가/전일대비/등락률 등이 담깁니다.",
		parameters: Type.Object({
			symb: Type.String({ description: "6자리 종목코드, 예: 005930" }),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await callApi(
					"domestic_stock.v1_국내주식-008",
					{ FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: params.symb },
					{ env: params.env ?? "auto" },
				);
				return textResult(JSON.stringify(result, null, 2));
			} catch (e) {
				return textResult(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2));
			}
		},
	});

	// ── convenience: 국내주식 기간별시세 (일/주/월/년 차트) ─────────────
	pi.registerTool({
		name: "kis_domestic_chart",
		label: "국내주식 차트",
		description:
			"국내주식 기간별시세(일/주/월/년) 조회 (v2 키: domestic_stock.v1_국내주식-016, tr_id FHKST03010100). " +
			"symb: 6자리 종목코드 (예: 005930), period: D=일봉(기본)/W=주봉/M=월봉/Y=년봉. " +
			"date1/date2: 조회 기간 YYYYMMDD (기본: 최근 150일 ~ 오늘, 최대 100개 데이터). " +
			"output1에 기간별 시세 목록이 담깁니다.",
		parameters: Type.Object({
			symb: Type.String({ description: "6자리 종목코드, 예: 005930" }),
			period: Type.Optional(Type.Union([Type.Literal("D"), Type.Literal("W"), Type.Literal("M"), Type.Literal("Y")], { description: "D=일봉(기본), W=주봉, M=월봉, Y=년봉" })),
			date1: Type.Optional(Type.String({ description: "조회 시작일자 YYYYMMDD (기본: 오늘-150일)" })),
			date2: Type.Optional(Type.String({ description: "조회 종료일자 YYYYMMDD (기본: 오늘)" })),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await callApi(
					"domestic_stock.v1_국내주식-016",
					{
						FID_COND_MRKT_DIV_CODE: "J",
						FID_INPUT_ISCD: params.symb,
						FID_INPUT_DATE_1: params.date1 ?? dateStr(150),
						FID_INPUT_DATE_2: params.date2 ?? dateStr(),
						FID_PERIOD_DIV_CODE: params.period ?? "D",
						FID_ORG_ADJ_PRC: "0",
					},
					{ env: params.env ?? "auto" },
				);
				return textResult(JSON.stringify(result, null, 2));
			} catch (e) {
				return textResult(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2));
			}
		},
	});

	// ── /kis-key ────────────────────────────────────────────────────────
	pi.registerCommand("kis-key", {
		description: "한국투자증권 OPEN API 키 등록 (입력창 → OS 키체인, 폴백: ~/.pi/agent/kis-keys.json, 0600)",
		handler: async (_args, ctx) => {
			const existing = loadKeys();
			const appKey = await ctx.ui.input(
				"KIS App Key (실전)",
				existing.appKey ? `현재 값: ${masked(existing.appKey)} — 엔터로 유지` : "개발자센터에서 발급받은 App Key",
			);
			if (appKey === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}
			const appSecret = await ctx.ui.input(
				"KIS App Secret (실전)",
				existing.appSecret ? `현재 값: ${masked(existing.appSecret)} — 엔터로 유지` : "App Secret",
			);
			if (appSecret === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}

			const keys: Record<string, string> = { ...(existing as KisKeys) };
			if (appKey.trim()) keys.appKey = appKey.trim();
			if (appSecret.trim()) keys.appSecret = appSecret.trim();

			const wantPaper = await ctx.ui.confirm("모의투자 키", "모의투자(paper) App Key/Secret도 등록할까요? (선택)");
			if (wantPaper) {
				const pKey = await ctx.ui.input("KIS Paper App Key (모의)", existing.paperAppKey ? `현재: ${masked(existing.paperAppKey)} — 엔터로 유지` : "");
				if (pKey && pKey.trim()) keys.paperAppKey = pKey.trim();
				const pSecret = await ctx.ui.input("KIS Paper App Secret (모의)", existing.paperAppSecret ? `현재: ${masked(existing.paperAppSecret)} — 엔터로 유지` : "");
				if (pSecret && pSecret.trim()) keys.paperAppSecret = pSecret.trim();
			}

			const wantAcct = await ctx.ui.confirm("계좌 정보", "주문/잔고 API용 계좌 정보도 등록할까요? (시세 조회엔 불필요)");
			if (wantAcct) {
				const hts = await ctx.ui.input("HTS ID", existing.htsId ? `현재: ${masked(existing.htsId)} — 엔터로 유지` : "");
				if (hts && hts.trim()) keys.htsId = hts.trim();
				const acct = await ctx.ui.input("실전 계좌번호 (8자리)", existing.acctStock ? `현재: ${masked(existing.acctStock)} — 엔터로 유지` : "");
				if (acct && acct.trim()) keys.acctStock = acct.trim();
			}

			await saveKeys(keys);
			ctx.ui.notify(
				`키 저장 완료 → ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : keysPath} (${store.backend})\n` +
				`실전: ${masked(keys.appKey)} / 모의: ${keys.paperAppKey ? masked(keys.paperAppKey) : "미등록"}`,
				"success",
			);
		},
	});

	// ── /kis-status ─────────────────────────────────────────────────────
	pi.registerCommand("kis-status", {
		description: "KIS 연동 상태 진단 (키 파일, 토큰 캐시, API 수: REST/WEBSOCKET/alias)",
		handler: async (_args, ctx) => {
			const keys = loadKeys();
			const env = resolveEnv("auto");
			const stats = specStats();
			const lines = [
				`backend    : ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : "file (0600)"}`,
				`  plaintext: ${hasPlaintextFiles() ? `남아있음 → ${keysPath}` : "없음 (keyring 사용 중)"}`,
				`keys file  : ${store.backend === "keyring" ? "(keyring 사용 — 파일 불필요)" : existsSync(keysPath) ? keysPath : "MISSING — run /kis-key"}`,
				`appKey     : ${masked(keys.appKey)}`,
				`appSecret  : ${masked(keys.appSecret)}`,
				`paper keys : ${keys.paperAppKey ? `${masked(keys.paperAppKey)} / ${masked(keys.paperAppSecret)}` : "not set"}`,
				`accounts   : ${[keys.htsId, keys.acctStock].filter(Boolean).length}/2 set (주문/잔고용, 선택)`,
				`auto env   : ${env}`,
				`token cache: real=${tokenAge("real") !== null ? `${tokenAge("real")}s 남음` : "없음"} / paper=${tokenAge("paper") !== null ? `${tokenAge("paper")}s 남음` : "없음"}`,
				`approval   : real=${approvalAge("real") !== null ? `${approvalAge("real")}s 남음` : "없음"} / paper=${approvalAge("paper") !== null ? `${approvalAge("paper")}s 남음` : "없음"} (웹소켓 전용, REST 토큰과 별개)`,
				`apis       : ${stats.total}개 (REST ${stats.rest} / WEBSOCKET ${stats.websocket}) + alias ${stats.aliases}개`,
				`사용법     : "RKLB 현재가 알려줘" → kis_overseas_price / kis_api (v2 키: kis_list_apis로 확인)`,
				`실시간     : "삼성전자 실시간체결가" → kis_realtime { tr_id: "H0STCNT0", tr_key: "005930" }`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	const keysReady = !!loadKeys().appKey;
	if (!keysReady) {
		console.warn("[pi-kis-trading] KIS API keys not registered — run /kis-key (stored in ~/.pi/agent/kis-keys.json).");
	}
}
