#!/usr/bin/env node
/**
 * CI/로컬 스모크 테스트 — pi-coingecko 확장이 계약된 툴/커맨드를 등록하는지 검증.
 *
 * 실행 (패키지 루트에서):
 *   node --experimental-transform-types scripts/smoke.mjs
 */
const EXPECTED_TOOLS = [
	"coingecko_price",
	"coingecko_chart",
	"coingecko_market",
	"coingecko_coin",
	"coingecko_search",
];
const EXPECTED_COMMANDS = ["coingecko-key", "coingecko-status"];

const registered = { tools: [], commands: [] };
const pi = {
	registerTool(t) {
		registered.tools.push(t.name);
	},
	registerCommand(name) {
		registered.commands.push(name);
	},
	on() {},
};

const mod = await import("../index.ts");
await mod.default(pi);

const tools = [...registered.tools].sort();
const commands = [...registered.commands].sort();
const expTools = [...EXPECTED_TOOLS].sort();
const expCommands = [...EXPECTED_COMMANDS].sort();

const failures = [];
if (JSON.stringify(tools) !== JSON.stringify(expTools)) {
	failures.push(`툴 목록 불일치\n  expected: ${expTools.join(", ")}\n  actual  : ${tools.join(", ")}`);
}
if (JSON.stringify(commands) !== JSON.stringify(expCommands)) {
	failures.push(`커맨드 목록 불일치\n  expected: ${expCommands.join(", ")}\n  actual  : ${commands.join(", ")}`);
}

if (failures.length > 0) {
	console.error(`[pi-coingecko smoke] FAIL\n${failures.join("\n")}`);
	process.exit(1);
}
console.log(`[pi-coingecko smoke] PASS — 툴 ${tools.length}개, 커맨드 ${commands.length}개`);
