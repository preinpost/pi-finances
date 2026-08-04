# pi-kis

한국투자증권 [OPEN API](https://apiportal.koreainvestment.com/)를 **REST로 직접 호출**하는 pi 패키지입니다.
MCP 서버 프로세스도, GitHub에서 코드를 내려받아 실행하는 방식도 없습니다 — 패키지에 포함된 API 정의(`src/core/generated/apis.json`, 공식 포털 전체 규격 기반 **338개**)와 순수 TypeScript 클라이언트로 동작합니다.

## 설치

```bash
pi install github.com/preinpost/pi-kis
# pi 재시작
```

## 사용

```bash
# pi 안에서:
/kis-key       # API 키 입력창 → OS 키체인 저장 (파일 폴백 시 ~/.pi/agent/kis-keys.json)
/kis-status    # 백엔드/키/토큰/API 수(338: REST 278 + WEBSOCKET 60, alias 164) 진단

# 그 다음 자연어로:
"RKLB 현재가 알려줘"              # kis_overseas_price
"RKLB 1년 일봉으로 52주 고점 계산해줘"  # kis_overseas_chart
"삼성전자 현재가"                  # kis_domestic_price
"삼성전자 최근 3개월 일봉"          # kis_domestic_chart
"삼성전자 재무제표 + 컨센서스"      # kis_research (재무/뉴스/컨센서스)
"화장품 섹터 종목 분석 리포트"      # sector-research 스킬 (섹터 파이프라인)
"삼성전자 리서치 딥다이브"          # stock-research 스킬 (단일 종목 리포트)
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

## 아키텍처 (에이전트 통합 친화적 3계층)

```
index.ts             — thin entry: export default registerExtension (src/agent/extension.ts)
src/
  core/              — transport/protocol (REST·WS·인증·시크릿, 338개 API 스펙)
    client.ts        callApi/buildParams/tr_id/hashkey/페이지네이션
    auth.ts          키·env·토큰 캐시 (parseAccount로 계좌번호 정규화)
    secret.ts        OS 키체인 → 0600 파일 적응형 폴백
    ws.ts            WebSocket 실시간 구독 (approval key 캐시)
    generated/       apis.json(338개) / aliases.json / ws-tr-ids.json
  roles/             — 도메인 역할 (core를 typed wrapper로 확장) — 에이전트가 직접 import
    market.ts        현재가·52주 요약(getDomesticQuoteSummary)·차트·실시간 재수출
    portfolio.ts     잔고/체결/미체결 조회
    research.ts      재무제표(income/ratios)·뉴스·애널리스트 컨센서스
    trading.ts       주문/정정/취소 — prepare/send 2단계 + 검증 API(안전 가드)
    types.ts         공용 타입 (PreparedOrder/PreparedCancel 등)
  agent/             — pi 통합
    extension.ts     registerExtension (마이그레이션 + tools/commands 등록)
    tools.ts         kis_* 8개 툴 (execute는 roles/core 위임, surface 불변)
    commands.ts      /kis-key, /kis-status
```

- **핵심 설계**: `core`는 안정된 transport만 담고, 역할(market/portfolio/research/trading)이 v2 키·tr_id·파라미터를 캡슐화한다.
  자동매매 에이전트는 `roles/trading.ts`를 직접 import해 `prepare*`(요약+검증) → 사용자 확인 → `send*`(실행) 흐름으로 사용한다.
- 주문은 원샷 함수가 아니라 **prepare/send 2단계** — 실전 주문은 사용자 확인 후 `send*`로만 실행한다.

## API 키 체계 (v2)

- 키 형식: `category.api_id` (예: `overseas_stock.v1_해외주식-009`, `domestic_stock.v1_국내주식-001`). 공식 포털
  [API_COLLECTION](https://apiportal.koreainvestment.com/files/download/apiCollection/API_COLLECTION) Excel에서
  `scripts/parse-portal-excel.py`로 생성 (`src/core/generated/apis.json`).
- **구버전 키 호환**: 예전 예제코드 파싱 스펙(164개)의 키(`overseas_stock.price` 등) → v2 키 매핑은
  `src/core/generated/aliases.json` (method + api_path 동일 매칭). `lookupApi`는 v2 키 먼저, 없으면 alias.

## v2 클라이언트 동작 (`src/core/client.ts`)

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
- **레이트 리밋**: core 계층 전역 스로틀 (`src/core/ratelimit.ts`) — env(real/paper)별 최소 호출 간격 **기본 300ms**(주문은 600ms)를 보장해 벌크 조회(섹터 스크리닝·차트 페이징)도 자동 조절됩니다. 초당 호출 제한(EGW00013 등)이 뜨면 **조회 계열만** 800ms→1.6s 백오프로 최대 2회 자동 재시도하고, 주문은 재시도하지 않습니다(중복 주문 방지). `KIS_RATE_LIMIT_MS=0`으로 해제 가능. WebSocket 실시간 구독에는 영향 없음.

## 키 & 토큰 (시크릿 저장소)

**우선순위: OS 키체인 → 0600 파일 폴백** (`src/core/secret.ts`)

| 백엔드 | 대상 OS | 비고 |
|---|---|---|
| `@napi-rs/keyring` | macOS Keychain / Windows Credential Manager / Linux Secret Service | 평문 파일 없음, 로그인 세션 바인딩 |
| 파일 (0600) | 전 OS (헤드리스 폴백) | `~/.pi/agent/kis-keys.json` / `kis-token.json` |

- **마이그레이션**: 키체인 활성 시 기존 평문 파일을 자동으로 키체인으로 옮기고 삭제합니다 (확장 로드 시 1회).
- **적응형 폴백**: 키체인 쓰기가 거부되면(대표: SSH/헤드리스 macOS에서 `Platform failure: User interaction is not allowed` — `errSecInteractionNotAllowed`) 자동으로 0600 파일 백엔드로 전환하고, 키체인에 있던 데이터를 파일로 이관합니다. macOS + SSH 세션은 기본적으로 파일 백엔드를 사용합니다.
- **강제 지정**: `KIS_SECRET_STORE=file` (헤드리스/컨테이너) 또는 `KIS_SECRET_STORE=keyring` (키체인 강제 — 사용 불가 시 에러)
- **의존성**: `@napi-rs/keyring`은 패키지 의존성. npm/git 소스 설치 시 pi가 자동 설치, 로컬 경로 설치 시 패키지 루트에서 `npm install` 1회 실행 필요.
- 키: `/kis-key`로 입력 (입력 다이얼로그). 셸 env(`KIS_APP_KEY` 등)도 fallback.
- 실전 키만으로 시세/차트 조회 가능. 모의 키는 `env: "paper"` 또는 `auto`(모의 키 우선)에 사용.
- 주문/잔고 API는 계좌 정보(htsId, acctStock) 필요 — `/kis-key`에서 선택 등록. 계좌번호는 `12345678-01` 형식도 그대로 입력 가능 (`-01` 상품코드는 자동 분리, `ACNT_PRDT_CD` 기본 `01`).
- 토큰: 키체인/파일에 캐시, 만료(~24h) 시에만 재발급. **토큰 발급 시 알림톡(SMS)이 발송**되므로 캐시를 재사용합니다. 401/토큰 만료 시 자동 재발급 후 1회 재시도.

## API 정의 재생성 (선택)

```bash
# 공식 포털 전체 API 규격 Excel 다운로드:
curl -L -o /tmp/kis_api_collection.xlsx https://apiportal.koreainvestment.com/files/download/apiCollection/API_COLLECTION
cd pi-kis
python3 scripts/parse-portal-excel.py /tmp/kis_api_collection.xlsx src/core/generated/apis.json
```

`src/core/generated/aliases.json`은 구버전 스펙(예제코드 파싱)의 키→v2 키 정적 매핑입니다 (재생성 불필요).

## 실시간 시세 (WebSocket)

- 별도 접속키: `POST {base}/oauth2/Approval` → approval key (24h, 키체인/파일 캐시 — REST 토큰과 별개).
- 접속: `ws://ops.koreainvestment.com:21000` (실전) / `ws://ops.koreainvestment.com:31000` (모의)
- **60개 실시간 API** (`kis_list_apis` → WEBSOCKET kind)의 tr_id는 `src/core/generated/ws-tr-ids.json` (예: H0STCNT0 국내주식 실시간체결가, HDFSCNT0 해외 실시간체결가, H0STASP0 국내주식 실시간호가).
- 데이터는 암호화 전송(encrypt=1) — AES-CBC 복호화 내장.

```
"삼성전자 실시간체결가" → kis_realtime { tr_id: "H0STCNT0", tr_key: "005930" }
"RKLB 실시간체결가"     → kis_realtime { tr_id: "HDFSCNT0", tr_key: "DNASRKLB" }
```

주의: 해외주식 실시간 시세는 유료 구독일 수 있습니다. 구독은 `duration_sec`(기본 10, 최대 60) 후 자동 해제·종료됩니다.

## 주문 API 패턴

주문 전 **가능여부 검증** (모두 GET, 계좌 자동 주입):
- 국내 매수가능: `domestic_stock.v1_국내주식-007` (TTTC8908R)
- 국내 매도가능수량: `domestic_stock.국내주식-165` (TTTC8408R)
- 국내 정정취소가능: `domestic_stock.v1_국내주식-004` (TTTC0084R)
- 해외 매수가능금액: `overseas_stock.v1_해외주식-014` (TTTS3007R)

주문은 다중 TR_ID — `tr_id` 필수 (hashkey 자동 적용):
- 국내 주식주문(현금): `domestic_stock.v1_국내주식-001` (TTTC0011U/TTTC0012U)
- 해외주식 주문: `overseas_stock.v1_해외주식-001` (TTTT1002U 미국 매수 등 12종 — tr_id 미지정 시 목록이 에러로 표시)

## 주의사항

- **해외주식 실시간 시세는 유료 구독일 수 있음** — 일봉/기간별 시세는 무료인 경우가 많습니다.
- 펀더멘털(수주잔고, 매출 등)은 조회 불가 — IR/뉴스에서 확인.
- 주문/잔고 API는 실전에서 신중히, 기본은 조회 위주. 실전 주문은 사용자 확인 후에만.
- 투자 결정은 본인 책임. 본 패키지는 투자 조언을 제공하지 않습니다.

## License

MIT
