#!/usr/bin/env node
/**
 * CI/로컬 스모크 테스트 — pi-binance 확장이 계약된 툴/커맨드를 등록하는지 검증.
 * HMAC 공식 예제 + 심볼 정규화도 함께 확인 (네트워크 없음).
 *
 * 실행 (패키지 루트에서):
 *   node --experimental-transform-types scripts/smoke.mjs
 */
const EXPECTED_TOOLS = [
	"binance_price",
	"binance_chart",
	"binance_account",
	"binance_order",
	"binance_orders",
	"binance_futures",
];
const EXPECTED_COMMANDS = ["binance-key", "binance-status"];

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

const { signQuery } = await import("../src/client.ts");
const officialQuery =
	"symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
const officialSecret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
const officialSig = "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71";
const gotSig = signQuery(officialQuery, officialSecret);
if (gotSig !== officialSig) {
	failures.push(`HMAC 공식 예제 불일치\n  expected: ${officialSig}\n  actual  : ${gotSig}`);
}

const { normalizeSymbol } = await import("../src/roles/binance.ts");
const cases = [
	["btc/usdt", "BTCUSDT"],
	["BTC-USDT", "BTCUSDT"],
	[" eth usdt ", "ETHUSDT"],
	["BTCUSDT", "BTCUSDT"],
];
for (const [input, want] of cases) {
	const got = normalizeSymbol(input);
	if (got !== want) failures.push(`normalizeSymbol(${JSON.stringify(input)}) → ${got}, expected ${want}`);
}

if (failures.length > 0) {
	console.error(`[pi-binance smoke] FAIL\n${failures.join("\n")}`);
	process.exit(1);
}
console.log(`[pi-binance smoke] PASS — 툴 ${tools.length}개, 커맨드 ${commands.length}개, HMAC/심볼 OK`);
