import { useEffect, useMemo, useRef, useState, type TouchEvent, type WheelEvent } from "react";

/** "진짜 바닥" 판정 여유 (px). 이 밴드 안에서만 재고정/스냅한다. */
const BOTTOM_TOLERANCE = 8;
import type { UIContentBlock, UIMessage } from "../../shared/protocol";
import type { ActiveTool } from "../lib/chat";
import { chatClient } from "../lib/chat";
import { useLocale, useT } from "../lib/i18n";
import { pickThinkingLine, pickToolFlavorLine } from "../lib/toolFlavor";
import { Markdown } from "./Markdown";
import { PixelLoader } from "./PixelLoader";
import { StreamingText } from "./StreamingText";

function SparkleIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function WrenchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4L15 12l-3-3 2.7-2.7Z" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function RetryIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
    </svg>
  );
}

/** 마크다운 링크에서 고유 도메인 목록 추출 (중복 제거, 최대 8개). */
function extractSources(text: string): { domain: string; url: string }[] {
  const seen = new Map<string, string>();
  for (const m of text.matchAll(/\(https?:\/\/[^)\s]+\)/g)) {
    try {
      const url = m[0].slice(1, -1);
      const domain = new URL(url).hostname.replace(/^www\./, "");
      if (!seen.has(domain)) seen.set(domain, url);
    } catch {
      /* 잘못된 URL 무시 */
    }
  }
  return [...seen.entries()].slice(0, 8).map(([domain, url]) => ({ domain, url }));
}

/** 도메인 첫 글자 + 해시 색상 아바타 (외부 이미지 없이 자체 생성). */
function DomainAvatar({ domain }: { domain: string }) {
  const hue = useMemo(
    () => [...domain].reduce((a, c) => a + c.charCodeAt(0) * 3, 0) % 360,
    [domain],
  );
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center rounded-full text-[8.5px] font-bold text-white shadow-[0_0_0_1.5px_var(--canvas)]"
      style={{ background: `hsl(${hue} 55% 42%)` }}
      aria-hidden
    >
      {domain[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

/** 완성된 assistant 메시지 아래 액션 행 — 복사 / 재생성(마지막만) / 소스 펼침. */
function MessageActions({
  text,
  canRetry,
  retryText,
}: {
  text: string;
  canRetry?: boolean;
  retryText?: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sources = useMemo(() => extractSources(text), [text]);
  if (!text && sources.length === 0) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 차단 등 무시 */
    }
  };

  return (
    <>
      <div className="mt-2 flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? t("copied") : t("copy")}
          className="flex size-6 items-center justify-center rounded-[6px] text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-500" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </button>
        {canRetry && retryText && (
          <button
            type="button"
            onClick={() => chatClient.send({ type: "prompt", text: retryText })}
            aria-label={t("retry")}
            className="flex size-6 items-center justify-center rounded-[6px] text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            <RetryIcon className="size-3.5" />
          </button>
        )}
        {sources.length > 0 && (
          <button
            type="button"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((v) => !v)}
            className="ml-1 flex items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 transition-colors duration-150 hover:bg-hover"
          >
            <span className="flex -space-x-1">
              {sources.slice(0, 4).map((s) => (
                <DomainAvatar key={s.domain} domain={s.domain} />
              ))}
            </span>
            <span className="text-[12px] text-muted">{t("sources", { count: sources.length })}</span>
            <ChevronIcon
              className={`size-3 text-faint transition-transform duration-200 ${
                sourcesOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        )}
      </div>
      {sourcesOpen && (
        <div className="pop-in mt-1.5 flex flex-col rounded-[10px] bg-inset p-1 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          {sources.map((s) => (
            <a
              key={s.domain}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12px] text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              <DomainAvatar domain={s.domain} />
              <span className="truncate font-medium text-ink">{s.domain}</span>
              <span className="ml-auto max-w-[45%] truncate font-mono text-[10.5px] text-faint">
                {s.url}
              </span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

/** 툴 콜 카드 — 원문 이름/인자 없이 장르 말투만 */
function ToolCallCard({
  block,
}: {
  block: Extract<UIContentBlock, { type: "toolCall" }>;
}) {
  const locale = useLocale();
  const running = !block.result;
  const isError = block.result?.isError ?? false;
  const label = pickToolFlavorLine(
    block.name,
    running ? "running" : isError ? "error" : "done",
    block.id || block.name,
    locale,
  );

  return (
    <div
      className={`my-2 flex w-fit items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${
        isError
          ? "border-red-300/70 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20"
          : "border-line bg-card/60"
      }`}
    >
      <span className="relative shrink-0">
        <span
          className={`block size-2 rounded-full ${
            isError ? "bg-red-500" : running ? "bg-amber-400" : "bg-emerald-500/80"
          }`}
        />
        {running && (
          <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/50" />
        )}
      </span>
      <WrenchIcon className="size-3.5 shrink-0 text-faint" />
      <span className={`text-[12.5px] font-medium ${
        isError ? "text-red-600 dark:text-red-400" : "text-ink"
      }`}>
        {label}
      </span>
      {!running &&
        (isError ? (
          <span className="text-[10px] font-bold text-red-500">!</span>
        ) : (
          <CheckIcon className="size-3 shrink-0 text-emerald-600 dark:text-emerald-500" />
        ))}
    </div>
  );
}

/** 접이식 thinking 트레이스 — 스파크 + 쉬머 라벨, 펼치면 본문 */
function Thinking({ text, streaming, seed }: { text: string; streaming?: boolean; seed: string }) {
  const locale = useLocale();
  const label = pickThinkingLine(streaming ? "running" : "done", seed, locale);
  return (
    <details className="group my-1.5 text-sm">
      <summary className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors select-none hover:bg-hover">
        <SparkleIcon className="size-3.5 shrink-0 text-accent" />
        {streaming ? (
          <span className="shimmer-text text-[12.5px] font-medium">{label}</span>
        ) : (
          <span className="text-[12.5px] font-medium text-muted">{label}</span>
        )}
        <ChevronIcon className="size-3.5 text-faint transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="mt-1 ml-[9px] border-l border-line pl-4 text-[13px] leading-relaxed text-muted whitespace-pre-wrap">
        {text}
      </div>
    </details>
  );
}

function Blocks({
  blocks,
  markdown,
  seedPrefix,
}: {
  blocks: UIContentBlock[];
  markdown: boolean;
  seedPrefix: string;
}) {
  const t = useT();
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "text":
            return markdown ? (
              <Markdown key={i} text={b.text} />
            ) : (
              <div key={i} className="whitespace-pre-wrap leading-relaxed">
                {b.text}
              </div>
            );
          case "thinking":
            return <Thinking key={i} text={b.text} seed={`${seedPrefix}:think`} />;
          case "toolCall":
            return <ToolCallCard key={i} block={b} />;
          case "image":
            return b.dataUrl ? (
              <img
                key={i}
                src={b.dataUrl}
                alt={t("attachedImage")}
                className="my-1 max-h-64 max-w-full rounded-lg"
              />
            ) : (
              <div key={i} className="text-xs opacity-60">
                {t("imagePlaceholder")}
              </div>
            );
        }
      })}
    </>
  );
}

function Message({
  message,
  canRetry,
  retryText,
  seedPrefix,
}: {
  message: UIMessage;
  canRetry?: boolean;
  retryText?: string;
  seedPrefix: string;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-[15px] whitespace-pre-wrap text-ink sm:max-w-[75%]">
          <Blocks blocks={message.content} markdown={false} seedPrefix={seedPrefix} />
        </div>
      </div>
    );
  }
  const text = message.content
    .filter((b): b is Extract<UIContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
  return (
    <div className="text-[15px]">
      <Blocks blocks={message.content} markdown seedPrefix={seedPrefix} />
      {message.errorMessage && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
          {message.errorMessage}
        </div>
      )}
      <MessageActions text={text} canRetry={canRetry} retryText={retryText} />
    </div>
  );
}

/** 빈 세션 웰컴 — 로고 + 안내 + 추천 질문 칩 */
function EmptyState() {
  const t = useT();
  const suggestions = [
    { label: t("suggest1"), delay: 200 },
    { label: t("suggest2"), delay: 270 },
    { label: t("suggest3"), delay: 340 },
    { label: t("suggest4"), delay: 410 },
  ];
  return (
    <div className="mt-[max(2.5rem,9vh)] flex flex-col items-center px-4 text-center">
      <div
        className="fade-up flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-soft via-card to-bubble shadow-[inset_0_0_0_1px_var(--c-line)]"
      >
        <span className="font-serif text-[26px] font-semibold text-accent">α</span>
      </div>
      <h2 className="fade-up mt-5 text-xl font-semibold tracking-tight text-ink" style={{ animationDelay: "60ms" }}>
        {t("emptyTitle")}
      </h2>
      <p className="fade-up mt-1.5 text-sm text-muted" style={{ animationDelay: "120ms" }}>
        {t("emptySubtitle")}
      </p>
      <div className="mt-8 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => chatClient.injectComposerText(s.label)}
            className="fade-up group flex items-center gap-2.5 rounded-xl border border-line bg-card px-3.5 py-2.5 text-left text-[13.5px] text-muted transition-all duration-150 hover:border-faint hover:text-ink hover:shadow-[0_2px_10px_rgba(0,0,0,0.06)]"
            style={{ animationDelay: `${s.delay}ms` }}
          >
            <SparkleIcon className="size-3.5 shrink-0 text-accent/80" />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <svg
              viewBox="0 0 24 24"
              className="size-3.5 shrink-0 text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  streamText,
  streamThinking,
  activeTools,
  isStreaming,
}: {
  messages: UIMessage[];
  streamText: string;
  streamThinking: string;
  activeTools: ActiveTool[];
  isStreaming: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * 바닥 고정 스크롤 (스트리밍 중 "덜덜덜" 흔들림 방지):
   *
   * 1. 위로 올리려는 의도는 wheel/touch에서 동기로 해제한다.
   *    - wheel: deltaY < 0 (ctrl+휠 핀치 줌 제외)
   *    - touch: 손가락이 시작점보다 아래로 움직인 즉시 (임계값 없음).
   *      passive 리스너는 브라우저의 기본 스크롤보다 먼저 실행되므로,
   *      첫 픽셀이 움직이기 전에 해제된다. +4px 임계값은 "브라우저는 이미
   *      위로 스크롤됐는데 아직 고정 상태"인 구간을 만들어 느린 드래그에서
   *      40ms 단위 delta 렌더가 화면을 계속 아래로 끌어당겼다 (덜덜덜).
   * 2. 재고정은 진짜 바닥(여유 8px)에서만 한다. 40px 재고정 밴드는 바닥
   *    근처 내용을 읽으려 조금 올린 사용자를 매 delta마다 강제로
   *    끌어내려 같은 흔들림을 만들었다.
   * 3. snap 전에 "직전 렌더 시점에 바닥이었는지"를 확인한다. 렌더 이후엔
   *    DOM이 이미 자랐으므로 직전 scrollHeight와 비교해야 사용자가 방금
   *    위로 올렸는지 안다. 이로써 scroll 이벤트가 프레임 단위로 늦게
   *    도착하는 경로(데스크톱 스크롤바 드래그 등)에서도 렌더가 끼어들어
   *    화면을 당기는 경합이 없다.
   */
  const stickToBottom = useRef(true);
  const prevScrollHeight = useRef(0);
  const touchStartY = useRef<number | null>(null);

  // 바닥 고정 중이면 컨테이너를 직접 바닥으로 스크롤한다.
  // scrollIntoView는 조상 스크롤러까지 건드릴 수 있어 비결정적이다.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const wasAtBottom =
      el.scrollTop + el.clientHeight >= prevScrollHeight.current - BOTTOM_TOLERANCE;
    prevScrollHeight.current = el.scrollHeight;
    if (stickToBottom.current && wasAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
  });

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    // 진짜 바닥 근처에서만 다시 고정한다
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_TOLERANCE;
  };

  const handleWheel = (e: WheelEvent) => {
    // ctrl+휠(트랙패드 핀치 줌)은 스크롤 의도가 아니다
    if (!e.ctrlKey && e.deltaY < 0) stickToBottom.current = false; // 위로 올리려는 시도
  };

  const handleTouchStart = (e: TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (touchStartY.current === null) return;
    const y = e.touches[0]?.clientY;
    // 손가락이 아래로 = 내용이 위로 = 과거 내용 보기. 첫 픽셀부터 해제.
    // 위로만 움직이는 드래그(바닥에서의 반동 등)는 해제하지 않는다.
    if (y != null && y > touchStartY.current) {
      stickToBottom.current = false;
    }
  };

  // 응답 대기 중일 때만 로더 표시 (최종 assistant 텍스트가 있으면 숨김 → 종료 후 잔상 방지)
  const last = messages[messages.length - 1];
  const waitingForAssistant =
    !last ||
    last.role === "user" ||
    (last.role === "assistant" && last.content.some((b) => b.type === "toolCall" && b.result));
  const showTyping =
    isStreaming && !streamText && !streamThinking && activeTools.length === 0 && waitingForAssistant;

  // 재생성(retry)용: 마지막 유저 메시지 텍스트
  const lastUser = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "user") {
        return m.content
          .filter((b): b is Extract<UIContentBlock, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n");
      }
    }
    return undefined;
  }, [messages]);

  // 실행 중 툴 중복 방지: message_end 스냅샷에 이미 "실행 중 카드"(결과 없는
  // toolCall 블록)로 그려진 툴은 tool_start 칩으로 또 그리지 않는다.
  // (tool_execution_start의 toolCallId = toolCall 블록의 id — SDK 확인 완료)
  const runningCardIds = new Set(
    last && last.role === "assistant"
      ? last.content
          .filter(
            (b): b is Extract<UIContentBlock, { type: "toolCall" }> =>
              b.type === "toolCall" && !b.result,
          )
          .map((b) => b.id)
      : [],
  );
  const toolChips = activeTools.filter((tool) => !runningCardIds.has(tool.toolCallId));

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      className="thin-scroll min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
        {messages.length === 0 && !streamText && !streamThinking && !isStreaming ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((m, i) => (
              <Message
                key={i}
                message={m}
                canRetry={
                  !isStreaming && m.role === "assistant" && i === messages.length - 1
                }
                retryText={lastUser}
                seedPrefix={`msg:${i}`}
              />
            ))}
            {streamThinking && (
              <Thinking text={streamThinking} streaming seed={`msg:${messages.length}:think`} />
            )}
            {streamText && <StreamingText text={streamText} />}
            {toolChips.map((tool) => (
              <div
                key={tool.toolCallId}
                className="fade-up flex w-fit items-center gap-2 rounded-full border border-line bg-card/70 py-1.5 pr-3.5 pl-2 text-[12.5px] text-muted"
              >
                <PixelLoader className="text-accent" />
                <WrenchIcon className="size-3 text-faint" />
                <span className="font-medium text-ink">
                  {pickToolFlavorLine(tool.toolName, "running", tool.toolCallId, locale)}
                </span>
              </div>
            ))}
            {showTyping && (
              <div
                className="flex items-center gap-2 text-faint"
                aria-label={pickThinkingLine("running", `wait:${messages.length}`, locale)}
              >
                <PixelLoader />
                <span className="shimmer-text text-[12.5px] font-medium">
                  {pickThinkingLine("running", `wait:${messages.length}`, locale)}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
