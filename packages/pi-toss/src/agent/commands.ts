/**
 * src/agent/commands.ts — pi 커맨드 등록 (/toss-key).
 *
 * 참고: pi의 ctx.ui.notify 타입은 "error"|"info"|"warning"만 허용하므로
 * 성공 알림은 "info"를 사용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeys, keysPath, saveKeys, store } from "../core/secret.ts";

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
}
