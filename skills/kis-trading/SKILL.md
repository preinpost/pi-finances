---
name: kis-trading
description: 한국투자증권 OPEN API로 국내외 주식 데이터를 조회·주문하는 방법. pi-kis-trading 패키지가 설치되어 있고 사용자가 "주가", "현재가", "차트", "시세", "52주 고점", "거래량 순위", "주문" 등 국내외 주식 요청 시, 이 스킬의 지침대로 kis_* 도구를 사용한다. 키 미등록 시 /kis-key 안내.
---

# KIS Trading (pi-kis-trading, v2)

한국투자증권 OPEN API를 REST로 직접 호출합니다 (MCP 서버 불필요). 공식 포털
(apiportal.koreainvestment.com) 전체 API 규격 기반 **338개 API**를 지원합니다.

## 사전 조건

- `pi install /Users/ms/dev/pi/pi-kis-trading` 후 pi 재시작 (로컬 경로 설치 시 패키지 루트에서 `npm install` 1회)
- 키 등록: `/kis-key` (실전 최소. 모의·계좌는 선택) — OS 키체인 저장, 헤드리스 환경은 0600 파일 폴백
- 상태 확인: `/kis-status` (백엔드/키/토큰 캐시/API 수: REST 278 + WEBSOCKET 60 + alias 164)
- 키 미등록 시 도구는 `{ "ok": false, "error": "KIS real API keys missing..." }`를 반환 → 사용자에게 `/kis-key` 안내

## API 키 체계 (v2)

- 키 형식: **`category.api_id`** — 예: `overseas_stock.v1_해외주식-009`, `domestic_stock.v1_국내주식-008`
- `kis_list_apis`로 카테고리별 전체 키 확인 (category: domestic_stock / overseas_stock /
  domestic_futureoption / overseas_futureoption / domestic_bond / oauth)
- **구버전 키 호환**: 예전 키(`overseas_stock.price`, `domestic_stock.inquire_price` 등 164개)도
  alias로 동작 (`src/generated/aliases.json`, method+api_path 매칭)

## 도구

| 도구 | 용도 | 주요 인자 |
|---|---|---|
| `kis_overseas_price` | 해외(미국) 현재체결가 | excd(NAS/NYS/AMS), symb(RKLB) |
| `kis_overseas_chart` | 해외 기간별시세(일/주/월) | excd, symb, gubn(0=일,1=주,2=월), bymd(YYYYMMDD), modp(0) |
| `kis_domestic_price` | 국내 현재가 | symb(005930) |
| `kis_domestic_chart` | 국내 기간별시세(일/주/월/년) | symb, period(D/W/M/Y), date1/date2(YYYYMMDD) |
| `kis_api` | 범용 디스패치 | api(v2 키), params, env, tr_id, pages |
| `kis_list_apis` | API 목록 조회 (v2 키 확인) | category(선택) |

## 사용 패턴

- "RKLB 현재가" → `kis_overseas_price { excd: "NAS", symb: "RKLB" }`
- "RKLB 1년 일봉으로 52주 고점/저점 계산" → `kis_overseas_chart { excd: "NAS", symb: "RKLB", gubn: "0", bymd: 오늘 }` → output2 집계 (최대 100행 — 이전 구간은 bymd를 과거로 지정해 추가 호출)
- "삼성전자 현재가" → `kis_domestic_price { symb: "005930" }`
- "삼성전자 최근 3개월 일봉" → `kis_domestic_chart { symb: "005930", period: "D", date1: "...", date2: "..." }` → output2에 시세 목록
- 그 외(지수/환율 차트, 호가, 순위, 잔고, 주문 등) → `kis_list_apis`로 v2 키 확인 후 `kis_api`
  - 예: 해외 거래대금순위 `kis_api { api: "overseas_stock.해외주식-044", params: { excd: "NYS", ... } }` (키는 kis_list_apis로 확인)

## kis_api 파라미터 규칙

- `params`: 스펙 파라미터를 **소문자 이름 또는 대문자 키**로 전달 (대문자 키 우선, 소문자는 대문자로 매핑).
  스펙에 없는 파라미터는 무시, required 누락 시 에러로 누락 목록 표시.
  자동 주입: AUTH→""(GET 시세), CANO→등록 계좌, ACNT_PRDT_CD→"01", custtype 헤더→"P".
- **tr_id**: 단일 TR_ID API는 env에 따라 자동 선택 (real→tr_id_real[0], paper→tr_id_paper[0]).
  **다중 TR_ID API는 `tr_id` 파라미터 필수** — 미지정 시 사용 가능한 tr_id 목록(한글 라벨 포함)이 에러로 표시됨.
- **hashkey**: POST 주문/정정/취소 계열(`/trading/`)은 hashkey 자동 발급·적용 (실주문 안전).
- **pages**: tr_cont 연속조회 페이지 수 (기본 1, 최대 10) — output 배열이 병합됨.
- **WEBSOCKET API는 kis_api로 호출 불가** (에러 반환 — 실시간 데이터는 웹소켓 전용).

## 주문 API 사용 패턴 (국내주식)

주문 전 반드시 **가능여부 검증 API**로 확인 (모두 GET, CANO/ACNT_PRDT_CD 자동 주입 — /kis-key에서 계좌 등록 필요):

| 검증 | v2 키 | tr_id |
|---|---|---|
| 국내 매수가능조회 | `domestic_stock.v1_국내주식-007` | TTTC8908R |
| 국내 매도가능수량조회 | `domestic_stock.국내주식-165` | TTTC8408R |
| 국내 정정취소가능주문조회 | `domestic_stock.v1_국내주식-004` | TTTC0084R |
| 해외 매수가능금액조회 | `overseas_stock.v1_해외주식-014` | TTTS3007R |

주문 (다중 TR_ID — tr_id 필수):
- 국내 주식주문(현금) `domestic_stock.v1_국내주식-001`: tr_id `TTTC0011U`/`TTTC0012U` (라벨은 에러 목록에서 확인)
- 해외주식 주문 `overseas_stock.v1_해외주식-001`: tr_id `TTTT1002U`(미국 매수)/`TTTT1006U`(미국 매도) 등 12종
- 정정/취소는 검증 후: 국내 `domestic_stock.v1_국내주식-003`(TTTC0013U), 해외 `overseas_stock.v1_해외주식-003`(tr_id 필수)

예시 (해외 매수 주문 — 실제 주문이므로 신중히):
```
kis_api { api: "overseas_stock.v1_해외주식-001", tr_id: "TTTT1002U",
  params: { OVRS_EXCG_CD: "NASD", PDNO: "RKLB", ORD_QTY: "10", OVRS_ORD_UNPR: "70.0", ORD_SVR_DVSN_CD: "0", ORD_DVSN: "00" } }
```
hashkey는 자동 발급·적용됩니다. **실전 주문은 사용자 확인 후에만** 수행하세요.

## 응답 해석

- `rt_cd == "0"` → 성공. 데이터는 `data.output` / `data.output1` / `data.output2` (기간별시세·잔고는 배열)
- 그 외 → `rt_cd`/`rt_msg` 확인 후 에러를 사용자에게 전달
- 401/토큰 만료 → 클라이언트가 자동으로 토큰 재발급 후 1회 재시도 (토큰 발급 시 알림톡 발송됨에 유의)

## 주의

- 해외주식 **실시간** 시세는 유료 구독일 수 있음 — 조회 실패/과금 안내 시 사용자에게 고지
- 펀더멘털(수주잔고, 매출 등)은 이 API로 조회 불가 → IR/뉴스 검색 사용
- `env: "paper"`는 모의투자 키 필요, `"auto"`(기본)는 모의 키가 있으면 모의 우선
- 주문/잔고 API는 실전에서 신중히 — 기본은 조회 위주, 주문은 가능여부 검증 후
