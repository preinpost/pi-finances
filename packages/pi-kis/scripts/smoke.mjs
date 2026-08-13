#!/usr/bin/env node
/**
 * CI/로컬 스모크 테스트 — pi-kis 확장이 계약된 툴/커맨드를 등록하는지 검증.
 *
 * 실행 (패키지 루트에서):
 *   node --experimental-transform-types scripts/smoke.mjs
 *
 * 툴 name은 하위 호환 계약 (tools.ts 주석: "이름 변경 불가") — 목록이 바뀌면
 * 의도된 breaking일 때만 이 파일도 함께 갱신한다.
 */
const EXPECTED_TOOLS = [
	"kis_api",
	"kis_list_apis",
	"kis_realtime",
	"kis_overseas_price",
	"kis_overseas_chart",
	"kis_domestic_price",
	"kis_domestic_chart",
	"kis_research",
	"kis_technical",
	"kis_derivatives",
	"broker_price",
	"broker_chart",
	"market_status",
];
const EXPECTED_COMMANDS = ["kis-key", "kis-status", "kis-watch"];

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
	console.error(`[pi-kis smoke] FAIL\n${failures.join("\n")}`);
	process.exit(1);
}
console.log(`[pi-kis smoke] PASS — 툴 ${tools.length}개, 커맨드 ${commands.length}개`);