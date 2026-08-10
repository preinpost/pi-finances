/**
 * src/agent/commands.ts — pi 커맨드 등록 (/toss-key, /toss-status).
 *
 * 참고: pi의 ctx.ui.notify 타입은 "error"|"info"|"warning"만 허용하므로
 * 성공 알림은 "info"를 사용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeys, getTokenCache, keysPath, saveKeys, store } from "../secret.ts";

function masked(v: string | undefined): string {
	return v ? `${v.slice(0, 4)}***${v.length > 8 ? `(${v.length})` : ""}` : "—";
}

export function registerCommands(pi: ExtensionAPI): void {
	// ── /toss-key ───────────────────────────────────────────────────────
	pi.registerCommand("toss-key", {
		description:
			"토스증권 Open API 키 등록 (개발자센터 발급 client_id/client_secret → OS 키체인/0600 파일 폴백). " +
			"pi-kis와 공용 저장소를 쓰므로 분리 전 등록한 키는 그대로 유지됩니다.",
		handler: async (_args, ctx) => {
			const existing = getKeys();
			const clientId = await ctx.ui.input(
				"Toss Client ID",
				existing.tossClientId ? `현재 값: ${masked(existing.tossClientId)} — 엔터로 유지` : "developers.tossinvest.com에서 발급받은 client_id (c_...)",
			);
			if (clientId === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}
			const clientSecret = await ctx.ui.input(
				"Toss Client Secret",
				existing.tossClientSecret ? `현재 값: ${masked(existing.tossClientSecret)} — 엔터로 유지` : "client_secret (s_...)",
			);
			if (clientSecret === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}

			const keys: { tossClientId?: string; tossClientSecret?: string } = { ...existing };
			if (clientId.trim()) keys.tossClientId = clientId.trim();
			if (clientSecret.trim()) keys.tossClientSecret = clientSecret.trim();

			await saveKeys(keys);
			ctx.ui.notify(
				`토스 키 저장 완료 → ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : keysPath} (${store.backend})\n` +
					`Client ID: ${masked(keys.tossClientId)} (toss_* 툴 사용 가능)`,
				"info",
			);
		},
	});

	// ── /toss-status ─────────────────────────────────────────────────────
	pi.registerCommand("toss-status", {
		description: "토스 연동 상태 진단 (키, 토큰 캐시, 저장 백엔드)",
		handler: async (_args, ctx) => {
			const keys = getKeys();
			const token = getTokenCache().toss;
			const lines = [
				`backend     : ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : "file (0600)"}`,
				`keys file   : ${store.backend === "keyring" ? "(keyring 사용 — 파일 불필요)" : keysPath}`,
				`clientId    : ${keys.tossClientId ? masked(keys.tossClientId) : "미등록 — /toss-key 실행"}`,
				`clientSecret: ${keys.tossClientSecret ? masked(keys.tossClientSecret) : "미등록"}`,
				`token cache : ${token && token.expiresAt > Date.now() ? `${Math.round((token.expiresAt - Date.now()) / 1000)}s 남음` : token ? "만료 — 다음 호출 시 자동 재발급" : "없음 (첫 호출 시 자동 발급)"}`,
				`사용법      : "AAPL 현재가" → toss_price / "005930 1분봉" → toss_chart (interval: 1m)`,
				`시장/자산   : toss_market / toss_balance (accountSeq 미지정 시 첫 계좌 자동)`,
				`주문        : toss_order / toss_orders / toss_conditional (실전 — 사용자 확인 후)`,
				`KIS         : KIS 툴(kis_*)은 pi-kis 패키지 제공 (pi install npm:pi-kis, 키는 /kis-key)`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
