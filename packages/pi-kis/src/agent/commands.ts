/**
 * src/agent/commands.ts — pi 커맨드 등록 (/kis-key, /kis-status).
 *
 * 동작·출력은 기존 index.ts와 동일하게 유지한다 (하위 호환).
 * 참고: pi의 ctx.ui.notify 타입은 "error"|"info"|"warning"만 허용하므로
 * 성공 알림은 "info"를 사용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { keysPath, loadKeys, resolveEnv, tokenAge } from "../auth.ts";
import { specStats } from "../client.ts";
import { approvalAge } from "../ws.ts";
import { hasPlaintextFiles, migrateSecretsToKeyring, saveKeys as saveStoredKeys, store } from "../secret.ts";
import type { KisKeys } from "../secret.ts";
import { createWatcher, hasSessionWatcher, parseArgs as parseWatchArgs, setSessionWatcher, stopSessionWatcher } from "../watch.ts";

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

function masked(v: string | undefined): string {
	return v ? `${v.slice(0, 4)}***${v.length > 8 ? `(${v.length})` : ""}` : "—";
}

async function saveKeys(keys: Record<string, string>): Promise<void> {
	await saveStoredKeys(keys as unknown as KisKeys);
}

export function registerCommands(pi: ExtensionAPI): void {
	// ── /kis-key ────────────────────────────────────────────────────────
	pi.registerCommand("kis-key", {
		description: "한국투자증권 OPEN API 키 등록 (입력창 → OS 키체인, 폴백: ~/.pi/agent/kis-keys.json, 0600)",
		handler: async (_args, ctx) => {
			const existing = loadKeys();
			const appKey = await ctx.ui.input(
				"KIS App Key",
				existing.appKey ? `현재 값: ${masked(existing.appKey)} — 엔터로 유지` : "개발자센터에서 발급받은 App Key",
			);
			if (appKey === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}
			const appSecret = await ctx.ui.input(
				"KIS App Secret",
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
				`KIS 실전: ${masked(keys.appKey)} / 모의: ${keys.paperAppKey ? masked(keys.paperAppKey) : "미등록"}`,
				"info",
			);
		},
	});

	// ── /kis-status ─────────────────────────────────────────────────────
	pi.registerCommand("kis-status", {
		description: "KIS 연동 상태 진단 (키, 토큰 캐시, API 수: REST/WEBSOCKET/alias)",
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
				`토스       : 토스증권 툴(toss_*)은 pi-toss 패키지에서 제공 (pi install npm:pi-toss, 키는 /toss-key)`,
				`폴백      : "현재가/차트" → broker_price/broker_chart (KIS 우선, 실패 시 toss_* 안내)`,
				`워치      : 실시간 감시 → /kis-watch start --symbols ... (subagent 불필요)`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ── /kis-watch ────────────────────────────────────────────────────
	pi.registerCommand("kis-watch", {
		description:
			"실시간 가격 감시 (헤드리스 워치) — start/stop/status. 조건 충족 시 알림(선택: 사전 승인 주문). subagent 불필요.",
		handler: async (args, ctx) => {
			// pi 커맨드 args는 공백 구분 단일 문자열 — 토큰화 ("start --symbols ...")
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const sub = (tokens[0] ?? "").toLowerCase();
			const statePath = join(process.env.PI_CODING_AGENT_DIR ?? agentDir, "kis-watch.json");
			const readState = (): { pid?: unknown; mode?: unknown; startedAt?: unknown; stoppedAt?: unknown; lastError?: unknown; symbols?: unknown; order?: unknown } | null => {
				try {
					return JSON.parse(readFileSync(statePath, "utf8"));
				} catch {
					return null;
				}
			};
			try {
			if (sub === "stop") {
					if (hasSessionWatcher()) {
						stopSessionWatcher();
						ctx.ui.notify("세션 내 워치를 종료했습니다.", "info");
						return;
					}
					const st = readState();
					if (st?.mode === "session") {
						// 세션 워치 기록이 남아있지만 현재 세션에 없음 (pi 재시작 등) — 상태만 정리
						ctx.ui.notify("세션 워치는 이 세션에 없습니다 (pi 재시작으로 종료됨).", "info");
						return;
					}
					const pid = st && typeof st.pid === "number" ? st.pid : null;
					if (pid === null || (st && typeof st.stoppedAt === "string" && st.stoppedAt)) {
						ctx.ui.notify("실행 중인 워치가 없습니다.", "info");
						return;
					}
					try {
						process.kill(pid, 0); // 프로세스 존재 확인 (재사용된 pid로 무고한 프로세스 종료 방지)
					} catch {
						ctx.ui.notify(`워치 프로세스(pid ${pid})가 존재하지 않습니다 — 상태파일 정리 후 재시작하세요.`, "warning");
						return;
					}
					try {
						process.kill(pid, "SIGTERM");
					} catch {
						/* 이미 종료됨 */
					}
					ctx.ui.notify(`워치 종료 요청 (pid ${pid}) — 상태파일: ${statePath}`, "info");
					return;
				}
				if (sub === "status") {
					const st = readState();
					if (!st) {
						ctx.ui.notify("워치 상태 없음 — /kis-watch start --symbols ... 로 시작하세요.", "info");
						return;
					}
					const syms = Array.isArray(st.symbols) ? (st.symbols as Array<Record<string, unknown>>) : [];
					const lines = [
						`pid        : ${String(st.pid ?? "—")}${st.stoppedAt ? ` (종료: ${String(st.stoppedAt)})` : ""}`,
						`startedAt  : ${String(st.startedAt ?? "—")}`,
						`lastError  : ${st.lastError ? String(st.lastError) : "없음"}`,
						...syms.map((s) => {
							const trKey = String(s.trKey ?? "?");
							const cond = `${String(s.condition ?? "?")}(${String(s.value ?? "?")})`;
							return `  ${trKey}: last=${s.last ?? "—"}${s.triggered ? " ✅트리거됨" : ""} (${cond})`;
						}),
					];
					if (st.order) lines.push(`order      : ${JSON.stringify(st.order)}`);
					lines.push(`state file : ${statePath}`);
					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}
				// start (기본)
				const forward = sub === "start" ? tokens.slice(1) : tokens;
				if (!forward.includes("--symbols")) {
					ctx.ui.notify(
						'사용법: /kis-watch start --symbols "DNYSORCL,below,144.5;DNASOLED,above,90" ' +
							"[--ref \"DNYSORCL,150\"] [--interval 55] [--once] [--max-minutes N] " +
							"[--order \"DNYSORCL,SELL,2\"] [--detach]\n조건: above(이상 도달)/below(이하 도달)/chgPct(±%, --ref로 기준가). " +
							"기본은 이 세션에서 백그라운드로 동작하고 알림이 여기 뜹니다. --detach는 독립 프로세스(OS 알림/로그). " +
							"--order는 사전 승인 주문 — 트리거 시 자동 실행되니 신중히 설정하세요.",
							"warning",
					);
					return;
				}
				if (hasSessionWatcher()) {
					ctx.ui.notify("이미 이 세션에서 워치가 실행 중입니다 — /kis-watch stop 후 재시작하세요.", "warning");
					return;
				}
				const running = readState();
				if (running && running.mode === "detached" && typeof running.pid === "number" && !running.stoppedAt) {
					ctx.ui.notify(`독립 워치가 실행 중입니다 (pid ${running.pid}) — /kis-watch stop 후 재시작하세요.`, "warning");
					return;
				}
				if (forward.includes("--order")) {
					const confirm = await ctx.ui.confirm(
						"사전 승인 주문 포함",
						"--order가 설정됐습니다 — 조건 충족 시 자동 주문이 실행됩니다 (사전 승인). 계속할까요?",
					);
					if (!confirm) {
						ctx.ui.notify("취소됨 — 워치를 시작하지 않았습니다.", "info");
						return;
					}
				}
				if (forward.includes("--detach")) {
					// 독립 프로세스 모드 — pi 세션과 무관하게 동작 (OS 알림/로그)
					const watchPath = fileURLToPath(new URL("../watch.ts", import.meta.url));
					const cwd = fileURLToPath(new URL("../../", import.meta.url)); // 패키지 루트
					const child = spawn(process.execPath, ["--experimental-transform-types", watchPath, ...forward], {
						detached: true,
						stdio: "ignore",
						cwd,
					});
					child.unref();
					ctx.ui.notify(
						`워치 시작 (pid ${child.pid ?? "?"}, 독립 프로세스) — 상태: ${statePath}.\n` +
							"/kis-watch status로 확인, /kis-watch stop으로 종료. 세션을 닫아도 계속 동작합니다.",
						"info",
					);
					return;
				}
				// 세션 내 백그라운드 워치 — 알림은 ctx.ui.notify로 이 세션(에이전트)에 전달
				try {
					const watchArgs = parseWatchArgs(forward);
					const handle = createWatcher(watchArgs, {
						mode: "session",
						notifyFn: (title, body) => ctx.ui.notify(`${title}\n${body}`, "info"),
					});
					setSessionWatcher(handle);
					handle.promise.catch((e) => {
						ctx.ui.notify(`워치 오류: ${(e as Error).message}`, "error");
						setSessionWatcher(null);
					});
					ctx.ui.notify(
						`워치 시작 (세션 내) — 조건 충족 시 이 세션으로 알림이 옵니다. /kis-watch stop으로 종료.\n` +
							`pi 세션을 닫으면 함께 종료됩니다 (독립 실행은 --detach). 상태: ${statePath}`,
						"info",
					);
				} catch (e) {
					ctx.ui.notify(`워치 시작 오류: ${(e as Error).message}`, "error");
				}
			} catch (e) {
				ctx.ui.notify(`워치 오류: ${(e as Error).message}`, "error");
			}
		},
	});
}
