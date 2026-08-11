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
| 웹챗 (Phase 3) | `web/server.mjs` + 정적 UI (포트 8080, `PI_WEB=1` — WEB-APP-DESIGN.md) |

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

- 백엔드(`server.mjs`)가 `pi --mode rpc` 서브프로세스를 띄우고 SSE로 중계한다 (제로 npm 의존성).
- `PI_DEFAULT_MODEL`/`PI_DEFAULT_THINKING` env는 그대로 rpc spawn 플래그로 사용된다.
- 3a 상태: 텍스트 스트리밍 챗만 (마크다운/템플릿 버튼/확인 모달은 3b, 인증은 3c).
- 세션은 `/opt/pi-agent/web-sessions`에 저장 (파드 수명 = 세션 수명, 에페메럴).

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

## 웹챗 (Phase 3 — React/TanStack 프론트)

`PI_WEB=1`이면 ttyd 대신 브라우저 챗 UI(`http://localhost:8080`)가 뜬다:

```bash
# compose.yaml에서 아래 주석 해제 후
#   - "8080:8080"   PI_WEB: "1"
cd containers && docker compose up -d --build
# → http://localhost:8080 (챗/설정/리포트 뷰)
```

**개발 워크플로 (HMR)**: 백엔드와 프론트를 분리 실행한다.

```bash
# 터미널 1 — 백엔드 (RPC + SSE + API)
cd containers/web && npm install
PI_WEB_SESSION_DIR=/tmp/web-sess PI_WEB_TEMPLATES_DIR=../agent-config/prompts \
  PI_WEB_STATIC_DIR=dist PI_WEB_WORKSPACE=/tmp/ws PORT=8080 node server.mjs

# 터미널 2 — Vite dev server (포트 5173, /api·/files 프록시 → :8080)
cd containers/web && npm run dev
# → http://localhost:5173
```

프론트 스택: React 19 + Vite + TypeScript + TanStack Query/Router. 빌드 산출물은
Dockerfile의 `web-build` 스테이지에서 생성되어 런타임 이미지에는 node_modules가 없다.

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
