# pi-finance-agent 컨테이너

pi 에이전트 하네스 + pi-finances 금융 패키지를 묶은 **금융분석 전용 컨테이너**.
브라우저 웹터미널(ttyd) 또는 **웹챗(Phase 3, `PI_WEB=1`)** 으로 pi 에이전트에 접속해
인터랙티브 금융분석을 수행한다.
설계 문서: 루트 `CONTAINER-DESIGN.md`, `WEB-APP-DESIGN.md`.

## 포함 구성

| 구성 | 내용 |
|---|---|
| 하네스 | `@earendil-works/pi-coding-agent` (pi CLI) |
| 패키지 | pi-kis, pi-toss, pi-twelve-data, pi-finnhub, pi-coingecko, pi-naver-news (+ core 자동 번들), **pi-web-access**(웹 검색·URL 페치·PDF/유튜브 분석) |
| 스킬 | kis-trading, kis-stock-research, kis-sector-research, kis-timing |
| 설정 | `agent-config/AGENTS.md`(전역 지침), `APPEND_SYSTEM.md`(금융 persona), `prompts/`(템플릿 3종) |
| 웹터미널 | ttyd (포트 7681, basic-auth 토큰) |
| 웹챗 (Phase 3) | pi-web-chat 소스 벤더링 (포트 8080, `PI_WEB=1` — WEB-APP-DESIGN.md, UPSTREAM.md) |

## 빌드 & 실행

```bash
cd containers
cp compose.example.yaml compose.yaml   # 템플릿 복사
# compose.yaml의 environment에 실제 API 키 입력 (compose.yaml은 gitignore 대상)
docker compose up --build
```

접속: 브라우저에서 `http://localhost:7681` → **user=`pi`**, **token=`$TTYD_TOKEN`**
(`TTYD_TOKEN` 미설정 시 시작 로그에 자동 생성 토큰이 출력된다).

## 웹챗 (Phase 3 — WEB-APP-DESIGN.md)

ttyd 대신 브라우저 챗 UI를 쓰려면 `compose.yaml`에서 주석 해제:

```yaml
ports:
  - "8080:8080"
environment:
  PI_WEB: "1"
```

```bash
docker compose up --build
```

접속: 브라우저에서 `http://localhost:8080`

- 웹앱은 pi-web-chat(SDK 기반 AgentSessionRuntime, WebSocket) 소스 벤더링 — 자세한 내용은 아래
  "웹챗 (Phase 3 — pi-web-chat 소스 벤더링)" 섹션과 [`web/UPSTREAM.md`](web/UPSTREAM.md).
- `PI_DEFAULT_MODEL`/`PI_DEFAULT_THINKING` env는 SDK가 모델 기본값으로 사용한다.
- 세션은 pi CLI와 공유 (`PI_CODING_AGENT_DIR` 기반, 채팅 cwd=`/workspace` — 에페메럴).
- ⚠️ **웹챗에는 인증이 없다** (HOST=0.0.0.0 바인딩) — 외부 노출 시 토큰 인증 프록시(3c) 필요.

## 환경 변수 (키 주입 계약 — 설계 §5)

| 변수 | 서비스 | 필수 |
|---|---|---|
| `ANTHROPIC_API_KEY` | LLM 프로바이더 | ✅ |
| `KIS_APP_KEY` / `KIS_APP_SECRET` | 한국투자증권 실전 | 선택 |
| `KIS_PAPER_APP_KEY` / `KIS_PAPER_APP_SECRET` | 한국투자증권 모의 | 선택 |
| `TOSS_CLIENT_ID` / `TOSS_CLIENT_SECRET` | 토스증권 | 선택 |
| `TWELVE_API_KEY` | Twelve Data | 선택 |
| `FINNHUB_API_KEY` | Finnhub | 선택 |
| `COINGECKO_API_KEY` | CoinGecko | 선택 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 뉴스 검색 | 선택 |
| `PI_DEFAULT_MODEL` | 기본 모델 (`provider/id`, `pi --list-models`로 확인) | 선택 |
| `PI_DEFAULT_THINKING` | 기본 thinking (`off/minimal/low/medium/high/xhigh/max`) | 선택 |
| `TTYD_TOKEN` | 웹터미널 basic-auth | 권장 (미설정 시 자동 생성) |

키는 compose.yaml의 `environment:` 또는 `docker run -e`로 주입되며 **이미지에 bake되지 않고
컨테이너 종료 시 소멸**한다. 참고: `compose.example.yaml`이 템플릿 (키 없음, 커밋 유지),
`compose.yaml`이 실키 파일 (gitignore 대상).

모델/thinking도 키와 한 세트로 지정한다 — `PI_DEFAULT_MODEL`은 `--model` 플래그로,
`PI_DEFAULT_THINKING`은 `--thinking` 플래그로 전달되며, TUI 안에서 `/model`로 언제든 변경 가능:

## 웹챗 (Phase 3 — pi-web-chat 소스 벤더링)

`PI_WEB=1`이면 ttyd 대신 브라우저 챗 UI(`http://localhost:8080`)가 뜬다.
웹앱은 [pi-web-chat](https://github.com/preinpost/pi-web-chat) (MIT, v0.1.19) 소스를
`containers/web/`에 벤더링해 사용한다 — 자체 server.mjs/React 구현은 폐기. 동기화·로컬 적응 내역은
[`containers/web/UPSTREAM.md`](web/UPSTREAM.md) 참고.

```bash
# compose.yaml에서 아래 주석 해제 후
#   - "8080:8080"   PI_WEB: "1"
cd containers && docker compose up -d --build
# → http://localhost:8080 (챗/세션 드로어/모델·확장 설정/리포트)
```

**주요 기능** (pi-web-chat): 세션 드로어·`/s/:id` URL 공유 (pi CLI와 세션 공유 —
`PI_CODING_AGENT_DIR` 기반, 같은 cwd의 pi CLI 세션이 목록에 표시됨), 모델/커스텀 프로바이더
관리, thinking 레벨, 확장(extension) 정보, 포크, 마크다운 렌더링, i18n·테마·PWA·모바일 지원.
컨테이너 로컬 적응으로 금융 템플릿 버튼(일일 리포트/딥다이브/섹터 스크리닝)이 입력창 위에 표시된다.

**개발 워크플로 (HMR)**: `containers/web`은 독립 npm 프로젝트 (pnpm 워크스페이스와 무관).

```bash
cd containers/web && npm install
npm run dev        # 서버(:3141) + Vite(:5173, /api·/ws 프록시) 동시 실행
# → http://localhost:5173
```

```bash
npm run typecheck  # tsc --noEmit
npm run build      # vite(프론트) + esbuild(서버) → dist/
```

**환경변수**: `PORT`(기본 3141), `HOST`(기본 127.0.0.1 — 컨테이너는 0.0.0.0),
`PI_WEB_CWD`(채팅 작업 디렉터리 — 컨테이너는 `/workspace`), `PI_WEB_TEMPLATES_DIR`(금융 템플릿
경로 — 컨테이너는 `/opt/pi-web/templates`). 빌드 산출물(dist)은 Dockerfile의 `web-build`
스테이지에서 생성되고, 런타임 의존성(`@earendil-works/pi-coding-agent`, `ws`)만
`npm ci --omit=dev`로 설치된다.

## 헤드리스 (배치 리포트)

동일 이미지를 cron/CI에서 배치 분석에 사용할 수 있다:

```bash
docker run --rm -e ANTHROPIC_API_KEY=... -e KIS_APP_KEY=... -e KIS_APP_SECRET=... \
  -e PI_HEADLESS=1 pi-finance:latest \
  "삼성전자 일일 리포트 작성해줘"
# 또는 표준입력: echo "..." | docker run --rm -e PI_HEADLESS=1 ...
```

## 보안 노트 (설계 §8)

- 키는 빌드 타임 bake 금지, 런타임 env만. 로그에 키를 출력하지 말 것.
- 파드는 에페메럴 — 키·스토어 파일·세션은 컨테이너와 함께 소멸 (기본 모델).
- 세션/리포트만 보존하려면 compose의 주석 처리된 `volumes` 참고.
  **키 파일(`/opt/pi-agent/*-keys.json`)은 절대 볼륨에 두지 말 것.**
- 웹터미널 포트를 외부에 노출할 때는 반드시 TLS + 토큰 인증을 붙일 것.
- 엔트리포인트가 시작 시 `/opt/pi-agent/*-keys.json`을 제거한다
  (env 키 우선 보장 — 스토어 파일 값이 env보다 우선하는 `file ?? env` 구조 때문).

## 동작 모드

| 모드 | 동작 |
|---|---|
| 기본 | `ttyd -W -p 7681 -c pi:$TTYD_TOKEN -- pi` — 웹터미널로 pi TUI |
| `PI_HEADLESS=1` | `pi -p --mode json "$@"` — 비인터랙티브 배치 (trust 프롬프트 없음) |

## 개발 메모

- 빌드 컨텍스트는 `containers/` (Dockerfile·agent-config·entrypoint가 전부 여기).
- `packages/*`(pnpm 워크스페이스)와 무관 — 별도 이미지 빌드 단위.
- `agent-config/prompts/`는 pi 글로벌 프롬프트 템플릿(`~/.pi/agent/prompts/`)으로
  복사되며, 컨테이너 안에서는 `/opt/pi-agent/prompts/` → `/daily-report` 등으로 호출.
- 이미지 빌드 검증: `docker build -t pi-finance containers/`
  (빌드 중 `pi install`이 네트워크로 npm 패키지를 받는다).
