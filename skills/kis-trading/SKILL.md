---
name: kis-trading
description: 한국투자증권 OPEN API로 국내외 주식 데이터를 조회·주문하는 방법. pi-kis 패키지가 설치되어 있고 사용자가 "주가", "현재가", "차트", "시세", "52주 고점", "거래량 순위", "실시간체결가", "주문" 등 국내외 주식 요청 시, 이 스킬의 지침대로 kis_* 도구를 사용한다. 키 미등록 시 /kis-key 안내.
---

# KIS Trading (pi-kis)

한국투자증권 OPEN API를 REST/WebSocket으로 직접 호출합니다 (MCP 서버 불필요).
도구별 인자·파라미터 규칙(v2 키, params, tr_id, env, pages, hashkey 등)은 각
kis_* 도구의 description을 우선 참고하세요. 이 스킬은 도구 설명에 없는
**사용 패턴·주문 안전 규칙·주의사항**만 정리합니다.

## 시작 전

- 키 등록: `/kis-key` — 저장 백엔드는 자동 선택 (GUI=OS 키체인, SSH/헤드리스=0600 파일)
- 키 미등록 시 도구는 `{ "ok": false, "error": "KIS real API keys missing..." }` 반환 → 사용자에게 `/kis-key` 안내
- 상태 진단: `/kis-status`

## 사용 패턴

- 국내 현재가: `kis_domestic_price { symb: "005930" }`
- 해외 현재가: `kis_overseas_price { excd: "NAS", symb: "RKLB" }`
- 52주 고점/저점 등 장기 집계: `kis_overseas_chart { excd, symb, gubn: "0", bymd: 오늘 }`
  → `output2`가 최대 100행이므로, 그 이전 구간은 `bymd`를 과거 날짜로 지정해 여러 번 호출해 합산
- 실시간 체결가(웹소켓): `kis_realtime { tr_id, tr_key }`
  - 국내: `{ tr_id: "H0STCNT0", tr_key: "005930" }`, 호가 `H0STASP0`
  - 해외: `{ tr_id: "HDFSCNT0", tr_key: "DNASRKLB" }` (D + 시장 3자리 + 종목코드), 호가 `HDFSASP0`
  - `duration_sec`(기본 10) 후 자동 구독해제. 장 마감이면 메시지 0개여도 정상
- 그 외(지수/환율 차트, 호가, 순위, 잔고, 주문 등): `kis_list_apis`로 v2 키 확인 후 `kis_api`
  - v2 키 형식 `category.api_id` (예: `overseas_stock.v1_해외주식-009`) — 구버전 키도 alias로 동작
  - 다중 TR_ID API(주문 등)는 `tr_id` 필수 — 미지정 시 사용 가능 목록이 에러로 표시

## 주문 API (안전 규칙)

1. 주문 전 반드시 **가능여부 검증 API**로 확인 (CANO/ACNT_PRDT_CD 자동 주입 — /kis-key에서 계좌 등록 필요):

   | 검증 | v2 키 | tr_id |
   |---|---|---|
   | 국내 매수가능조회 | `domestic_stock.v1_국내주식-007` | TTTC8908R |
   | 국내 매도가능수량조회 | `domestic_stock.국내주식-165` | TTTC8408R |
   | 국내 정정취소가능주문조회 | `domestic_stock.v1_국내주식-004` | TTTC0084R |
   | 해외 매수가능금액조회 | `overseas_stock.v1_해외주식-014` | TTTS3007R |

2. 주문 호출 (다중 TR_ID — `tr_id` 필수, hashkey 자동 발급·적용):
   - 국내 주식주문(현금) `domestic_stock.v1_국내주식-001`: `TTTC0011U`(매수)/`TTTC0012U`(매도)
   - 해외 주문 `overseas_stock.v1_해외주식-001`: `TTTT1002U`(미국 매수)/`TTTT1006U`(미국 매도)
   - 정정/취소는 검증 후: 국내 `domestic_stock.v1_국내주식-003`(`TTTC0013U`), 해외 `overseas_stock.v1_해외주식-003`(`TTTT1004U`)

3. **실전 주문은 사용자 확인을 받은 뒤에만** 수행. 예시 (해외 매수):
   `kis_api { api: "overseas_stock.v1_해외주식-001", tr_id: "TTTT1002U", params: { OVRS_EXCG_CD: "NASD", PDNO: "RKLB", ORD_QTY: "10", OVRS_ORD_UNPR: "70.0", ORD_SVR_DVSN_CD: "0", ORD_DVSN: "00" } }`

## 응답 해석

- `rt_cd == "0"` → 성공. 데이터는 `data.output` / `data.output1` / `data.output2` (기간별시세·잔고는 배열)
- 그 외 → `rt_cd`/`rt_msg` 확인 후 사용자에게 전달. 필드 형식 오류(`INPUT_FILED_SIZE [필드]`)는 에러에 해당 필드 스펙 설명이 포함됨
- 401/토큰 만료 → 클라이언트가 자동 토큰 재발급 후 1회 재시도 (토큰 발급 시 알림톡 발송됨에 유의)

## 주의

- 해외주식 **실시간**(REST 시세·웹소켓)은 유료 구독일 수 있음 — 실패/과금 안내 시 사용자에게 고지
- 펀더멘털(수주잔고, 매출 등)은 이 API로 조회 불가 → IR/뉴스 검색 사용
- `env: "paper"`는 모의투자 키 필요, `"auto"`(기본)는 모의 키가 있으면 모의 우선
- 주문/잔고 API는 실전에서 신중히 — 기본은 조회 위주, 주문은 가능여부 검증 후
