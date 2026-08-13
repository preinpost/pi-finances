import { useSyncExternalStore } from "react";

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  user?: string;
}

type AuthPhase = "loading" | "ready";

interface AuthState {
  phase: AuthPhase;
  status: AuthStatus | null;
}

const initialState: AuthState = { phase: "loading", status: null };
const listeners = new Set<() => void>();

let state: AuthState = initialState;

function notify() {
  for (const l of listeners) l();
}

function setState(next: AuthState) {
  state = next;
  notify();
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`auth status: ${res.status}`);
  return readJson<AuthStatus>(res);
}

export async function login(user: string, password: string): Promise<void> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user, password }),
  });
  if (res.status === 429) throw new Error("too-many");
  if (!res.ok) throw new Error("invalid");
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  setState({
    phase: "ready",
    status: { enabled: true, authenticated: false },
  });
}

export async function refreshAuth(): Promise<AuthStatus> {
  const status = await fetchAuthStatus();
  setState({ phase: "ready", status });
  return status;
}

export function initAuth() {
  void refreshAuth().catch(() => {
    setState({
      phase: "ready",
      status: { enabled: true, authenticated: false },
    });
  });
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => initialState,
  );
}

export function isAuthed(status: AuthStatus | null): boolean {
  return Boolean(status && (!status.enabled || status.authenticated));
}
