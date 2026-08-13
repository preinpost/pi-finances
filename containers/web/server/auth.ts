import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const SESSION_COOKIE = "pi_web_sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX_ATTEMPTS = 8;

export interface AuthConfig {
  enabled: boolean;
  user: string;
  /** Set only when we generated it this process — safe to print once. */
  generatedPassword?: string;
}

interface Session {
  user: string;
  exp: number;
}

interface LoginBucket {
  n: number;
  resetAt: number;
}

const sessions = new Map<string, Session>();
const loginBuckets = new Map<string, LoginBucket>();

function envFlag(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function envDisabled(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "off" || v === "no";
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function loadAuthConfig(): AuthConfig {
  if (envDisabled("PI_WEB_AUTH")) {
    return { enabled: false, user: envFlag("PI_WEB_USER") ?? "pi" };
  }
  const user = envFlag("PI_WEB_USER") ?? "pi";
  const provided = envFlag("PI_WEB_PASSWORD");
  if (provided) return { enabled: true, user };
  return {
    enabled: true,
    user,
    generatedPassword: randomBytes(16).toString("hex"),
  };
}

let password = "";

export function applyAuthSecret(config: AuthConfig, secret?: string) {
  password = secret ?? config.generatedPassword ?? envFlag("PI_WEB_PASSWORD") ?? "";
}

export function verifyCredentials(user: string, pass: string, expectedUser: string): boolean {
  const userOk = safeEqual(user, expectedUser);
  const passOk = password.length > 0 && safeEqual(pass, password);
  return userOk && passOk;
}

export function createSession(user: string): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { user, exp: Date.now() + SESSION_TTL_MS });
  return token;
}

export function destroySession(token: string | undefined) {
  if (token) sessions.delete(token);
}

export function readSession(token: string | undefined): Session | undefined {
  if (!token) return undefined;
  const session = sessions.get(token);
  if (!session) return undefined;
  if (Date.now() >= session.exp) {
    sessions.delete(token);
    return undefined;
  }
  return session;
}

export function parseCookie(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return trimmed.slice(eq + 1);
    }
  }
  return undefined;
}

export function sessionFromRequest(req: IncomingMessage): Session | undefined {
  return readSession(parseCookie(req, SESSION_COOKIE));
}

export function isSecureRequest(req: IncomingMessage): boolean {
  const proto = req.headers["x-forwarded-proto"];
  if (typeof proto === "string") return proto.split(",")[0]?.trim() === "https";
  return false;
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

/** Returns false when the IP is temporarily locked out. */
export function consumeLoginAttempt(ip: string): boolean {
  const now = Date.now();
  const bucket = loginBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    loginBuckets.set(ip, { n: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (bucket.n >= LOGIN_MAX_ATTEMPTS) return false;
  bucket.n += 1;
  return true;
}

export function resetLoginAttempts(ip: string) {
  loginBuckets.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now >= session.exp) sessions.delete(token);
  }
  for (const [ip, bucket] of loginBuckets) {
    if (now >= bucket.resetAt) loginBuckets.delete(ip);
  }
}, 60_000).unref();
