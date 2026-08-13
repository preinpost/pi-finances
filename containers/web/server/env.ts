import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Load package-root `.env` if present. Existing process.env wins. */
export function loadDotEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(process.cwd(), ".env"), join(here, "..", ".env")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseDotEnv(readFileSync(file, "utf8")))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}

export function envFilePath(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(process.cwd(), ".env"), join(here, "..", ".env")];
  for (const file of candidates) {
    if (existsSync(file)) return file;
  }
  // 로컬 개발: 패키지 루트에 새로 만들 수 있다. 컨테이너(/opt/pi-web)는 persist 금지.
  if (!process.cwd().startsWith("/opt/pi-web")) return join(process.cwd(), ".env");
  return undefined;
}

function quoteEnv(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

/** 화이트리스트 키만 .env에 병합. 빈 값은 해당 키를 지운다. 기존 주석/순서는 최대한 유지. */
export function upsertDotEnv(updates: Record<string, string>): string | undefined {
  const file = envFilePath();
  if (!file) return undefined;
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      next.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      next.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!(key in updates)) {
      next.push(line);
      continue;
    }
    seen.add(key);
    const value = updates[key] ?? "";
    if (value === "") continue;
    next.push(`${key}=${quoteEnv(value)}`);
  }
  const pending = Object.entries(updates).filter(([k, v]) => !seen.has(k) && v !== "");
  if (pending.length > 0) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    for (const [key, value] of pending) next.push(`${key}=${quoteEnv(value)}`);
  }
  const text = `${next.join("\n").replace(/\n+$/, "")}\n`;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
  return file;
}

loadDotEnv();
