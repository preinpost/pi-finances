/**
 * RPC 클라이언트 — POST /api/cmd (화이트리스트) 타입드 래퍼.
 * useRpc(cmd) → TanStack Query mutation. SSE 이벤트는 useSseStream이 담당.
 */
import { useMutation, type UseMutationResult } from "@tanstack/react-query";

export interface RpcResponse {
  type: "response";
  command: string;
  success: boolean;
  error?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface RpcError {
  error?: string;
}

export async function rpc<T = RpcResponse>(cmd: string, payload?: Record<string, unknown>): Promise<T> {
  const resp = await fetch("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, payload: payload ?? {} }),
  });
  const data = (await resp.json()) as T & RpcError;
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  const envelope = data as unknown as RpcResponse;
  if (envelope.success === false) {
    throw new Error(envelope.error || "RPC 명령이 거부되었습니다");
  }
  return data;
}

function useRpc<T = RpcResponse>(cmd: string): UseMutationResult<T, Error, Record<string, unknown> | undefined, unknown> {
  return useMutation<T, Error, Record<string, unknown> | undefined>({
    mutationFn: (payload) => rpc<T>(cmd, payload),
    retry: 0,
  });
}

export function usePrompt() {
  return useRpc("prompt");
}
export function useAbort() {
  return useRpc("abort");
}
export function useNewSession() {
  return useRpc("new_session");
}
export function useSetModel() {
  return useRpc("set_model");
}
export function useSetThinking() {
  return useRpc("set_thinking");
}
export function useUiResponse() {
  return useRpc("ui_response");
}
