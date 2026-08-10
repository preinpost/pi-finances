# pi-finnhub

[Finnhub 공식 API](https://finnhub.io/) 클라이언트 pi 패키지 — 미국 주식 시세·차트·뉴스·펀더멘털·컨센서스.

무료 키 + 직접 REST 호출, 의존성 0 (MCP 서버 없음). **무료 티어는 미국 종목만** 지원합니다 (AAPL, MSFT 등).

## 설치

```bash
pi install npm:pi-finnhub
# pi 재시작
```

## 사용

```bash
# pi 안에서:
/finnhub-key      # finnhub.io 무료 가입 → dashboard의 API token 등록

# 그 다음 자연어로:
"AAPL 현재가"             # finnhub_price
"AAPL 일봉"               # finnhub_chart (resolution: D)
"MSFT 1시간봉"            # finnhub_chart (resolution: 60)
"AAPL 뉴스"               # finnhub_news (최근 7일)
"AAPL 펀더멘털"            # finnhub_fundamentals (프로필 + 메트릭 + 컨센서스)
```

## 도구

| 도구 | 설명 |
|---|---|
| `finnhub_price` | 현재가 — 콤마 구분 최대 10종목, 심볼당 `/quote` 1회 호출 (15초 캐시) |
| `finnhub_chart` | 캔들 차트·지표 — `1/5/15/30/60`(분봉, 최근 5일)/`D`(일봉, 기본, 최근 1년)/`W`/`M`, 공용 지표(pi-finance-core analyze) |
| `finnhub_news` | 기업 뉴스 — 최근 7일 기본 (from/to `YYYY-MM-DD` 선택), 최대 20건, summary 200자 (5분 캐시) |
| `finnhub_fundamentals` | 프로필(`company-profile2`) + 밸류에이션 메트릭(`/stock/metrics` PE·PBR·배당·EPS·마진·ROE/ROA·FCF) + 애널리스트 컨센서스(`/stock/recommendation`) (30분 캐시) |

> ⚠️ 무료 티어 한도 **60 req/min** — `finnhub_price` 10종목 호출 시 내부 스로틀(1100ms 간격)로 순차 처리됩니다.
> 모든 툴은 참고용이며 투자 결정의 책임은 사용자에게 있습니다.

## 인증·한도

- 키: [finnhub.io](https://finnhub.io/) 무료 가입 → dashboard → API token. 쿼리 파라미터 `token`으로 전달.
- `/finnhub-key`로 등록하거나 환경변수 `FINNHUB_API_KEY`로 지정 가능합니다.
- 무료 티어: **미국 종목만**, 60 req/min. 유료 티어는 다른 시장/엔드포인트 추가 제공.
- 에러: HTTP 401(키 오류)/403(무료 티어 미지원)/429(레이트 초과) — 본문 `{"error": "..."}` 포함.

## 아키텍처

```
index.ts             — thin entry: export default registerExtension
src/
  client.ts          전송 계층 — fetch + token 쿼리 + 레이트리밋 + TTL 캐시 + 에러 envelope
  ratelimit.ts       무료 60 req/min 스로틀 (기본 간격 1100ms, tail 체인)
  cache.ts           TTL 메모리 캐시 (TtlCache + cached 헬퍼)
  secret.ts          공용 시크릿 스토어 위 pi-finnhub 키 뷰 (mergeWrite)
  roles/finnhub.ts   현재가·차트·뉴스·펀더멘털 (정규화 + Bar 변환)
  agent/             — pi 통합
    extension.ts     registerExtension
    tools.ts         finnhub_* 4 툴 (execute는 roles 위임, compact 응답)
    commands.ts      /finnhub-key, /finnhub-status
```

### 환경변수

| 변수 | 기본 | 설명 |
|---|---|---|
| `FINNHUB_API_KEY` | — | API token (스토어 미등록 시 폴백) |
| `FINNHUB_RATE_LIMIT_MULTIPLIER` | `1.0` | 호출 간격 배율 (2.0 = 2배 완화, 0 = 스로틀 해제) |
| `FINNHUB_DISABLE_CACHE` | — | `1`이면 TTL 캐시 비활성 (실시간 확인용) |
| `KIS_SECRET_STORE` / `KIS_KEYS_FILE` | — | 공용 시크릿 스토어 백엔드/파일 제어 |

## 시크릿 저장소

전용 네임스페이스(`pi-finnhub`)를 사용합니다. 백엔드 우선순위: OS 키체인 → 0600 파일 폴백(`~/.pi/agent/pi-finnhub-keys.json`).
자세한 동작(적응형 폴백)은 [pi-finance-core](https://github.com/preinpost/pi-finances/tree/main/packages/pi-finance-core) 참고.

## 개발

이 패키지는 [pi-finances](https://github.com/preinpost/pi-finances) 모노레포(pnpm workspace)의 일부입니다.

```bash
pnpm install                    # 루트에서
pnpm --filter pi-finnhub typecheck
pnpm --filter pi-finnhub exec node --experimental-transform-types scripts/smoke.mjs
```
