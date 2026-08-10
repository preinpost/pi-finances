#!/usr/bin/env node
/**
 * src/watch.ts — 헤드리스 실시간 가격 감시 (워치 엔진 + CLI).
 *
 * subagent/pi 세션 의존 없이 "실시간 체결가 계속 listen → 조건 충족 시 알림
 * (선택: 사전 승인 주문)"을 프로젝트 자체에서 해결한다.
 *
 * 동작:
 *  - kis_realtime(subscribeRealtime)을 종목별로 연속 재구독 (일회성 10~60초 한계를
 *    재구독 루프로 극복 — 이 세션에서 실측: 체결 틱 수신 정상)
 *  - 수신 체결가로 조건 평가: above(이상 도달)/below(이하 도달)/chgPct(기준가 대비 ±%)
 *  - 충족 시 플랫폼별 알림(macOS osascript / Linux notify-send / 그 외 log) + 상태파일 기록 (+ --order 설정 시 사전 승인 주문 1회)
 *  - 상태파일: ~/.pi/agent/kis-watch.json — pi 에이전트(/kis-watch status)가 읽을 수 있음
 *
 * CLI: node --experimental-transform-types src/watch.ts \
 *        --symbols "DNYSORCL,below,144.5;DNASOLED,above,90" \
 *        [--ref "DNYSORCL,150"] [--interval 55] [--notify auto|macos|linux|windows|log] \
 *        [--state ~/.pi/agent/kis-watch.json] [--order "DNYSORCL,SELL,2"] \
 *        [--once] [--max-minutes N]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { subscribeRealtime } from "./core/ws.ts";
import { callApi } from "./core/client.ts";

// ── 타입 ───────────────────────────────────────────────────────────────────

export type WatchCondition = "above" | "below" | "chgPct";

export interface WatchSymbol {
	/** 구독 키 — 해외 "DNYSORCL"(D+시장3자리+종목) 또는 국내 6자리 "005930". */
	trKey: string;
	/** 국내 6자리 → H0STCNT0(STCK_PRPR), 그 외 → HDFSCNT0(LAST). */
	trId: "H0STCNT0" | "HDFSCNT0";
	/** 파싱된 종목코드 (ORCL / 005930). */
	symbol: string;
	condition: WatchCondition;
	/** above/below: 가격, chgPct: % (음수면 하락). above/below도 음수면 % 해석. */
	value: number;
	/** chgPct/음수 조건의 기준가 — 미지정 시 첫 수신가로 자동 설정. */
	ref?: number;
	refAuto?: boolean;
	last?: number;
	lastAt?: string;
	triggered?: boolean;
	notified?: boolean;
}

export interface WatchOrder {
	trKey: string;
	side: "BUY" | "SELL";
	qty: number;
	done?: boolean;
	result?: string;
}

export interface WatchArgs {
	symbols: WatchSymbol[];
	intervalSec: number;
	notifyMode: "auto" | "macos" | "linux" | "windows" | "log";
	statePath: string;
	order?: WatchOrder;
	once: boolean;
	maxMinutes: number;
}

export interface WatchState {
	pid?: number;
	/** detached(독립 프로세스) / session(pi 세션 내 백그라운드). */
	mode?: "detached" | "session";
	startedAt?: string;
	stoppedAt?: string;
	symbols: WatchSymbol[];
	order?: WatchOrder | null;
	lastError?: string;
}

// ── CLI 파싱 (순수 함수 — 단위 검증 대상) ──────────────────────────────────

export function parseArgs(argv: string[]): WatchArgs {
	const get = (flag: string): string | undefined => {
		const i = argv.indexOf(flag);
		return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
	};
	const has = (flag: string): boolean => argv.includes(flag);

	// --ref "DNYSORCL,150;DNASOLED,90"
	const refs: Record<string, number> = {};
	const refRaw = get("--ref");
	if (refRaw) {
		for (const part of refRaw.split(";")) {
			const [trKey, val] = part.split(",");
			if (trKey && val !== undefined && Number.isFinite(Number(val))) refs[trKey.trim().toUpperCase()] = Number(val);
		}
	}

	const symbolsRaw = get("--symbols");
	if (!symbolsRaw) throw new Error("--symbols 필수 (예: --symbols DNYSORCL,below,144.5;DNASOLED,above,90)");
	const symbols: WatchSymbol[] = [];
	for (const part of symbolsRaw.split(";")) {
		const seg = part.split(",");
		if (seg.length < 3) throw new Error(`--symbols 항목 형식 오류: "${part}" (trKey,조건,값 — 예: DNYSORCL,below,144.5)`);
		const trKey = seg[0].trim().toUpperCase();
		const rawCondition = seg[1].trim().toLowerCase();
		const condition = (rawCondition === "chgpct" ? "chgPct" : rawCondition) as WatchCondition; // 대소문자 정규화
		if (!["above", "below", "chgPct"].includes(condition)) {
			throw new Error(`알 수 없는 조건: "${seg[1]}" (above/below/chgPct)`);
		}
		const value = Number(seg[2]);
		if (!Number.isFinite(value)) throw new Error(`조건값 숫자 오류: "${seg[2]}"`);
		symbols.push({
			trKey,
			trId: /^\d{6}$/.test(trKey) ? "H0STCNT0" : "HDFSCNT0",
			symbol: /^\d{6}$/.test(trKey) ? trKey : trKey.replace(/^D[A-Z]{3}/, ""),
			condition,
			value,
			ref: refs[trKey] ?? undefined,
		});
	}

	const intervalSec = Math.min(60, Math.max(5, Number(get("--interval") ?? 55) || 55));
	const notifyRaw = (get("--notify") ?? "auto").toLowerCase();
	const notifyMode = (["auto", "macos", "linux", "windows", "log"].includes(notifyRaw) ? notifyRaw : "auto") as WatchArgs["notifyMode"];
	const statePath =
		get("--state") ?? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "kis-watch.json");

	let order: WatchOrder | undefined;
	const orderRaw = get("--order");
	if (orderRaw) {
		const [trKey, sideRaw, qtyRaw] = orderRaw.split(",");
		const side = (sideRaw ?? "").toUpperCase();
		if (!trKey || !["BUY", "SELL"].includes(side)) {
			throw new Error(`--order 형식 오류: "${orderRaw}" (trKey,SIDE,qty — 예: DNYSORCL,SELL,2)`);
		}
		const qty = Number(qtyRaw);
		if (!Number.isInteger(qty) || qty <= 0) throw new Error(`--order 수량 오류: "${qtyRaw}" (양의 정수)`);
		order = { trKey: trKey.trim().toUpperCase(), side: side as "BUY" | "SELL", qty };
	}

	return {
		symbols,
		intervalSec,
		notifyMode,
		statePath,
		order,
		once: has("--once"),
		maxMinutes: Math.max(0, Number(get("--max-minutes") ?? 0) || 0),
	};
}

// ── 조건 평가 (순수 함수 — 단위 검증 대상) ─────────────────────────────────

/** 위험: above/below의 음수 값은 % 해석 — 가격은 음수가 될 수 없으므로 모호성 없음. */
export function evaluateCondition(sym: WatchSymbol, last: number): boolean {
	const pct = (): number | null => (sym.ref === undefined ? null : ((last - sym.ref) / sym.ref) * 100);
	const v = sym.value;

	if (sym.condition === "above") {
		if (v < 0) {
			const p = pct();
			return p !== null && p >= v; // 음수 → 기준가 대비 상승률이 v% 이상
		}
		return last >= v; // 가격 도달
	}
	if (sym.condition === "below") {
		if (v < 0) {
			const p = pct();
			return p !== null && p <= v; // 음수 → 기준가 대비 하락률이 v% 이하
		}
		return last <= v;
	}
	// chgPct: (last-ref)/ref*100 — 양수면 이상 도달, 음수면 이하 도달
	const p = pct();
	if (p === null) return false;
	return v >= 0 ? p >= v : p <= v;
}

// ── 상태 파일 ──────────────────────────────────────────────────────────────

export function readStateFile(path: string): WatchState | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as WatchState;
	} catch {
		return null;
	}
}

export function writeStateFile(path: string, state: WatchState): void {
	try {
		writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
	} catch {
		/* 상태파일 기록 실패는 치명적이지 않음 */
	}
}

// ── 알림 ───────────────────────────────────────────────────────────────────

function notifyMacos(title: string, body: string): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			execFile(
				"osascript",
				["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`],
				(err) => resolve(!err),
			);
		} catch {
			resolve(false);
		}
	});
}

/** Linux 데스크톱 알림 (libnotify — notify-send). 없으면 false → 로그 폴백. */
function notifyLinux(title: string, body: string): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			execFile("notify-send", [title, body], (err) => resolve(!err));
		} catch {
			resolve(false);
		}
	});
}

/** 실행 플랫폼에 맞는 기본 알림 모드. */
export function defaultNotifyMode(): "macos" | "linux" | "windows" | "log" {
	if (process.platform === "darwin") return "macos";
	if (process.platform === "linux") return "linux";
	if (process.platform === "win32") return "windows";
	return "log";
}

export async function notify(args: WatchArgs, title: string, body: string): Promise<void> {
	const mode = args.notifyMode === "auto" ? defaultNotifyMode() : args.notifyMode;
	if (mode === "macos") {
		const ok = await notifyMacos(title, body);
		if (!ok) console.log(`[WATCH] ${title}: ${body}`); // osascript 실패 → 로그 폴백
		return;
	}
	if (mode === "linux") {
		const ok = await notifyLinux(title, body);
		if (!ok) console.log(`[WATCH] ${title}: ${body}`); // notify-send 없으면 로그 폴백
		return;
	}
	// windows / log: 데스크톱 토스트는 외부 의존(BurntToast 등) 필요 — 로그 + 상태파일로 동작
	console.log(`[WATCH] ${title}: ${body}`);
}

// ── 주문 (사전 승인 — --order가 명시적으로 설정된 경우에만 실행) ───────────

/**
 * 해외 KIS 주문 실행 — 시장가(OVRS_ORD_UNPR "0" + ORD_DVSN "00", KIS 공식 규약).
 * tr_key "DNYSORCL" → 시장코드 NAS→OVRS_EXCG_CD "NASD"(NYSE→NYSE, AMEX→AMEX).
 * SLL_TYPE: 매도 "00" / 매수는 필드 생략.
 */
export async function placeWatchOrder(order: WatchOrder): Promise<string> {
	const m = /^D([A-Z]{3})(.+)$/.exec(order.trKey);
	if (!m) throw new Error(`--order는 해외 종목만 지원 (D+시장3자리+종목, 예: DNYSORCL) — 국내 주문 미지원`);
	const [, mkt, symbol] = m;
	const exchMap: Record<string, string> = { NAS: "NASD", NYS: "NYSE", AMS: "AMEX" };
	const ovrsExcg = exchMap[mkt];
	if (!ovrsExcg) throw new Error(`알 수 없는 시장코드: ${mkt} (NAS/NYS/AMS)`);
	const trId = order.side === "BUY" ? "TTTT1002U" : "TTTT1006U"; // 실전 tr_id
	const result = await callApi(
		"overseas_stock.v1_해외주식-001",
		{
			OVRS_EXCG_CD: ovrsExcg,
			PDNO: symbol,
			ORD_QTY: String(order.qty),
			OVRS_ORD_UNPR: "0", // 시장가
			SLL_TYPE: order.side === "SELL" ? "00" : undefined, // 매수는 필드 제거
			ORD_SVR_DVSN_CD: "0",
			ORD_DVSN: "00",
		},
		{ env: "real", trId },
	);
	return JSON.stringify(result.data ?? result).slice(0, 300);
}

// ── 워치 메인 루프 ─────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 체결 프레임에서 가격 추출 — 해외 HDFSCNT0: output1.LAST, 국내 H0STCNT0: output1.STCK_PRPR. */
function extractLast(trId: string, out1: Record<string, unknown> | null): number | null {
	if (!out1) return null;
	const raw = trId === "H0STCNT0" ? out1.STCK_PRPR : out1.LAST;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : null;
}

export interface WatcherOptions {
	/** 알림 콜백 — 기본은 플랫폼별 데스크톱 알림(notify). pi 세션 내에서는 ctx.ui.notify를 주입한다. */
	notifyFn?: (title: string, body: string) => Promise<void> | void;
	/** 실행 모드 — detached(독립 프로세스, 기본) / session(pi 세션 내 백그라운드). 상태파일 mode에 기록. */
	mode?: "detached" | "session";
}

export interface WatchHandle {
	stop(): void;
	state: WatchState;
	promise: Promise<void>;
}

/**
 * 워치 생성 — 구독 루프를 백그라운드로 시작하고 stop 핸들을 반환.
 * CLI(main)는 runWatch로, pi 세션 내(/kis-watch start)는 이 함수에 ctx.ui.notify를 주입해 사용한다.
 */
export function createWatcher(args: WatchArgs, opts?: WatcherOptions): WatchHandle {
	const notifyFn = opts?.notifyFn ?? ((title: string, body: string) => notify(args, title, body));
	const state: WatchState = {
		pid: process.pid,
		mode: opts?.mode ?? "detached",
		startedAt: new Date().toISOString(),
		symbols: args.symbols,
		order: args.order ?? null,
	};
	writeStateFile(args.statePath, state);
	const startTime = Date.now();
	let stop = false;

	const loop = (async () => {
		try {
			while (!stop) {
				if (args.maxMinutes > 0 && (Date.now() - startTime) / 60_000 >= args.maxMinutes) break;
				for (const sym of args.symbols) {
					if (stop) break;
					try {
						const res = await subscribeRealtime({
							trId: sym.trId,
							trKey: sym.trKey,
							durationMs: args.intervalSec * 1000,
							maxMessages: 1000,
						});
						for (const msg of res.messages) {
							if (stop) break; // stop 후 잔여 메시지로 알림/주문 실행 방지
							const last = extractLast(sym.trId, msg.output1);
							if (last === null) continue;
							sym.last = last;
							sym.lastAt = new Date().toISOString();
							// 기준가 자동 설정 (chgPct/음수 조건, --ref 미지정 시 첫 수신가)
							if (sym.ref === undefined && (sym.condition === "chgPct" || sym.value < 0)) {
								sym.ref = last;
								sym.refAuto = true;
							}
							if (!sym.triggered && evaluateCondition(sym, last)) {
								sym.triggered = true;
								sym.notified = true;
								const desc = `${sym.trKey} ${sym.condition}(${sym.value}) — 현재가 ${last}`;
								await notifyFn(`[KIS 워치] ${sym.symbol} 조건 충족`, desc);
								// 사전 승인 주문 (트리거된 종목과 일치할 때만, 1회)
								if (args.order && !args.order.done && args.order.trKey === sym.trKey) {
									try {
										const r = await placeWatchOrder(args.order);
										args.order.done = true;
										args.order.result = `주문 성공: ${r}`;
										await notifyFn("[KIS 워치] 주문 실행", `${args.order.trKey} ${args.order.side} ${args.order.qty}주`);
									} catch (e) {
										args.order.result = `주문 실패: ${(e as Error).message}`;
									}
								}
								if (args.once) stop = true;
							}
						}
						state.lastError = undefined;
					} catch (e) {
						state.lastError = (e as Error).message;
						writeStateFile(args.statePath, state);
						await sleep(3000); // 재연결 백오프
					}
					writeStateFile(args.statePath, state);
					await sleep(500); // 재구독 사이 짧은 간격
				}
			}
		} finally {
			state.stoppedAt = new Date().toISOString();
			writeStateFile(args.statePath, state);
		}
	})();

	return {
		stop: () => {
			stop = true;
			writeStateFile(args.statePath, state); // 즉시 상태 저장
		},
		state,
		promise: loop,
	};
}

/** CLI 전용 — 시그널 처리와 함께 워치 실행 (독립 프로세스). */
export async function runWatch(args: WatchArgs): Promise<void> {
	const h = createWatcher(args, { mode: "detached" });
	const onSignal = (): void => {
		h.stop();
		// 진행 중인 구독(최대 60s)을 기다리지 않고 종료 — 잔여 메시지로 알림/주문 실행 방지
		setTimeout(() => process.exit(0), 500);
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
	await h.promise;
}

// ── 세션 내 워치 레지스트리 (pi 확장용) ─────────────────────────────────────

let sessionWatcher: WatchHandle | null = null;

/** pi 세션 내 워치 등록 (이전 워치는 자동 중지). */
export function setSessionWatcher(h: WatchHandle | null): void {
	if (sessionWatcher && sessionWatcher !== h) sessionWatcher.stop();
	sessionWatcher = h;
}

/** pi 세션 내 워치 중지 (session_shutdown 시에도 호출). */
export function stopSessionWatcher(): void {
	if (sessionWatcher) {
		sessionWatcher.stop();
		sessionWatcher = null;
	}
}

/** 현재 세션 워치 여부. */
export function hasSessionWatcher(): boolean {
	return sessionWatcher !== null;
}

// ── CLI 엔트리 ─────────────────────────────────────────────────────────────

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		runWatch(args).catch((e) => {
			console.error("[WATCH] 치명적 오류:", e);
			process.exit(1);
		});
	} catch (e) {
		console.error("[WATCH] 인자 오류:", (e as Error).message);
		console.error(
			'사용법: node --experimental-transform-types src/watch.ts --symbols "DNYSORCL,below,144.5;DNASOLED,above,90" ' +
				"[--ref \"DNYSORCL,150\"] [--interval 55] [--notify macos|log] [--state ...] [--order \"DNYSORCL,SELL,2\"] [--once] [--max-minutes N]",
		);
		process.exit(2);
	}
}
