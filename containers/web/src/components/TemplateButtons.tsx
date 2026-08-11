import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePrompt } from "../hooks/useRpc";
import type { PromptTemplate } from "../types";

/**
 * 템플릿 버튼 — /api/templates에서 프롬프트 템플릿을 가져와 한 번에 전송.
 * 선택 시 추가 인자(예: 종목명)를 받는 인라인 입력 바가 나타난다.
 */
export default function TemplateButtons() {
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const resp = await fetch("/api/templates");
      if (!resp.ok) throw new Error("템플릿을 불러오지 못했습니다");
      const data = (await resp.json()) as { templates?: PromptTemplate[] };
      return data.templates ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const prompt = usePrompt();
  const [selected, setSelected] = useState<PromptTemplate | null>(null);
  const [arg, setArg] = useState("");

  const sendTemplate = (t: PromptTemplate, extra: string) => {
    const message = extra.trim() ? `${t.body}\n\n대상: ${extra.trim()}` : t.body;
    prompt.mutate({ message });
    setSelected(null);
    setArg("");
  };

  return (
    <div className="templates">
      {templates.data?.map((t) => (
        <button key={t.name} className="chip" title={t.title} onClick={() => setSelected(t)}>
          {t.title}
        </button>
      ))}
      {templates.error && <span className="hint">템플릿 로드 실패</span>}
      {selected && (
        <div className="template-prompt">
          <span className="template-title">{selected.title}</span>
          <input
            autoFocus
            value={arg}
            placeholder="대상 (선택 — 예: 삼성전자)"
            onChange={(e) => setArg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendTemplate(selected, arg);
              if (e.key === "Escape") setSelected(null);
            }}
          />
          <button className="btn primary" onClick={() => sendTemplate(selected, arg)}>
            전송
          </button>
          <button className="btn" onClick={() => setSelected(null)}>
            취소
          </button>
        </div>
      )}
    </div>
  );
}
