# Phase 3 설계 — 금융분석 웹챗 (RPC 웹앱) (review 대상)

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

## 3. 아키텍처

```
Browser (SPA)
  ├─ GET  /            → Vite 빌드 산출물 (dist/index.html + /assets/*)
  ├─ GET  /api/stream  → SSE (text/event-stream) — RPC 이벤트/UI 요청 중계
  ├─ POST /api/cmd     → {cmd, payload} — prompt/steer/abort/set_model/... 화이트리스트 중계
  ├─ GET  /api/templates → agent-config/prompts/*.md 목록 (템플릿 버튼용)
  ├─ GET  /api/files     → /workspace 파일 목록 (리포트 뷰용)
  ├─ GET  /files/*       → /workspace 읽기 전용 서빙 (HTML 리포트 링크용)
  └─ 인증: Bearer 토큰 (PI_WEB_TOKEN, 미설정 시 자동 생성 → 시작 로그)

Node 백엔드 (containers/web/server.mjs, ~400줄)
  ├─ spawn("pi", ["--mode","rpc","--session-dir","/opt/pi-agent/web-sessions",
  │              ...PI_DEFAULT_MODEL/THINKING 플래그])
  ├─ stdin: 화이트리스트 명령 직렬화 (JSONL)
  ├─ stdout: 라인 파싱 → 이벤트 분류 → SSE 브로드캐스트
  ├─ stderr: 로그 (키/토큰 레드랙트)
  └─ 자식 사망 시 동일 세션 디렉터리로 재스폰 → 클라이언트에 status 이벤트
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

**HTTP 보조 API** (프론트 전용, RPC 미경유):

| 엔드포인트 | 역할 |
|---|---|
| `GET /api/templates` | 프롬프트 템플릿 목록 `{name, title, body}` (frontmatter title/description 우선, body는 frontmatter 제거) |
| `GET /api/files?dir=reports` | workspace 파일 목록 (2단계 재귀, .html/.md) `{name, size, mtime}` |
| `GET /files/*` | workspace 읽기 전용 서빙 (.html/.md/.txt/.json, symlink 차단, 경로 탈출 403) |
| `GET /` (SPA 폴백) | /api·/files 외 GET 경로 → index.html (클라이언트 라우팅) |

**미노출**: `bash`, `fork`, `clone`, `get_entries`(대용량), `compact`(자동 설정 유지).

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

- `PI_WEB_TOKEN` Bearer 인증 (HTTP + SSE + files 전부). 미설정 시 `openssl rand` 자동 생성,
  시작 로그 출력 (ttyd 토큰과 동일 패턴). compose에 `PI_WEB_TOKEN` 권장.
- `PI_WEB_TOKEN` 보유 = 챗 + (rpc 화이트리스트 경유) 셸 간접 접근 — ttyd와 **동등한 위험 수준**
  (pod-per-user 에페메럴 모델이므로 허용, 설계 §8 참조).
- `/files/*`는 `path.normalize` 후 `/workspace` 접두사 강제, symlink 금지, HTML만 허용.
- SSE 응답에 `X-Accel-Buffering: no`, CSP 헤더(`default-src 'self'`), `X-Content-Type-Options`.
- 키·토큰은 백엔드 로그에서 레드랙트 (정규식 `sk-...`/`token=` 마스킹).

## 7. 배포 (기존 이미지 확장)

- `containers/web/` (npm 프로젝트 — 루트 pnpm 워크스페이스와 무관): `server.mjs`,
  `src/`(React 앱: routes/__root·index·settings·reports, hooks/useSseStream·useRpc,
  components/ConfirmModal·TemplateButtons·ModelPicker), `package.json`(lock 커밋), `dist/`(빌드 산출물, gitignore).
- Dockerfile 멀티스테이지: Stage 1 `npm ci && npm run build` → Stage 2 `COPY --from=web-build` (dist + server.mjs),
  `agent-config/prompts/` → `/opt/pi-web/templates/` 복사.
- Dockerfile: `COPY web/ /opt/pi-web/` + `chown` — pi 설치 레이어와 분리.
- 엔트리포인트 분기 추가: `PI_WEB=1` → `exec node /opt/pi-web/server.mjs` (기본값은 ttyd 유지).
- compose: `PI_WEB=1`, 포트 `8080:8080` 추가 (ttyd 7681과 공존), `PI_WEB_TOKEN` 추가.
- 모델 env(`PI_DEFAULT_MODEL`/`PI_DEFAULT_THINKING`)는 백엔드가 rpc spawn 플래그로 재사용 —
  compose 키/모델 한 세트 구조 그대로 유효.

## 8. 구현 순서 (워커 할당 단위)

| 단계 | 내용 | 검증 |
|---|---|---|
| 3a ✅ | `server.mjs` 골격: rpc spawn + SSE + POST 화이트리스트 + 최소 챗 UI | 호스트/컨테이너 검증 완료 (실제 LLM 왕복 확인) |
| 3b ✅ | React + Vite + TS + TanStack Query/Router 전면 개편(챗/설정/리포트 뷰, 템플릿 버튼, 마크다운, confirm 모달, 모델 드롭다운) + API 보강(/api/templates, /api/files, /files/*) + 멀티스테이지 Dockerfile | tsc + vite build + 호스트 왕복 + 컨테이너 스모크 완료 |
| 3c | 하드닝: 토큰 인증, 재접속 복원 | 토큰 401 검증, 프로세스 kill 테스트 |

## 9. 오픈 이슈

1. **SSE vs WS**: 제로 의존성 위해 SSE+POST 선택 — 이벤트 순서 보장·프록시 호환성은 구현 시
   확인 (nginx/ingress buffering 주의, `X-Accel-Buffering: no`).
2. **ttyd 유지 여부**: 기본 모드는 ttyd 유지, `PI_WEB=1`로 전환 — Phase 3 안정화 후
   웹챗을 기본으로 바꿀지 사용자 결정.
3. **세션 재개**: 파드 재시작 시 `--session-dir`의 세션이 `switch_session`으로 재개 가능 —
   MVP에서는 자동 재개 없이 새 세션 + 경고 표시.
4. **이미지 태그/레지스트리**: Phase 3c에서 CI 이미지 빌드와 함께 결정.
5. **멀티탭**: 브로드캐스트로 통일 — 동시 프롬프트는 `queue_update`로 표시만.
