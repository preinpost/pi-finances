# pi 금융분석 에이전트 컨테이너 설계 (review 대상)

> pi 에이전트 하네스 + pi-finances 패키지를 묶은 **금융분석 전용 컨테이너** 설계.
> 브라우저에서 API 키를 입력하면 파드가 뜨고, 웹터미널(이후 커스텀 웹챗)로
> 에이전트와 인터랙티브하게 금융분석을 수행하는 모델.
> 코드 사실 검증 기반: `packages/*/src/{auth,secret,store}.ts`, pi `docs/containerization.md`,
> `docs/rpc.md`, `docs/environment-variables.md`.

## 1. 목표 / 비목표

**목표**
- pi 하네스 + 7개 금융 패키지(pi-kis/toss/twelve-data/finnhub/coingecko/naver-news) +
  금융분석 스킬(kis-trading/stock-research/sector-research/timing)이 **이미지에 bake**된
  컨테이너 이미지 1개.
- pod-per-user 세션 모델: 브라우저 폼 → 키 env 주입 → 파드 스핀업 → 웹 인터랙션.
- 파드 생명주기 = 세션 생명주기 (에페메럴 기본, 키는 파드와 함께 소멸 = 보안상 유리).
- 로컬(MVP)은 `docker compose`, 운영은 k8s 배포 가능한 동일 이미지.

**비목표 (v1)**
- 멀티테넌트 SaaS (세션당 파드 1개 — 동시성은 파드 수로 해결).
- 키 영구 저장/관리 UI (키는 요청마다 입력, 에페메럴).
- 커스텀 웹챗 UI (Phase 3 로드맵, v1은 웹터미널).

## 2. 사용자 시나리오

```
1. 브라우저에서 세션 생성 폼에 키 입력
   (ANTHROPIC_API_KEY + 선택: KIS/Toss/Twelve/Finnhub/CoinGecko/Naver 키)
2. 백엔드가 파드 스핀업 — 키는 env/Secret으로 주입 (로그에 절대 노출 금지)
3. 사용자는 웹터미널(https://<pod>/terminal?token=...)로 접속
4. pi TUI가 그대로 동작 — "삼성전자 기술적 분석 해줘" 같은 금융분석 대화
5. 세션 종료(파드 삭제) → 키·파일·세션 소멸 (세션 볼륨은 옵션)
```

## 3. 아키텍처

```
┌──────────┐   HTTPS    ┌───────────────────────── pod ─────────────────────────┐
│ Browser  │◄─────────►│  ┌────────┐   pty    ┌───────────────┐                 │
│ (xterm)  │            │  │ ttyd   │◄────────│ pi (TUI)      │                 │
└──────────┘            │  │ :7681  │  (pi)   │  ├ kis_* toss_*│  env 주입:     │
   │                    │  └───┬────┘         │  ├ broker_*    │  KIS_APP_KEY,  │
   ▼ (폼)               │      │ basic-auth   │  ├ twelve_* ...│  TOSS_CLIENT_* │
┌──────────┐            │      │ (토큰)       │  └───────────────┘  ANTHROPIC_* │
│ 백엔드    │──env──────►│  agent dir: /opt/pi-agent (PI_CODING_AGENT_DIR)       │
│ (파드생성)│            │   ├ packages/* (이미지 bake)                          │
└──────────┘            │   └ sessions/  (옵션 볼륨)                            │
                        └──────────────────────────────────────────────────────┘
                                        │ outbound HTTPS/WS only
                                        ▼
                    KIS/Toss/NAVER API · LLM provider · market data APIs
```

핵심 설계 결정:

1. **웹터미널(ttyd)이 v1 인터페이스** — pi TUI(권한 팝업·plan mode·`/명령어`)를 그대로 살리는
   최소비용 경로. RPC 웹챗은 Phase 3.
2. **모든 금융 키는 env 폴백으로 주입** — 코드 검증 완료: KIS `auth.ts`가 `file.appKey ?? env.KIS_APP_KEY`
   패턴, Toss/Twelve/Finnhub/CoinGecko/Naver 전부 env 폴백 존재 (§5 테이블).
   → 엔트리포인트가 시크릿 스토어 파일을 쓰는 스크립트가 **불필요**.
3. **`KIS_SECRET_STORE=file` 이미지에서 강제** — 컨테이너에 keyring(Secret Service)이 없으므로
   적응형 스토어의 probe/degrade 왕복을 아예 생략, 결정적 동작.
4. **`KIS_KEYS_FILE`은 사용하지 않음** — 단일 경로를 모든 네임스페이스가 공유하는 구조라
   (각 패키지 `secret.ts`의 `keysFileEnv: "KIS_KEYS_FILE"`) 다중 패키지 키가 서로 덮어쓸 위험.
   기본 경로(`~/.pi/agent/{namespace}-keys.json`)를 에페메럴로 두는 게 안전.
5. **에이전트 디렉터리를 `PI_CODING_AGENT_DIR=/opt/pi-agent`로 재배치** — HOME과 무관하게
   고정 경로 → 빌드 시 패키지 설치, 런타임 non-root 동작이 깔끔해짐.
   (pi `environment-variables.md`에서 확인된 공식 오버라이드, 호스트 PoC + 컨테이너 빌드로 검증 완료)
6. **non-root 유저는 uid 1001** — `node:24` 이미지에 uid 1000(node 유저)이 이미 존재
   (컨테이너 빌드 검증 중 발견: `useradd -u 1000` → "UID is not unique").
   `USER` 지시문도 반드시 1001로 일치시켜야 함 (1000으로 두면 node 유저로 실행돼
   에이전트 디렉터리 권한 거부 — 실제 빌드에서 발견).

## 4. 이미지 설계

### 4.1 Dockerfile 레이어 (안)

```dockerfile
FROM node:24-bookworm-slim

# pi 공식 컨테이너화 문서(Dockerfile.pi) 기반 + tzdata/ttyd 추가
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates git ripgrep tzdata ttyd \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g --ignore-scripts @earendil-works/pi-coding-agent

ENV TZ=Asia/Seoul \
    PI_CODING_AGENT_DIR=/opt/pi-agent \
    KIS_SECRET_STORE=file \
    PI_CODING_AGENT_HOME=/home/pi   # (실제 변수명은 pi docs 확인 — HOME=/home/pi로 대체 가능)

# 금융 패키지 설치 (빌드 타임, 유저 스코프 → /opt/pi-agent)
RUN pi install npm:pi-kis npm:pi-toss npm:pi-twelve-data \
               npm:pi-finnhub npm:pi-coingecko npm:pi-naver-news

# 금융분석 포커스 설정 (§4.2)
COPY agent-config/ /opt/pi-agent/

RUN useradd -m -u 1000 pi && chown -R pi:pi /opt/pi-agent /workspace
USER 1000
WORKDIR /workspace
ENTRYPOINT ["docker-entrypoint.sh"]
```

**레이어 주의**: `pi install`은 빌드 타임(캐시됨). 런타임에 `/opt/pi-agent` 전체를 볼륨 마운트하면
패키지가 가려짐 → **에이전트 디렉터리 볼륨 마운트 금지**, 세션만 `sessions/` 하위 마운트.

### 4.2 금융분석 포커스 구성 (이미지에 bake)

| 구성 | 내용 | 근거 |
|---|---|---|
| 패키지 8개 | pi-kis, pi-toss, pi-twelve-data, pi-finnhub, pi-coingecko, pi-naver-news (+core 자동 번들), pi-web-access(외부 — 웹 검색·URL 페치·PDF/유튜브 분석) | 모노레포 README의 설치 목록 + 금융 리서치 보강 |
| 스킬 4개 | kis-trading, kis-stock-research, kis-sector-research, kis-timing | 패키지 번들 스킬, 설치 시 자동 등록 |
| TZ | `Asia/Seoul` | 한국 시장 운영 시간 기준 |
| AGENTS.md | 전역 금융분석 컨벤션 (리포트 형식, 키 미등록 시 안내 멘트, 주의문구) | pi 컨텍스트 파일 메커니즘 |
| APPEND_SYSTEM.md | "금융분석 전문 에이전트" persona 강화 | 시스템 프롬프트 append |
| 프롬프트 템플릿 | "일일 리포트", "종목 딥다이브", "섹터 스크리닝" 등 `/template` | pi prompt-templates |
| 모델 기본값 | `PI_DEFAULT_MODEL`/`PI_DEFAULT_THINKING` env → 엔트리포인트가 `--model`/`--thinking` 플래그로 전달 (TUI `/model`로 변경 가능, pi에 env 기반 기본모델 설정은 없음 — usage.md 옵션 표) | pi CLI 플래그 |

## 5. 키 주입 계약 (코드 검증 테이블)

브라우저 폼 필드명 = env 변수명 (백엔드가 그대로 pod env로 주입):

| 서비스 | env (폼 필드) | env 폴백 근거 (코드) |
|---|---|---|
| LLM provider | `ANTHROPIC_API_KEY` 등 | pi 표준 |
| KIS 실전 | `KIS_APP_KEY` / `KIS_APP_SECRET` | `pi-kis/src/auth.ts:47` `file.appKey ?? env.KIS_APP_KEY` |
| KIS 모의 | `KIS_PAPER_APP_KEY` / `KIS_PAPER_APP_SECRET` | `auth.ts:76` |
| Toss | `TOSS_CLIENT_ID` / `TOSS_CLIENT_SECRET` | `pi-toss/src/secret.ts:40` |
| Twelve Data | `TWELVE_API_KEY` | `pi-twelve-data/src/secret.ts:32` |
| Finnhub | `FINNHUB_API_KEY` | `pi-finnhub/src/agent/commands.ts:53` |
| CoinGecko | `COINGECKO_API_KEY` | `pi-coingecko/src/secret.ts:32` |
| Naver News | `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` (또는 `NCP_APIGW_API_KEY_ID`/`KEY` + `NAVER_NEWS_API_MODE=hub`) | `pi-naver-news/src/secret.ts:52` |

**우선순위 주의**: 시크릿 스토어 파일 값이 env보다 우선(`file ?? env`). 에페메럴 파드에선
스토어 파일이 없으므로 env가 항상 동작. **파드 재사용(볼륨 마운트) 시 스토어 파일이 살아있으면
env가 무시될 수 있음** → 엔트리포인트에서 스토어 파일을 삭제하거나(권장: 에페메럴 기본),
키 주입 시 `rm -f /opt/pi-agent/*-keys.json` 후 시작.

옵션: `KIS_SECRET_STORE`는 이미지에 `file`로 고정 (§3 결정 3) — 사용자가 `/kis-key`로 키를
저장해도 0600 파일로 저장될 뿐, 세션 종료 시 소멸.

## 6. 웹 레이어 (v1: ttyd)

- **선택 근거**: C 싱글 바이너리(~1.3MB 정적), xterm.js 터미널을 브라우저에 그대로 제공,
  pty를 통해 pi TUI 완전 지원. wetty(node) 대비 리소스·공격면 작음.
- **설치원**: bookworm apt에 **미포함**(arm64 빌드 검증, 2026-08-11) → GitHub 공식 릴리스
  정적 바이너리(`tsl0922/ttyd` 1.7.7, x86_64/aarch64)를 `uname -m` 분기로 다운로드.
- **실행**: `ttyd -p 7681 -c <user>:<token> -- pi` — basic auth가 토큰 역할.
  파드 생성 시 토큰 발급 → URL `https://<host>/t/<token>` 형태로 사용자에게 전달.
- **TLS**: 인그레스/리버스 프록시에서 종료 (ttyd 자체 TLS는 비권장 — MVP 로컬은 http).
- **하트비트**: LLM 스트리밍이 길면 웹소켓 타임아웃 가능 → 프록시 ws idle timeout 증가 필요.
- **헤드리스 겸용**: `docker-entrypoint.sh`가 `PI_HEADLESS=1`이면 ttyd 대신
  `exec pi -p --mode json`으로 실행 (배치 리포트용 — 같은 이미지).

## 7. 파드 모델 & 오케스트레이션

- **모델**: pod-per-user, 에페메럴 (키·파일이 파드와 함께 소멸 — 보안상 가장 단순).
  컨트롤러(백엔드)가 폼 → Secret/env → 파드 생성 → URL 반환 → 세션 종료 시 삭제.
- **리소스**: pi는 Node CLI + 외부 API 중심 — `requests: 250m/512Mi`, `limits: 1/2Gi` 정도.
- **네트워크**: 인바운드는 웹 포트(7681)만. 아웃바운드 HTTPS/WS(LLM, KIS, Toss, 데이터 API).
  k8s `NetworkPolicy`로 egress-only 권장. KIS/Toss API는 IP 화이트리스트 불필요
  (appkey/secret 인증 — 키움 eBest와 달리 컨테이너 NAT에서 동작).
- **실시간(WS)**: KIS 실시간체결(H0STCNT0) 등은 파드에서 정상 동작. `/kis-watch` 사용 가능.
- **로컬 MVP**: `containers/compose.yaml` 1서비스 + `-p 7681:7681`. 키는 compose의 env 파일로.

## 8. 보안 설계

1. 키는 빌드 타임 bake 금지, 런타임 env/Secret만. 파드 스펙·로그에 키 미출력 (레드랙트).
2. 브라우저 폼 키는 백엔드 로그·DB에 저장 금지 (에페메럴 전달).
3. 웹 포트는 basic-auth 토큰 + TLS. 토큰은 파드마다 유일, 세션 종료 시 소멸.
4. non-root(uid 1000) 실행, 에이전트 디렉터리 0700/파일 0600 (스토어는 이미 0600 보장).
5. 이미지에 셸·git이 있어 컨테이너 탈출 시 위험 — 파드는 에페메럴+네트워크 제한으로
   영향 반경 축소 (완전 샌드박스는 Gondolin/OpenShell 패턴이 별도 옵션 — pi containerization.md).
6. 세션 볼륨(선택)에 리포트·세션만 보존 — 키 파일은 절대 볼륨에 두지 않음.

## 9. RPC 웹챗 진화 (Phase 3, 설계 방향만)

- 파드당 `pi --mode rpc` 서브프로세스 1개 (JSONL stdin/stdout 프로토콜 — `docs/rpc.md`).
- 백엔드가 `prompt` 명령 → 이벤트 스트림을 브라우저에 SSE/WS로 중계.
- 금융분석 UX: 리포트 카드(종목명·타점·지표), stock-html 스킬의 HTML 리포트 뷰어,
  세션 이력 UI. `steer`/`streamingBehavior`로 중간 개입 가능.
- 권한 승인(예: 주문)은 RPC 권한 이벤트를 UI 버튼으로 연결 (TUI 팝업 대체).
- v1 이미지와 동일 — 엔트리포인트만 `--mode rpc`로 분기하므로 파드 모델 그대로.

## 10. 로드맵

| Phase | 내용 | 산출물 |
|---|---|---|
| 0 | 이미지 빌드 + 로컬 `docker run -it` (웹 없이) 검증 | `containers/Dockerfile`, 엔트리포인트 |
| 1 | ttyd 웹터미널 + 토큰 인증 + 키 env 주입 | compose, 로컬 MVP |
| 2 | 하드닝: non-root, 세션 볼륨 옵션, egress 제한, CI 이미지 빌드 | 보안 체크리스트, 워크플로 |
| 3 | RPC 웹챗 (금융분석 UI) | 웹앱 서브프로젝트 |
| 4 | (선택) k8s: 파드 컨트롤러, Secret 관리, NetworkPolicy | 헬름/매니페스트 |

## 11. 오픈 이슈 (결정 필요)

1. **레포 배치**: `containers/` 디렉터리로 pi-finances에 포함 (모노레포와 설정 공유, npm 워크스페이스 제외)
   vs 별도 레포 (이미지 릴리스 주기 분리). → 모노레포 포함을 기본안으로 제안.
2. **non-root + `PI_CODING_AGENT_DIR` 재배치**가 빌드/런타임 양쪽에서 깨끗한지 PoC 필요
   (pi의 npm 설치 경로 해석이 env를 따르는지 — store.ts는 따름, pi 본체 확인).
3. **토큰 전달 방식**: URL 쿼리 vs 헤더 vs 짧은 만료 인증 링크 (MVP는 URL 토큰).
4. **파드 스핀업 백엔드**: compose(로컬) 이후 k8s 컨트롤러까지 갈지, 아니면
   `docker run` 래퍼 스크립트로 충분한지.
5. **세션 지속성**: 기본 에페메럴 vs 사용자 요청 시 세션 볼륨 (리포트 산출물 보존).
6. **모델 기본값**: 금융분석 워크로드에 맞는 기본 모델/thinking 레벨 고정 여부.
7. **이미지 태그/레지스트리**: `preinpost/pi-finance-agent` + 버전 규칙 (패키지 릴리스와 연동?).

## 부록 — 검증된 사실 (설계 근거)

- pi 공식 Docker 패턴: `docs/containerization.md` — `node:24-bookworm-slim` +
  `npm i -g --ignore-scripts @earendil-works/pi-coding-agent` + git/ripgrep.
- 시크릿 스토어: `pi-finance-core/src/store.ts` — keyring→file 적응형, `KIS_SECRET_STORE=file` 강제 가능,
  파일 0600, `PI_CODING_AGENT_DIR` 지원.
- 키 env 폴백: 위 §5 테이블 (각 패키지 `auth.ts`/`secret.ts` 소스 위치 명기).
- RPC 모드: `docs/rpc.md` — prompt/steer/이벤트 스트림, 세션 옵션, Node 클라이언트 예제.
- pi 비인터랙티브: `-p` / `--mode json` / `--mode rpc` — trust 프롬프트 없음,
  `defaultProjectTrust` 설정으로 제어 (`docs/usage.md`).
