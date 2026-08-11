import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";
import { extractText, streamingKey } from "../hooks/useSseStream";
import type { AgentMessage, StreamingState } from "../types";

function markdownHtml(text: string): string {
  return marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
}

function bubbleContent(m: AgentMessage): string {
  return extractText(m);
}

export default function MessageList({
  messages,
  loading,
  error,
}: {
  messages: AgentMessage[];
  loading: boolean;
  error: string | null;
}) {
  // 스트리밍 중인 assistant 텍스트 — SSE message_update가 캐시에 누적
  const stream = useQuery<StreamingState | null>({ queryKey: [...streamingKey], initialData: null });
  const streamingText = stream.data ? [...stream.data.textByIndex.values()].join("") : "";
  const showStream = stream.data?.assistantMessageId != null && streamingText.length > 0;

  if (loading) return <div className="chat-empty">메시지 로딩 중…</div>;
  if (error) return <div className="chat-empty error">{error}</div>;

  return (
    <div className="messages">
      {messages.length === 0 && !showStream && <div className="chat-empty">금융분석 질문을 입력하세요.</div>}
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.role}`}>
          <div
            className="bubble"
            // assistant는 마크다운 렌더링 (에이전트 출력 — 신뢰 경계는 컨테이너 내부)
            dangerouslySetInnerHTML={m.role === "assistant" ? { __html: markdownHtml(bubbleContent(m)) } : undefined}
          >
            {m.role === "user" ? bubbleContent(m) : null}
          </div>
        </div>
      ))}
      {showStream && (
        <div className="msg assistant">
          <div className="bubble streaming" dangerouslySetInnerHTML={{ __html: markdownHtml(streamingText) }} />
        </div>
      )}
    </div>
  );
}
