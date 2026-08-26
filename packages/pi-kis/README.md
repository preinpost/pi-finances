# pi-kis

한국투자증권 [OPEN API](https://apiportal.koreainvestment.com/)를 **REST로 직접 호출**하는 pi 패키지입니다.
MCP 서버 프로세스도, GitHub에서 코드를 내려받아 실행하는 방식도 없습니다 — 패키지에 포함된 API 정의(`src/generated/apis.json`, 공식 포털 전체 규격 기반 **338개**)와 순수 TypeScript 클라이언트로 동작합니다.

## 설치

```bash
# npm 레지스트리 (권장) — 배포 버전
pi install npm:pi-kis
# 버전 고정: pi install npm:pi-kis@0.3.0

# 토스증권 툴(toss_*)도 쓰려면 (선택)
pi install npm:pi-toss

# pi 재시작
```

> ⚠️ v0.3.0부터 토스증권은 **pi-toss 패키지로 분리**되었습니다.
> 기존 `pi-kis` 사용자가 toss_* 툴을 유지하려면 `pi install npm:pi-toss`를 추가로 설치하세요
> (키는 `/toss-key`에서 재등록할 필요 없음 — 공용 키 저장소를 그대로 사용).
> 참고: 모노레포로 이전하면서 GitHub git 설치(`pi install git:...`)는 더 이상 지원하지 않습니다 — npm만.

이후 업데이트/제거:

```bash
pi update npm:pi-kis    # 최신 배포 버전으로 업데이트
pi remove npm:pi-kis    # 제거
```

## 사용

```bash
# pi 안에서:
/kis-key       # KIS API 키 입력창 → OS 키체인 저장 (파일 폴백 시 ~/.pi/agent/kis-keys.json)
               #   appKey/appSecret(실전·모의) + 계좌번호 (선택)
/kis-status    # 백엔드/키/토큰/API 수(338: REST 278 + WEBSOCKET 60, alias 164) 진단
               #   (토스 키는 pi-toss 패키지의 /toss-key에서 관리)

# 그 다음 자연어로:
"RKLB 현재가 알려줘"              # kis_overseas_price
"RKLB 1년 일봉으로 52주 고점 계산해줘"  # kis_overseas_chart
"삼성전자 현재가"                  # kis_domestic_price
"삼성전자 최근 3개월 일봉"          # kis_domestic_chart
"삼성전자 재무제표 + 컨센서스"      # kis_research (재무/뉴스/컨센서스)
"삼성전자 매수 타이밍"            # kis_technical (MA/RSI/ATR/볼린저/지지저항/추세)
"화장품 섹터 종목 분석 리포트"      # kis-sector-research 스킬 (섹터 파이프라인)
"삼성전자 리서치 딥다이브"          # kis-stock-research 스킬 (단일 종목 리포트)
"삼성전자 매수/매도 타점"          # kis-timing 스킬 (pi-finance-core 제공 — 공용 차트분석)
```

## 도구

| 도구 | 설명 |
|---|---|
| `kis_api` | 범용 디스패치 — `api`(v2 키), `params`, `env`, `tr_id`(다중 TR_ID API), `pages`(연속조회) |
| `kis_list_apis` | 사용 가능한 API 목록 (카테고리 필터, v2 키 + 웹소켓 tr_id 확인) |
| `kis_realtime` | 실시간 시세 (WebSocket) — `tr_id` + `tr_key` 구독 (예: H0STCNT0/005930, HDFSCNT0/DNASRKLB) |
| `kis_overseas_price` | 해외주식 현재체결가 (`overseas_stock.v1_해외주식-009`, HHDFS00000300) |
| `kis_overseas_chart` | 해외주식 기간별시세 (`overseas_stock.v1_해외주식-010`, HHDFS76240000) |
| `kis_domestic_price` | 국내주식 현재가 (`domestic_stock.v1_국내주식-008`, FHKST01010100) |
| `kis_domestic_chart` | 국내주식 기간별시세 (`domestic_stock.v1_국내주식-016`, FHKST03010100) |
| `kis_research` | 주식 리서치 — 재무제표/뉴스/컨센서스 (`kind: income\|ratios\|news\|consensus`, `symb`) |
| `kis_technical` | 기술적 분석(타점) — MA/RSI/ATR/볼린저/지지저항/추세 (`market`, `symb`, `period`) |
| `kis_derivatives` | 해외 선물/옵션 — 종목코드(SRS_CD) 단위 시세/상품정보/분봉/장운영시간 + **option-greeks**(IV 역산 → Black-Scholes 델타/감마/세타/베가/로) |
| `broker_price` | 현재가 (KIS 우선 + **fallback 툴 콜 폴백**) — 국내 6자리/해외 티커. KIS 미지원/실패 시 `fallback: { func, tools, args, why }` 지시 — tools에 설치된 `*_price` 후보를 찾아 툴 콜 |
| `broker_chart` | 차트·지표 (KIS 우선 + **fallback 툴 콜 폴백**) — D/W/M/1d(KIS), 1m(KIS 미지원). KIS 미지원/실패 시 `fallback` 지시 — tools에 설치된 `*_chart` 후보를 찾아 툴 콜 |
| `broker_chart_card` | 채팅용 캔들 차트 카드 — 시세는 툴이 직접 조회. LLM에는 요약만, `details.kind=chart-card`로 웹챗이 렌더. 분석 숫자는 `broker_chart` / `kis_technical` |

토스증권 툴(`toss_price`/`toss_chart`/`toss_market`/`toss_balance`/`toss_order`/`toss_orders`/`toss_conditional`)은
[pi-toss](https://github.com/preinpost/pi-finances/tree/main/packages/pi-toss) 패키지에서 제공합니다.

## 브로커 폴백 (KIS 우선 → fallback 툴 콜)

- `broker_*` 툴은 KIS 우선이고, KIS가 불가능하면(키 미등록·실패·유료 시세 미구독 빈 응답) **코드로 다른 브로커를 호출하지 않고**,
  응답에 **구조화된 폴백 지시**를 담아 반환한다: `fallback: { func, tools, args, why }`.
- **prefix_name 규칙의 suffix 발견**: 동일 기능 툴은 같은 함수명 suffix를 공유하므로(toss_price/twelve_price/finnhub_price),
  `pi.getAllTools()`에서 `*_{func}` 툴을 찾아 `tools`에 실어준다 (broker_*/kis_* 제외).
- 에이전트는 `tools` 후보 중 하나를 **그대로 툴 콜로 수행**한다 (툴 콜 레벨의 느슨한 결합 — pi 패키지 간 코드 의존성 없음).
- 후보 전부 실패면 `why`의 안내를 따른다 (키 등록: `/toss-key` 등, 패키지 설치: `pi install npm:pi-toss` 등).
- 기간 구분: 1m는 *_chart의 1m 지원 툴 전용, W/M은 why가 1d 조정을 안내.
- **계좌·주문·자산은 브로커 간 폴백 불가** — 증권사별 계좌에 묶여 있으므로 `kis_*`/`toss_*` 툴로 명시적으로 선택.

## 에이전트 디버깅 가이드 (툴 발견·파라미터 확인)

`kis_*` 툴은 **MCP가 아닌 네이티브 pi 툴**입니다 — `mcp({ describe / search })` 게이트웨이는
MCP 서버 전용이라 여기서 조회되지 않습니다. 툴은 직접 호출하고, 파라미터·동작은
**세션 툴 스키마 → `src/agent/tools.ts`(입력 검증·에러 원본) → `src/roles/*.ts`(구현)** 순서로 확인하세요.
실전 API는 서버 에러 메시지가 가장 빠른 피드백입니다 (예: 호가 단위·필수값 오류 → 파라미터 교정).

## 아키텍처 (에이전트 통합 친화적 3계층)

```
index.ts             — thin entry: export default registerExtension (src/agent/extension.ts)
src/
  client.ts          transport/protocol (REST·WS·인증·시크릿, 338개 API 스펙)
  auth.ts            키·env·토큰 캐시 (parseAccount로 계좌번호 정규화)
  secret.ts          OS 키체인 → 0600 파일 적응형 폴백 (pi-finance-core 공용 스토어 위)
  ws.ts              WebSocket 실시간 구독 (approval key 캐시)
  ratelimit.ts       전역 레이트 스로틀
  generated/         apis.json(338개) / aliases.json / ws-tr-ids.json
  watch.ts           /kis-watch 엔진 (헤드리스 실시간 감시 CLI)
  roles/             — 도메인 역할 (transport를 typed wrapper로 확장) — 에이전트가 직접 import
    market.ts        현재가·52주 요약(getDomesticQuoteSummary)·차트·실시간 재수출
    broker.ts        KIS 우선 퍼사드 — 시세·차트, 불가 시 toss_* 툴 안내 (에이전트 중재 폴백)
    portfolio.ts     잔고/체결/미체결 조회
    research.ts      재무제표(income/ratios)·뉴스·애널리스트 컨센서스
    greeks.ts        Black-Scholes 그릭스 + IV 역산 (순수 계산 — 해외옵션용)
    derivatives.ts   해외 선물/옵션 파이프라인 (SRS_CD 파싱·시세·상품정보·만기·option-greeks)
    trading.ts       주문/정정/취소 — prepare/send 2단계 + 검증 API(안전 가드)
    types.ts         공용 타입 (PreparedOrder/PreparedCancel 등)
  agent/             — pi 통합
    extension.ts     registerExtension (마이그레이션 + tools/commands 등록)
    tools.ts         kis_* 10 + broker_* 2 툴 (execute는 roles/core 위임)
    commands.ts      /kis-key, /kis-status
```

- **공용 모듈·스킬**: 기술적 지표/시크릿 스토어와 `kis-timing` 스킬(차트분석·타점 — 브로커 중립)은
  [pi-finance-core](https://github.com/preinpost/pi-finances/tree/main/packages/pi-finance-core) 패키지에 있다.
  core는 **번들 의존성**(`bundledDependencies`)으로 tarball에 포함되고, 스킬은
  `node_modules/pi-finance-core/skills` 경로로 로드된다 — 사용자가 직접 설치할 필요 없음.
  등록은 **pi-kis 단독**이 담당한다 (pi-toss는 번들만 유지 — 양쪽이 등록하면 pi가 이름 충돌 경고).

- **핵심 설계**: `core`는 안정된 transport만 담고, 역할(market/portfolio/research/trading)이 v2 키·tr_id·파라미터를 캡슐화한다. (토스 역할은 pi-toss 패키지)
  자동매매 에이전트는 `roles/trading.ts`를 직접 import해 `prepare*`(요약+검증) → 사용자 확인 → `send*`(실행) 흐름으로 사용한다.
- 주문은 원샷 함수가 아니라 **prepare/send 2단계** — 실전 주문은 사용자 확인 후 `send*`로만 실행한다.

## 브로커 비교 (KIS vs Toss — Toss는 pi-toss 패키지)

| 항목 | KIS (pi-kis) | Toss (토스증권) |
|---|---|---|
| 시세 | 국내·해외 현재가/차트(일·주·월) | 현재가/캔들(**일봉·1분봉만**) |
| 리서치 | 338개 API — 재무제표·뉴스·컨센서스·투자자매매동향 | 제한적 — 투자자별 매매대금(지수), 랭킹, 종목경고 |
| 실시간 | WebSocket (체결가/호가/체결통보) | 없음 (스냅샷·캔들만) |
| 주문 | 국내·해외 주문/정정/취소 (hashkey) | 주문/정정/취소 + **조건주문(SINGLE/OCO/OTO)** |
| 수수료 | API로 조회 없음 | 수수료율 조회 (`toss_balance`) |
| 장운영 | API로 조회 없음 | KR·US 장운영시간·환율 (`toss_market`) |
| 인증 | 토큰 24h + 알림톡, appKey/secret | OAuth2, client_id/secret |
| 모의투자 | paper 지원 | 실전 전용 |
| 레이트리밋 | 전역 300ms(조회)/600ms(주문) | 그룹별 (ACCOUNT 1/s ~ MARKET_DATA 10/s) |

> **활용**: 시세·차트는 어느 브로커든 동일하므로 KIS 우선. 토스는 **비겹침 데이터**(조건주문·수수료·장운영시간·환율·랭킹·종목경고·투자자별 매매대금)로 인사이트를 보강한다. (토스 툴은 pi-toss 패키지 설치 필요)

## API 키 체계 (v2)

- 키 형식: `category.api_id` (예: `overseas_stock.v1_해외주식-009`, `domestic_stock.v1_국내주식-001`). 공식 포털
  [API_COLLECTION](https://apiportal.koreainvestment.com/files/download/apiCollection/API_COLLECTION) Excel에서
  `scripts/parse-portal-excel.py`로 생성 (`src/generated/apis.json`).
- **구버전 키 호환**: 예전 예제코드 파싱 스펙(164개)의 키(`overseas_stock.price` 등) → v2 키 매핑은
  `src/generated/aliases.json` (method + api_path 동일 매칭). `lookupApi`는 v2 키 먼저, 없으면 alias.

## v2 클라이언트 동작 (`src/client.ts`)

- **tr_id 선택**: env에 따라 `tr_id_real[0]`/`tr_id_paper[0]` 자동 선택. **다중 TR_ID API**(배열 길이>1 또는
  `headers.tr_id.desc`에 라벨 목록 존재 — 해외주식 주문은 12개 라벨)는 `tr_id` 파라미터 필수. desc의
  "TRID : 한글라벨"을 파싱해 선택 목록을 제공하고, 목록에 없는 tr_id는 에러.
- **hashkey**: POST 주문/정정/취소 계열(`/trading/` 경로)에 자동 적용. `POST {base}/uapi/hashkey`
  (content-type/appkey/appsecret 헤더만, authorization 불필요) → `HASH` → 요청 헤더 `hashkey` 추가.
  발급 실패 시 hashkey 없이 진행하지 않고 에러 (안전 우선).
- **파라미터 자동 주입**: GET→query, POST→body. AUTH→`""`, CANO→등록 계좌, ACNT_PRDT_CD→`"01"`,
  custtype 헤더→`"P"`, CTX_AREA_*→`""`(연속조회). 사용자 params는 소문자/대문자 키 모두 허용(대문자 우선),
  required 누락 시 누락 목록 에러, 스펙에 없는 파라미터는 무시.
- **WEBSOCKET API**: `kis_api` 호출 시 "websocket 전용, REST 호출 불가" 에러.
- **tr_cont 페이지네이션**: `pages`(기본 1, 최대 10). 응답 body의 `ctx_area_nk100/fk100`(→nk200/fk200→nk50/fk50)을
  다음 요청 query로 에코, 응답 헤더 `tr_cont`가 D/E 또는 ctx 키가 없으면 종료, output 배열 병합.
- **인증**: 401/토큰 만료 시 캐시 클리어 후 토큰 재발급 + 1회 재시도 (토큰 발급 시 알림톡 발송).
- **레이트 리밋**: core 계층 전역 스로틀 (`src/ratelimit.ts`) — env(real/paper)별 최소 호출 간격 **기본 300ms**(주문은 600ms)를 보장해 벌크 조회(섹터 스크리닝·차트 페이징)도 자동 조절됩니다. 초당 호출 제한(EGW00013 등)이 뜨면 **조회 계열만** 800ms→1.6s 백오프로 최대 2회 자동 재시도하고, 주문은 재시도하지 않습니다(중복 주문 방지). `KIS_RATE_LIMIT_MS=0`으로 해제 가능. WebSocket 실시간 구독에는 영향 없음.

## 키 & 토큰 (시크릿 저장소)

**우선순위: OS 키체인 → 0600 파일 폴백** (`src/secret.ts`)

| 백엔드 | 대상 OS | 비고 |
|---|---|---|
| `@napi-rs/keyring` | macOS Keychain / Windows Credential Manager / Linux Secret Service | 평문 파일 없음, 로그인 세션 바인딩 |
| 파일 (0600) | 전 OS (헤드리스 폴백) | `~/.pi/agent/kis-keys.json` / `kis-token.json` |

- **마이그레이션**: 키체인 활성 시 기존 평문 파일을 자동으로 키체인으로 옮기고 삭제합니다 (확장 로드 시 1회).
- **적응형 폴백**: 키체인 쓰기가 거부되면(대표: SSH/헤드리스 macOS에서 `Platform failure: User interaction is not allowed` — `errSecInteractionNotAllowed`) 자동으로 0600 파일 백엔드로 전환하고, 키체인에 있던 데이터를 파일로 이관합니다. macOS + SSH 세션은 기본적으로 파일 백엔드를 사용합니다.
- **강제 지정**: `KIS_SECRET_STORE=file` (헤드리스/컨테이너) 또는 `KIS_SECRET_STORE=keyring` (키체인 강제 — 사용 불가 시 에러)
- **의존성**: `pi-finance-core`(공용) + `@napi-rs/keyring`(core 내). npm 소스 설치 시 pi가 자동 설치, 로컬 경로 설치 시 패키지 루트에서 `npm install`(pnpm 워크스페이스는 루트에서 `pnpm install`) 1회 실행 필요.
- 키: `/kis-key`로 입력 (입력 다이얼로그). 셸 env(`KIS_APP_KEY` 등)도 fallback.
- 실전 키만으로 시세/차트 조회 가능. 모의 키는 `env: "paper"` 또는 `auto`(모의 키 우선)에 사용.
- 주문/잔고 API는 계좌 정보(acctStock) 필요 — `/kis-key`에서 선택 등록. `12345678-01` 형식도 그대로 입력 가능 (상품코드 `-01`은 자동 분리, `ACNT_PRDT_CD` 기본 `01`).
- 토큰: 키체인/파일에 캐시, 만료(~24h) 시에만 재발급. **토큰 발급 시 알림톡(SMS)이 발송**되므로 캐시를 재사용합니다. 401/토큰 만료 시 자동 재발급 후 1회 재시도.

## API 정의 재생성 (선택)

```bash
# 공식 포털 전체 API 규격 Excel 다운로드:
curl -L -o /tmp/kis_api_collection.xlsx https://apiportal.koreainvestment.com/files/download/apiCollection/API_COLLECTION
cd pi-kis
python3 scripts/parse-portal-excel.py /tmp/kis_api_collection.xlsx src/generated/apis.json
```

`src/generated/aliases.json`은 구버전 스펙(예제코드 파싱)의 키→v2 키 정적 매핑입니다 (재생성 불필요).

## 실시간 시세 (WebSocket)

- 별도 접속키: `POST {base}/oauth2/Approval` → approval key (24h, 키체인/파일 캐시 — REST 토큰과 별개).
- 접속: `ws://ops.koreainvestment.com:21000` (실전) / `ws://ops.koreainvestment.com:31000` (모의)
- **60개 실시간 API** (`kis_list_apis` → WEBSOCKET kind)의 tr_id는 `src/generated/ws-tr-ids.json` (예: H0STCNT0 국내주식 실시간체결가, HDFSCNT0 해외 실시간체결가, H0STASP0 국내주식 실시간호가).
- 데이터는 암호화 전송(encrypt=1) — AES-CBC 복호화 내장.

```
"삼성전자 실시간체결가" → kis_realtime { tr_id: "H0STCNT0", tr_key: "005930" }
"RKLB 실시간체결가"     → kis_realtime { tr_id: "HDFSCNT0", tr_key: "DNASRKLB" }
```

주의: 해외주식 실시간 시세는 유료 구독일 수 있습니다. 구독은 `duration_sec`(기본 10, 최대 60) 후 자동 해제·종료됩니다.

## 실시간 감시 (워치) — subagent 불필요

`kis_realtime`은 일회성(최대 60초)이라 지속 감시가 안 되므로, 패키지에 **실시간 워치**(`src/watch.ts`)를 내장했습니다. 실시간 체결가를 계속 listen → 조건 충족 시 알림(선택: 사전 승인 주문)을 보냅니다.

```bash
# pi 안에서 (기본: 이 세션의 백그라운드 워치 — 조건 충족 시 에이전트(채팅)로 알림)
/kis-watch start --symbols "DNYSORCL,below,144.5;DNASOLED,above,90" [--once] [--max-minutes 480]
/kis-watch status        # 종목별 last·트리거 상태
/kis-watch stop

# 세션과 무관하게 계속 돌게 하려면 (독립 프로세스, OS 알림/로그):
/kis-watch start --detach --symbols "DNYSORCL,below,144.5"
```

- **모드**: 기본은 **세션 내 워치** — pi 세션이 켜져 있는 동안 백그라운드로 listen하고 트리거 시 `ctx.ui.notify`로 그 세션(에이전트)에 알림 (subagent 불필요, 데스크톱 알림 불필요). `--detach`는 독립 프로세스(macOS osascript / Linux notify-send / 그 외 로그·상태파일) — 세션을 닫아도 계속 동작, 재부팅 시 재시작 필요
- **조건**: `above`(이상 도달) / `below`(이하 도달) / `chgPct`(기준가 대비 ±% — `--ref "DNYSORCL,150"`로 기준가, 미지정 시 첫 수신가 자동)
- **종목 형식**: 해외 `D+시장3자리+종목`(예: `DNYSORCL`, `DNASOLED`), 국내 6자리(예: `005930`)
- **상태**: 상태파일 `~/.pi/agent/kis-watch.json` — `pid/mode/종목별 last·triggered/lastError`
- **사전 승인 주문(선택)**: `--order "DNYSORCL,SELL,2"` — 조건 충족 시 KIS 해외 시장가 주문 1회 실행 (시작 시 사용자 확인 필수, `SLL_TYPE`/tr_id 자동, 멱등)
- **한계**: 세션 내 모드는 pi 세션 종료 시 함께 종료(`session_shutdown` 정리). 국내/해외 실시간 시세는 각각 유료 구독일 수 있습니다.

## 주문 API 패턴

주문 전 **가능여부 검증** (모두 GET, 계좌 자동 주입):
- 국내 매수가능: `domestic_stock.v1_국내주식-007` (TTTC8908R)
- 국내 매도가능수량: `domestic_stock.국내주식-165` (TTTC8408R)
- 국내 정정취소가능: `domestic_stock.v1_국내주식-004` (TTTC0084R)
- 해외 매수가능금액: `overseas_stock.v1_해외주식-014` (TTTS3007R)

주문은 다중 TR_ID — `tr_id` 필수 (hashkey 자동 적용):
- 국내 주식주문(현금): `domestic_stock.v1_국내주식-001` (TTTC0011U/TTTC0012U)
- 해외주식 주문: `overseas_stock.v1_해외주식-001` (TTTT1002U 미국 매수 등 12종 — tr_id 미지정 시 목록이 에러로 표시)

## 해외 선물/옵션 (파생상품)

해외는 **월물 전광판 API가 없어 종목코드(SRS_CD) 단위**로 조회한다 (`kis_derivatives` 툴 또는 `roles/derivatives.ts`):

- 선물 코드: `ESU24`, `CNHU24`, `6EU24` (제품 + 월코드 F=1월...Z=12월 + 연도 2자리)
- 옵션 코드: `OESU24 C5500` = O + 기초선물코드 + **C(콜)/P(풋)** + 행사가
- **option-greeks**: 옵션 시장가 + 기초선물가 + 행사가 + 만기(상품정보 `expr_date` 우선, 없으면 셋째 금요일 근사)로 IV를 역산하고 Black-Scholes 델타/감마/세타/베가/로를 계산 (무위험금리 기본 4% 가정, `notes`에 명시)
- 국내(KOSPI200 등)는 옵션 전광판이 **그릭스·IV를 직접 제공** — `domestic_futureoption.국내선물-022` 조회로 충분 (계산 불필요)
- ⚠️ **CME/SGX 등 해외 파생 시세는 유료 구독** 필요할 수 있으며, 레버리지 상품이라 주문 시 안전 점검 필수

## 주의사항

- **해외주식 실시간 시세는 유료 구독일 수 있음** — 일봉/기간별 시세는 무료인 경우가 많습니다.
- 펀더멘털(수주잔고, 매출 등)은 조회 불가 — IR/뉴스에서 확인.
- 주문/잔고 API는 실전에서 신중히, 기본은 조회 위주. 실전 주문은 사용자 확인 후에만.
- 투자 결정은 본인 책임. 본 패키지는 투자 조언을 제공하지 않습니다.

## License

MIT
