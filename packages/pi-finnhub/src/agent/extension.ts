/**
 * src/agent/extension.ts — pi 확장 진입점 (tools + commands 묶음).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTools } from "./tools.ts";
import { registerCommands } from "./commands.ts";

/** pi 확장 등록 — finnhub_* 툴 4개 + /finnhub-key, /finnhub-status. */
export default function registerExtension(pi: ExtensionAPI): void {
	registerTools(pi);
	registerCommands(pi);
}
