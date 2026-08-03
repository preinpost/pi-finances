---
name: kis-trading
description: 한국투자증권 OPEN API로 국내외 주식 데이터를 조회하는 방법. pi-kis-trading 패키지가 설치되어 있고 사용자가 "주가", "현재가", "차트", "시세", "52주 고점", "거래량 순위" 등 국내외 주식 데이터 요청 시, 이 스킬의 지침대로 kis_* 도구를 사용한다. 키 미등록 시 /kis-key 안내.
---

# KIS Trading 데이터 조회 (pi-kis-trading)

한국투자증권 OPEN API를 REST로 직접 호출합니다 (MCP 서버 불필요).

## 사전 조건

- `pi install /Users/ms/dev/pi/pi-kis-trading` 후 pi 재시작 (로컬 경로 설치 시 패키지 루트에서 `npm install` 1회)
- 키 등록: `/kis-key` (실전 최소. 모의는 선택) — OS 키체인 저장, 헤드리스 환경은 0600 파일 폴백
- 상태 확인: `/kis-status` (백엔드/키/토큰 캐시 확인)
- 키 미등록 시 도구는 `{ "ok": false, "error": "KIS real API keys missing..." }`를 반환 → 사용자에게 `/kis-key` 안내

## 도구

| 도구 | 용도 | 주요 인자 |
|---|---|---|
| `kis_overseas_price` | 해외(미국) 현재체결가 | excd(NAS/NYS/AMS), symb(RKLB) |
| `kis_overseas_chart` | 해외 기간별시세(일/주/월) | excd, symb, gubn(0=일,1=주,2=월), bymd(YYYYMMDD), modp(0) |
| `kis_domestic_price` | 국내 현재가 | symb(005930) |
| `kis_api` | 범용 디스패치 | api("overseas_stock.price"), params{...}, env |
| `kis_list_apis` | API 목록 조회 | category(선택) |

## 사용 패턴

- "RKLB 현재가" → `kis_overseas_price { excd: "NAS", symb: "RKLB" }`
- "RKLB 1년 일봉으로 52주 고점/저점 계산" → `kis_overseas_chart { excd: "NAS", symb: "RKLB", gubn: "0", bymd: 오늘 }` → output2의 최고/최저 집계 (최대 100행 — 그 이전 구간은 bymd를 과거로 설정해 추가 호출)
- "삼성전자 현재가" → `kis_domestic_price { symb: "005930" }`
- 그 외(지수/환율 차트, 호가, 거래량순위 등) → `kis_list_apis`로 확인 후 `kis_api`
  - 예: 거래량순위 `kis_api { api: "overseas_stock.trade_vol", params: { excd: "NYS", nday: "0", vol_rang: "0" } }`

## 응답 해석

- `rt_cd == "0"` → 성공. 데이터는 `data.output` / `data.output1` / `data.output2` (기간별시세는 output2가 목록)
- 그 외 → `rt_cd`/`rt_msg` 확인 후 에러를 사용자에게 전달
- 401/토큰 만료 → 클라이언트가 자동으로 토큰 재발급 후 1회 재시도 (토큰 발급 시 알림톡 발송됨에 유의)

## 주의

- 해외주식 **실시간** 시세는 유료 구독일 수 있음 — 조회 실패/과금 안내 시 사용자에게 고지
- 펀더멘털(수주잔고, 매출 등)은 이 API로 조회 불가 → IR/뉴스 검색 사용
- `env: "paper"`는 모의투자 키 필요, `"auto"`(기본)는 모의 키가 있으면 모의 우선
- 주문/잔고 API는 실전에서 신중히 — 기본은 조회 위주
