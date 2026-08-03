/**
 * src/client.ts — config-driven KIS Open API executor.
 *
 * API definitions come from src/generated/apis.json (generated from the
 * official koreainvestment/open-trading-api examples by
 * scripts/generate-apis.mjs): api_path, HTTP method, tr_id and the exact
 * query/body parameter map per API. No code is downloaded or executed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl, clearTokenCache, getToken, keysFor, loadKeys, resolveEnv, type EnvArg } from "./auth.ts";

export interface ApiParamDef {
	required: boolean;
	default: string | null;
}

export interface ApiDef {
	name: string;
	api_path: string;
	method: "GET" | "POST";
	tr_ids: string[];
	/** Request parameter map: { query/body key → example function arg name } */
	body: { key: string; var: string }[];
	required: string[];
	params: Record<string, ApiParamDef>;
}

interface GeneratedApis {
	generated: string;
	source: string;
	apis: Record<string, ApiDef>;
}

const generatedPath = join(dirname(fileURLToPath(import.meta.url)), "generated", "apis.json");
const generated: GeneratedApis = JSON.parse(readFileSync(generatedPath, "utf8"));

export function listApis(category?: string): string[] {
	const names = Object.keys(generated.apis).sort();
	return category ? names.filter((n) => n.startsWith(`${category}.`)) : names;
}

export function lookupApi(api: string): ApiDef {
	const def = generated.apis[api];
	if (!def) {
		throw new Error(
			`Unknown KIS API "${api}". Use kis_list_apis to see available APIs ` +
			`(e.g. "overseas_stock.price", "domestic_stock.inquire_price").`,
		);
	}
	return def;
}

/** Pick the tr_id for an env, mirroring the repo's paper-trading conversion. */
function resolveTrId(def: ApiDef, env: "real" | "paper"): string {
	if (env === "paper") {
		const explicit = def.tr_ids.find((t) => t.startsWith("V"));
		if (explicit) return explicit;
		const first = def.tr_ids[0];
		// 실전 전용 tr_id (T/J/C prefix) → 모의 "V" + rest
		if (/^[TJC]/.test(first)) return `V${first.slice(1)}`;
		return first;
	}
	return def.tr_ids[0];
}

/** Build the request param object for one API call (query for GET, body for POST). */
export function buildParams(def: ApiDef, userParams: Record<string, unknown>, env: "real" | "paper"): Record<string, string> {
	const keys = loadKeys();
	const out: Record<string, string> = {};
	const missing: string[] = [];
	for (const { key, var: v } of def.body) {
		let value: unknown = userParams[v];
		if (value === undefined) {
			// auto-fill transport/account/auth params (same as the official MCP server)
			if (v === "auth") value = "";
			else if (v === "cano") value = keys.acctStock;
			else if (v === "acnt_prdt_cd") value = "01";
			else if (v === "my_htsid" || v === "user_id") value = keys.htsId;
			else if (v === "paper_cano") value = keys.paperStock;
			else value = def.params[v]?.default ?? undefined;
		}
		if (value === undefined || value === null) {
			missing.push(v);
			continue;
		}
		out[key] = String(value);
	}
	if (missing.length > 0) {
		throw new Error(
			`KIS API "${def.name}" requires parameter(s): ${missing.join(", ")}. ` +
			`Provide them via the tool's params argument.`,
		);
	}
	return out;
}

function isAuthError(status: number, rtCd: string, rtMsg: string): boolean {
	if (status === 401) return true;
	const codes = ["EGW00123", "EGW00200", "EGW00201", "OPSQ2003"];
	if (codes.includes(rtCd)) return true;
	return /(token|토큰).*(expire|만료|유효)/i.test(rtMsg);
}

async function rawCall(def: ApiDef, params: Record<string, unknown>, env: "real" | "paper"): Promise<Record<string, unknown>> {
	const { appKey, appSecret } = keysFor(env);
	const token = await getToken(env);
	const trId = resolveTrId(def, env);
	const body = buildParams(def, params, env);
	const url = baseUrl(env) + def.api_path;
	const headers: Record<string, string> = {
		authorization: `Bearer ${token}`,
		appkey: appKey,
		appsecret: appSecret,
		tr_id: trId,
		custtype: "P",
		tr_cont: "",
		"content-type": "application/json; charset=UTF-8",
	};
	const res =
		def.method === "POST"
			? await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
			: await fetch(`${url}?${new URLSearchParams(body)}`, { method: "GET", headers });
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

/**
 * Execute a KIS API. On auth errors (expired/missing token) the token cache
 * is cleared and the call is retried once with a freshly issued token.
 */
export async function callApi(
	api: string,
	params: Record<string, unknown>,
	env: EnvArg = "auto",
): Promise<{ ok: true; api: string; env: "real" | "paper"; data: Record<string, unknown> }> {
	const envResolved = resolveEnv(env);
	const def = lookupApi(api);
	try {
		const data = await rawCall(def, params, envResolved);
		return { ok: true, api, env: envResolved, data };
	} catch (e) {
		const err = e as Error & { kis?: { rt_cd: string; rt_msg: string; status: number } };
		if (err.kis && isAuthError(err.kis.status, err.kis.rt_cd, err.kis.rt_msg)) {
			await clearTokenCache(envResolved);
			const data = await rawCall(def, params, envResolved);
			return { ok: true, api, env: envResolved, data };
		}
		throw e;
	}
}
