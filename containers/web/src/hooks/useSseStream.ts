/**
 * SSE 구독 — /api/stream 이벤트를 TanStack Query 캐시에 반영.
 *   ['messages']      — 대화 메시지 배열 (get_messages로 초기 하이드레이션)
 *   ['streaming']     — 진행 중 assistant 텍스트 누적 (StreamingState)
 *   ['agent-status']  — 에이전트 상태 (AgentStatus)
 *   ['ui-request']    — extension_ui_request (ConfirmModal이 소비)
 *   ['conn']          — SSE 연결 여부
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentMessage, AgentStatus, RpcEvent, StreamingState, UiRequest } from "../types";

export const messagesKey = ["messages"] as const;
export const streamingKey = ["streaming"] as const;
export const statusKey = ["agent-status"] as const;
export const uiRequestKey = ["ui-request"] as const;
export const connKey = ["conn"] as const;

export const INITIAL_STATUS: AgentStatus = { state: "idle" };
export const INITIAL_STREAMING: StreamingState = { assistantMessageId: null, textByIndex: new Map() };

const DIALOG_METHODS = new Set(["confirm", "input", "editor", "select"]);

/** 임의 문자열을 AgentState로 정규화 (SSE status 이벤트의 state 값) */
function toAgentState(s: string): AgentStatus["state"] {
  return s === "running" || s === "done" || s === "idle" || s === "exited" || s === "respawned" ? s : "idle";
}

export function extractText(m: AgentMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .filter(
        (c): c is { type: "text"; text: string } =>
          typeof c === "object" &&
          c !== null &&
          (c as { type?: unknown }).type === "text" &&
          typeof (c as { text?: unknown }).text === "string",
      )
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

export function useSseStream() {
  const qc = useQueryClient();

  useEffect(() => {
    const es = new EventSource("/api/stream");

    es.onopen = () => qc.setQueryData(connKey, true);
    es.onerror = () => qc.setQueryData(connKey, false);

    es.onmessage = (e) => {
      let evt: RpcEvent;
      try {
        evt = JSON.parse(e.data) as RpcEvent;
      } catch {
        return;
      }
      switch (evt.type) {
        case "agent_start":
          qc.setQueryData(statusKey, { state: "running" } satisfies AgentStatus);
          break;
        case "agent_end":
        case "agent_settled":
          qc.setQueryData(statusKey, { state: "done" } satisfies AgentStatus);
          break;
        case "tool_execution_start":
          qc.setQueryData(statusKey, { state: "running", toolName: evt.toolName } satisfies AgentStatus);
          break;
        case "status":
          qc.setQueryData(statusKey, { state: toAgentState(evt.state) } satisfies AgentStatus);
          break;
        case "message_start": {
          const m = evt.message;
          if (m && m.role === "assistant") {
            const list = qc.getQueryData<AgentMessage[]>(messagesKey) ?? [];
            qc.setQueryData(messagesKey, [...list, m]);
            qc.setQueryData(streamingKey, {
              assistantMessageId: m.id,
              textByIndex: new Map(),
            } satisfies StreamingState);
          }
          break;
        }
        case "message_update": {
          const d = evt.assistantMessageEvent;
          if (!d) break;
          const st = qc.getQueryData<StreamingState>(streamingKey);
          if (!st || st.assistantMessageId == null) break;
          const idx = d.contentIndex ?? 0;
          const next = new Map(st.textByIndex);
          if (d.type === "text_start") {
            next.set(idx, "");
            qc.setQueryData(streamingKey, { ...st, textByIndex: next });
          } else if (d.type === "text_delta" && typeof d.delta === "string") {
            next.set(idx, (next.get(idx) ?? "") + d.delta);
            qc.setQueryData(streamingKey, { ...st, textByIndex: next });
          }
          break;
        }
        case "message_end": {
          const m = evt.message;
          if (m && m.role === "assistant") {
            const list = qc.getQueryData<AgentMessage[]>(messagesKey) ?? [];
            const idx = list.findIndex((x) => x.id === m.id);
            if (idx >= 0) {
              const next = [...list];
              next[idx] = m;
              qc.setQueryData(messagesKey, next);
            } else {
              qc.setQueryData(messagesKey, [...list, m]);
            }
          }
          qc.setQueryData(streamingKey, INITIAL_STREAMING);
          break;
        }
        case "extension_ui_request": {
          if (DIALOG_METHODS.has(evt.method ?? "")) {
            qc.setQueryData(uiRequestKey, evt as unknown as UiRequest);
          }
          break;
        }
        default:
          break;
      }
    };

    return () => es.close();
  }, [qc]);
}
