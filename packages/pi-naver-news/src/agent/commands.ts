/**
 * src/agent/commands.ts — pi 커맨드 등록 (/naver-news-key, /naver-news-status).
 *
 * 참고: pi의 ctx.ui.notify 타입은 "error"|"info"|"warning"만 허용하므로
 * 성공 알림은 "info"를 사용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { groupIntervalMs, todayCalls } from "../ratelimit.ts";
import { getKeys, keysPath, saveKeys, store, type NaverNewsMode } from "../secret.ts";

function masked(v: string | undefined): string {
	return v ? `${v.slice(0, 4)}***${v.length > 8 ? `(${v.length})` : ""}` : "—";
}

export function registerCommands(pi: ExtensionAPI): void {
	// ── /naver-news-key ─────────────────────────────────────────────────
	pi.registerCommand("naver-news-key", {
		description:
			"네이버 뉴스 검색 API 키 등록 — 기본은 NAVER API HUB (NCP 콘솔 → NAVER API HUB 구독 → Application 생성 → API Key ID/Secret). " +
			"기존 개발자센터 키 보유 시 모드에 'legacy' 입력 (2027-06-30까지). 빈 값 입력 시 해당 키 삭제.",
		handler: async (_args, ctx) => {
			const existing = getKeys();

			const modeInput = await ctx.ui.input(
				"API 모드",
				`현재: ${existing.mode} — 엔터로 유지 (hub=NAVER API HUB 기본, legacy=개발자센터 기존 키)`,
			);
			if (modeInput === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}
			const mode: NaverNewsMode =
				modeInput.trim().toLowerCase() === "legacy" ? "legacy" : "hub";

			const idLabel = mode === "hub" ? "API Key ID" : "Client ID";
			const secretLabel = mode === "hub" ? "API Key" : "Client Secret";
			const envNote =
				mode === "hub"
					? "(NCP 콘솔 → Application Services → NAVER API HUB → Application 생성 → 인증키)"
					: "(개발자센터 앱 등록 시 발급, 검색 API 활성화 필요 — 2027-06-30까지)";

			const clientId = await ctx.ui.input(
				`네이버 ${idLabel}`,
				existing.clientId
					? `현재 값: ${masked(existing.clientId)} — 엔터로 유지, 빈 값 입력 시 삭제`
					: `${idLabel} 입력 ${envNote}`,
			);
			if (clientId === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}
			const clientSecret = await ctx.ui.input(
				`네이버 ${secretLabel}`,
				existing.clientSecret
					? `현재 값: ${masked(existing.clientSecret)} — 엔터로 유지, 빈 값 입력 시 삭제`
					: `${secretLabel} 입력 ${envNote}`,
			);
			if (clientSecret === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}

			const keys = { ...existing, mode };
			if (clientId.trim()) keys.clientId = clientId.trim();
			else delete keys.clientId;
			if (clientSecret.trim()) keys.clientSecret = clientSecret.trim();
			else delete keys.clientSecret;

			await saveKeys(keys);
			ctx.ui.notify(
				`네이버 키 ${keys.clientId || keys.clientSecret ? "저장" : "삭제"} 완료 → ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : keysPath} (${store.backend})\n` +
					`mode        : ${keys.mode} (${keys.mode === "hub" ? "NAVER API HUB" : "개발자센터 legacy — 2027-06-30까지"})\n` +
					`${idLabel}   : ${keys.clientId ? masked(keys.clientId) : "미등록"}\n` +
					`${secretLabel}: ${keys.clientSecret ? masked(keys.clientSecret) : "미등록"}`,
				"info",
			);
		},
	});

	// ── /naver-news-status ──────────────────────────────────────────────
	pi.registerCommand("naver-news-status", {
		description: "네이버 뉴스 연동 상태 진단 (모드, 키 상태, 저장 백엔드, 레이트리밋 간격, 캐시, 오늘 호출 수)",
		handler: async (_args, ctx) => {
			const keys = getKeys();
			const calls = todayCalls();
			const limitNote =
				keys.mode === "hub"
					? "월 775,000건 통합 / 키당 50 RPS (현재 한시 무료)"
					: "하루 25,000회 (2027-06-30 종료)";
			const lines = [
				`mode        : ${keys.mode} (${keys.mode === "hub" ? "NAVER API HUB — naverapihub.apigw.ntruss.com" : "개발자센터 legacy — openapi.naver.com (2027-06-30까지)"})`,
				`backend     : ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : "file (0600)"}`,
				`keys file   : ${store.backend === "keyring" ? "(keyring 사용 — 파일 불필요)" : keysPath}`,
				`API Key ID  : ${keys.clientId ? masked(keys.clientId) : "미등록 (env 폴백: " + (keys.mode === "hub" ? "NCP_APIGW_API_KEY_ID" : "NAVER_CLIENT_ID") + ")"}`,
				`API Key     : ${keys.clientSecret ? masked(keys.clientSecret) : "미등록 (env 폴백: " + (keys.mode === "hub" ? "NCP_APIGW_API_KEY" : "NAVER_CLIENT_SECRET") + ")"}`,
				`rate limit  : ${groupIntervalMs("DEFAULT")}ms 간격 (NAVER_NEWS_RATE_LIMIT_MULTIPLIER 배율 적용)`,
				`limit       : ${limitNote}`,
				`today calls : ${calls}회 (자정 리셋 모니터링용)`,
				`cache       : ${process.env.NAVER_NEWS_DISABLE_CACHE === "1" ? "비활성 (NAVER_NEWS_DISABLE_CACHE=1)" : "활성 (검색 60s)"}`,
				`사용법      : "삼성전자 최근 뉴스" → naver_news_search (sort=date) / "코스피 관련 기사" → naver_news_search`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
