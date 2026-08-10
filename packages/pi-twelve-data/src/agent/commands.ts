/**
 * src/agent/commands.ts — pi 커맨드 등록 (/twelve-key, /twelve-status).
 *
 * 참고: pi의 ctx.ui.notify 타입은 "error"|"info"|"warning"만 허용하므로
 * 성공 알림은 "info"를 사용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeys, keysPath, saveKeys, store, type TwelveKeys } from "../secret.ts";
import { groupIntervalMs } from "../ratelimit.ts";

function masked(v: string | undefined): string {
	return v ? `${v.slice(0, 4)}***${v.length > 8 ? `(${v.length})` : ""}` : "—";
}

export function registerCommands(pi: ExtensionAPI): void {
	// ── /twelve-key ─────────────────────────────────────────────────────
	pi.registerCommand("twelve-key", {
		description: "Twelve Data API 키 등록 (twelvedata.com 무료 가입 → apikey → OS 키체인/0600 파일 폴백)",
		handler: async (_args, ctx) => {
			const existing = getKeys();
			const apiKey = await ctx.ui.input(
				"Twelve Data API Key",
				existing.apiKey ? `현재 값: ${masked(existing.apiKey)} — 엔터로 유지` : "twelvedata.com에서 발급받은 apikey",
			);
			if (apiKey === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}

			const keys: TwelveKeys = { ...existing };
			if (apiKey.trim()) keys.apiKey = apiKey.trim();

			await saveKeys(keys);
			ctx.ui.notify(
				`Twelve Data 키 저장 완료 → ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : keysPath} (${store.backend})\n` +
					`API Key: ${masked(keys.apiKey)} (twelve_* 툴 사용 가능)`,
				"info",
			);
		},
	});

	// ── /twelve-status ──────────────────────────────────────────────────
	pi.registerCommand("twelve-status", {
		description: "Twelve Data 연동 상태 진단 (키, 레이트리밋 간격, 캐시)",
		handler: async (_args, ctx) => {
			const keys = getKeys();
			const lines = [
				`backend     : ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : "file (0600)"}`,
				`keys file   : ${store.backend === "keyring" ? "(keyring 사용 — 파일 불필요)" : keysPath}`,
				`API Key     : ${keys.apiKey ? masked(keys.apiKey) : "미등록 — /twelve-key 실행"}`,
				`rate limit  : ${groupIntervalMs("DEFAULT")}ms 간격 (무료 8 req/min, TWELVE_RATE_LIMIT_MULTIPLIER=${process.env.TWELVE_RATE_LIMIT_MULTIPLIER ?? "1"})`,
				`cache       : quote 15s / chart 60s / search 10m / exchange_rate 60s${process.env.TWELVE_DISABLE_CACHE === "1" ? " (TWELVE_DISABLE_CACHE=1 → 비활성)" : ""}`,
				`사용법      : "AAPL 현재가" → twelve_price / "AAPL 일봉 지표" → twelve_chart`,
				`            : "애플 심볼 검색" → twelve_search / "USD/KRW 환율" → twelve_exchange_rate`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
