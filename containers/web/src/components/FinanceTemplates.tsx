// 컨테이너 로컬 적응 (upstream 미포함): 금융 분석 프롬프트 템플릿 버튼.
// server /api/templates (agent-config/prompts/*.md — Dockerfile이 /opt/pi-web/templates로 복사)를
// 조회해 목록을 렌더링하고, 클릭하면 템플릿 본문을 채팅으로 전송한다.
import { useQuery } from "@tanstack/react-query";
import { chatClient } from "../lib/chat";

interface TemplateItem {
  name: string;
  title: string;
  body: string;
}

/** 버튼 라벨 — "제목 — 부제" 형태면 "제목"만 사용 */
function shortLabel(title: string): string {
  const head = title.split("—")[0]?.trim();
  return head && head.length <= 16 ? head : title;
}

export function FinanceTemplates() {
  const { data } = useQuery({
    queryKey: ["finance-templates"],
    queryFn: async () => {
      try {
        const resp = await fetch("/api/templates");
        if (!resp.ok) return [];
        const parsed = (await resp.json()) as { templates?: TemplateItem[] };
        return parsed.templates ?? [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  if (!data || data.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
      {data.map((t) => (
        <button
          key={t.name}
          type="button"
          className="rounded-full border border-line bg-card px-2.5 py-1 text-xs text-ink/80 transition-colors hover:bg-hover"
          title={t.title}
          onClick={() => chatClient.send({ type: "prompt", text: t.body })}
        >
          {shortLabel(t.title)}
        </button>
      ))}
    </div>
  );
}
