# pi-coingecko

CoinGecko [공식 API](https://docs.coingecko.com/) 클라이언트 pi 패키지 — 암호화폐 현재가·OHLC 차트·시장 랭킹·코인 상세·검색.

REST 직접 호출(의존성 0, MCP 서버 없음). 무료 Demo 키(`x-cg-demo-api-key` 헤더) — 키가 없어도 공개 API 사용 가능(5~15 req/min).

## 설치

```bash
pi install npm:pi-coingecko
# pi 재시작
```

## 사용

```bash
# pi 안에서:
/coingecko-key      # CoinGecko Demo API 키 등록 (없어도 공개 API 사용 가능)
/coingecko-status   # 연동 상태 진단 (키/백엔드/레이트리밋/캐시)

# 그 다음 자연어로:
"비트코인 현재가"                  # coingecko_price
"이더리움 30일 차트 지표"            # coingecko_chart
"시가총액 랭킹 top 20"             # coingecko_market
"리플 코인 상세"                    # coingecko_coin
"아발란체 코인 id 찾아줘"            # coingecko_search
```

> ⚠️ 코인 식별은 **id**(bitcoin, ethereum, ...)입니다 — 심볼이 중복될 수 있어
> `coingecko_search`로 정확한 id를 확인하세요.

## 도구

| 도구 | 설명 |
|---|---|
| `coingecko_price` | 현재가 — 복수 코인 (id 콤마 구분 최대 10, 표시 통화 최대 5, 24h 변동률·시총 포함) |
| `coingecko_chart` | OHLC 차트·지표 — 1/7/14/30/90/180/365/max일, 공용 지표(pi-finance-core) |
| `coingecko_market` | 시장 랭킹 — order(4종) / perPage(최대 50), usd 기준 |
| `coingecko_coin` | 코인 상세 — market_data에서 usd 값만 pick |
| `coingecko_search` | 코인 검색 — id 찾기용 (심볼 아님) |

> ⚠️ `coingecko_chart`는 OHLC 데이터라 volume이 없어 거래량 지표는 제한적입니다.
> 참고용 분석이며 투자 결정의 책임은 사용자에게 있습니다.

## 한도 (무료 플랜)

- 공개 API(키 없음): ~5~15 req/min — 기본 스로틀 **5000ms** (12 req/min)
- Demo 키: ~5~30 req/min — `COINGECKO_RATE_LIMIT_MULTIPLIER`로 배율 조정 (0이면 해제)
- TTL 캐시로 호출 절약: price 15s / chart 60s / market 2m / coin·search 10m
  (`COINGECKO_DISABLE_CACHE=1`로 비활성화)
- 429(레이트 초과) 시 GET 자동 백오프 재시도 (최대 2회)

## 키 등록

coingecko.com [API 대시보드](https://www.coingecko.com/en/developers/dashboard) 무료 가입 → demo key 발급 →
`/coingecko-key`로 등록 (OS 키체인 / 0600 파일 폴백). 셸 env `COINGECKO_API_KEY` 폴백 지원 — 키가 없으면 공개 API를 사용합니다.

## 아키텍처

```
index.ts             — thin entry: export default registerExtension
src/
  cache.ts           TTL 메모리 캐시 (엔드포인트별 TTL, COINGECKO_DISABLE_CACHE=1 비활성)
  client.ts          CoinGecko transport — x-cg-demo-api-key 헤더 + 레이트리밋 + 에러 envelope + 429 백오프
  ratelimit.ts       promise-chain 레이트리밋 (기본 5000ms, COINGECKO_RATE_LIMIT_MULTIPLIER 배율)
  secret.ts          pi-coingecko 전용 키 스토어 (mergeWrite — COINGECKO_API_KEY env 폴백)
  roles/             — 도메인 역할 (typed wrapper, 에이전트가 직접 import)
    coingecko.ts     가격·차트·랭킹·상세·검색 정규화(compact) + OHLC → Bar 변환
  agent/             — pi 통합
    extension.ts     registerExtension
    tools.ts         coingecko_* 5 툴 (execute는 roles 위임)
    commands.ts      /coingecko-key, /coingecko-status
```

## 시크릿 저장소

namespace `pi-coingecko` (env 컨트롤은 공용 `KIS_SECRET_STORE`/`KIS_KEYS_FILE`).
백엔드 우선순위: OS 키체인(`@napi-rs/keyring`) → 0600 파일 폴백(`~/.pi/agent/pi-coingecko-keys.json`).
자세한 동작(적응형 폴백/마이그레이션)은 [pi-finance-core](https://github.com/preinpost/pi-finances/tree/main/packages/pi-finance-core) 참고.

## 개발

이 패키지는 [pi-finances](https://github.com/preinpost/pi-finances) 모노레포(pnpm workspace)의 일부입니다.

```bash
pnpm --filter pi-coingecko typecheck
pnpm --filter pi-coingecko exec node --experimental-transform-types scripts/smoke.mjs
```
