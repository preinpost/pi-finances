/**
 * RPC 이벤트/메시지 타입 — server.mjs가 중계하는 원본 type 기준 (pi docs/rpc.md).
 * 실제 이벤트는 더 많지만, UI가 소비하는 필드만 정의한다.
 */

export interface TextBlock {
  type: "text";
  text: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: (string | TextBlock)[];
  [key: string]: unknown;
}

export type UiRequestMethod =
  | "confirm"
  | "input"
  | "editor"
  | "select"
  | "notify"
  | "setStatus"
  | "setWidget"
  | "setTitle";

export interface UiRequest {
  id: string;
  method: UiRequestMethod;
  title?: string;
  message?: string;
  placeholder?: string;
  prefill?: string;
  options?: string[];
  [key: string]: unknown;
}

export interface AssistantDelta {
  type: string;
  contentIndex?: number;
  delta?: string;
  [key: string]: unknown;
}

/** 스트리밍 중 assistant 메시지의 text 블록 누적 상태 (query cache) */
export interface StreamingState {
  assistantMessageId: string | null;
  textByIndex: Map<number, string>;
}

export type AgentState = "idle" | "running" | "done" | "exited" | "respawned";

export interface AgentStatus {
  state: AgentState;
  toolName?: string;
}

export interface ModelInfo {
  provider: string;
  modelId?: string;
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface PromptTemplate {
  name: string;
  title: string;
  body: string;
}

export interface WorkspaceFile {
  name: string;
  size: number;
  mtime: string;
}

export type RpcEvent =
  | { type: "message_start"; message: AgentMessage; [k: string]: unknown }
  | { type: "message_update"; assistantMessageEvent?: AssistantDelta; message?: AgentMessage; [k: string]: unknown }
  | { type: "message_end"; message: AgentMessage; [k: string]: unknown }
  | { type: "extension_ui_request"; id: string; method: string; title?: string; message?: string; [k: string]: unknown }
  | { type: "agent_start" | "agent_end" | "agent_settled"; [k: string]: unknown }
  | { type: "turn_start" | "turn_end"; [k: string]: unknown }
  | { type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end"; toolName?: string; [k: string]: unknown }
  | { type: "bash_execution_update"; [k: string]: unknown }
  | { type: "queue_update"; [k: string]: unknown }
  | { type: "extension_error"; [k: string]: unknown }
  | { type: "compaction_start" | "compaction_end"; [k: string]: unknown }
  | { type: "status"; state: string; [k: string]: unknown }
  | { type: "response"; command: string; success: boolean; error?: string; data?: unknown; [k: string]: unknown };
