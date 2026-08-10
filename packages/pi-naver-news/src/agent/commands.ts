/**
 * src/agent/commands.ts — pi 커맨드 등록 (/naver-news-key, /naver-news-status).
 *
 * 참고: pi의 ctx.ui.notify 타입은 "error"|"info"|"warning"만 허용하므로
 * 성공 알림은 "info"를 사용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { groupIntervalMs, todayCalls } from "../ratelimit.ts";
import { getKeys, keysPath, saveKeys, store } from "../secret.ts";

function masked(v: string | undefined): string {
	return v ? `${v.slice(0, 4)}***${v.length > 8 ? `(${v.length})` : ""}` : "—";
}

export function registerCommands(pi: ExtensionAPI): void {
	// ── /naver-news-key ─────────────────────────────────────────────────
	pi.registerCommand("naver-news-key", {
		description:
			"네이버 검색 API 키 등록 (developers.naver.com → 내 애플리케이션 → Client ID / Client Secret, '검색' API 활성화 필수). " +
			"빈 값 입력 시 해당 키 삭제.",
		handler: async (_args, ctx) => {
			const existing = getKeys();
			const clientId = await ctx.ui.input(
				"네이버 Client ID",
				existing.clientId
					? `현재 값: ${masked(existing.clientId)} — 엔터로 유지, 빈 값 입력 시 삭제`
					: "developers.naver.com에서 앱 등록 후 발급받은 Client ID",
			);
			if (clientId === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}
			const clientSecret = await ctx.ui.input(
				"네이버 Client Secret",
				existing.clientSecret
					? `현재 값: ${masked(existing.clientSecret)} — 엔터로 유지, 빈 값 입력 시 삭제`
					: "앱 등록 시 발급받은 Client Secret",
			);
			if (clientSecret === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}

			const keys = { ...existing };
			if (clientId.trim()) keys.clientId = clientId.trim();
			else delete keys.clientId;
			if (clientSecret.trim()) keys.clientSecret = clientSecret.trim();
			else delete keys.clientSecret;

			await saveKeys(keys);
			ctx.ui.notify(
				`네이버 키 ${keys.clientId || keys.clientSecret ? "저장" : "삭제"} 완료 → ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : keysPath} (${store.backend})\n` +
					`Client ID: ${keys.clientId ? masked(keys.clientId) : "미등록"}\n` +
					`Client Secret: ${keys.clientSecret ? masked(keys.clientSecret) : "미등록"}`,
				"info",
			);
		},
	});

	// ── /naver-news-status ──────────────────────────────────────────────
	pi.registerCommand("naver-news-status", {
		description: "네이버 뉴스 연동 상태 진단 (키 상태, 저장 백엔드, 레이트리밋 간격, 캐시, 오늘 호출 수)",
		handler: async (_args, ctx) => {
			const keys = getKeys();
			const calls = todayCalls();
			const lines = [
				`backend     : ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : "file (0600)"}`,
				`keys file   : ${store.backend === "keyring" ? "(keyring 사용 — 파일 불필요)" : keysPath}`,
				`Client ID   : ${keys.clientId ? masked(keys.clientId) : "미등록 (NAVER_CLIENT_ID env 폴백 확인)"}`,
				`Client Secret: ${keys.clientSecret ? masked(keys.clientSecret) : "미등록 (NAVER_CLIENT_SECRET env 폴백 확인)"}`,
				`rate limit  : ${groupIntervalMs("DEFAULT")}ms 간격 (일일 한도 25,000회, NAVER_NEWS_RATE_LIMIT_MULTIPLIER 배율 적용)`,
				`today calls : ${calls}/25,000회 (오늘 누적 — 자정 리셋)`,
				`cache       : ${process.env.NAVER_NEWS_DISABLE_CACHE === "1" ? "비활성 (NAVER_NEWS_DISABLE_CACHE=1)" : "활성 (검색 60s)"}`,
				`사용법      : "삼성전자 최근 뉴스" → naver_news_search (sort=date) / "코스피 관련 기사" → naver_news_search`,
			];
			ctx.ui.notify(lines.join("\n"), calls > 20_000 ? "warning" : "info");
		},
	});
}
