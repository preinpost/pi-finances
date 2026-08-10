/**
 * src/agent/commands.ts — pi 커맨드 등록 (/finnhub-key, /finnhub-status).
 *
 * 참고: pi의 ctx.ui.notify 타입은 "error"|"info"|"warning"만 허용하므로
 * 성공 알림은 "info"를 사용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeys, keysPath, saveKeys, store } from "../secret.ts";
import { groupIntervalMs } from "../ratelimit.ts";

function masked(v: string | undefined): string {
	return v ? `${v.slice(0, 4)}***${v.length > 8 ? `(${v.length})` : ""}` : "—";
}

export function registerCommands(pi: ExtensionAPI): void {
	// ── /finnhub-key ─────────────────────────────────────────────────────
	pi.registerCommand("finnhub-key", {
		description:
			"Finnhub API 키 등록 (finnhub.io 무료 가입 → dashboard token → OS 키체인/0600 파일 폴백). " +
			"등록 후 finnhub_* 툴 사용 가능 (FINNHUB_API_KEY 환경변수로도 대체 가능).",
		handler: async (_args, ctx) => {
			const existing = getKeys();
			const key = await ctx.ui.input(
				"Finnhub API Key",
				existing.finnhubApiKey ? `현재 값: ${masked(existing.finnhubApiKey)} — 엔터로 유지` : "finnhub.io dashboard에서 발급받은 token",
			);
			if (key === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}

			const keys: { finnhubApiKey?: string } = { ...existing };
			if (key.trim()) keys.finnhubApiKey = key.trim();

			await saveKeys(keys);
			ctx.ui.notify(
				`Finnhub 키 저장 완료 → ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : keysPath} (${store.backend})\n` +
					`API key: ${masked(keys.finnhubApiKey)} (finnhub_* 툴 사용 가능)`,
				"info",
			);
		},
	});

	// ── /finnhub-status ──────────────────────────────────────────────────
	pi.registerCommand("finnhub-status", {
		description: "Finnhub 연동 상태 진단 (키, 레이트리밋 간격, 캐시, 저장 백엔드)",
		handler: async (_args, ctx) => {
			const keys = getKeys();
			const interval = groupIntervalMs("API");
			const lines = [
				`backend     : ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : "file (0600)"}`,
				`keys file   : ${store.backend === "keyring" ? "(keyring 사용 — 파일 불필요)" : keysPath}`,
				`api key     : ${keys.finnhubApiKey ? masked(keys.finnhubApiKey) : "미등록 — /finnhub-key 실행 (또는 FINNHUB_API_KEY env)"}`,
				`rate limit  : ${interval > 0 ? `${interval}ms 간격 (60 req/min, 배율 ${process.env.FINNHUB_RATE_LIMIT_MULTIPLIER ?? "1.0"})` : "해제 (FINNHUB_RATE_LIMIT_MULTIPLIER=0)"}`,
				`cache       : ${process.env.FINNHUB_DISABLE_CACHE === "1" ? "비활성 (FINNHUB_DISABLE_CACHE=1)" : "quote 15s / chart 60s / news 5m / fundamentals 30m"}`,
				`한도        : 무료 60 req/min, 미국 종목만 (AAPL/MSFT 등)`,
				`사용법      : "AAPL 현재가" → finnhub_price / "AAPL 일봉" → finnhub_chart / "AAPL 뉴스" → finnhub_news / "AAPL 펀더멘털" → finnhub_fundamentals`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
