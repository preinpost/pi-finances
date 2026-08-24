/**
 * src/agent/commands.ts — pi 커맨드 등록 (/binance-key, /binance-status).
 *
 * 참고: pi의 ctx.ui.notify 타입은 "error"|"info"|"warning"만 허용하므로
 * 성공 알림은 "info"를 사용한다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { groupIntervalMs } from "../ratelimit.ts";
import { BINANCE_BASES } from "../client.ts";
import { getKeys, keysPath, parseBinanceEnv, saveKeys, store, type BinanceEnv, type BinanceKeys } from "../secret.ts";

function masked(v: string | undefined): string {
	return v ? `${v.slice(0, 4)}***${v.length > 8 ? `(${v.length})` : ""}` : "—";
}

export function registerCommands(pi: ExtensionAPI): void {
	pi.registerCommand("binance-key", {
		description:
			"Binance API Key/Secret 등록 (binance.com API Management, HMAC). " +
			"출금(Enable Withdrawals)은 반드시 끄고, Spot + Futures 권한만 켤 것. " +
			"live/testnet 선택 — 현물 테스트넷과 선물 테스트넷 키는 서로 다름.",
		handler: async (_args, ctx) => {
			const existing = getKeys();
			const apiKey = await ctx.ui.input(
				"Binance API Key",
				existing.apiKey ? `현재 값: ${masked(existing.apiKey)} — 엔터로 유지` : "binance.com API Management에서 발급한 API Key",
			);
			if (apiKey === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}
			const apiSecret = await ctx.ui.input(
				"Binance API Secret",
				existing.apiSecret ? `현재 값: ${masked(existing.apiSecret)} — 엔터로 유지` : "API Secret (한 번만 표시됨 — 출금 권한 OFF)",
			);
			if (apiSecret === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}
			const envRaw = await ctx.ui.input(
				"Environment (live / testnet)",
				`현재: ${existing.env ?? "live"} — live 또는 testnet`,
			);
			if (envRaw === undefined) {
				ctx.ui.notify("취소됨 — 키를 저장하지 않았습니다.", "info");
				return;
			}

			const keys: BinanceKeys = { ...existing };
			if (apiKey.trim()) keys.apiKey = apiKey.trim();
			if (apiSecret.trim()) keys.apiSecret = apiSecret.trim();
			if (envRaw.trim()) keys.env = parseBinanceEnv(envRaw);

			await saveKeys(keys);
			const env: BinanceEnv = keys.env ?? "live";
			ctx.ui.notify(
				`Binance 키 저장 완료 → ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : keysPath} (${store.backend})\n` +
					`API key: ${masked(keys.apiKey)}\n` +
					`env: ${env}  spot=${BINANCE_BASES[env].spot}  usdm=${BINANCE_BASES[env].usdm}\n` +
					`출금 권한이 꺼져 있는지 다시 확인하세요. 주문은 사용자 확인 후에만.`,
				"info",
			);
		},
	});

	pi.registerCommand("binance-status", {
		description: "Binance 연동 상태 진단 (키, live/testnet, 저장 백엔드, 레이트리밋)",
		handler: async (_args, ctx) => {
			const keys = getKeys();
			const env = keys.env ?? "live";
			const lines = [
				`backend     : ${store.backend === "keyring" ? "OS keyring (Keychain/CredMan/SecretService)" : "file (0600)"}`,
				`keys file   : ${store.backend === "keyring" ? "(keyring 사용 — 파일 불필요)" : keysPath}`,
				`apiKey      : ${keys.apiKey ? masked(keys.apiKey) : "미등록 — 시세·차트는 키 없이 가능, 잔고·주문은 /binance-key"}`,
				`apiSecret   : ${keys.apiSecret ? masked(keys.apiSecret) : "미등록"}`,
				`env         : ${env}`,
				`spot base   : ${BINANCE_BASES[env].spot}`,
				`usdm base   : ${BINANCE_BASES[env].usdm}`,
				`rate limit  : MARKET ${groupIntervalMs("MARKET")}ms / ACCOUNT ${groupIntervalMs("ACCOUNT")}ms / ORDER ${groupIntervalMs("ORDER")}ms (BINANCE_RATE_LIMIT_MULTIPLIER)`,
				`시세/차트   : binance_price / binance_chart (키 불필요, symbol=BTCUSDT, market=spot|usdm)`,
				`잔고        : binance_account (현물 잔고 / 선물 잔고·포지션)`,
				`주문        : binance_order / binance_orders (실전 — 사용자 확인 후, 출금 없음)`,
				`선물        : binance_futures (funding/mark/open-interest/positions/leverage/margin-type)`,
				`주의        : 현물 테스트넷과 선물 테스트넷 키는 다름. CoinGecko는 시세 리서치용.`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
