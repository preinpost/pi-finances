import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { statusKey } from "../hooks/useSseStream";
import { useAbort, usePrompt } from "../hooks/useRpc";

export default function Composer() {
  const [text, setText] = useState("");
  const prompt = usePrompt();
  const abort = useAbort();
  const status = useQuery({ queryKey: [...statusKey], initialData: { state: "idle" } });
  const running = status.data?.state === "running" || prompt.isPending;

  const send = () => {
    const msg = text.trim();
    if (!msg || running) return;
    setText("");
    prompt.mutate({ message: msg });
  };

  return (
    <footer className="composer">
      <textarea
        id="input"
        value={text}
        placeholder="금융분석 질문을 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={2}
      />
      <div className="composer-actions">
        <span className="composer-error">{prompt.error ? `오류: ${String(prompt.error)}` : ""}</span>
        {running ? (
          <button className="btn danger" onClick={() => abort.mutate({})} disabled={abort.isPending}>
            {abort.isPending ? "중단 중…" : "■ 중단"}
          </button>
        ) : (
          <button className="btn primary" onClick={send} disabled={!text.trim()}>
            전송
          </button>
        )}
      </div>
    </footer>
  );
}
