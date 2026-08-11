import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceFile } from "../types";

export const Route = createFileRoute("/reports")({
  component: ReportsPage,
});

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function ReportsPage() {
  const files = useQuery({
    queryKey: ["files", "reports"],
    queryFn: async () => {
      const resp = await fetch("/api/files?dir=reports");
      if (!resp.ok) throw new Error("파일 목록을 불러오지 못했습니다");
      const data = (await resp.json()) as { files?: WorkspaceFile[] };
      return data.files ?? [];
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  return (
    <div className="page reports">
      <div className="page-head">
        <h2>리포트</h2>
        <button className="btn" onClick={() => void files.refetch()} disabled={files.isFetching}>
          {files.isFetching ? "새로고침 중…" : "새로고침"}
        </button>
      </div>
      {files.isLoading && <p className="hint">로딩 중…</p>}
      {files.error && <p className="error">오류: {String(files.error)}</p>}
      {!files.isLoading && !files.error && (files.data?.length ?? 0) === 0 && (
        <p className="hint">아직 리포트가 없습니다. 챗에서 리포트 작성을 요청해보세요.</p>
      )}
      <ul className="file-list">
        {files.data?.map((f) => (
          <li key={f.name}>
            <a href={`/files/reports/${f.name}`} target="_blank" rel="noopener noreferrer">
              {f.name}
            </a>
            <span className="file-meta">
              {formatSize(f.size)} · {formatDate(f.mtime)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
