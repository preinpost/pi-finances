/**
 * pi-kis-trading
 * ==============
 * Korea Investment (KIS) Open API client for pi — direct REST calls, no MCP
 * server, no dynamic code download.
 *
 * Tools:
 *   - kis_api             generic dispatch: api "category.api_type" + params
 *   - kis_list_apis       discover available APIs (by category)
 *   - kis_overseas_price  해외주식 현재체결가 (excd NAS/NYS/AMS, symb)
 *   - kis_overseas_chart  해외주식 기간별시세 일/주/월 (dailyprice)
 *   - kis_domestic_price  국내주식 현재가 (symb 6자리)
 *
 * Commands:
 *   - /kis-key    register API keys → ~/.pi/agent/kis-keys.json (0600)
 *   - /kis-status diagnose keys / token cache / api count
 *
 * Keys: ~/.pi/agent/kis-keys.json (0600, same pattern as auth.json) or env
 * KIS_APP_KEY / KIS_APP_SECRET (paper: KIS_PAPER_APP_KEY/_SECRET).
 * Tokens: cached in ~/.pi/agent/kis-token.json (0600); issuance sends an
 * SMS alert (알림톡) so the cache is reused until expiry (~24h).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { callApi, listApis } from "./src/client.ts";
import { keysPath, loadKeys, resolveEnv, tokenAge } from "./src/auth.ts";
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

export default async function (pi: ExtensionAPI) {
	// Migrate plaintext key/token files into the OS keyring (when active).
	await migrateSecretsToKeyring();
	// ── generic dispatch ────────────────────────────────────────────────
	pi.registerTool({
		name: "kis_api",
		label: "KIS API",
		description:
			"한국투자증권 OPEN API 직접 호출 (시세/차트/호가/순위/주문). " +
			`api는 "category.api_type" 형식 (예: "overseas_stock.price", "domestic_stock.inquire_price"). ` +
			"전체 목록은 kis_list_apis로 조회. params에는 해당 API의 파라미터를 소문자 이름으로 전달 " +
			"(예: excd, symb). env: real(실전)/paper(모의)/auto(기본). 응답의 rt_cd가 0이면 성공.",
		parameters: Type.Object({
			api: Type.String({ description: 'API 식별자, 예: "overseas_stock.price"' }),
			params: Type.Object({}, {
				description: "API 파라미터 (소문자 이름, 예: { excd: \"NAS\", symb: \"RKLB\" })",
				additionalProperties: Type.Unknown(),
			}),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")], {
				description: "real(실전)/paper(모의)/auto(기본: 모의 키 있으면 모의)",
			})),
		}),
		async execute(_id, params) {
			try {
				const result = await callApi(params.api, params.params ?? {}, params.env ?? "auto");
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
			"한국투자증권 OPEN API 목록 조회. category 지정 시 해당 카테고리만 " +
			'(예: "overseas_stock", "domestic_stock"). kis_api 도구 호출 전에 API 이름을 확인할 때 사용.',
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
			return textResult(
				JSON.stringify(
					{
						total: names.length,
						categories: cats,
						apis: names,
					},
					null,
					2,
				),
			);
		},
	});

	// ── convenience: 해외주식 현재체결가 ────────────────────────────────
	pi.registerTool({
		name: "kis_overseas_price",
		label: "해외주식 현재가",
		description:
			"해외주식(미국 등) 현재체결가 조회. excd: NAS(나스닥)/NYS(뉴욕)/AMS(아멕스), symb: 종목코드(예: RKLB, AAPL). " +
			"rt_cd=0이면 성공이며 output에 현재가/전일대비 등이 담깁니다. 실시간 시세는 유료 구독일 수 있습니다.",
		parameters: Type.Object({
			excd: Type.String({ description: "거래소: NAS(나스닥)/NYS(뉴욕)/AMS(아멕스)" }),
			symb: Type.String({ description: "종목코드, 예: RKLB, AAPL" }),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await callApi("overseas_stock.price", { excd: params.excd, symb: params.symb }, params.env ?? "auto");
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
			"해외주식 기간별시세(일/주/월) 조회. excd: NAS/NYS/AMS, symb: 종목코드. " +
			"gubn: 0=일별, 1=주별, 2=월별. bymd: 조회기준일(YYYYMMDD, 기본 오늘). modp: 0=수정주가 반영. " +
			"output2에 기간별 시세 목록(최대 100행)이 담기므로 52주 고점/저점 계산 등에 활용. " +
			"100행 초과 구간이 필요하면 bymd를 과거 날짜로 지정해 여러 번 호출. " +
			"(지수/환율용 inquire_daily_chartprice는 kis_api로 호출 가능)",
		parameters: Type.Object({
			excd: Type.String({ description: "거래소: NAS/NYS/AMS" }),
			symb: Type.String({ description: "종목코드, 예: RKLB" }),
			gubn: Type.Optional(Type.Union([Type.Literal("0"), Type.Literal("1"), Type.Literal("2")], { description: "0=일별(기본), 1=주별, 2=월별" })),
			bymd: Type.Optional(Type.String({ description: "조회기준일 YYYYMMDD (기본: 오늘)" })),
			modp: Type.Optional(Type.Union([Type.Literal("0"), Type.Literal("1")], { description: "0=수정주가 반영(기본), 1=미반영" })),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const now = new Date();
				const bymd =
					params.bymd ??
					`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
				const result = await callApi(
					"overseas_stock.dailyprice",
					{ excd: params.excd, symb: params.symb, gubn: params.gubn ?? "0", bymd, modp: params.modp ?? "0" },
					params.env ?? "auto",
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
			"국내주식 현재가 조회. symb: 6자리 종목코드 (예: 005930=삼성전자). " +
			"output에 현재가/전일대비/등락률 등이 담깁니다.",
		parameters: Type.Object({
			symb: Type.String({ description: "6자리 종목코드, 예: 005930" }),
			env: Type.Optional(Type.Union([Type.Literal("real"), Type.Literal("paper"), Type.Literal("auto")])),
		}),
		async execute(_id, params) {
			try {
				const result = await callApi(
					"domestic_stock.inquire_price",
					{ fid_cond_mrkt_div_code: "J", fid_input_iscd: params.symb },
					params.env ?? "auto",
				);
				return textResult(JSON.stringify(result, null, 2));
			} catch (e) {
				return textResult(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2));
			}
		},
	});

	// ── /kis-key ────────────────────────────────────────────────────────
	pi.registerCommand("kis-key", {
		description: "한국투자증권 OPEN API 키 등록 (입력창 → ~/.pi/agent/kis-keys.json, 0600)",
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
		description: "KIS 연동 상태 진단 (키 파일, 토큰 캐시, 지원 API 수)",
		handler: async (_args, ctx) => {
			const keys = loadKeys();
			const env = resolveEnv("auto");
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
				`apis       : ${listApis().length}개 (configs + generated map)`,
				`사용법     : "RKLB 현재가 알려줘" → kis_overseas_price / kis_api`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	const keysReady = !!loadKeys().appKey;
	if (!keysReady) {
		console.warn("[pi-kis-trading] KIS API keys not registered — run /kis-key (stored in ~/.pi/agent/kis-keys.json).");
	}
}
