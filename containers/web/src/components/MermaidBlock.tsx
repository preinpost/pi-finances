import { useEffect, useId, useRef } from "react";

const MERMAID_START =
  /^(xychart-beta|xychart|flowchart|graph\s|sequenceDiagram|pie\s|gantt|classDiagram|stateDiagram|erDiagram|journey|gitGraph|mindmap|timeline|quadrantChart|C4Context)\b/;

export function looksLikeMermaid(lang: string | undefined, source: string): boolean {
  if (lang === "mermaid" || lang === "mmd") return true;
  return MERMAID_START.test(source.trim());
}

export function MermaidBlock({ source }: { source: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, "");

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let cancelled = false;

    void (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral",
      });
      try {
        const { svg } = await mermaid.render(`mermaid-${reactId}`, source.trim());
        if (!cancelled) el.innerHTML = svg;
      } catch (err) {
        if (!cancelled) {
          el.innerHTML = "";
          el.textContent = err instanceof Error ? err.message : "mermaid 렌더 실패";
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, reactId]);

  return (
    <div
      ref={hostRef}
      className="my-3 overflow-x-auto rounded-2xl border border-line bg-card p-3 text-[13px] text-muted"
    />
  );
}
