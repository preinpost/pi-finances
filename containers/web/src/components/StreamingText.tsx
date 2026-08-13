import { memo } from "react";
import { Markdown } from "./Markdown";

/**
 * 스트리밍 텍스트 — beautiful-ui 스타일의 단어 fade/blur 해소 애니메이션.
 *
 * v1 (하이브리드) 문제: 앞부분을 마크다운 블록(<p>)으로, 꼬리를 인라인 span으로
 * 렌더하니 단어가 꼬리→본문으로 넘어갈 때마다 블록/인라인 시임에서 줄이 튀었다.
 * → v2: 스트리밍 중에는 **전체를 단어 span 하나의 인라인 흐름**으로 렌더한다
 *   (시임 없음 — 단어는 도착 시 1회 애니메이션 후 그 자리에 유지).
 *   인라인 마크다운 마커(**, `, [링크])는 표시용으로만 벗겨내고,
 *   최종 완료 시 정식 마크다운으로 교체된다.
 *
 * 표/코드 펜스/블록 구문 메시지는 스트리밍 중에도 전체를 마크다운으로 렌더해
 * 구문이 깨져 보이지 않게 한다 (단어 애니메이션 없음 — 평면 스트리밍).
 */
const STRUCTURAL_START = /^\s{0,3}(#{1,6}\s|\||```|[-*+]\s|\d+\.\s|>\s)/;
const HAS_TABLE_OR_FENCE = /(^|\n)\s{0,3}\||```/;

/** 스트리밍 표시용 인라인 마크다운 마커 정리 (최종 렌더는 정식 마크다운). */
function cleanWord(word: string): string {
  return word
    .replace(/^#{1,6}\s*/, "") // 헤딩 마커
    .replace(/^\s*>\s*/, "") // 인용
    .replace(/^[-*+]\s+/, "• ") // 리스트 글머리
    .replace(/\*\*([^*]+)\*\*/g, "$1") // 볼드
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2") // 이탤릭
    .replace(/`([^`]*)`/g, "$1") // 인라인 코드
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 링크 → 라벨
    .replace(/\|/g, " ") // 테이블 파이프 (구조 감지로 거의 안 닿음)
    .trim();
}

export const StreamingText = memo(function StreamingText({ text }: { text: string }) {
  // 표/코드/블록 구문 → 스트리밍 내내 실시간 마크다운 (단어 애니메이션 없음)
  if (STRUCTURAL_START.test(text) || HAS_TABLE_OR_FENCE.test(text)) {
    return (
      <div className="text-[15px]">
        <Markdown text={text} />
        <span className="stream-cursor" aria-hidden />
      </div>
    );
  }

  // 순수 문장 → 단어별 fade/blur 캐스케이드 (key = 도착 순서, 재마운트 없음)
  const words = text.split(" ").filter((w) => w.length > 0);
  return (
    <div className="text-[15px] leading-relaxed whitespace-pre-wrap">
      {words.map((word, i) => (
        <span key={i} className="stream-word">
          {cleanWord(word)}
          {" "}
        </span>
      ))}
      <span className="stream-cursor" aria-hidden />
    </div>
  );
});
