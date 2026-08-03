/**
 * src/client.ts — config-driven KIS Open API executor (v2, 공식 포털 스펙).
 *
 * API definitions come from src/generated/apis.json (338 APIs parsed from the
 * official apiportal.koreainvestment.com API_COLLECTION Excel by
 * scripts/parse-portal-excel.py):
 *   { name, category, api_id, kind: REST|WEBSOCKET, method, api_path,
 *     tr_id_real[], tr_id_paper[], description, headers{}, query{}, body{},
 *     response{}, example_request }
 * Key format: "<category>.<api_id>" (예: "overseas_stock.v1_해외주식-009").
 *
 * src/generated/aliases.json maps legacy keys (164개, 구버전 예제코드 파싱
 * 스펙) to v2 keys by (method + api_path) for backward compatibility.
 *
 * v2 동작 요약:
 *  - tr_id: env에 따라 tr_id_real[0]/tr_id_paper[0] 자동 선택. 다중 TR_ID
 *    API(배열 길이>1 또는 headers.tr_id.desc에 라벨 목록 존재)는 사용자가
 *    명시적 `tr_id` 파라미터를 넘겨야 한다 (desc의 "TRID : 한글라벨" 파싱으로
 *    선택 목록 제공, 목록에 없으면 에러).
 *  - hashkey: POST 주문/정정/취소 계열(/trading/)에 자동 적용.
 *    POST {base}/uapi/hashkey (authorization 불필요) → HASH → hashkey 헤더.
 *    발급 실패 시 에러 반환 (비필수지만 안전 우선, hashkey 없이 진행하지 않음).
 *  - 파라미터: GET → query, POST → body. AUTH→"", CANO→keys.acctStock,
 *    ACNT_PRDT_CD→"01", custtype 헤더→"P" 자동 주입. 사용자 params는 소문자
 *    이름/대문자 키 모두 허용(대문자 키 우선). required 누락 시 에러(누락 목록
 *    표시), 스펙에 없는 파라미터는 무시.
 *  - WEBSOCKET kind → REST 호출 불가 에러.
 *  - tr_cont 페이지네이션: pages 옵션(기본 1, 최대 10). 응답 body의
 *    ctx_area_nk100/fk100(→nk200/fk200→nk50/fk50)을 다음 요청 query로 에코,
 *    응답 헤더 tr_cont가 D/E 또는 ctx 키가 없으면 종료. output 배열 병합.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl, clearTokenCache, getToken, keysFor, loadKeys, resolveEnv, type EnvArg, type KisEnv } from "./auth.ts";

export type { EnvArg, KisEnv } from "./auth.ts";

export interface ParamField {
	name_kr?: string;
	type?: string;
	required?: boolean;
	length?: string;
	desc?: string;
}

export interface ApiDef {
	name: string;
	category: string;
	api_id: string;
	kind: "REST" | "WEBSOCKET";
	method: "GET" | "POST";
	api_path: string;
	tr_id_real: string[];
	tr_id_paper: string[];
	description?: string;
	headers: Record<string, ParamField>;
	query: Record<string, ParamField>;
	body: Record<string, ParamField>;
	response?: Record<string, ParamField>;
	example_request?: string;
}

interface GeneratedFile {
	generated?: string;
	apis: Record<string, ApiDef>;
}

interface AliasesFile {
	generated?: string;
	aliases: Record<string, string>;
}

const generatedDir = join(dirname(fileURLToPath(import.meta.url)), "generated");
const generated: GeneratedFile = JSON.parse(readFileSync(join(generatedDir, "apis.json"), "utf8"));
const aliases: AliasesFile = JSON.parse(readFileSync(join(generatedDir, "aliases.json"), "utf8"));

// ── API discovery ─────────────────────────────────────────────────────────

export function listApis(category?: string): string[] {
	const names = Object.keys(generated.apis).sort();
	return category ? names.filter((n) => n.startsWith(`${category}.`)) : names;
}

/** v2 키 → API 정의 (없으면 alias로 해석). */
export function lookupApi(api: string): ApiDef {
	const key = resolveApiKey(api);
	return generated.apis[key];
}

/** 입력 키를 v2 키로 정규화: v2 키 먼저, 없으면 alias. */
export function resolveApiKey(api: string): string {
	if (api in generated.apis) return api;
	const alias = aliases.aliases[api];
	if (alias && alias in generated.apis) return alias;
	throw new Error(
		`Unknown KIS API "${api}". Use kis_list_apis to see available APIs ` +
			`(v2 키 형식: "overseas_stock.v1_해외주식-009", "domestic_stock.v1_국내주식-008").`,
	);
}

/** /kis-status용: 총 API 수 / REST / WEBSOCKET / alias 수. */
export function specStats(): { total: number; rest: number; websocket: number; aliases: number } {
	let rest = 0;
	let websocket = 0;
	for (const def of Object.values(generated.apis)) {
		if (def.kind === "WEBSOCKET") websocket++;
		else rest++;
	}
	return { total: Object.keys(generated.apis).length, rest, websocket, aliases: Object.keys(aliases.aliases).length };
}

// ── tr_id 선택 ────────────────────────────────────────────────────────────

export interface TrIdOption {
	id: string;
	label: string;
}

/** "TTTT1002U : 미국 매수 주문" 형식 (선택적 "(신)" 접두사 허용). */
const TR_ID_LABEL_RE = /^\s*(?:\(신\)\s*)?([A-Z][A-Z0-9]{8,12})\s*[:：]\s*(.+)$/;

/** "국내주식주문 매도 : (구)TTTC0801U → (신)TTTC0011U" 구TR→신TR 안내 형식. */
const TR_ID_MIGRATION_RE = /^\s*(.+?)\s*[:(（]?\s*\(구\)[A-Z0-9]{8,13}\s*→\s*\(신\)([A-Z][A-Z0-9]{8,12})\s*$/;

function parseTrIdLabels(desc: string | undefined): { real: TrIdOption[]; paper: TrIdOption[] } {
	const out: { real: TrIdOption[]; paper: TrIdOption[] } = { real: [], paper: [] };
	if (!desc) return out;
	let section: "real" | "paper" | null = null;
	for (const raw of desc.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (line.includes("[실전투자")) {
			section = "real";
			continue;
		}
		if (line.includes("[모의투자")) {
			section = "paper";
			continue;
		}
		const m = line.match(TR_ID_LABEL_RE);
		if (m && section) out[section].push({ id: m[1], label: m[2].trim() });
	}
	return out;
}

function parseMigrationLabels(desc: string | undefined): TrIdOption[] {
	const out: TrIdOption[] = [];
	if (!desc) return out;
	for (const raw of desc.split(/\r?\n/)) {
		const m = raw.trim().match(TR_ID_MIGRATION_RE);
		if (m) out.push({ id: m[2], label: m[1].trim() });
	}
	return out;
}

/** env에 대한 tr_id 후보 배열 (paper 우선, 없으면 real로 폴백). */
function envTrIds(def: ApiDef, env: KisEnv): string[] {
	const primary = env === "paper" ? def.tr_id_paper : def.tr_id_real;
	return primary.length > 0 ? primary : env === "paper" ? def.tr_id_real : def.tr_id_paper;
}

/** 모의투자 tr_id는 V 접두사 (실전 id와 섞인 desc에서 env별 필터용). */
function isPaperTrId(id: string): boolean {
	return id.startsWith("V");
}

/** 선택 가능한 tr_id 목록 — env에 맞는 id만 (desc가 실전/모의를 섞어놓아도 필터). */
function trIdPool(def: ApiDef, env: KisEnv): TrIdOption[] {
	const envIds = envTrIds(def, env);
	const labels = parseTrIdLabels(def.headers?.tr_id?.desc);
	const section = env === "paper" ? labels.paper : labels.real;
	const base = section.length > 0 ? [...section] : parseMigrationLabels(def.headers?.tr_id?.desc);
	// env 필터: paper는 V 접두사, real은 V 접두사 제외 (desc에 다른 env id가 섞인 경우 방지)
	const filtered = base.filter((o) => (env === "paper" ? isPaperTrId(o.id) : !isPaperTrId(o.id)));
	const pool = filtered.length > 0 ? filtered : base;
	const seen = new Set(pool.map((o) => o.id));
	for (const id of envIds) {
		if (!seen.has(id)) pool.push({ id, label: id });
	}
	return pool;
}

/** 다중 TR_ID 여부: env 배열 길이>1 또는 desc 라벨 목록 존재(환경 무관). */
function isMultiTrId(def: ApiDef, env: KisEnv): boolean {
	if (envTrIds(def, env).length > 1) return true;
	const labels = parseTrIdLabels(def.headers?.tr_id?.desc);
	return labels.real.length + labels.paper.length > 1;
}

export interface TrIdSelection {
	trId: string;
	options: TrIdOption[];
	explicit: boolean;
}

/** tr_id 결정: 다중 TR_ID API는 명시적 tr_id 필수, 전달값은 목록 검증. */
export function resolveTrId(def: ApiDef, env: KisEnv, requested?: string): TrIdSelection {
	const envIds = envTrIds(def, env);
	const options = trIdPool(def, env);
	if (requested) {
		const hit = options.find((o) => o.id === requested);
		if (!hit) {
			throw new Error(
				`KIS API "${def.name}" — tr_id "${requested}"는 env=${env}에서 사용 불가. ` +
					`사용 가능한 tr_id 목록:\n${options.map((o) => `${o.id} : ${o.label}`).join("\n")}`,
			);
		}
		return { trId: requested, options, explicit: true };
	}
	if (isMultiTrId(def, env)) {
		throw new Error(
			`KIS API "${def.name}"는 다중 TR_ID API입니다 — 명시적 tr_id 파라미터를 넘겨주세요 ` +
				`(env=${env}):\n${options.map((o) => `${o.id} : ${o.label}`).join("\n")}`,
		);
	}
	return { trId: envIds[0] ?? "", options, explicit: false };
}

// ── 파라미터 빌드 ─────────────────────────────────────────────────────────

/**
 * GET → query, POST → body 파라미터 맵을 빌드한다.
 * - AUTH(쿼리) → "", CANO → env별 계좌번호(real: acctStock, paper: paperStock), ACNT_PRDT_CD → "01" 자동 주입
 * - 사용자 params: 대문자 키 우선, 소문자 이름은 대문자로 매핑 시도
 * - required 누락 → 에러(누락 목록 표시), 스펙에 없는 키는 무시
 */
export function buildParams(def: ApiDef, userParams: Record<string, unknown>, env: KisEnv): Record<string, string> {
	const keys = loadKeys();
	const spec = def.method === "GET" ? def.query : def.body;
	const provided: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(userParams ?? {})) {
		if (v === undefined || v === null) continue;
		const specKey = spec[k] !== undefined ? k : spec[k.toUpperCase()] !== undefined ? k.toUpperCase() : undefined;
		if (specKey && !(specKey in provided)) provided[specKey] = v;
	}
	const out: Record<string, string> = {};
	const missing: string[] = [];
	for (const [key, field] of Object.entries(spec)) {
		let value: unknown = provided[key];
		if (value === undefined) {
			if (key === "AUTH") value = ""; // GET 시세 AUTH (레거시 필드, "" 고정)
			else if (key.startsWith("CTX_AREA_")) value = ""; // 연속조회 키 (첫 요청은 "", 이후 페이지에서 에코)
			else if (key === "CANO") value = env === "paper" ? keys.paperStock : keys.acctStock;
			else if (key === "ACNT_PRDT_CD") value = "01";
		}
		if (value === undefined || value === null) {
			if (field.required) missing.push(key);
			continue;
		}
		out[key] = String(value);
	}
	if (missing.length > 0) {
		const acctHint = missing.includes("CANO") || missing.includes("ACNT_PRDT_CD")
			? " (계좌번호 미등록 시 /kis-key에서 계좌 정보 등록 필요)"
			: "";
		throw new Error(
			`KIS API "${def.name}" requires parameter(s): ${missing.join(", ")}${acctHint}. ` +
				`Provide them via the tool's params argument.`,
		);
	}
	return out;
}

// ── hashkey ───────────────────────────────────────────────────────────────

/** POST 주문/정정/취소 계열 여부 (api_path에 /trading/ 포함, method=POST). */
export function needsHashkey(def: ApiDef): boolean {
	return def.kind === "REST" && def.method === "POST" && def.api_path.includes("/trading/");
}

/**
 * POST {base}/uapi/hashkey — authorization 불필요, body는 주문과 동일한 JSON.
 * 발급 실패 시 에러 (hashkey 없이 진행하지 않음, 안전 우선).
 */
async function getHashkey(base: string, appKey: string, appSecret: string, body: Record<string, string>): Promise<string> {
	let res: Response;
	try {
		res = await fetch(`${base}/uapi/hashkey`, {
			method: "POST",
			headers: {
				"content-type": "application/json; charset=UTF-8",
				appkey: appKey,
				appsecret: appSecret,
			},
			body: JSON.stringify(body),
		});
	} catch (e) {
		throw new Error(`KIS hashkey 발급 실패 (네트워크): ${(e as Error).message}`);
	}
	const text = await res.text();
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`KIS hashkey 발급 실패 (HTTP ${res.status}): ${text.slice(0, 200)}`);
	}
	const hash = json.HASH ?? json.hash;
	if (typeof hash !== "string" || !hash) {
		throw new Error(`KIS hashkey 발급 실패: ${text.slice(0, 200)}`);
	}
	return hash;
}

// ── 응답 처리 ─────────────────────────────────────────────────────────────

const CTX_PAIRS: [string, string][] = [
	["ctx_area_nk100", "ctx_area_fk100"],
	["ctx_area_nk200", "ctx_area_fk200"],
	["ctx_area_nk50", "ctx_area_fk50"],
];

/** 응답 body에서 연속조회 키 추출 (nk100/fk100 → nk200/fk200 → nk50/fk50). */
function extractCtx(json: Record<string, unknown>): Record<string, string> {
	for (const [nk, fk] of CTX_PAIRS) {
		const nkS = typeof json[nk] === "string" ? (json[nk] as string) : "";
		const fkS = typeof json[fk] === "string" ? (json[fk] as string) : "";
		if (nkS || fkS) return { [nk]: nkS, [fk]: fkS };
	}
	return {};
}

/** 페이지네이션 병합: 배열 키는 concat, 스칼라 키는 마지막 페이지 우선. */
function mergeResponses(acc: Record<string, unknown>, page: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of new Set([...Object.keys(acc), ...Object.keys(page)])) {
		const a = acc[k];
		const b = page[k];
		if (Array.isArray(a) || Array.isArray(b)) {
			out[k] = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
		} else {
			out[k] = b !== undefined ? b : a;
		}
	}
	return out;
}

async function parseResponse(res: Response, def: ApiDef): Promise<Record<string, unknown>> {
	const text = await res.text();
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`KIS API "${def.name}" returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
	}
	const rtCd = String(json.rt_cd ?? "");
	const rtMsg = String(json.rt_msg ?? json.msg1 ?? "");
	if (rtCd !== "0" && rtCd !== "") {
		throw Object.assign(new Error(`KIS API error [${def.name}] rt_cd=${rtCd} rt_msg=${rtMsg}`), {
			kis: { rt_cd: rtCd, rt_msg: rtMsg, status: res.status },
		});
	}
	return json;
}

function isAuthError(status: number, rtCd: string, rtMsg: string): boolean {
	if (status === 401) return true;
	const codes = ["EGW00123", "EGW00200", "EGW00201", "OPSQ2003"];
	if (codes.includes(rtCd)) return true;
	return /(token|토큰).*(expire|만료|유효)/i.test(rtMsg);
}

interface RawResult {
	data: Record<string, unknown>;
	pages: number;
	trId: string;
}

async function rawCall(
	def: ApiDef,
	params: Record<string, unknown>,
	env: KisEnv,
	requestedTrId: string | undefined,
	pages: number,
): Promise<RawResult> {
	if (def.kind === "WEBSOCKET") {
		const trId = def.api_path.startsWith("/tryitout/") ? def.api_path.slice("/tryitout/".length) : "";
		throw new Error(
			`KIS API "${def.name}"는 websocket 전용 API입니다 — REST 호출 불가. ` +
				(trId
					? `실시간 데이터는 kis_realtime 도구로 구독하세요 (tr_id: ${trId}, tr_key: 종목코드). `
					: "실시간 데이터는 kis_realtime 도구로 구독하세요. ") +
				`전체 WS tr_id 목록: kis_list_apis 결과의 websocket_tr_ids (또는 src/generated/ws-tr-ids.json) 참고.`,
		);
	}
	const { appKey, appSecret } = keysFor(env);
	const token = await getToken(env);
	const sel = resolveTrId(def, env, requestedTrId);
	const nPages = Math.min(Math.max(1, Math.floor(pages)), 10);

	const body = buildParams(def, params, env);
	let hashkey: string | undefined;
	if (needsHashkey(def)) {
		hashkey = await getHashkey(baseUrl(env), appKey, appSecret, body);
	}

	const url = baseUrl(env) + def.api_path;
	const baseHeaders: Record<string, string> = {
		authorization: `Bearer ${token}`,
		appkey: appKey,
		appsecret: appSecret,
		tr_id: sel.trId,
		custtype: "P",
		"content-type": "application/json; charset=UTF-8",
	};
	if (hashkey) baseHeaders.hashkey = hashkey;

	let merged: Record<string, unknown> | null = null;
	let ctx: Record<string, string> = {};
	let pagesDone = 0;
	for (let i = 0; i < nPages; i++) {
		const headers = { ...baseHeaders, tr_cont: i === 0 ? "" : "N" };
		const query = buildParams(def, { ...params, ...ctx }, env);
		const res =
			def.method === "POST"
				? await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
				: await fetch(`${url}?${new URLSearchParams(query)}`, { method: "GET", headers });
		const json = await parseResponse(res, def);
		merged = merged ? mergeResponses(merged, json) : json;
		pagesDone++;

		const nextCtx = extractCtx(json);
		const cont = res.headers.get("tr_cont") ?? "";
		if (cont === "D" || cont === "E") break; // 연속조회 종료 (응답 헤더)
		if (Object.keys(nextCtx).length === 0) break; // ctx 키 없음 → 종료
		ctx = nextCtx;
	}
	return { data: merged ?? {}, pages: pagesDone, trId: sel.trId };
}

export interface CallOptions {
	env?: EnvArg;
	/** 다중 TR_ID API용 명시적 tr_id (예: "TTTT1002U"). */
	trId?: string;
	/** tr_cont 페이지네이션 (기본 1, 최대 10). */
	pages?: number;
}

export interface CallResult {
	ok: true;
	api: string;
	env: KisEnv;
	tr_id: string;
	/** 실제 수행한 페이지 수 (pages>1일 때). */
	pages: number;
	data: Record<string, unknown>;
}

/**
 * Execute a KIS API.
 * - WEBSOCKET API → 에러
 * - 다중 TR_ID API → trId 옵션 필수
 * - POST 주문 계열 → hashkey 자동 적용
 * - pages>1 → tr_cont 페이지네이션 + output 배열 병합
 * - 인증 에러 시 토큰 캐시 클리어 후 1회 재시도 (토큰 재발급 시 알림톡 발송)
 */
export async function callApi(
	api: string,
	params: Record<string, unknown>,
	options?: CallOptions,
): Promise<CallResult> {
	const envResolved = resolveEnv(options?.env ?? "auto");
	const key = resolveApiKey(api);
	const def = lookupApi(key);
	const pages = Number.isFinite(options?.pages) ? Math.max(1, Math.floor(options?.pages as number)) : 1;
	try {
		const { data, pages: pagesDone, trId } = await rawCall(def, params, envResolved, options?.trId, pages);
		return { ok: true, api: key, env: envResolved, tr_id: trId, pages: pagesDone, data };
	} catch (e) {
		const err = e as Error & { kis?: { rt_cd: string; rt_msg: string; status: number } };
		if (err.kis && isAuthError(err.kis.status, err.kis.rt_cd, err.kis.rt_msg)) {
			await clearTokenCache(envResolved);
			const { data, pages: pagesDone, trId } = await rawCall(def, params, envResolved, options?.trId, pages);
			return { ok: true, api: key, env: envResolved, tr_id: trId, pages: pagesDone, data };
		}
		throw e;
	}
}
