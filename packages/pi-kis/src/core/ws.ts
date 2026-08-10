/**
 * src/ws.ts — KIS 실시간 시세 (WebSocket) 지원.
 *
 * REST 토큰(/oauth2/tokenP)과 **별개**로 웹소켓 전용 접속키(/oauth2/Approval)를
 * 발급받아 ws://ops.koreainvestment.com:21000(실전) / :31000(모의)에 연결한 뒤
 * tr_id + tr_key로 구독하고 실시간 데이터 프레임을 수신한다.
 *
 * 수신 형식 (KIS 공식 샘플 — legacy/websocket/python/ws_domestic_overseas_all.py):
 *  - 실시간 데이터: "0|TR_ID|건수|필드1^필드2^..." (0=평문, 1=AES256-CBC 암호화)
 *  - 시스템 메시지(구독 응답 등): JSON {"header":{"tr_id":...},"body":{"rt_cd":"0",
 *    "msg1":"SUBSCRIBE SUCCESS","output":{"key":...,"iv":...}}}
 *    - "PINGPONG" 수신 시 동일 텍스트를 그대로 에코
 *  - tr_id별 필드 정의: src/core/generated/apis.json의 response 테이블
 *    (ws-tr-ids.json에 field_count 기록 — 다건 프레임 청크 분할에 사용)
 *
 * 인증 흐름:
 *  - 접속키는 24h 유효 (공식 스펙). ~/.pi/agent/kis-approval.json(0600) 또는
 *    OS 키체인(secret.ts store)에 env별 캐시 후 재사용.
 *  - 구독 중 approval key 오류(만료/무효) → 캐시 삭제 + 재발급 + 재연결 1회.
 */
import { createDecipheriv } from "node:crypto";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl, keysFor, resolveEnv, type EnvArg, type KisEnv } from "./auth.ts";
import { getApprovalCache, saveApprovalCache } from "./secret.ts";
import type { ApiDef } from "./client.ts";

const WS_URL_REAL = "ws://ops.koreainvestment.com:21000";
const WS_URL_PAPER = "ws://ops.koreainvestment.com:31000";

/** 접속키 스펙상 유효기간 24h — 23h 캐시 후 자동 재발급. */
const APPROVAL_TTL_MS = (24 * 3600 - 3600) * 1000;

// ── approval key (웹소켓 전용 접속키) ──────────────────────────────────────

function hashKey(appKey: string): string {
	return createHash("sha256").update(appKey).digest("hex").slice(0, 16);
}

/** POST {base}/oauth2/Approval — REST 토큰 발급(/oauth2/tokenP)과 별개. */
async function issueApprovalKeyOnce(env: KisEnv): Promise<string> {
	const { appKey, appSecret } = keysFor(env);
	let res: Response;
	try {
		res = await fetch(`${baseUrl(env)}/oauth2/Approval`, {
			method: "POST",
			headers: { "content-type": "application/json; charset=UTF-8" },
			// 스펙 필드명은 secretkey (appsecret과 동일 값 — 공식 스펙 주의 문구).
			// task 요구(appsecret)와 공식 스펙(secretkey) 모두 포함해 호환.
			body: JSON.stringify({
				grant_type: "client_credentials",
				appkey: appKey,
				secretkey: appSecret,
				appsecret: appSecret,
			}),
		});
	} catch (e) {
		throw new Error(`KIS 웹소켓 접속키 발급 실패 (네트워크): ${(e as Error).message}`);
	}
	const text = await res.text();
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`KIS 웹소켓 접속키 발급 실패 (HTTP ${res.status}): ${text.slice(0, 200)}`);
	}
	const key = json.approval_key;
	if (typeof key !== "string" || !key) {
		throw new Error(`KIS 웹소켓 접속키 발급 실패: ${text.slice(0, 300)}`);
	}
	const cache = getApprovalCache();
	cache[env] = { approvalKey: key, appKeyHash: hashKey(appKey), expiresAt: Date.now() + APPROVAL_TTL_MS };
	await saveApprovalCache(cache);
	return key;
}

/** 캐시된 접속키 반환, 없거나 만료 시 발급 (발급 실패 시 1회 재시도). */
export async function getApprovalKey(env: KisEnv): Promise<string> {
	const { appKey } = keysFor(env);
	const cached = getApprovalCache()[env];
	if (cached && cached.approvalKey && cached.appKeyHash === hashKey(appKey) && cached.expiresAt > Date.now() + 60_000) {
		return cached.approvalKey;
	}
	try {
		return await issueApprovalKeyOnce(env);
	} catch (e) {
		// 발급 실패 → 캐시 정리 후 1회 재시도
		await clearApprovalCache(env).catch(() => {});
		return issueApprovalKeyOnce(env);
	}
}

export async function clearApprovalCache(env: KisEnv): Promise<void> {
	const cache = getApprovalCache();
	delete cache[env];
	await saveApprovalCache(cache);
}

/** /kis-status용 — 만료까지 남은 초 (캐시 없으면 null). */
export function approvalAge(env: KisEnv): number | null {
	const cached = getApprovalCache()[env];
	if (!cached) return null;
	return Math.round((cached.expiresAt - Date.now()) / 1000);
}

// ── WS tr_id 맵 (src/core/generated/ws-tr-ids.json) ───────────────────────

export interface WsTrIdEntry {
	tr_id: string;
	name: string;
	tr_key_desc?: string;
	/** apis.json response 테이블 필드 수 — 다건 프레임 청크 분할 기준. */
	field_count?: number;
}

interface WsTrIdsFile {
	generated?: string;
	tr_ids: Record<string, WsTrIdEntry>;
}

const generatedDir = join(dirname(fileURLToPath(import.meta.url)), "generated");
const generated: { apis: Record<string, ApiDef> } = JSON.parse(
	readFileSync(join(generatedDir, "apis.json"), "utf8"),
);

let wsTrIdMap: Record<string, WsTrIdEntry> | null = null;

/** ws-tr-ids.json 로드 (v2 API 키 → tr_id 정보). */
export function wsTrIds(): Record<string, WsTrIdEntry> {
	if (!wsTrIdMap) {
		const raw = JSON.parse(readFileSync(join(generatedDir, "ws-tr-ids.json"), "utf8")) as WsTrIdsFile;
		wsTrIdMap = raw.tr_ids;
	}
	return wsTrIdMap;
}

/** v2 API 키 → tr_id (없으면 undefined). */
export function wsTrIdFor(apiKey: string): string | undefined {
	return wsTrIds()[apiKey]?.tr_id;
}

/** tr_id → 응답 필드 키 목록 (apis.json response 테이블). */
function fieldKeysFor(trId: string): string[] {
	for (const def of Object.values(generated.apis)) {
		if (def.kind === "WEBSOCKET" && def.api_path === `/tryitout/${trId}`) {
			return Object.keys(def.response ?? {});
		}
	}
	return [];
}

// ── 실시간 데이터 프레임 처리 ───────────────────────────────────────────────

/** AES256-CBC (PKCS7) 복호화 — 체결통보 등 encrypt=1 프레임용. */
export function aesCbcDecrypt(key: string, iv: string, cipherText: string): string {
	const decipher = createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
	let out = decipher.update(Buffer.from(cipherText, "base64"), undefined as never, "utf8");
	out += decipher.final("utf8");
	return out;
}

/** field_count 기준으로 다건 프레임을 레코드 단위로 분할. */
function chunkRecords(fields: string[], fieldCount: number): string[][] {
	if (fieldCount <= 0) return [fields];
	const n = Math.floor(fields.length / fieldCount);
	if (n <= 1) return [fields];
	const out: string[][] = [];
	for (let i = 0; i < n; i++) out.push(fields.slice(i * fieldCount, (i + 1) * fieldCount));
	return out;
}

function mapRecord(rec: string[], keys: string[]): Record<string, unknown> {
	if (keys.length === 0) return { raw: rec };
	const out: Record<string, unknown> = {};
	keys.forEach((k, i) => {
		if (i < rec.length) out[k] = rec[i];
	});
	return out;
}

const APPROVAL_ERR_RE = /approval|접속키|EGW00123|OPSQ2004|already in use|인증|auth/i;

// ── 구독 (1회 연결 시도) ────────────────────────────────────────────────────

export interface WsMessage {
	header: Record<string, unknown>;
	output1: Record<string, unknown> | null;
	output2: Record<string, unknown>[];
}

export interface WsSystemEvent {
	tr_id: string;
	tr_key?: string;
	rt_cd?: string;
	msg1?: string;
}

export interface WsResult {
	ok: true;
	env: KisEnv;
	tr_id: string;
	tr_key: string;
	durationMs: number;
	maxMessages: number;
	/** 실시간 데이터 프레임 (장 마감 등으로 0개일 수 있음 — 정상). */
	messages: WsMessage[];
	/** 구독/해제 응답 등 시스템 메시지. */
	system: WsSystemEvent[];
	/** 데이터 0건일 때의 원인 힌트 (있을 때만). */
	note?: string;
	approval: { cached: boolean };
	closedBy: "timeout" | "max_messages" | "server" | "error";
}

interface AttemptOptions {
	url: string;
	approvalKey: string;
	trId: string;
	trKey: string;
	durationMs: number;
	maxMessages: number;
	fieldKeys: string[];
}

interface AttemptResult {
	messages: WsMessage[];
	system: WsSystemEvent[];
	approvalError: boolean;
	failed: boolean;
	closedBy: "timeout" | "max_messages" | "server" | "error";
	error?: string;
}

/** 단일 연결: 구독 → durationMs 동안 수신 → 구독해제(tr_type=2) → close. */
function connectOnce(o: AttemptOptions): Promise<AttemptResult> {
	return new Promise<AttemptResult>((resolve) => {
		let ws: WebSocket;
		try {
			ws = new WebSocket(o.url);
		} catch (e) {
			resolve({
				messages: [], system: [], approvalError: false, failed: true, closedBy: "error",
				error: `WebSocket 생성 실패: ${(e as Error).message}`,
			});
			return;
		}

		const messages: WsMessage[] = [];
		const system: WsSystemEvent[] = [];
		let approvalError = false;
		let decryptKey = "";
		let decryptIv = "";
		let opened = false;
		let closedBy: "timeout" | "max_messages" | "server" | "error" = "server";
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const finish = (r?: { failed?: boolean; error?: string }) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			if (connectTimer) clearTimeout(connectTimer);
			// 모든 경로에서 소켓 정리 (에러 경로의 누수 방지)
			if (opened) {
				try {
					if (ws.readyState === WebSocket.OPEN) ws.close(1000, "finish");
				} catch {
					/* ignore */
				}
			}
			resolve({ messages, system, approvalError, failed: r?.failed ?? false, closedBy, ...r });
		};

		// 연결 타임아웃: open 이벤트가 오지 않으면 실패 처리 (행 방지)
		const connectTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
			if (opened) return;
			closedBy = "error";
			try {
				ws.close();
			} catch {
				/* ignore */
			}
			finish({ failed: true, error: "WebSocket 연결 타임아웃 (15s)" });
		}, 15_000);

		const sendUnsub = () => {
			try {
				ws.send(
					JSON.stringify({
						header: { approval_key: o.approvalKey, custtype: "P", tr_type: "2", "content-type": "utf-8" },
						body: { input: { tr_id: o.trId, tr_key: o.trKey } },
					}),
				);
			} catch {
				/* ignore */
			}
		};

		const closeAfterUnsub = (reason: "timeout" | "max_messages") => {
			closedBy = reason;
			if (timer) clearTimeout(timer);
			if (opened) {
				sendUnsub();
				setTimeout(() => {
					try {
						ws.close(1000, "done");
					} catch {
						/* ignore */
					}
				}, 300); // 해제 메시지 전송 보장 후 close
			} else {
				try {
					ws.close();
				} catch {
					/* ignore */
				}
			}
			// close 이벤트가 오지 않아도 안전 종료
			timer = setTimeout(() => finish(), 5000);
		};

		ws.onopen = () => {
			opened = true;
			try {
				ws.send(
					JSON.stringify({
						header: { approval_key: o.approvalKey, custtype: "P", tr_type: "1", "content-type": "utf-8" },
						body: { input: { tr_id: o.trId, tr_key: o.trKey }, output: "1" },
					}),
				);
			} catch (e) {
				finish({ failed: true, error: `구독 메시지 전송 실패: ${(e as Error).message}` });
				return;
			}
			timer = setTimeout(() => closeAfterUnsub("timeout"), o.durationMs);
		};

		ws.onmessage = (ev: MessageEvent) => {
			const raw = typeof ev.data === "string" ? ev.data : null;
			if (raw === null || raw.length === 0) return;
			const c0 = raw[0];

			if (c0 === "0" || c0 === "1") {
				// 실시간 데이터 프레임: 0|TR_ID|건수|필드^필드^...
				const parts = raw.split("|");
				if (parts.length < 4) return;
				const encrypt = parts[0];
				const frameTrId = parts[1];
				const count = parseInt(parts[2], 10) || 1;
				let payload = parts.slice(3).join("|");
				if (encrypt === "1" && decryptKey && decryptIv) {
					try {
						payload = aesCbcDecrypt(decryptKey, decryptIv, payload);
					} catch {
						/* 복호화 실패 → raw 유지 */
					}
				}
				const recs = chunkRecords(payload.split("^"), o.fieldKeys.length);
				const mapped = recs.map((rec) => mapRecord(rec, o.fieldKeys));
				messages.push({
					header: { tr_id: frameTrId, encrypt, count },
					output1: mapped[0] ?? null,
					output2: mapped.slice(1),
				});
				if (messages.length >= o.maxMessages) closeAfterUnsub("max_messages");
			} else if (c0 === "{") {
				// 시스템 메시지 (구독 응답 / PINGPONG)
				try {
					const j = JSON.parse(raw) as {
						header?: { tr_id?: string; tr_key?: string };
						body?: { rt_cd?: string; msg1?: string; output?: { key?: string; iv?: string } };
					};
					const trId = j.header?.tr_id ?? "";
					if (trId === "PINGPONG") {
						try {
							ws.send(raw); // 동일 텍스트 에코
						} catch {
							/* ignore */
						}
						return;
					}
					const rtCd = j.body?.rt_cd ?? "";
					const msg1 = j.body?.msg1 ?? "";
					if (j.body?.output?.key && j.body?.output?.iv) {
						decryptKey = j.body.output.key;
						decryptIv = j.body.output.iv;
					}
					system.push({ tr_id: trId, tr_key: j.header?.tr_key, rt_cd: rtCd, msg1 });
					if (rtCd !== "" && rtCd !== "0") {
						if (APPROVAL_ERR_RE.test(msg1)) approvalError = true;
						if (!msg1.includes("ALREADY IN SUBSCRIBE")) {
							finish({ failed: true, error: `구독 실패 [${trId}]: rt_cd=${rtCd} msg=${msg1}` });
						}
					}
				} catch {
					/* JSON 파싱 실패 — 무시 */
				}
			}
		};

		ws.onerror = () => {
			finish({ failed: true, error: "WebSocket 연결 오류" });
		};

		ws.onclose = () => {
			if (!opened) {
				// 연결이 열리기 전 종료 (서버 거부/네트워크) → 성공으로 처리하지 않음
				finish({ failed: true, error: "WebSocket 연결이 열리기 전에 종료됨 (서버 거부?)" });
				return;
			}
			finish();
		};
	});
}

export interface SubscribeOptions {
	trId: string;
	trKey: string;
	env?: EnvArg;
	durationMs?: number;
	maxMessages?: number;
}

/**
 * 실시간 구독: 연결 → 구독(tr_type=1) → durationMs 동안 수신 → 해제(tr_type=2) → close.
 *
 * 에러 처리:
 *  - approval key 오류(만료/무효) → 캐시 삭제 + 재발급 + 재연결 1회
 *  - 연결 실패 / 구독 오류(잘못된 tr_id 등) → Error throw
 *  - 장 마감 등으로 데이터 0건이어도 성공 (연결/구독 성공이면 ok)
 */
export async function subscribeRealtime(opts: SubscribeOptions): Promise<WsResult> {
	const env = resolveEnv(opts.env ?? "auto");
	const url = env === "paper" ? WS_URL_PAPER : WS_URL_REAL;
	const durationMs = Math.min(Math.max(1, Math.floor(opts.durationMs ?? 10_000)), 60_000);
	const maxMessages = Math.max(1, Math.floor(opts.maxMessages ?? 20));
	const fieldKeys = fieldKeysFor(opts.trId);

	let approval = await getApprovalKey(env);
	let cached = true;

	for (let attempt = 0; attempt < 2; attempt++) {
		const res = await connectOnce({ url, approvalKey: approval, trId: opts.trId, trKey: opts.trKey, durationMs, maxMessages, fieldKeys });
		if (res.failed && res.approvalError && attempt === 0) {
			// approval key 만료/무효 → 재발급 후 재연결 1회
			await clearApprovalCache(env).catch(() => {});
			approval = await issueApprovalKeyOnce(env);
			cached = false;
			continue;
		}
		if (res.failed) throw new Error(res.error ?? "웹소켓 구독 실패");
		const note =
			res.messages.length === 0 && opts.trId.startsWith("HDF")
				? "해외 실시간 체결가 0건 — ① tr_key의 시장코드 확인 (예: ORCL=DNYSORCL, AAPL=DNASAPPL, D+3자리 시장+종목코드) ② 해외 실시간 시세 유료 구독 미가입일 수 있음 ③ 장 마감이면 정상. REST(broker_price/toss_price)로 대체 가능."
				: res.messages.length === 0
					? "실시간 데이터 0건 — 장 마감이면 정상이며, 장중이면 구독 조건(tr_id/tr_key) 또는 유료 구독 여부를 확인하세요."
					: undefined;
		return {
			ok: true,
			env,
			tr_id: opts.trId,
			tr_key: opts.trKey,
			durationMs,
			maxMessages,
			messages: res.messages,
			system: res.system,
			approval: { cached },
			closedBy: res.closedBy,
			note,
		};
	}
	throw new Error("웹소켓 재연결 실패 (approval key 재발급 후에도 구독 오류)");
}
