/**
 * src/agent/commands.ts — pi 커맨드 등록 (/coingecko-key, /coingecko-status).
 *
 * 참고: pi의 ctx.ui.notify 타입은 "error"|"info"|"warning"만 허용하므로
 * 성공 알림은 "info"를 사용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { groupIntervalMs } from "../ratelimit.ts";
import { getKeys, keysPath, saveKeys, store } from "../secret.ts";

function masked(v: string | undefined): string {
	return v ? `${v.slice(0, 4)}***${v.length > 8 ? `(${v.length})` : ""}` : "—";
}

export function registerCommands(pi: ExtensionAPI): void {
	// ── /coingecko-key ───────────────────────────────────────────────────
	pi.registerCommand("coingecko-key", {
		description:
			"CoinGecko API 키 등록 (coingecko.com API 대시보드 무료 가입 → demo key, x-cg-demo-api-key 헤더). " +
			"키가 없어도 공개 API 사용 가능 (5~15 req/min) — 빈 값 입력 시 기존 키 삭제.",
		handler: async (_args, ctx) => {
			const existing = getKeys();
			const apiKey = await ctx.ui.input(
				"CoinGecko API Key",
				existing.apiKey
					? `현재 값: ${masked(existing.apiKey)} — 엔터로 유지, 빈 값 입력 시 삭제`
					: "coingecko.com/en/developers/dashboard에서 발급한 데모 키 (x_cg_demo_...) — 없으면 엔터 (공개 API 사용)",
			);
			if (apiKey === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}

			const keys: { apiKey?: string } = { ...existing };
			if (apiKey.trim()) keys.apiKey = apiKey.trim();
			else delete keys.apiKey;

			await saveKeys(keys);
			ctx.ui.notify(
				`CoinGecko 키 ${keys.apiKey ? "저장" : "삭제"} 완료 → ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : keysPath} (${store.backend})\n` +
					`API key: ${keys.apiKey ? masked(keys.apiKey) : "미등록 — 공개 API 사용 (5~15 req/min)"}`,
				"info",
			);
		},
	});

	// ── /coingecko-status ────────────────────────────────────────────────
	pi.registerCommand("coingecko-status", {
		description: "CoinGecko 연동 상태 진단 (키 상태, 저장 백엔드, 레이트리밋 간격, 캐시)",
		handler: async (_args, ctx) => {
			const keys = getKeys();
			const lines = [
				`backend     : ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : "file (0600)"}`,
				`keys file   : ${store.backend === "keyring" ? "(keyring 사용 — 파일 불필요)" : keysPath}`,
				`apiKey      : ${keys.apiKey ? masked(keys.apiKey) : "미등록 — 공개 API 사용 (5~15 req/min)"}`,
				`rate limit  : ${groupIntervalMs("DEFAULT")}ms 간격 (무료 플랜 5~15 req/min, COINGECKO_RATE_LIMIT_MULTIPLIER 배율 적용)`,
				`cache       : ${process.env.COINGECKO_DISABLE_CACHE === "1" ? "비활성 (COINGECKO_DISABLE_CACHE=1)" : "활성 (price 15s / chart 60s / market 2m / coin·search 10m)"}`,
				`사용법      : "비트코인 현재가" → coingecko_price / "비트코인 30일 차트" → coingecko_chart`,
				`랭킹/상세   : coingecko_market / coingecko_coin (id 필요 — coingecko_search로 확인)`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
