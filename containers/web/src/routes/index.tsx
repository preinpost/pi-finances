import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import MessageList from "../components/MessageList";
import Composer from "../components/Composer";
import TemplateButtons from "../components/TemplateButtons";
import { messagesKey } from "../hooks/useSseStream";
import { rpc } from "../hooks/useRpc";
import type { AgentMessage } from "../types";

export const Route = createFileRoute("/")({
  component: ChatPage,
});

function ChatPage() {
  // get_messages로 초기 하이드레이션 — 이후엔 SSE가 캐시를 갱신
  const { data: messages = [], isLoading, error } = useQuery({
    queryKey: [...messagesKey],
    queryFn: async () => {
      const resp = await rpc<{ data?: { messages?: AgentMessage[] } }>("get_messages");
      return resp.data?.messages ?? [];
    },
    staleTime: 60_000,
  });

  return (
    <div className="chat">
      <TemplateButtons />
      <MessageList messages={messages} loading={isLoading} error={error ? String(error) : null} />
      <Composer />
    </div>
  );
}
