---
name: stock-research
description: 특정 종목 리서치 — "삼성전자 리서치", "○○ 딥다이브", "○○ 재무제표·컨센서스 리포트", "○○ 52주 고저 분석" 등 단일 종목 요청 시, kis_* 도구(kis_research 포함) 지침대로 시세·재무·뉴스·컨센서스를 조사해 종목 리포트를 작성. 키 미등록 시 /kis-key 안내.
---

# Stock Research (단일 종목 리포트 워크플로우)

특정 종목 하나를 깊게 조사하는 파이프라인. 모든 API·파라미터는 실측 검증 완료 (2026-08 기준).

## 0. 실행 시퀀스

```
종목 확정 → 시세·52주 → 재무(손익계산서·재무비율) → 뉴스 2채널(KIS+구글RSS)
→ 애널리스트 컨센서스 → 종목 리포트
```

## 1. 종목 확인

- `kis_domestic_price { symb }` — **output이 전부 0이면 거래정지/폐지** (예: 고운세상코스메틱 089260)
- **종목코드 변경 사례 주의** (세화피앤씨 058530→252500) — 조회 전 코드 검증 필수
- 종목명 ↔ 코드 불일치 시 사용자에게 확인 후 진행

## 2. 시세·52주

```jsonc
// kis_domestic_price (domestic_stock.v1_국내주식-008, FHKST01010100)
{ "symb": "051900" }
```

| 필드 | 의미 |
|---|---|
| `stck_prpr` | 현재가 |
| `w52_hgpr` / `w52_lwpr` | 52주 최고가 / 최저가 |
| `w52_hgpr_date` / `w52_lwpr_date` | 해당 기록일 |
| `w52_hgpr_vrss_prpr_ctrt` | 고점대비 등락률(%) |
| `per` / `pbr` / `eps` / `bps` | 밸류에이션 |
| `hts_avls` | 시가총액(억) |

⚠️ 감자·주가조정 이력 종목(본느 226340, 한국화장품제조 003350)은 w52 수치 왜곡 →
`d250_hgpr`/`d250_lwpr`와 교차 확인.

## 3. 재무

```jsonc
// 손익계산서 — kis_research { kind: "income", symb: "051900" }
//   → sale_account(매출) / bsop_prti(영업익) / thtr_ntin(순익)

// 재무비율 — kis_research { kind: "ratios", symb: "051900" }
//   → grs(매출증가율) / bsop_prfi_inrt(영업익증가율) / roe_val / eps / bps / lblt_rate(부채비율)
```

⚠️ 분기 데이터는 **연내 누적합산** 기준. `roe_val`은 당분기 기준 → 리포트에선 **TTM(직전
12개월)으로 재해석** 표기. 최신 분기 미반영 시차 있음 (2Q26는 뉴스로 보완).

## 4. 뉴스 2채널

```jsonc
// 채널 A — KIS 뉴스: kis_research { kind: "news", symb: "161890" }
//   → hts_pbnt_titl_cntt(제목) / dorg(언론사) / data_dt / data_tm
//   ⚠️ 제목만 + 시장 전체 뉴스 노이즈 섞임 — 중요 기사만 fetch_content로 본문 확인
```

```text
// 채널 B — Google News RSS (개인·비상업적 용도만 허용)
https://news.google.com/rss/search?q=한국콜마+주가&hl=ko&gl=KR&ceid=KR:ko
// ⚠️ 링크는 리다이렉트 URL — 본문은 fetch_content로 별도 해제. 중요 기사만 본문 확인.
```

## 5. 애널리스트 컨센서스

```jsonc
// kis_research { kind: "consensus", symb: "051900" }
//   → output1: 담당 애널리스트/투자의견 + top-level rcmd_name(투자의견)·estdate(추정일)
//   → output2: 매출·영업익·순익 5개년(2023~2027E)
//   → output3: EPS/BPS/PER/PBR/ROE/EV-EBITDA/배당률
```

⚠️ **한국투자 리서치 커버 약 160개 기업 한정** — 중소형주는 빈 응답 정상 (커버 안 됨 표기).
추정일은 월초 기준이라 실적발표 후 시차 존재.

## 5b. 토스 데이터 교차 (선택 — KIS와 비겹침 보강)

pi-toss 패키지가 설치되어 있으면(`pi install npm:pi-toss`, 키는 `/toss-key`에서 등록) **KIS에 없는 데이터**로 인사이트를 보강한다:

```jsonc
// toss_market { kind: "exchange-rate" }              // KRW↔USD 환율 (해외주식 손익 환산에 유용)
// toss_market { kind: "calendar-KR"/"calendar-US" }  // 장운영시간 (미국 프리/정규/애프터마켓)
// toss_market { kind: "rankings", rankingsType, rankingsMarket, rankingsDuration }  // 거래대금·상승률 랭킹
// toss_market { kind: "investor-trading", symbol: "KOSPI"/"KOSDAQ", interval }      // 투자자별 매매대금
// toss_market { kind: "warnings", symbol }            // 매수 유의사항 (정리매매/과열/투자경고/VI) — 리스크 절에 필수 반영
// toss_balance                                        // 수수료율·보유종목·매수여력 — KIS와 교차 확인
```

- **warnings는 리포트 '리스크' 절에 반드시 반영** (투자경고/정리매매 대상이면 매수 추천 금지)
- 수수료율·환율은 종목 리포트의 비용/수익 계산에 사용
- 시세·차트는 KIS와 겹치므로 굳이 토스로 중복 조회하지 않는다 (비겹침 데이터만)

## 6. 종목 리포트 포맷 (마크다운)

```markdown
# ○○ (종목명/코드) 종목 리포트 (기준일)
### 시세·52주
| 현재가 | 52주 최고가 | 고점대비 | 52주 최저가 | 최저가일 | 시가총액 |
### 4축 요약
- **밸류**: PER / PBR
- **성장**: 매출·영업익 YoY
- **모멘텀**: 고점대비 낙폭 + 저점 대비 회복률
- **재무**: ROE / 부채비율
### 재무
| 매출 | 영업익 | 순익 | (YoY) | (분기 → TTM 재해석 고지)
### 📰 뉴스 다이제스트 (2채널)
- KIS + 구글 RSS, 증권사 리포트(목표가) 포함
### 🤖 애널리스트 컨센서스
| 투자의견 | 2026E 영업익 | 2027E 영업익 | (커버 안 됨 표기)
### ⚠️ 리스크
### 한 줄 요약
> 시세·공시 기반 참고 분석이며, 투자 결정의 책임은 본인에게 있습니다.
```

## 7. 재사용 주의사항

- API 시차: 재무 API 최신은 분기 실적발표 후 반영 (2Q26는 뉴스로 보완)
- Google RSS: 상업적 이용 금지 (피드 라이선스 명시)
- 52주 고저 필드 기준일: 장 마감 후 갱신, 장중엔 당일 변동 가능
- 종목코드 변경(세화피앤씨 058530→252500) 사례 — 코드 검증 필수
- 벌크 조회(여러 종목 재무/뉴스)는 core 전역 스로틀(기본 300ms 간격)이 자동 적용되므로 순차 조회로 진행하면 됨
