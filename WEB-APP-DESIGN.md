# Phase 3 설계 — 금융분석 웹챗 (review 대상)

> **2026-08-11 결정**: 프론트/백엔드를 **pi-web-chat 소스 벤더링**(github.com/preinpost/pi-web-chat,
> v0.1.19)으로 교체. 자체 구현(server.mjs + React SSE 앱)은 폐기 — pi-web-chat이 SDK 기반
> (AgentSessionRuntime) 세션 허브·모델/확장 관리·포크 등 성숙 기능을 이미 갖추고 있어 재구현 대신
> 벤더링+적응을 택함. 벤더링 내역·동기화: `containers/web/UPSTREAM.md`. 아래 문서는 교체 전
> 설계 과정 기록으로 남겨둔다.

> CONTAINER-DESIGN.md §9(진화 로드맵)의 Phase 3 상세 설계.
> ttyd 웹터미널(Phase 1)을 대체하는 **커스텀 웹챗 UI** — 브라우저에서 pi 에이전트와
> 대화하며 금융분석 리포트를 보는 화면. 동일 이미지·동일 pod-per-user 모델 유지.
> 코드 사실 검증 기반: pi `docs/rpc.md` (전체 명령/이벤트), `docs/usage.md` (CLI 플래그).

## 1. 목표 / 비목표

**목표**
- 컨테이너 안에서 `pi --mode rpc` 서브프로세스를 띄우고, 브라우저 챗 UI가
  WebSocket/SSE로 대화하는 웹앱. 파드 1개 = 백엔드 1 + pi rpc 1 + 사용자 1.
- 금융분석 특화 UX: 템플릿 버튼(일일 리포트/딥다이브/스크리닝), 마크다운 렌더링,
  HTML 리포트 링크, 모델/thinking 선택, 확인 모달(주문 등).
- **백엔드 제로 런타임 의존성**: Node 24 내장(`node:http`)만 사용 — 서버 런타임에 node_modules 불필요.
- **프론트는 React + Vite + TS + TanStack** (Query: 데이터/스트리밍 상태, Router: 챗/설정/리포트 뷰):
  Vite 빌드 산출물(dist)만 이미지에 복사 — **빌드 타임 의존성, 런타임 이미지는 여전히 제로**.

**비목표 (MVP)**
- 멀티테넌트/멀티세션 동시성 (파드당 1 세션, 브라우저는 브로드캐스트).
- RPC `bash` 명령 노출 (보안 — 토큰 보유자만 셸 접근, ttyd와 동일 수준).
- SSE 재연결 이벤트 리플레이 (재접속 시 `get_messages` 스냅샷으로 복원).

## 2. 검증된 사실 (설계 근거)

- RPC 프로토콜: stdin/stdout JSONL, `docs/rpc.md`. 명령: `prompt`/`steer`/`follow_up`/`abort`,
  `new_session`, `get_state`/`get_messages`, `set_model`/`cycle_model`/`get_available_models`,
  `set_thinking_level`/`get_available_thinking_levels`, `set_steering_mode`/`set_follow_up_mode`,
  `compact`/`set_auto_compaction`, `bash`/`abort_bash`, `get_session_stats`/`export_html`/
  `switch_session`/`fork`/`clone`/`get_entries`/`get_tree`/`get_last_assistant_text`/
  `set_session_name`, `get_commands`.
- 이벤트: `agent_start/end/settled`, `turn_start/end`, `message_start/end` +
  `message_update`(스트리밍 텍스트), `tool_execution_start/update/end`,
  `bash_execution_update`, `queue_update`, `compaction_*`, `auto_retry_*`, `extension_error`,
  `extension_ui_request`(stdout).
- **권한 팝업 이벤트는 RPC에 없음** (permission 관련 타입/이벤트 부재 — dist 타입 정의 확인).
  → ttyd의 권한 팝업 대신, **에이전트 지침(AGENTS.md의 "주문 툴은 명시적 요청 시에만")이
  LLM 레벨에서 지켜지고**, 사용자가 챗에서 "주문해줘"를 입력할 때만 실행됨.
  주문 확인 UX = 챗 대화 + (확장자가 내는) `confirm` 모달.
- `extension_ui_request`(confirm/input/editor/select/notify/setStatus/setWidget/setTitle)는
  stdout으로 스트리밍되고 `extension_ui_response`(stdin)로 응답 — `/kis-key`의 `ctx.ui.input`
  등이 이 경로로 동작하므로 **키 등록도 웹 UI에서 가능**.
- 세션: `--session-dir <path>`로 저장 위치 지정, `new_session`으로 초기화, `switch_session`으로
  재개. 파드 수명 = 세션 수명 (에페메럴 모델 그대로).
- Node 24: 타입 스트리핑 기본 활성 — 백엔드는 `.mjs` (빌드 스텝 없음, `node:http` 내장).

## 3. 아키텍처 (2026-08-11 갱신 — pi-web-chat 벤더링 기준)

```
Browser (SPA — React 19 + TanStack Router/Query + Base UI + Tailwind v4)
  ├─ GET  /            → Vite 빌드 산출물 (dist/public)
  ├─ WS   /ws          → 세션별 실시간 이벤트/명령 (세션 허브 — URL /s/:sessionId)
  ├─ GET  /api/health·sessions·models·custom-models·fork-points·extensions·state
  └─ 비밀번호 게이트 (`PI_WEB_USER`/`PI_WEB_PASSWORD`, HttpOnly 세션 쿠키)

Node 서버 (containers/web/dist/index.js — pi-web-chat 벤더링)
  ├─ @earendil-works/pi-coding-agent SDK (AgentSessionRuntime — rpc 서브프로세스 아님)
  ├─ 세션 허브: 세션별 독립 런타임, 같은 세션 클라이언트끼리 브로드캐스트
  ├─ 세션 파일: PI_CODING_AGENT_DIR(=/opt/pi-agent)/sessions — 컨테이너 pi CLI와 공유
  └─ chat cwd: PI_WEB_CWD(=/workspace)
```

**SSE + POST를 선택** (WS 대신): 브라우저 EventSource 내장 + `node:http` 스트리밍이면
**npm 의존성 0개**. 클라이언트→서버는 POST, 서버→클라이언트는 SSE 단방향 — pi RPC도
stdin(요청)/stdout(이벤트) 단방향이므로 1:1 대응이 자연스러움.

## 4. 화이트리스트 API 계약

| 클라이언트 cmd | RPC 명령 | 비고 |
|---|---|---|
| `prompt` | prompt | `streamingBehavior: "steer"` 기본 (대화형) |
| `steer` / `abort` | steer / abort | 실행 중 개입 |
| `new_session` | new_session | "/ 새 대화" 버튼 (세션 초기화) |
| `set_model` / `set_thinking` | set_model / set_thinking_level | 헤더 드롭다운 |
| `list_models` / `list_thinking` | get_available_models / get_available_thinking_levels | 최초 1회 캐시 |
| `get_state` / `get_messages` | get_state / get_messages | 재접속 시 하이드레이션 (`data.messages`) |
| `export_html` | export_html | 리포트 내보내기 (옵션) |
| `ui_response` | extension_ui_response | confirm/input/editor 모달 응답 |

**HTTP 보조 API** (pi-web-chat 고유):

| 엔드포인트 | 역할 |
|---|---|
| `GET /api/health` | 상태·버전 `{ok, version}` |
| `GET /api/sessions` | 세션 목록 (pi CLI와 공유 — 파일 기반) |
| `GET /api/models` / `/api/custom-models` | 모델 카탈로그 + 커스텀 프로바이더 (ModelsDialog) |
| `GET /api/fork-points` / `/api/extensions` / `/api/state` | fork 지점·확장 정보·세션 스냅샷 |

**미노출**: RPC `bash`(SDK 직접 사용이라 해당 없음), 대용량 이벤트 히스토리.

## 5. 금융분석 UX (MVP)

1. **템플릿 버튼** (채팅 입력 위): 일일 리포트 / 종목 딥다이브 / 섹터 스크리닝 —
   `agent-config/prompts/*.md`를 백엔드가 읽어 전개 후 `prompt`로 전송 (종목명은
   인라인 입력 모달로 받음).
2. **마크다운 렌더링**: `vendor/marked.min.js` (MIT, 정적 파일로 vendor — 버전 핀, 라이선스
   헤더 유지). 코드블록/표/리스트. 스트리밍 중에는 text만 표시, `message_end`에서 렌더.
3. **HTML 리포트 링크**: agent가 `reports/*.html`(stock-html 스킬) 생성 시 `/files/reports/...`
   링크를 메시지에서 자동 감지해 "리포트 열기 ↗" 버튼 렌더링 (새 탭, iframe 방지 헤더).
4. **확인 모달**: `extension_ui_request.confirm/input/editor` → 브라우저 모달 →
   `ui_response` 전송. (주문 확인·키 입력 시나리오)
5. **모델/thinking 드롭다운**: `PI_DEFAULT_MODEL` env로 시작하되 UI에서 변경 가능.
6. **상태 표시**: `agent_start/end`, `tool_execution_*` → "리서치 중… (kis_domestic_chart)"
   같은 진행 인디케이터, 스트리밍 토큰 카운터(옵션).

## 6. 보안 설계

- `PI_WEB_USER`/`PI_WEB_PASSWORD` 비밀번호 게이트 (HTTP + WS). 미설정 시 서버가 비밀번호를
  생성해 시작 로그에 출력. compose에 `PI_WEB_PASSWORD` 권장. `PI_WEB_AUTH=0`으로 끌 수 있다.
- 로그인 세션 보유 = 챗 + 에이전트 제어 — 파드당 단일 공유 계정 (pod-per-user 에페메럴 모델).
- `/files/*`는 `path.normalize` 후 `/workspace` 접두사 강제, symlink 금지, HTML만 허용.
- SSE 응답에 `X-Accel-Buffering: no`, CSP 헤더(`default-src 'self'`), `X-Content-Type-Options`.
- 키·토큰은 백엔드 로그에서 레드랙트 (정규식 `sk-...`/`token=` 마스킹).

## 7. 배포 (기존 이미지 확장) — 벤더링 후 실제 구성

> 2026-08-11 벤더링으로 교체됨 — 아래는 현재 실제 구성 (상세: `containers/web/UPSTREAM.md`).

- `containers/web/` = pi-web-chat 소스 벤더링 (npm 프로젝트 — 루트 pnpm 워크스페이스와 무관):
  `server/`(SDK 기반 AgentSessionRuntime + WS), `shared/protocol.ts`, `src/`(React 19 +
  TanStack Router/Query + Base UI + Tailwind v4), `bin/ scripts/ public/`(PWA), `package.json`+lock.
- Dockerfile 멀티스테이지: Stage 1(web-build) `npm ci && npm run build`(vite+esbuild) →
  Stage 2 `COPY --from=web-build /build/web/dist /opt/pi-web/dist` + `npm ci --omit=dev`
  (런타임 의존성 `@earendil-works/pi-coding-agent`, `ws`만).
- 엔트리포인트: 기본이 웹챗 (`exec node /opt/pi-web/dist/index.js`). ttyd는 제거됨.
- 컨테이너 env: `PORT=8080 HOST=0.0.0.0 PI_WEB_CWD=/workspace`.
  모델 기본값(`PI_DEFAULT_MODEL`/`PI_DEFAULT_THINKING`)은 SDK가 설정으로 사용.
- 로컬 적응: 비밀번호 게이트 (`PI_WEB_USER`/`PI_WEB_PASSWORD`) — UPSTREAM.md 참조.

## 8. 구현 순서 (워커 할당 단위)

| 단계 | 내용 | 검증 |
|---|---|---|
| 3a ✅ | `server.mjs` 골격: rpc spawn + SSE + POST 화이트리스트 + 최소 챗 UI | 호스트/컨테이너 검증 완료 (실제 LLM 왕복 확인) |
| 3b ✅ | ~~React + Vite + TS + TanStack 전면 개편~~ → **pi-web-chat 소스 벤더링**(세션·모델·확장·fork·i18n 등 전체 기능) + 멀티스테이지 Dockerfile | tsc + vite build + 호스트 왕복(WS) + 컨테이너 스모크 완료 |
| 3c | 하드닝: 비밀번호 게이트 | 로그인 401/429 검증, 세션 쿠키로 API/WS 통과 |

## 9. 오픈 이슈

1. **SSE vs WS**: 제로 의존성 위해 SSE+POST 선택 — 이벤트 순서 보장·프록시 호환성은 구현 시
   확인 (nginx/ingress buffering 주의, `X-Accel-Buffering: no`).
2. **ttyd**: 제거됨. 웹챗이 기본 인터페이스.
3. **세션 재개**: 파드 재시작 시 `--session-dir`의 세션이 `switch_session`으로 재개 가능 —
   MVP에서는 자동 재개 없이 새 세션 + 경고 표시.
4. **이미지 태그/레지스트리**: Phase 3c에서 CI 이미지 빌드와 함께 결정.
5. **멀티탭**: 브로드캐스트로 통일 — 동시 프롬프트는 `queue_update`로 표시만.
