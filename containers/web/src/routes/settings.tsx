import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { rpc, useNewSession, useSetModel, useSetThinking } from "../hooks/useRpc";
import type { ModelInfo } from "../types";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function modelLabel(m: ModelInfo): string {
  const id = m.modelId ?? m.id ?? "unknown";
  return m.name ? `${m.provider}/${id} (${m.name})` : `${m.provider}/${id}`;
}

function SettingsPage() {
  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const resp = await rpc<{ data?: { models?: ModelInfo[] } }>("list_models");
      return resp.data?.models ?? [];
    },
    staleTime: 5 * 60_000,
  });
  const levels = useQuery({
    queryKey: ["thinking-levels"],
    queryFn: async () => {
      const resp = await rpc<{ data?: { levels?: string[] } }>("list_thinking");
      return resp.data?.levels ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const setModel = useSetModel();
  const setThinking = useSetThinking();
  const newSession = useNewSession();

  const error = models.error || levels.error || setModel.error || setThinking.error || newSession.error;

  return (
    <div className="page settings">
      <h2>모델 설정</h2>

      <label className="field">
        <span>모델</span>
        <select
          disabled={models.isLoading}
          onChange={(e) => {
            const [provider, ...rest] = e.target.value.split("/");
            const modelId = rest.join("/");
            if (provider && modelId) setModel.mutate({ provider, modelId });
          }}
        >
          {models.isLoading && <option>로딩 중…</option>}
          {models.data?.map((m) => (
            <option key={`${m.provider}/${m.modelId ?? m.id}`} value={`${m.provider}/${m.modelId ?? m.id}`}>
              {modelLabel(m)}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Thinking 레벨</span>
        <select
          disabled={levels.isLoading}
          onChange={(e) => setThinking.mutate({ level: e.target.value })}
        >
          {levels.isLoading && <option>로딩 중…</option>}
          {levels.data?.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>

      <button
        className="btn danger"
        onClick={() => {
          if (confirm("대화를 초기화하고 새 세션을 시작할까요?")) newSession.mutate({});
        }}
      >
        새 세션 시작
      </button>

      {setModel.isPending && <p className="hint">모델 전환 중…</p>}
      {setThinking.isPending && <p className="hint">thinking 적용 중…</p>}
      {error && <p className="error">오류: {String(error)}</p>}
    </div>
  );
}
