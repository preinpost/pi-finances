import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UIAuthCatalog,
  UIAuthSession,
  UIAuthType,
  UICustomModelsResponse,
  UICustomProvider,
  UIExtensionsResponse,
  UIForkPoint,
  UIModel,
  UISessionInfo,
} from "../../shared/protocol";
import type { UISecretsResponse, UISecretsSaveResponse } from "../../shared/secrets";
import { refreshAuth } from "./auth";

function handleUnauthorized(res: Response) {
  if (res.status === 401) void refreshAuth();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(`${url}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const SESSIONS_QUERY_KEY = ["sessions"] as const;

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: () => fetchJson<UISessionInfo[]>("/api/sessions"),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** 세션 생성/전환/메시지 완료 후 사이드바 목록 갱신 */
export function useInvalidateSessions() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
}

/** 세션 파일 삭제 (서버에서 실행 중인 런타임도 함께 정리) */
export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) {
    handleUnauthorized(res);
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error ?? `delete failed: ${res.status}`);
  }
}

export function useForkPoints(sessionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["fork-points", sessionId],
    queryFn: () =>
      fetchJson<UIForkPoint[]>(`/api/fork-points?session=${encodeURIComponent(sessionId ?? "")}`),
    enabled: enabled && !!sessionId,
    staleTime: 0,
  });
}

export function useExtensions(enabled = true) {
  return useQuery({
    queryKey: ["extensions"],
    queryFn: () => fetchJson<UIExtensionsResponse>("/api/extensions"),
    enabled,
    staleTime: 0,
  });
}

export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => fetchJson<UIModel[]>("/api/models"),
    staleTime: 5 * 60_000,
  });
}

export const CUSTOM_MODELS_QUERY_KEY = ["custom-models"] as const;

/** ~/.pi/agent/models.json 의 커스텀 프로바이더/모델 */
export function useCustomModels(enabled = true) {
  return useQuery({
    queryKey: CUSTOM_MODELS_QUERY_KEY,
    queryFn: () => fetchJson<UICustomModelsResponse>("/api/custom-models"),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export async function saveCustomModels(
  providers: UICustomProvider[],
): Promise<UICustomModelsResponse> {
  const res = await fetch("/api/custom-models", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providers }),
  });
  const json = (await res.json()) as UICustomModelsResponse & { error?: string };
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(json.error ?? `save failed: ${res.status}`);
  }
  return json;
}

/** 모델 목록 재조회 (커스텀 모델 저장 후) */
export function useInvalidateModels() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["models"] });
}

export const PROVIDERS_QUERY_KEY = ["providers"] as const;

export function useAuthProviders(enabled = true) {
  return useQuery({
    queryKey: PROVIDERS_QUERY_KEY,
    queryFn: () => fetchJson<UIAuthCatalog>("/api/providers"),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useInvalidateProviders() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY });
    await qc.invalidateQueries({ queryKey: ["models"] });
  };
}

export async function startProviderLogin(
  providerId: string,
  method: UIAuthType,
): Promise<UIAuthSession> {
  return fetchJson<UIAuthSession>("/api/providers/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId, method }),
  });
}

export async function pollProviderLogin(id: string): Promise<UIAuthSession> {
  return fetchJson<UIAuthSession>(`/api/providers/login/${encodeURIComponent(id)}`);
}

export async function answerProviderLogin(id: string, value: string): Promise<UIAuthSession> {
  return fetchJson<UIAuthSession>(`/api/providers/login/${encodeURIComponent(id)}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

export async function cancelProviderLogin(id: string): Promise<void> {
  await fetchJson(`/api/providers/login/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export async function logoutProvider(providerId: string): Promise<void> {
  await fetchJson(`/api/providers/${encodeURIComponent(providerId)}/logout`, { method: "POST" });
}

export const SECRETS_QUERY_KEY = ["secrets"] as const;

export function useSecrets(enabled = true) {
  return useQuery({
    queryKey: SECRETS_QUERY_KEY,
    queryFn: () => fetchJson<UISecretsResponse>("/api/secrets"),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export async function saveSecrets(values: Record<string, string>): Promise<UISecretsSaveResponse> {
  const res = await fetch("/api/secrets", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values }),
  });
  const json = (await res.json()) as UISecretsSaveResponse & { error?: string };
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(json.error ?? `save failed: ${res.status}`);
  }
  return json;
}
