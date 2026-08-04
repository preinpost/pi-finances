/**
 * src/agent/commands.ts — pi 커맨드 등록 (/kis-key, /kis-status).
 *
 * 동작·출력은 기존 index.ts와 동일하게 유지한다 (하위 호환).
 * 참고: pi의 ctx.ui.notify 타입은 "error"|"info"|"warning"만 허용하므로
 * 성공 알림은 "info"를 사용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { keysPath, loadKeys, resolveEnv, tokenAge } from "../core/auth.ts";
import { specStats } from "../core/client.ts";
import { approvalAge } from "../core/ws.ts";
import { hasPlaintextFiles, migrateSecretsToKeyring, store } from "../core/secret.ts";
import type { KisKeys } from "../core/secret.ts";

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

function masked(v: string | undefined): string {
	return v ? `${v.slice(0, 4)}***${v.length > 8 ? `(${v.length})` : ""}` : "—";
}

async function saveKeys(keys: Record<string, string>): Promise<void> {
	await store.saveKeys(keys as unknown as KisKeys);
}

export function registerCommands(pi: ExtensionAPI): void {
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
				const acct = await ctx.ui.input("실전 계좌번호", existing.acctStock ? `현재: ${masked(existing.acctStock)} — 엔터로 유지` : "");
				if (acct && acct.trim()) keys.acctStock = acct.trim();
			}

			await saveKeys(keys);
			ctx.ui.notify(
				`키 저장 완료 → ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : keysPath} (${store.backend})\n` +
				`실전: ${masked(keys.appKey)} / 모의: ${keys.paperAppKey ? masked(keys.paperAppKey) : "미등록"}`,
				"info",
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
				`accounts   : ${keys.acctStock ? "1 set" : "0 set"} (주문/잔고용, 선택)`,
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
}
