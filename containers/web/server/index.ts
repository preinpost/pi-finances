import "./env.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  ClientCommand,
  ServerEvent,
  UIAuthCatalog,
  UIAuthEvent,
  UIAuthProvider,
  UIAuthSession,
  UIAuthType,
  UICustomModelsResponse,
  UICustomProvider,
  UIExtensionInfo,
  UIModel,
  UISessionInfo,
  UISnapshot,
  UIThinkingLevel,
} from "../shared/protocol.ts";
import {
  applyAuthSecret,
  clearSessionCookieHeader,
  clientIp,
  consumeLoginAttempt,
  createSession,
  destroySession,
  isSecureRequest,
  loadAuthConfig,
  parseCookie,
  resetLoginAttempts,
  SESSION_COOKIE,
  sessionCookieHeader,
  sessionFromRequest,
  verifyCredentials,
} from "./auth.ts";
import { envFilePath, upsertDotEnv } from "./env.ts";
import { providerStatusBlock, responseRulesBlock } from "./providerStatus.ts";
import { readCustomModels, validateProviders, writeCustomModels } from "./models-config.ts";
import { serializeMessages } from "./serialize.ts";
import { SECRET_FIELDS, SECRET_KEY_SET, type UISecretsResponse } from "../shared/secrets.ts";

const PORT = Number(process.env.PORT ?? 3141);
// Default to loopback. Password gate is on by default (PI_WEB_AUTH=0 to disable).
// Override with HOST=0.0.0.0 only behind TLS or on a trusted network.
const HOST = process.env.HOST ?? "127.0.0.1";
const AUTH = loadAuthConfig();
applyAuthSecret(AUTH);
const HOME = homedir();
// 개인 채팅 워크스페이스 (프로젝트 cwd와 분리). PI_WEB_CWD로 오버라이드 가능
const DEFAULT_AGENT_CWD = join(HOME, ".pi", "web-chat");
const AGENT_CWD = resolve(process.env.PI_WEB_CWD ?? DEFAULT_AGENT_CWD);
mkdirSync(AGENT_CWD, { recursive: true });

// Resolve static assets for both layouts:
//   production package: <pkg>/dist/index.js  + <pkg>/dist/public/
//   dev (tsx server/):  <pkg>/server/index.ts + <pkg>/dist/  (vite default) or dist/public
const HERE = dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  for (const candidate of [join(HERE, "..", "package.json"), join(HERE, "package.json")]) {
    try {
      if (!existsSync(candidate)) continue;
      const v = (JSON.parse(readFileSync(candidate, "utf8")) as { version?: string }).version;
      if (v) return v;
    } catch {
      /* ignore */
    }
  }
  return "unknown";
}

/** 컨테이너 VERSION 우선 — 설정 메뉴에 표시. 로컬 웹은 containers/VERSION. */
function readAppVersion(): string {
  const fromEnv = process.env.PI_FINANCE_VERSION?.trim();
  if (fromEnv) return fromEnv;
  for (const candidate of [
    "/tmp/pi-finance.VERSION",
    join(HERE, "..", "..", "VERSION"),
    join(process.cwd(), "VERSION"),
    join(process.cwd(), "..", "VERSION"),
  ]) {
    try {
      if (!existsSync(candidate)) continue;
      const v = readFileSync(candidate, "utf8").trim();
      if (v) return v;
    } catch {
      /* ignore */
    }
  }
  return readPackageVersion();
}
const PACKAGE_VERSION = readPackageVersion();
const APP_VERSION = readAppVersion();
const DIST_DIR = (() => {
  const candidates = [
    join(HERE, "public"), // dist/index.js → dist/public
    join(HERE, "dist", "public"), // monorepo-style
    join(HERE, "..", "dist", "public"), // server/index.ts → dist/public
    join(HERE, "..", "dist"), // server/index.ts → dist (legacy vite outDir)
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return candidates[0]!;
})();

// ---------------------------------------------------------------------------
// 컨테이너 기본 모델/thinking — env 주입 (docker-entrypoint.sh / compose.yaml)
// ---------------------------------------------------------------------------
const ALL_THINKING_LEVELS: UIThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// PI_DEFAULT_MODEL="provider/id", PI_DEFAULT_THINKING="off|minimal|...|max".
// TUI/헤드리스 모드는 --model/--thinking 플래그로 전달받지만 웹 서버는 세션을
// 직접 만들기 때문에 여기서 env를 읽는다. 새 세션(메시지 없음)에만 적용하고,
// 재개/포크 등 메시지가 이미 있는 세션은 저장된 모델·thinking 복원이 우선
// (SDK 기본 동작과 동일).
// ⚠️ 업스트림(pi-web-chat)에는 없는 로컬 적응 — UPSTREAM.md 참고.
const ENV_DEFAULT_MODEL = process.env.PI_DEFAULT_MODEL?.trim() || undefined;
const ENV_DEFAULT_THINKING = ALL_THINKING_LEVELS.includes(
  process.env.PI_DEFAULT_THINKING?.trim() as UIThinkingLevel,
)
  ? (process.env.PI_DEFAULT_THINKING!.trim() as UIThinkingLevel)
  : undefined;

// PI_DISABLE_MODEL_SELECTION="true|1" — 모델/thinking 선택 UI를 숨긴다.
// 서버 env로만 제어하므로 사용자가 웹 UI에서 해제할 수 없다.
const ENV_DISABLE_MODEL_SELECTION =
  process.env.PI_DISABLE_MODEL_SELECTION?.trim().toLowerCase() === "true" ||
  process.env.PI_DISABLE_MODEL_SELECTION?.trim() === "1";

// ---------------------------------------------------------------------------
// pi 세션 런타임
// ---------------------------------------------------------------------------

let modelRuntime = await ModelRuntime.create();

// env 기본 모델을 시작 시 미리 해석해 둔다 — 부트스트랩 스냅샷(세션 생성 전
// 헤더 표시용)에서 즉시 사용. 세션 런타임과 무관하게 카탈로그 기준으로 매칭된다.
const ENV_DEFAULT_RESOLVED = ENV_DEFAULT_MODEL
  ? resolveCliModel({
      cliModel: ENV_DEFAULT_MODEL,
      cliThinking: ENV_DEFAULT_THINKING,
      modelRuntime,
    })
  : undefined;
if (ENV_DEFAULT_MODEL) {
  if (ENV_DEFAULT_RESOLVED?.warning) console.warn(`[pi-web-chat] ${ENV_DEFAULT_RESOLVED.warning}`);
  if (!ENV_DEFAULT_RESOLVED?.model) {
    console.warn(
      `[pi-web-chat] PI_DEFAULT_MODEL="${ENV_DEFAULT_MODEL}" not found — falling back to default model resolution`,
    );
  }
}

const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({
    cwd,
    // 데이터 제공자 키 상태를 세션 시스템 프롬프트에 동적 주입 (미설정 브로커
    // 순차 시도 방지 — .env 저장 등 런타임 변경이 다음 세션부터 반영됨)
    resourceLoaderOptions: {
      appendSystemPrompt: [providerStatusBlock(process.env), responseRulesBlock()],
    },
  });
  // env 기본 모델/thinking — 빈 세션(새 초안)에만 적용.
  // 기존 세션은 SDK가 저장된 모델·thinking을 복원한다.
  let model: ReturnType<typeof resolveCliModel>["model"];
  let thinkingLevel: UIThinkingLevel | undefined;
  if (sessionManager.buildSessionContext().messages.length === 0) {
    if (ENV_DEFAULT_MODEL) {
      const resolved = resolveCliModel({
        cliModel: ENV_DEFAULT_MODEL,
        cliThinking: ENV_DEFAULT_THINKING,
        modelRuntime: services.modelRuntime,
      });
      model = resolved.model;
      thinkingLevel = resolved.thinkingLevel ?? ENV_DEFAULT_THINKING;
      if (resolved.warning) console.warn(`[pi-web-chat] ${resolved.warning}`);
      if (!model) {
        console.warn(
          `[pi-web-chat] PI_DEFAULT_MODEL="${ENV_DEFAULT_MODEL}" not found — falling back to default model resolution`,
        );
      }
    } else {
      thinkingLevel = ENV_DEFAULT_THINKING;
    }
  }
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model,
      thinkingLevel,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

// ---------------------------------------------------------------------------
// 세션 허브: 세션별로 독립된 런타임을 들고, 같은 세션을 보는 클라이언트끼리만
// 브로드캐스트한다. URL /s/:sessionId 와 1:1 대응.
// ---------------------------------------------------------------------------

interface SessionEntry {
  id: string;
  runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>>;
  clients: Set<WebSocket>;
  unsubscribe?: () => void;
  lastActive: number;
  /**
   * URL(/s/:id)에 공개했는지.
   * `/` 접속으로 만든 빈 초안은 첫 prompt 전까지 false — 주소에 sessionId를 붙이지 않는다.
   */
  published: boolean;
}

const entries = new Map<string, SessionEntry>();
const pending = new Map<string, Promise<SessionEntry>>();
const wsEntry = new Map<WebSocket, SessionEntry>();
/** 비어 있는 세션 런타임을 정리하기 전 유예 시간 */
const IDLE_TTL_MS = 15 * 60_000;

/** 세션 파일명(<timestamp>_<uuid>.jsonl) → URL 식별자 */
function sessionIdOf(file?: string): string {
  if (!file) return "";
  const base = basename(file).replace(/\.jsonl$/, "");
  const i = base.lastIndexOf("_");
  return i >= 0 ? base.slice(i + 1) : base;
}

async function resolveSessionPath(id: string): Promise<string | undefined> {
  const sessions = await SessionManager.list(AGENT_CWD);
  return sessions.find((s) => sessionIdOf(s.path) === id)?.path;
}

function broadcastTo(entry: SessionEntry, event: ServerEvent) {
  const data = JSON.stringify(event);
  for (const ws of entry.clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

/** 세션을 URL에 공개 (idempotent). 첫 메시지·기존 세션 접속·포크 시 호출 */
function publishEntry(entry: SessionEntry, ws?: WebSocket) {
  entry.published = true;
  const event: ServerEvent = { type: "session_bound", sessionId: entry.id };
  if (ws) sendTo(ws, event);
  else broadcastTo(entry, event);
}

/** 세션이 교체되면(포크 등) 키를 다시 맞추고 클라이언트에 알린다 */
function rekeyEntry(entry: SessionEntry) {
  const next = sessionIdOf(entry.runtime.session.sessionFile);
  if (!next || next === entry.id) return;
  entries.delete(entry.id);
  entry.id = next;
  entries.set(next, entry);
  entry.published = true;
  broadcastTo(entry, { type: "session_bound", sessionId: next });
}

async function createEntry(id: string | null): Promise<SessionEntry> {
  const path = id ? await resolveSessionPath(id) : undefined;
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: AGENT_CWD,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.create(AGENT_CWD),
  });
  if (path) await runtime.switchSession(path);
  const entry: SessionEntry = {
    id: sessionIdOf(runtime.session.sessionFile),
    runtime,
    clients: new Set(),
    lastActive: Date.now(),
    // 명시적 세션 id로 연 경우만 즉시 공개. null 접속은 빈 초안.
    published: id !== null,
  };
  entries.set(entry.id, entry);
  bindSession(entry);
  return entry;
}

/** id가 없으면 새 세션, 있으면 기존 런타임 재사용 (동시 접속 경합 방지) */
async function acquireEntry(id: string | null): Promise<SessionEntry> {
  if (!id) return createEntry(null);
  const hit = entries.get(id);
  if (hit) return hit;
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const p = createEntry(id).finally(() => pending.delete(id));
  pending.set(id, p);
  return p;
}

/** 비어 있고 오래된 런타임 정리 */
setInterval(() => {
  const now = Date.now();
  for (const entry of [...entries.values()]) {
    if (entry.clients.size > 0 || entry.runtime.session.isStreaming) continue;
    if (now - entry.lastActive < IDLE_TTL_MS) continue;
    entries.delete(entry.id);
    entry.unsubscribe?.();
    void entry.runtime.dispose().catch(() => {});
  }
}, 60_000).unref();

function supportedThinkingLevels(model: unknown): UIThinkingLevel[] {
  const m = model as
    | { reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> }
    | null
    | undefined;
  if (!m?.reasoning) return ["off"];
  const map = m.thinkingLevelMap;
  return ALL_THINKING_LEVELS.filter((level) => {
    if (map && map[level] === null) return false;
    // xhigh/max는 명시적으로 매핑된 모델 패밀리만 지원
    if ((level === "xhigh" || level === "max") && map?.[level] == null) return false;
    return true;
  });
}

/**
 * 세션 생성(수 초 소요)이 끝나기 전에 헤더(모델/thinking)를 바로 채우는
 * 부트스트랩 스냅샷. env 기본 모델/thinking은 세션 생성과 무관하게 확정적이므로
 * 새 초안(세션 미지정) 접속 직후에 보낼 수 있다. 실제 스냅샷이 도착하면 교체된다.
 * 기존 세션(?session=)은 저장된 모델·thinking 복원이 우선이라 대상이 아니다.
 */
function bootstrapSnapshot(): UISnapshot | undefined {
  if (!ENV_DEFAULT_MODEL && !ENV_DEFAULT_THINKING && !ENV_DISABLE_MODEL_SELECTION) {
    return undefined;
  }
  const resolved = ENV_DEFAULT_RESOLVED;
  const model: UIModel | null = resolved?.model
    ? {
        provider: resolved.model.provider,
        id: resolved.model.id,
        name: (resolved.model as { name?: string }).name,
        reasoning: (resolved.model as { reasoning?: boolean }).reasoning,
      }
    : null;
  return {
    messages: [],
    isStreaming: false,
    model,
    thinkingLevel: resolved?.thinkingLevel ?? ENV_DEFAULT_THINKING ?? "medium",
    thinkingLevels: resolved?.model ? supportedThinkingLevels(resolved.model) : ALL_THINKING_LEVELS,
    modelSelectionDisabled: ENV_DISABLE_MODEL_SELECTION,
  };
}

function buildSnapshot(entry: SessionEntry): UISnapshot {
  const session = entry.runtime.session;
  const model = session.model;
  return {
    messages: serializeMessages(session.messages),
    isStreaming: session.isStreaming,
    model: model
      ? {
          provider: model.provider,
          id: model.id,
          name: (model as { name?: string }).name,
          reasoning: (model as { reasoning?: boolean }).reasoning,
        }
      : null,
    thinkingLevel: session.thinkingLevel as UIThinkingLevel,
    thinkingLevels: supportedThinkingLevels(model),
    modelSelectionDisabled: ENV_DISABLE_MODEL_SELECTION,
    sessionFile: session.sessionFile,
    sessionId: entry.id,
  };
}

function broadcastSnapshot(entry: SessionEntry) {
  broadcastTo(entry, { type: "snapshot", snapshot: buildSnapshot(entry) });
}

/** 세션 이벤트 구독 (세션 교체 시 재구독 필요) */
function bindSession(entry: SessionEntry) {
  entry.unsubscribe?.();
  entry.unsubscribe = entry.runtime.session.subscribe((event) => {
    entry.lastActive = Date.now();
    const broadcast = (e: ServerEvent) => broadcastTo(entry, e);
    switch (event.type) {
      case "message_update": {
        const e = event.assistantMessageEvent;
        if (e.type === "text_delta") {
          broadcast({ type: "delta", kind: "text", delta: e.delta });
        } else if (e.type === "thinking_delta") {
          broadcast({ type: "delta", kind: "thinking", delta: e.delta });
        }
        break;
      }
      case "message_end":
        broadcastSnapshot(entry);
        break;
      case "tool_execution_start":
        broadcast({ type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName });
        break;
      case "tool_execution_end":
        broadcast({
          type: "tool_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
        });
        broadcastSnapshot(entry);
        break;
      case "agent_start":
        broadcast({ type: "agent_start" });
        break;
      case "agent_end": {
        broadcast({ type: "agent_end" });
        // agent_end 직후 session.isStreaming 이 아직 true일 수 있어 명시적으로 false
        const snap = buildSnapshot(entry);
        snap.isStreaming = false;
        broadcast({ type: "snapshot", snapshot: snap });
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 클라이언트 커맨드 처리
// ---------------------------------------------------------------------------

async function handleCommand(cmd: ClientCommand, ws: WebSocket) {
  const entry = wsEntry.get(ws);
  if (!entry) return;
  entry.lastActive = Date.now();
  const runtime = entry.runtime;
  const session = runtime.session;
  switch (cmd.type) {
    case "prompt": {
      const text = cmd.text.trim();
      const images = (cmd.images ?? []).map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));
      if (!text && images.length === 0) return;
      // 첫 입력 시점에 세션을 URL에 공개 → 클라이언트가 /s/:id 로 교체
      if (!entry.published) publishEntry(entry, ws);
      // prompt()는 전체 런이 끝날 때까지 resolve되지 않으므로 await하지 않는다
      session
        .prompt(text, {
          images: images.length > 0 ? images : undefined,
          ...(session.isStreaming ? { streamingBehavior: "steer" as const } : {}),
        })
        .catch((err) => {
          sendTo(ws, { type: "error", message: String(err instanceof Error ? err.message : err) });
        });
      break;
    }
    case "abort":
      await session.abort();
      broadcastSnapshot(entry);
      break;
    case "set_model": {
      const model = modelRuntime.getModel(cmd.provider, cmd.id);
      if (!model) {
        sendTo(ws, { type: "error", message: `Model not found: ${cmd.provider}/${cmd.id}` });
        return;
      }
      await runtime.session.setModel(model);
      broadcastSnapshot(entry);
      break;
    }
    case "set_thinking_level":
      session.setThinkingLevel(cmd.level);
      broadcastSnapshot(entry);
      break;
    case "fork": {
      const result = await runtime.fork(cmd.entryId);
      if (result.cancelled) return;
      bindSession(entry);
      rekeyEntry(entry);
      broadcastSnapshot(entry);
      sendTo(ws, { type: "forked", selectedText: result.selectedText });
      break;
    }
  }
}

function sendTo(ws: WebSocket, event: ServerEvent) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

// ---------------------------------------------------------------------------
// 커스텀 모델 (models.json) 반영
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * 저장된 providers 를 실행 중인 런타임에 반영한다.
 * - 목록용 modelRuntime 은 재생성 (models.json 을 다시 읽음)
 * - 대화 중인 세션 런타임에는 registerProvider 로 라이브 등록
 * 실패하면 재시작이 필요하다는 경고 문자열을 돌려준다.
 */
async function reloadModelProviders(providers: UICustomProvider[]): Promise<string | undefined> {
  const previousKeys = new Set(knownCustomProviderKeys);
  knownCustomProviderKeys = new Set(providers.map((p) => p.key));

  try {
    modelRuntime = await ModelRuntime.create();
  } catch (err) {
    return `models.json saved, but reloading failed: ${String(err)}`;
  }

  try {
    for (const entry of entries.values()) {
      const sessionModels = entry.runtime.services.modelRuntime;
      for (const key of previousKeys) {
        if (!knownCustomProviderKeys.has(key)) sessionModels.unregisterProvider(key);
      }
      for (const p of providers) {
        sessionModels.registerProvider(p.key, {
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          api: p.api,
          models: p.models.map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            reasoning: m.reasoning ?? false,
            input: m.input && m.input.length > 0 ? m.input : ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: m.contextWindow ?? 128_000,
            maxTokens: m.maxTokens ?? 8_192,
          })),
        });
      }
    }
  } catch (err) {
    return `models.json saved, but live reload failed (restart pi --web to apply): ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
  return undefined;
}

let knownCustomProviderKeys = new Set(readCustomModels().providers.map((p) => p.key));

interface LoginWaiter {
  session: UIAuthSession;
  prompt?: (value: string) => void;
  reject?: (err: Error) => void;
  abort: AbortController;
}

const loginWaiters = new Map<string, LoginWaiter>();

function newLoginId(): string {
  return randomId();
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function buildAuthCatalog(): Promise<UIAuthCatalog> {
  const providers: UIAuthProvider[] = [];
  for (const p of modelRuntime.getProviders()) {
    const methods: UIAuthType[] = [];
    if (p.auth.apiKey?.login) methods.push("api_key");
    if (p.auth.oauth) methods.push("oauth");
    if (methods.length === 0) continue;
    const status = await modelRuntime.checkAuth(p.id).catch(() => undefined);
    providers.push({
      id: p.id,
      name: p.name,
      methods,
      status: status ? { type: status.type, source: status.source } : undefined,
      loggedIn: Boolean(status),
    });
  }
  providers.sort((a, b) => Number(b.loggedIn) - Number(a.loggedIn) || a.name.localeCompare(b.name));
  return { providers };
}

function startProviderLogin(providerId: string, method: UIAuthType): UIAuthSession {
  const provider = modelRuntime.getProvider(providerId);
  if (!provider) throw new Error(`unknown provider: ${providerId}`);
  if (method === "oauth" && !provider.auth.oauth) throw new Error("oauth not supported");
  if (method === "api_key" && !provider.auth.apiKey?.login) throw new Error("api key login not supported");
  const id = newLoginId();
  const abort = new AbortController();
  const session: UIAuthSession = {
    id,
    providerId,
    providerName: provider.name,
    method,
    events: [],
  };
  const waiter: LoginWaiter = { session, abort };
  loginWaiters.set(id, waiter);
  void modelRuntime
    .login(providerId, method, {
      signal: abort.signal,
      prompt: (prompt) =>
        new Promise<string>((resolve, reject) => {
          if (abort.signal.aborted) {
            reject(new Error("Login cancelled"));
            return;
          }
          waiter.prompt = resolve;
          waiter.reject = reject;
          waiter.session = {
            ...waiter.session,
            prompt: {
              type: prompt.type,
              message: prompt.message,
              placeholder: "placeholder" in prompt ? prompt.placeholder : undefined,
              options: prompt.type === "select" ? [...prompt.options] : undefined,
            },
          };
        }),
      notify: (event) => {
        const mapped: UIAuthEvent =
          event.type === "auth_url"
            ? { type: "auth_url", url: event.url, instructions: event.instructions }
            : event.type === "device_code"
              ? {
                  type: "device_code",
                  userCode: event.userCode,
                  verificationUri: event.verificationUri,
                }
              : event.type === "info"
                ? {
                    type: "info",
                    message: event.message,
                    links: event.links ? [...event.links] : undefined,
                  }
                : { type: "progress", message: event.message };
        waiter.session = { ...waiter.session, events: [...waiter.session.events, mapped] };
      },
    })
    .then(async () => {
      waiter.session = { ...waiter.session, done: true, prompt: undefined };
      try {
        await modelRuntime.getAvailable();
      } catch {
        /* catalog refresh is best-effort */
      }
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      waiter.session = {
        ...waiter.session,
        done: true,
        prompt: undefined,
        error: message === "Login cancelled" ? undefined : message,
      };
    });
  return session;
}

function secretsSnapshot(): UISecretsResponse {
  return {
    persistable: Boolean(envFilePath()),
    fields: SECRET_FIELDS.map((f) => ({
      key: f.key,
      configured: Boolean(process.env[f.key]?.trim()),
      source: process.env[f.key]?.trim() ? "env" : "none",
    })),
  };
}

// ---------------------------------------------------------------------------
// HTTP 서버 (API + 정적 파일)
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function writeJson(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  try {
    // Lightweight readiness probe (used by `pi --web` before opening the browser).
    if (url.pathname === "/api/health") {
      writeJson(res, 200, { ok: true, version: PACKAGE_VERSION, appVersion: APP_VERSION });
      return;
    }

    if (url.pathname === "/api/auth/status") {
      const session = sessionFromRequest(req);
      writeJson(res, 200, {
        enabled: AUTH.enabled,
        authenticated: AUTH.enabled ? Boolean(session) : true,
        user: AUTH.enabled ? session?.user : undefined,
        appVersion: APP_VERSION,
      });
      return;
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      if (!AUTH.enabled) {
        writeJson(res, 200, { ok: true, enabled: false });
        return;
      }
      const ip = clientIp(req);
      if (!consumeLoginAttempt(ip)) {
        writeJson(res, 429, { error: "too many attempts" });
        return;
      }
      let body: { user?: unknown; password?: unknown };
      try {
        body = JSON.parse(await readBody(req, 8_192)) as { user?: unknown; password?: unknown };
      } catch {
        writeJson(res, 400, { error: "invalid JSON" });
        return;
      }
      const user = typeof body.user === "string" ? body.user : "";
      const pass = typeof body.password === "string" ? body.password : "";
      if (!verifyCredentials(user, pass, AUTH.user)) {
        writeJson(res, 401, { error: "invalid credentials" });
        return;
      }
      resetLoginAttempts(ip);
      const token = createSession(AUTH.user);
      writeJson(res, 200, { ok: true, user: AUTH.user }, {
        "set-cookie": sessionCookieHeader(token, isSecureRequest(req)),
      });
      return;
    }

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      destroySession(parseCookie(req, SESSION_COOKIE));
      writeJson(res, 200, { ok: true }, {
        "set-cookie": clearSessionCookieHeader(isSecureRequest(req)),
      });
      return;
    }

    if (AUTH.enabled && url.pathname.startsWith("/api/") && !sessionFromRequest(req)) {
      writeJson(res, 401, { error: "unauthorized" });
      return;
    }

    if (url.pathname === "/api/sessions") {
      const sessions = await SessionManager.list(AGENT_CWD);
      const list: UISessionInfo[] = sessions
        .sort((a, b) => b.modified.getTime() - a.modified.getTime())
        .slice(0, 100)
        .map((s) => ({
          id: sessionIdOf(s.path),
          path: s.path,
          name: s.name,
          firstMessage: s.firstMessage.slice(0, 200),
          modified: s.modified.toISOString(),
          messageCount: s.messageCount,
        }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(list));
      return;
    }

    // 세션 삭제 — 실행 중인 런타임(entry)이 있으면 먼저 정리하고 파일을 지운다
    if (url.pathname.startsWith("/api/sessions/") && req.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length));
      const entry = entries.get(id);
      if (entry) {
        entries.delete(id);
        entry.unsubscribe?.();
        // 바인딩된 클라이언트에 삭제 통보 → 새 초안으로 재연결하게 한다
        for (const ws of [...entry.clients]) {
          wsEntry.delete(ws);
          if (ws.readyState === ws.OPEN) {
            const event: ServerEvent = { type: "session_deleted" };
            ws.send(JSON.stringify(event));
          }
        }
        await entry.runtime.dispose().catch(() => {});
      }
      const sessions = await SessionManager.list(AGENT_CWD);
      const found = sessions.find((s) => sessionIdOf(s.path) === id);
      if (!found) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "session not found" }));
        return;
      }
      await rm(found.path, { force: true });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/models") {
      const models = await modelRuntime.getAvailable();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          models.map((m) => ({
            provider: m.provider,
            id: m.id,
            name: (m as { name?: string }).name,
            reasoning: (m as { reasoning?: boolean }).reasoning,
          })),
        ),
      );
      return;
    }

    if (url.pathname === "/api/providers" && req.method === "GET") {
      writeJson(res, 200, await buildAuthCatalog());
      return;
    }

    if (url.pathname === "/api/providers/login" && req.method === "POST") {
      let body: { providerId?: unknown; method?: unknown };
      try {
        body = JSON.parse(await readBody(req, 8_192)) as { providerId?: unknown; method?: unknown };
      } catch {
        writeJson(res, 400, { error: "invalid JSON" });
        return;
      }
      const providerId = typeof body.providerId === "string" ? body.providerId : "";
      const method = body.method === "oauth" || body.method === "api_key" ? body.method : "";
      if (!providerId || !method) {
        writeJson(res, 400, { error: "providerId and method required" });
        return;
      }
      try {
        writeJson(res, 200, startProviderLogin(providerId, method));
      } catch (err) {
        writeJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (url.pathname.startsWith("/api/providers/login/") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.slice("/api/providers/login/".length));
      const waiter = loginWaiters.get(id);
      if (!waiter) {
        writeJson(res, 404, { error: "login session not found" });
        return;
      }
      writeJson(res, 200, waiter.session);
      if (waiter.session.done) loginWaiters.delete(id);
      return;
    }

    if (url.pathname.startsWith("/api/providers/login/") && url.pathname.endsWith("/answer") && req.method === "POST") {
      const id = decodeURIComponent(url.pathname.slice("/api/providers/login/".length, -"/answer".length));
      const waiter = loginWaiters.get(id);
      if (!waiter) {
        writeJson(res, 404, { error: "login session not found" });
        return;
      }
      let body: { value?: unknown };
      try {
        body = JSON.parse(await readBody(req, 16_000)) as { value?: unknown };
      } catch {
        writeJson(res, 400, { error: "invalid JSON" });
        return;
      }
      const value = typeof body.value === "string" ? body.value : "";
      if (!waiter.prompt) {
        writeJson(res, 409, { error: "no pending prompt" });
        return;
      }
      const resolve = waiter.prompt;
      waiter.prompt = undefined;
      waiter.reject = undefined;
      waiter.session = { ...waiter.session, prompt: undefined };
      resolve(value);
      writeJson(res, 200, waiter.session);
      return;
    }

    if (url.pathname.startsWith("/api/providers/login/") && url.pathname.endsWith("/cancel") && req.method === "POST") {
      const id = decodeURIComponent(url.pathname.slice("/api/providers/login/".length, -"/cancel".length));
      const waiter = loginWaiters.get(id);
      if (waiter) {
        waiter.abort.abort();
        waiter.reject?.(new Error("Login cancelled"));
        loginWaiters.delete(id);
      }
      writeJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/logout") && req.method === "POST") {
      const providerId = decodeURIComponent(
        url.pathname.slice("/api/providers/".length, -"/logout".length),
      );
      try {
        await modelRuntime.logout(providerId);
        writeJson(res, 200, { ok: true });
      } catch (err) {
        writeJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (url.pathname === "/api/secrets") {
      if (req.method === "GET") {
        writeJson(res, 200, secretsSnapshot());
        return;
      }
      if (req.method === "PUT") {
        let body: { values?: Record<string, unknown> };
        try {
          body = JSON.parse(await readBody(req, 32_000)) as { values?: Record<string, unknown> };
        } catch {
          writeJson(res, 400, { error: "invalid JSON" });
          return;
        }
        const values = body.values ?? {};
        const updates: Record<string, string> = {};
        for (const [key, raw] of Object.entries(values)) {
          if (!SECRET_KEY_SET.has(key)) {
            writeJson(res, 400, { error: `unknown key: ${key}` });
            return;
          }
          if (typeof raw !== "string") {
            writeJson(res, 400, { error: `invalid value for ${key}` });
            return;
          }
          updates[key] = raw.trim();
        }
        for (const [key, value] of Object.entries(updates)) {
          if (value) process.env[key] = value;
          else delete process.env[key];
        }
        const persisted = upsertDotEnv(updates);
        let warning: string | undefined;
        try {
          modelRuntime = await ModelRuntime.create();
        } catch (err) {
          warning = `keys saved, but model reload failed: ${String(err)}`;
        }
        writeJson(res, 200, {
          ...secretsSnapshot(),
          warning: persisted ? warning : (warning ?? "keys applied in this process only (no .env file)"),
        });
        return;
      }
      writeJson(res, 405, { error: "method not allowed" });
      return;
    }

    // 커스텀 모델 관리 (~/.pi/agent/models.json)
    if (url.pathname === "/api/custom-models") {
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(readCustomModels()));
        return;
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        let providers: UICustomProvider[];
        try {
          providers = (JSON.parse(body) as { providers: UICustomProvider[] }).providers;
        } catch (err) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `invalid JSON: ${String(err)}` }));
          return;
        }
        const invalid = validateProviders(providers);
        if (invalid) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: invalid }));
          return;
        }
        writeCustomModels(providers);
        const warning = await reloadModelProviders(providers);
        const result: UICustomModelsResponse = { ...readCustomModels(), warning };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    if (url.pathname === "/api/fork-points") {
      const entry = entries.get(url.searchParams.get("session") ?? "");
      if (!entry) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("[]");
        return;
      }
      const points = entry.runtime.session.getUserMessagesForForking();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(points.map((p) => ({ entryId: p.entryId, text: p.text.slice(0, 200) }))),
      );
      return;
    }

    if (url.pathname === "/api/extensions") {
      const anyEntry = entries.values().next().value as SessionEntry | undefined;
      if (!anyEntry) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ extensions: [], errors: [] }));
        return;
      }
      const { extensions, errors } = anyEntry.runtime.session.resourceLoader.getExtensions();
      const shorten = (p: string) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
      const list: UIExtensionInfo[] = extensions.map((ext) => {
        const { sourceInfo } = ext;
        let name: string;
        let packageName: string | undefined;
        if (sourceInfo.origin === "package") {
          packageName = sourceInfo.source.replace(/^npm:/, "");
          // 패키지 루트 기준 상대경로에서 표시명 유도 (extensions/foo/index.ts -> foo)
          const rel = relative(sourceInfo.baseDir ?? dirname(ext.path), ext.path)
            .replace(/\.(ts|js|mjs|cjs)$/, "")
            .replace(/\/index$/, "")
            .replace(/^index$/, "")
            .replace(/^(src\/)?(extensions\/)?/, "");
          name = rel && rel !== "src" ? rel : packageName;
        } else {
          name = basename(ext.path).replace(/\.(ts|js|mjs|cjs)$/, "");
        }
        return {
          name,
          packageName,
          path: shorten(ext.path),
          scope: sourceInfo.scope,
          tools: [...ext.tools.keys()],
          commands: [...ext.commands.keys()],
          flags: [...ext.flags.keys()],
          events: [...ext.handlers.keys()],
        };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          extensions: list,
          errors: errors.map((e) => ({ path: shorten(e.path), error: e.error })),
        }),
      );
      return;
    }

    if (url.pathname === "/api/state") {
      const requested = url.searchParams.get("session");
      const entry = requested ? entries.get(requested) : undefined;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          entry
            ? buildSnapshot(entry)
            : {
                activeSessions: [...entries.values()].map((e) => ({
                  id: e.id,
                  clients: e.clients.size,
                  isStreaming: e.runtime.session.isStreaming,
                })),
              },
        ),
      );
      return;
    }

    // 정적 파일 (프로덕션 빌드)
    if (existsSync(DIST_DIR)) {
      let filePath = join(DIST_DIR, url.pathname === "/" ? "index.html" : url.pathname);
      if (!filePath.startsWith(DIST_DIR) || !existsSync(filePath)) {
        filePath = join(DIST_DIR, "index.html"); // SPA fallback
      }
      const ext = extname(filePath);
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      res.end(readFileSync(filePath));
      return;
    }

    res.writeHead(404);
    res.end("Not found. Run `npm run build` first, or use `npm run dev`.");
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
  }
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws, req) => {
  if (AUTH.enabled && !sessionFromRequest(req)) {
    ws.close(4401, "unauthorized");
    return;
  }
  const requested = new URL(req.url ?? "/ws", "http://localhost").searchParams.get("session");
  // 새 초안은 세션 생성(수 초) 전에 모델/thinking 헤더가 바로 뜨도록 부트스트랩 전송.
  // 실제 스냅샷이 도착하면 클라이언트에서 교체된다.
  if (!requested) {
    const boot = bootstrapSnapshot();
    if (boot) sendTo(ws, { type: "snapshot", snapshot: boot });
  }
  const queue: ClientCommand[] = [];
  let ready = false;

  ws.on("message", (raw) => {
    let cmd: ClientCommand;
    try {
      cmd = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // 세션 바인딩 완료 전에 도착한 커맨드는 잠시 보관
    if (!ready) {
      queue.push(cmd);
      return;
    }
    handleCommand(cmd, ws).catch((err) => {
      sendTo(ws, { type: "error", message: String(err instanceof Error ? err.message : err) });
    });
  });

  acquireEntry(requested)
    .then((entry) => {
      if (ws.readyState !== ws.OPEN) return;
      entry.clients.add(ws);
      entry.lastActive = Date.now();
      wsEntry.set(ws, entry);
      // 기존 세션(/s/:id) 또는 이미 공개된 세션만 즉시 바인딩.
      // `/` 빈 초안은 첫 prompt 때 session_bound → URL 정리.
      if (entry.published || requested) {
        publishEntry(entry, ws);
      }
      sendTo(ws, { type: "snapshot", snapshot: buildSnapshot(entry) });
      ready = true;
      for (const cmd of queue.splice(0)) {
        handleCommand(cmd, ws).catch((err) => {
          sendTo(ws, { type: "error", message: String(err instanceof Error ? err.message : err) });
        });
      }
    })
    .catch((err) => {
      sendTo(ws, { type: "error", message: String(err instanceof Error ? err.message : err) });
      ws.close();
    });

  ws.on("close", () => {
    const entry = wsEntry.get(ws);
    if (entry) {
      entry.clients.delete(ws);
      entry.lastActive = Date.now();
      wsEntry.delete(ws);
    }
  });
});

httpServer.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" || HOST === "::" ? "localhost" : HOST;
  console.log(
    `pi-web-chat server: http://${displayHost}:${PORT}  (bind ${HOST}, chat cwd: ${AGENT_CWD})`,
  );
  if (!AUTH.enabled) {
    console.log("[pi-web-chat] auth disabled (PI_WEB_AUTH=0)");
  } else if (AUTH.generatedPassword) {
    console.log(
      `[pi-web-chat] auth enabled — generated password (set PI_WEB_PASSWORD to pin it)`,
    );
    console.log(`[pi-web-chat] user=${AUTH.user}  password=${AUTH.generatedPassword}`);
  } else {
    console.log(`[pi-web-chat] auth enabled (user=${AUTH.user})`);
  }
});
