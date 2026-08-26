# pi-web-chat — 업스트림 동기화 메모

- 업스트림: https://github.com/preinpost/pi-web-chat (MIT)
- 벤더링 기준: 커밋 `76235d4` (fix(ui): disable GFM strikethrough in chat markdown), 버전 v0.1.19 (npm: pi-web-chat)
- 동기화: `rsync -a --exclude node_modules --exclude .git --exclude .github --exclude dist --exclude extensions <pi-web>/ ./` (HANDOFF/README 제외)
- 로컬 적응(업스트림 미포함): `PI_DEFAULT_MODEL` / `PI_DEFAULT_THINKING` env 지원
  (`server/index.ts` — 새 세션 기본 모델/thinking + 접속 직후 부트스트랩 스냅샷으로 헤더 즉시 표시.
  메시지 있는 기존 세션은 저장된 모델·thinking 복원이 우선)
- 로컬 적응(업스트림 미포함): **세션 삭제** — `DELETE /api/sessions/:id` (`server/index.ts`),
  실행 중인 세션 런타임(entry)을 dispose 후 세션 파일 삭제, 바인딩된 클라이언트엔
  `session_deleted` 이벤트 전송 → 클라이언트(`chat.ts` `resetToDraft()`)는 새 초안으로 재연결.
  사이드바(`SessionsDrawer.tsx`) 각 행에 삭제 버튼(호버 표시, 확인 후 삭제, 현재 세션이면 `/` 이동),
  `--c-danger` 색상 토큰 추가, i18n 4개 언어에 deleteSession/confirmDeleteSession 키 추가
- **UI 폴리싱 (2026-08-13, 프론트 전용 — 서버 로직 변경 없음)**:
  - `src/components/MessageList.tsx` — 빈 상태 웰컴(π 배지 + 부제 + 추천 질문 칩 4개, 칩 클릭 시
    컴포저 주입), 씽킹 트레이스(스파크 아이콘 + 쉬머 라벨 + 화살표 회전), 툴 칩(상태 도트·렌치
    아이콘·인자 미리보기·체크/에러, 펼치면 `bg-inset` 결과 영역), 스트리밍 커서, 실행 중 툴 칩,
    픽셀 그리드 로더(타이핑 인디케이터)
  - `src/components/ChatPage.tsx` — 헤더 π 로고 배지 + 연결 상태 레이블(데스크톱) + 구분선,
    연결 오버레이를 픽셀 로더로 교체
  - `src/components/Composer.tsx` — 포커스 링(accent-soft), 이미지 아이콘, Enter/Shift+Enter 힌트,
    버튼 active 스케일
  - `src/components/SessionsDrawer.tsx` — 세션 행 2줄 레이아웃(제목 + 날짜·메시지 수), 활성 행
    아이콘 강조, 빈 상태 아이콘
  - `src/components/ThinkingMenu.tsx` — 🧠 이모지 → 스파크 SVG, `ModelMenu.tsx` — 활성 체크 표시
  - `src/lib/chat.ts` — `injectComposerText()` 추가 (빈 상태 추천 질문 → 컴포저)
  - `src/components/PixelLoader.tsx` 신규, `src/styles.css` — `--c-inset` 토큰 + fade-up/pixel-on/
    shimmer/caret keyframes + prefers-reduced-motion 대응, i18n 4개 언어에 새 키 추가
    (emptyTitle/emptySubtitle/suggest1-4/thinking/noOutput/sendHint)
  - **툴 이름 숨김 (로컬 적응)**: 채팅의 실행 중 칩·완료 카드에 원문 툴 이름/인자/결과를
    노출하지 않고, 분류별 장르 말투만 표시 (`src/lib/toolFlavor.ts` +
    `src/i18n/flavorLines.ts`). 분류마다 실행/완료/실패 10개, 생각하는 중도 10개.
    같은 호출(id)은 같은 문구를 고정. 확장 목록 다이얼로그는 그대로.
  - **사고 토큰 숨김 (로컬 적응)**: thinking 채널·`<think>` 본문·태그 없는 영어 혼잣말을
    웹챗에 노출하지 않는다. 서버는 `thinking_delta` 미전송, think 태그 제거,
    Let me/The user/툴이름 문장 필터 (`server/thinkingText.ts`). UI는 로더만 표시.
  - **스트리밍 텍스트 (beautiful-ui 스타일)** (`StreamingText.tsx` 신규 + `MessageList.tsx`):
    - 스트리밍 중 단어 blur 해소 애니메이션 — **v2: 전체를 단어 span 하나의 인라인 흐름으로 렌더**
      (v1의 마크다운 블록+꼬리 span 하이브리드는 시임에서 줄이 튀어 폐기). 인라인 마크다운
      마커(**, `, 링크)는 표시용으로만 벗겨내고 완료 시 정식 마크다운으로 교체.
      표/코드 펜스/블록 구문 메시지는 스트리밍 중에도 전체 마크다운 렌더 (구문 깨짐 방지)
    - 완성된 assistant 메시지에 액션 행: 복사(클립보드) / 재생성(마지막 메시지만, 직전 유저
      텍스트 재전송) / **출처 펼침** — 마크다운 링크에서 고유 도메인 추출, 해시색 도메인
      아바타(외부 이미지 없음) + N곳 카운트 + 펼치면 도메인/URL 목록
  - **실행 중 툴 중복 표시 수정** (`MessageList.tsx`): message_end 스냅샷에 결과 없는
    toolCall 블록이 먼저 들어와 카드(amber)로 그려지는데, tool_start 칩이 겹쳐 같은 툴이
    두 번 보이던 문제 — 마지막 assistant 메시지의 실행 중 카드와 toolCallId가 같은 칩은
    숨김 (SDK의 tool_execution_start toolCallId = toolCall 블록 id 확인 완료)
- 컨테이너 전용 설정은 코드 기본값이 아니라 env(PORT/HOST/PI_WEB_CWD)로 주입 (Dockerfile 참조)
- 로컬 적응(업스트림 미포함): **브랜드 AlphaFolio** — 헤더/로그인/빈화면 배지 `α`,
  탭·PWA 이름, favicon/PWA 아이콘 (`scripts/generate-icons.mjs`). npm 패키지명·서버 로그는 업스트림 유지.
- 로컬 적응(업스트림 미포함): **설정 > 프로바이더** — pi `/login`/`/logout`과 동일.
  `ModelRuntime.login/logout` → `~/.pi/agent/auth.json`. OAuth·API 키 프롬프트는 웹 다이얼로그.
- 로컬 적응(업스트림 미포함): **설정 > API 키** — `/api/secrets`로 LLM/브로커/시세 키를
  프로세스 env에 반영하고, 로컬이면 `.env`에도 병합. 컨테이너(`/opt/pi-web`)는 메모리만.
  모델 관리는 Ollama/LM Studio/OpenRouter 프리셋 버튼 + 헤더 모델 메뉴 프로바이더 그룹화.
- 로컬 적응(업스트림 미포함): **`.env` 로드** — `server/env.ts`가 패키지 루트 `.env`를 읽음
  (기존 process.env 우선). 템플릿은 `.env.example`.
- 로컬 적응(업스트림 미포함): **비밀번호 게이트** — `PI_WEB_USER`/`PI_WEB_PASSWORD`
  (`server/auth.ts` + `server/index.ts`). HttpOnly 세션 쿠키(`pi_web_sid`),
  `/api/*`·`/ws` 잠금, `/api/health`·`/api/auth/*`만 공개. 미설정 시 비밀번호 자동 생성·시작 로그 출력.
  `PI_WEB_AUTH=0`으로 끌 수 있다. 프론트는 로그인 화면(`LoginPage`) + 설정 메뉴 로그아웃.
- 로컬 적응(업스트림 미포함): **차트 카드** — `broker_chart_card` 툴 결과 `details.kind=chart-card`를
  웹챗이 Lightweight Charts React 카드로 렌더 (`ChartCard.tsx`, `serialize.ts`). HTML 생성 없음.
