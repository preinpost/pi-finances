/**
 * fluent-korean 출력 지침을 세션 시스템 프롬프트에 주입한다.
 *
 * Claude Code output-style이 아니라 pi 웹챗/TUI 시스템 프롬프트 층위다.
 * 온디맨드 스킬로 두면 말투가 매 턴 적용되지 않으므로 항상 append 한다.
 *
 * 원본: https://github.com/snflkd/fluent-korean (MIT) fluent-korean-not-coding
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function stripFrontmatter(s: string): string {
  return s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

function candidatePaths(): string[] {
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  return [
    agentDir ? join(agentDir, "fluent-korean.md") : "",
    join(HERE, "fluent-korean.md"),
    join(HERE, "..", "fluent-korean.md"),
    join(HERE, "..", "..", "agent-config", "fluent-korean.md"),
    "/opt/pi-agent/fluent-korean.md",
  ].filter(Boolean);
}

/** 세션 시스템 프롬프트에 붙일 fluent-korean 본문. 파일을 못 찾으면 빈 문자열. */
export function fluentKoreanBlock(): string {
  for (const p of candidatePaths()) {
    try {
      if (!existsSync(p)) continue;
      const body = stripFrontmatter(readFileSync(p, "utf8"));
      if (body) return body;
    } catch {
      /* ignore */
    }
  }
  console.warn("[pi-web-chat] fluent-korean.md not found — Korean output style not injected");
  return "";
}
