import { useQuery } from "@tanstack/react-query";
import { connKey, statusKey } from "../hooks/useSseStream";
import { INITIAL_STATUS } from "../hooks/useSseStream";
import type { AgentStatus } from "../types";

const STATE_LABEL: Record<string, string> = {
  idle: "대기",
  running: "분석 중…",
  done: "완료",
  exited: "RPC 재시작 대기",
  respawned: "RPC 연결됨",
};

export default function StatusBar() {
  const status = useQuery<AgentStatus>({ queryKey: [...statusKey], initialData: INITIAL_STATUS });
  const conn = useQuery({ queryKey: [...connKey], initialData: false });

  const label = STATE_LABEL[status.data?.state ?? "idle"] ?? status.data?.state;
  const tool = status.data?.toolName;

  return (
    <footer className="statusbar">
      <span className={`dot ${conn.data ? "online" : "offline"}`} />
      <span className="status-text">
        {conn.data ? "연결됨" : "연결 끊김"} · {label}
        {tool ? ` · 툴: ${tool}` : ""}
      </span>
    </footer>
  );
}
