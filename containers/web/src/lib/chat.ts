import { useSyncExternalStore } from "react";
import type { ClientCommand, ServerEvent, UISnapshot, UIRunNote } from "../../shared/protocol";
import { refreshAuth } from "./auth";

export interface ActiveTool {
  toolCallId: string;
  toolName: string;
}

/** 서버가 보낸 런 생명주기 공지 (재시도·압축·비정상 종료) */
export type RunNote = UIRunNote & { id: number };

/** WS lifecycle for chrome status (avoid red flash on first paint). */
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface ChatState {
  connection: ConnectionStatus;
  /** 서버가 이 연결에 바인딩한 세션 id (URL 동기화용) */
  sessionId: string | null;
  snapshot: UISnapshot | null;
  /** 현재 스트리밍 중인 assistant 텍스트 (아직 snapshot에 없음) */
  streamText: string;
  streamThinking: string;
  activeTools: ActiveTool[];
  /** fork 직후 composer에 주입할 텍스트 (소비 후 clear) */
  injectText: string | null;
  /** 증가할 때마다 composer textarea 포커스 */
  focusToken: number;
  /** 런 중단·재시도 공지 — 새 실행(agent_start)이 시작되면 해제된다 */
  runNote: RunNote | null;
}

const initialState: ChatState = {
  connection: "connecting",
  sessionId: null,
  snapshot: null,
  streamText: "",
  streamThinking: "",
  activeTools: [],
  injectText: null,
  focusToken: 0,
  runNote: null,
};

class ChatClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private reconnectDelay = 400;
  private intentionalClose = false;
  /** After a drop, stay on "connecting" briefly before showing disconnected. */
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private everConnected = false;
  /** 접속하려는 세션 id (null = 새 세션) */
  private target: string | null = null;
  /**
   * 스트리밍 delta 병합 버퍼. 토큰 단위로 도착하는 delta를 그대로 렌더하면
   * 초당 수십~수백 번 re-render + 누적 마크다운 전체 재파싱이 발생한다.
   * 짧은 주기로 모아서 한 번에 반영해 렌더/스크롤 경합을 줄인다.
   */
  private pendingText = "";
  private pendingThinking = "";
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  state: ChatState = initialState;

  /**
   * 세션에 연결. 이미 같은 세션에 붙어 있으면 무시하고,
   * 다른 세션이면 기존 연결을 끊고 새로 연다.
   * `force: true` — 이미 `/`(새 초안)에 있어도 새 초안 연결을 다시 연다.
   */
  connect(sessionId: string | null = null, opts?: { force?: boolean }) {
    if (this.ws) {
      const current = this.state.sessionId ?? this.target;
      if (!opts?.force && (sessionId === null ? this.target === null : sessionId === current)) {
        return;
      }
      // 세션 전환: 이전 연결 종료 + 화면 초기화
      this.closeSocket();
      this.clearPendingDeltas();
      this.update({
        snapshot: null,
        sessionId: null,
        streamText: "",
        streamThinking: "",
        activeTools: [],
        runNote: null,
      });
    }
    this.target = sessionId;
    if (this.state.connection === "disconnected") {
      this.update({ connection: "connecting" });
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
    // Cookie (HttpOnly session) is sent automatically on same-origin WS.
    const ws = new WebSocket(`${proto}://${location.host}/ws${query}`);
    this.ws = ws;

    ws.onopen = () => {
      this.clearDisconnectTimer();
      this.reconnectDelay = 400;
      this.everConnected = true;
      this.update({ connection: "connected" });
    };
    ws.onmessage = (e) => {
      try {
        this.handle(JSON.parse(e.data) as ServerEvent);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = (ev) => {
      this.ws = null;
      if (this.intentionalClose) return;
      // 세션 쿠키가 없거나 만료되면 재연결하지 않는다 (로그인 게이트로 넘김).
      if (ev.code === 4401) {
        this.update({ connection: "disconnected" });
        void refreshAuth();
        return;
      }

      // Soft state while retrying — don't flash red on first paint / brief blips.
      if (this.state.connection === "connected") {
        this.update({ connection: "connecting" });
      }
      this.scheduleDisconnected();
      // 재연결은 현재 바인딩된 세션으로 (새 세션이 또 생기지 않게)
      const retryTarget = this.state.sessionId ?? this.target;
      setTimeout(() => {
        this.target = retryTarget;
        this.connect(retryTarget);
      }, this.reconnectDelay);
      this.reconnectDelay = Math.min(Math.round(this.reconnectDelay * 1.6), 8_000);
    };
    ws.onerror = () => ws.close();
  }

  /** 재연결 핸들러까지 떼고 소켓을 닫는다 (유령 연결/재연결 루프 방지) */
  private closeSocket() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  send(cmd: ClientCommand) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    }
  }

  private scheduleDisconnected() {
    this.clearDisconnectTimer();
    // First load: wait longer before red. After a live session drop: faster.
    const graceMs = this.everConnected ? 1_200 : 4_000;
    this.disconnectTimer = setTimeout(() => {
      if (this.ws?.readyState === WebSocket.OPEN) return;
      this.update({ connection: "disconnected" });
    }, graceMs);
  }

  private clearDisconnectTimer() {
    if (this.disconnectTimer !== null) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  private handle(event: ServerEvent) {
    switch (event.type) {
      case "session_bound":
        // 첫 메시지(또는 기존 세션 접속) 후 서버가 id를 알려 주면 URL 동기화 대상이 된다
        this.target = event.sessionId;
        this.update({ sessionId: event.sessionId });
        break;
      case "snapshot":
        // 완결된 메시지가 snapshot에 반영되므로 스트림 버퍼는 비운다
        this.flushPendingDeltas();
        this.update({ snapshot: event.snapshot, streamText: "", streamThinking: "" });
        break;
      case "delta":
        // 토큰 단위 delta를 병합해 일정 주기로 한 번에 반영
        if (event.kind === "text") {
          this.pendingText += event.delta;
        } else {
          this.pendingThinking += event.delta;
        }
        this.scheduleDeltaFlush();
        break;
      case "tool_start":
        this.update({
          activeTools: [
            ...this.state.activeTools,
            { toolCallId: event.toolCallId, toolName: event.toolName },
          ],
        });
        break;
      case "tool_end":
        this.update({
          activeTools: this.state.activeTools.filter((t) => t.toolCallId !== event.toolCallId),
        });
        break;
      case "agent_start":
        // 새 실행이 시작되면 이전 런의 중단 공지는 해제한다
        this.update({
          snapshot: this.state.snapshot ? { ...this.state.snapshot, isStreaming: true } : null,
          runNote: null,
        });
        break;
      case "agent_end":
        // snapshot 도착 전에도 isStreaming을 즉시 내려 로딩 점이 남지 않게 한다
        this.flushPendingDeltas();
        this.update({
          activeTools: [],
          streamText: "",
          streamThinking: "",
          snapshot: this.state.snapshot
            ? { ...this.state.snapshot, isStreaming: false }
            : null,
        });
        break;
      case "forked":
        if (event.selectedText) this.update({ injectText: event.selectedText });
        break;
      case "session_deleted":
        // 다른 탭/사용자가 이 세션을 삭제 → 상태 초기화 후 새 초안에 재연결
        this.resetToDraft();
        break;
      case "run_note":
        // 재시도·압축·비정상 종료 공지를 채팅 하단에 노출 (말이 끊긴 원인 안내)
        this.update({ runNote: { ...event.note, id: Date.now() } });
        break;
      case "error":
        console.error("[pi-web-chat]", event.message);
        if (!this.state.runNote) {
          this.update({
            runNote: {
              level: "warn",
              kind: "run_failed",
              id: Date.now(),
              text: `요청 처리 중 오류가 발생했어요 (${event.message}).`,
            },
          });
        }
        break;
    }
  }

  consumeInjectText() {
    if (this.state.injectText !== null) this.update({ injectText: null });
  }

  /** 빈 상태 추천 질문 등에서 컴포저에 텍스트 주입 + 포커스 */
  injectComposerText(text: string) {
    this.update({ injectText: text });
    this.requestComposerFocus();
  }

  /** 세션 삭제 시: 상태 초기화 + 새 초안 연결 (session_deleted 이벤트와 동일 경로) */
  resetToDraft() {
    if (this.ws) this.closeSocket();
    this.clearPendingDeltas();
    this.update({
      snapshot: null,
      sessionId: null,
      streamText: "",
      streamThinking: "",
      activeTools: [],
      runNote: null,
    });
    this.connect(null, { force: true });
  }

  /** 로그아웃: 재연결 없이 소켓만 끊고 화면 상태를 비운다 */
  disconnect() {
    this.intentionalClose = true;
    this.closeSocket();
    this.clearPendingDeltas();
    this.clearDisconnectTimer();
    this.target = null;
    this.everConnected = false;
    this.intentionalClose = false;
    this.update({
      connection: "disconnected",
      snapshot: null,
      sessionId: null,
      streamText: "",
      streamThinking: "",
      activeTools: [],
    });
  }

  /** 드로어 닫힘 등과 겹치지 않도록 약간 늦춰 composer에 포커스 */
  requestComposerFocus() {
    window.setTimeout(() => {
      this.update({ focusToken: this.state.focusToken + 1 });
    }, 50);
  }

  private scheduleDeltaFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPendingDeltas();
    }, 40);
  }

  /** 버퍼에 쌓인 delta를 state에 반영 (snapshot/agent_end 등 종료 시점엔 즉시 flush) */
  private flushPendingDeltas() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const text = this.pendingText;
    const thinking = this.pendingThinking;
    if (!text && !thinking) return;
    this.pendingText = "";
    this.pendingThinking = "";
    this.update({
      streamText: text ? this.state.streamText + text : this.state.streamText,
      streamThinking: thinking ? this.state.streamThinking + thinking : this.state.streamThinking,
    });
  }

  private clearPendingDeltas() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingText = "";
    this.pendingThinking = "";
  }

  private update(partial: Partial<ChatState>) {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;
}

export const chatClient = new ChatClient();

export function useChat(): ChatState {
  return useSyncExternalStore(chatClient.subscribe, chatClient.getSnapshot);
}
