#!/usr/bin/env node
/**
 * pi 금융분석 웹챗 백엔드 (Phase 3a — 골격)
 *
 * pi --mode rpc 서브프로세스를 띄우고 브라우저 챗 UI와 중계한다.
 *   - 브라우저 → POST /api/cmd (화이트리스트) → pi stdin (JSONL)
 *   - pi stdout (JSONL 이벤트) → SSE /api/stream → 브라우저
 *
 * 제로 런타임 의존성: Node 24 내장(node:http, node:child_process)만 사용.
 * 설계 근거: WEB-APP-DESIGN.md §3(아키텍처)/§4(API 계약), pi docs/rpc.md.
 * 3b 예정: 템플릿 버튼·마크다운·confirm 모달은 extension_ui_request 중계만 두고
 *          렌더링은 클라이언트에서 (3a에서는 콘솔 로그만).
 * 3c 예정: PI_WEB_TOKEN 인증, /files/* 서빙, 재접속 복원(get_state).
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "static");
// 컨테이너 기본값; 호스트 테스트 등에서는 env로 재정의 가능
const SESSION_DIR = process.env.PI_WEB_SESSION_DIR || "/opt/pi-agent/web-sessions";
const RESPAWN_DELAY_MS = 1000;
const CMD_TIMEOUT_MS = 30000;
const SSE_KEEPALIVE_MS = 15000;

// ── 로그 (키/토큰 레드랙트) ─────────────────────────────────────────
function redact(s) {
  return String(s)
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "sk-***")
    .replace(/(token[=:]\s*)([A-Za-z0-9_-]{8,})/gi, "$1***")
    .replace(/((?:api[_-]?key|client[_-]?secret|app[_-]?secret)[=:]\s*)([A-Za-z0-9_-]{8,})/gi, "$1***");
}
function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[pi-web ${ts}]`, ...args.map((a) => (typeof a === "string" ? redact(a) : a)));
}

// ── RPC 자식 프로세스 ────────────────────────────────────────────────
let child = null;
const sseClients = new Set(); // 응답 객체(ServerResponse) 집합 — 브로드캐스트 대상
let nextId = 1;
const pending = new Map(); // id → { resolve, reject, timer } — POST 응답 상관관계

function broadcast(obj) {
  for (const res of sseClients) {
    try {
      res.write(`event: message\ndata: ${JSON.stringify(obj)}\n\n`);
    } catch {
      /* 클라이언트 연결 끊김 — close 이벤트가 정리 */
    }
  }
}

function spawnPi() {
  const args = ["--mode", "rpc", "--session-dir", SESSION_DIR];
  // compose의 키/모델 한 세트 구조 재사용 — PI_DEFAULT_MODEL/THINKING env → 플래그
  if (process.env.PI_DEFAULT_MODEL) args.push("--model", process.env.PI_DEFAULT_MODEL);
  if (process.env.PI_DEFAULT_THINKING) args.push("--thinking", process.env.PI_DEFAULT_THINKING);
  log(`spawn pi ${args.join(" ")}`);

  child = spawn("pi", args, { env: process.env });
  child.stdout.setEncoding("utf8");

  // JSONL 라인 단위 파싱 (stdout)
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        log("unparsable rpc line:", line.slice(0, 200));
        continue;
      }
      // POST /api/cmd 상관관계: id가 일치하는 response면 pending을 해소
      if (evt.type === "response" && evt.id && pending.has(evt.id)) {
        const p = pending.get(evt.id);
        pending.delete(evt.id);
        clearTimeout(p.timer);
        p.resolve(evt);
      }
      // 모든 이벤트를 SSE로 중계 (원본 type 유지 — 클라이언트가 분기)
      broadcast(evt);
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => log("rpc stderr:", d));

  child.on("error", (err) => log("spawn error:", err.message));

  child.on("exit", (code, signal) => {
    log(`rpc exited (code=${code}, signal=${signal}) → ${RESPAWN_DELAY_MS}ms 후 재스폰`);
    // 대기 중이던 명령은 실패 처리 (재스폰 후 세션은 유지 — --session-dir)
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("RPC 프로세스가 재시작되었습니다 — 다시 시도해주세요"));
    }
    pending.clear();
    broadcast({ type: "status", state: "exited" });
    setTimeout(spawnPi, RESPAWN_DELAY_MS);
  });

  broadcast({ type: "status", state: "respawned" });
}

// 화이트리스트 명령을 stdin에 쓰고, 대응 response를 Promise로 반환
function sendRpc(obj) {
  if (!child || !child.stdin.writable) {
    return Promise.reject(new Error("RPC 프로세스가 준비되지 않았습니다"));
  }
  const id = `web-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("RPC 응답 시간 초과"));
    }, CMD_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, ...obj }) + "\n", (err) => {
      if (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  });
}

// ── 화이트리스트 (WEB-APP-DESIGN.md §4) ─────────────────────────────
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const CMD_BUILDERS = {
  prompt: (p) => {
    if (typeof p.message !== "string" || !p.message.trim()) throw new Error("payload.message(문자열)가 필요합니다");
    const out = { type: "prompt", message: p.message, streamingBehavior: "steer" };
    if (Array.isArray(p.images)) out.images = p.images;
    return out;
  },
  steer: (p) => {
    if (typeof p.message !== "string" || !p.message.trim()) throw new Error("payload.message(문자열)가 필요합니다");
    return { type: "steer", message: p.message };
  },
  abort: () => ({ type: "abort" }),
  new_session: () => ({ type: "new_session" }),
  set_model: (p) => {
    if (typeof p.provider !== "string" || typeof p.modelId !== "string") {
      throw new Error("payload.provider, payload.modelId(문자열)가 필요합니다");
    }
    return { type: "set_model", provider: p.provider, modelId: p.modelId };
  },
  set_thinking: (p) => {
    if (!THINKING_LEVELS.has(p.level)) throw new Error(`payload.level은 ${[...THINKING_LEVELS].join("/")} 중 하나여야 합니다`);
    return { type: "set_thinking_level", level: p.level };
  },
  list_models: () => ({ type: "get_available_models" }),
  list_thinking: () => ({ type: "get_available_thinking_levels" }),
  get_state: () => ({ type: "get_state" }),
  ui_response: (p) => {
    if (typeof p.id !== "string") throw new Error("payload.id(문자열)가 필요합니다");
    const out = { type: "extension_ui_response", id: p.id };
    if (p.cancelled) out.cancelled = true;
    else if (p.confirmed !== undefined) out.confirmed = Boolean(p.confirmed);
    else if (p.value !== undefined) out.value = p.value;
    else throw new Error("payload에 value/confirmed/cancelled 중 하나가 필요합니다");
    return out;
  },
};

// ── HTTP 헬퍼 ────────────────────────────────────────────────────────
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/static\//, "");
  const filePath = normalize(join(STATIC_DIR, rel));
  // 경로 탈출 차단 — STATIC_DIR 밖 접근 금지
  if (filePath !== STATIC_DIR && !filePath.startsWith(STATIC_DIR + sep)) {
    json(res, 403, { error: "forbidden" });
    return;
  }
  try {
    const st = await stat(filePath);
    if (!st.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(filePath).pipe(res);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

function handleSse(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  sseClients.add(res);
  const keepalive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      /* 연결 끊김 */
    }
  }, SSE_KEEPALIVE_MS);
  req.on("close", () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
}

async function handleCmd(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk;
  let parsed;
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    json(res, 400, { error: "JSON 본문이 필요합니다" });
    return;
  }
  const { cmd, payload } = parsed;
  const builder = CMD_BUILDERS[cmd];
  if (!builder) {
    json(res, 400, { error: `지원하지 않는 cmd: ${String(cmd)} (화이트리스트: ${Object.keys(CMD_BUILDERS).join(", ")})` });
    return;
  }
  let rpcObj;
  try {
    rpcObj = builder(payload || {});
  } catch (err) {
    json(res, 400, { error: err.message });
    return;
  }
  try {
    const resp = await sendRpc(rpcObj);
    json(res, 200, resp);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
}

// ── 서버 ─────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    json(res, 400, { error: "bad request" });
    return;
  }
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/static/"))) {
      return await serveStatic(req, res, url.pathname);
    }
    if (req.method === "GET" && url.pathname === "/api/stream") {
      return handleSse(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/cmd") {
      return await handleCmd(req, res);
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    log("request error:", err.message);
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  }
});

// 정리 — 컨테이너 종료 시 자식도 함께
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (child) child.kill("SIGTERM");
    process.exit(0);
  });
}

spawnPi();
server.listen(PORT, "0.0.0.0", () => log(`listening on http://0.0.0.0:${PORT} (session dir: ${SESSION_DIR})`));
