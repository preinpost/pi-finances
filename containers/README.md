# pi-finance-agent 컨테이너

pi 에이전트 하네스 + pi-finances 금융 패키지를 묶은 **금융분석 전용 컨테이너**.
브라우저 웹터미널(ttyd)로 pi TUI에 접속해 인터랙티브 금융분석을 수행한다.
설계 문서: 루트 `CONTAINER-DESIGN.md`.

## 포함 구성

| 구성 | 내용 |
|---|---|
| 하네스 | `@earendil-works/pi-coding-agent` (pi CLI) |
| 패키지 | pi-kis, pi-toss, pi-twelve-data, pi-finnhub, pi-coingecko, pi-naver-news (+ core 자동 번들) |
| 스킬 | kis-trading, kis-stock-research, kis-sector-research, kis-timing |
| 설정 | `agent-config/AGENTS.md`(전역 지침), `APPEND_SYSTEM.md`(금융 persona), `prompts/`(템플릿 3종) |
| 웹터미널 | ttyd (포트 7681, basic-auth 토큰) |

## 빌드 & 실행

```bash
cd containers
cp compose.example.yaml compose.yaml   # 템플릿 복사
# compose.yaml의 environment에 실제 API 키 입력 (compose.yaml은 gitignore 대상)
docker compose up --build
```

접속: 브라우저에서 `http://localhost:7681` → **user=`pi`**, **token=`$TTYD_TOKEN`**
(`TTYD_TOKEN` 미설정 시 시작 로그에 자동 생성 토큰이 출력된다).

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
| `TTYD_TOKEN` | 웹터미널 basic-auth | 권장 (미설정 시 자동 생성) |

키는 compose.yaml의 `environment:` 또는 `docker run -e`로 주입되며 **이미지에 bake되지 않고
컨테이너 종료 시 소멸**한다. 참고: `compose.example.yaml`이 템플릿 (키 없음, 커밋 유지),
`compose.yaml`이 실키 파일 (gitignore 대상).

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
