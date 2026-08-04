/**
 * src/agent/extension.ts — pi 확장 진입점 (tools + commands 묶음).
 *
 * 계층 구조:
 *   core/   — transport/protocol (REST/WS/인증/시크릿, 338개 API 스펙)
 *   roles/  — 도메인 역할 (market/portfolio/trading) — 에이전트가 직접 import 가능
 *   agent/  — pi 통합 (이 파일: 툴·커맨드 등록)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadKeys } from "../core/auth.ts";
import { migrateSecretsToKeyring } from "../core/secret.ts";
import { registerTools } from "./tools.ts";
import { registerCommands } from "./commands.ts";

/** pi 확장 등록 — 키 마이그레이션 후 툴·커맨드 등록. */
export default async function registerExtension(pi: ExtensionAPI): Promise<void> {
	// Migrate plaintext key/token files into the OS keyring (when active).
	await migrateSecretsToKeyring();
	registerTools(pi);
	registerCommands(pi);

	if (!loadKeys().appKey) {
		console.warn("[pi-kis] KIS API keys not registered — run /kis-key (stored in ~/.pi/agent/kis-keys.json).");
	}
}
