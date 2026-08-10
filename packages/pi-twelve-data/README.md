# pi-twelve-data

Twelve Data [공식 API](https://twelvedata.com) 클라이언트 pi 패키지 — 전 세계 주식·지수·외환·암호화폐의 현재가/차트/심볼 검색/환율 (직접 REST, 의존성 0).

twelvedata.com 무료 가입으로 발급받는 apikey로 바로 사용할 수 있습니다.

## 설치

```bash
pi install npm:pi-twelve-data
# pi 재시작
```

## 사용

```bash
# pi 안에서:
/twelve-key      # apikey 등록 (twelvedata.com 무료 가입 → 발급) → 시크릿 스토어

# 그 다음 자연어로:
"AAPL 현재가"          # twelve_price
"AAPL 일봉 지표"        # twelve_chart (interval: 1day)
"애플 심볼 검색"         # twelve_search
"USD/KRW 환율"         # twelve_exchange_rate
```

키는 `/twelve-key`로 등록하거나 `TWELVE_API_KEY` 환경변수로 설정할 수 있습니다 (스토어 우선).

## 도구

| 도구 | 설명 |
|---|---|
| `twelve_price` | 현재가 — 콤마 구분 최대 8개 (무료 8 req/min 고려, 하나씩 `/quote` 호출) |
| `twelve_chart` | 차트·지표 — `1min`~`1month` (기본 `1day`), 최대 5000봉, 공용 지표(pi-finance-core) |
| `twelve_search` | 심볼 검색 — 전 세계 시장 (주식/지수/외환/암호화폐) |
| `twelve_exchange_rate` | 환율 — USD/KRW, EUR/USD 등 |

## 한도 / 캐시

무료 티어는 **8 req/min** (API 키당 전역) — 호출 간격 7.6s 자동 스로틀 + TTL 캐시로 한도를 아껴 씁니다.

| 항목 | 값 |
|---|---|
| 호출 간격 | 7600ms (`TWELVE_RATE_LIMIT_MULTIPLIER` 배율 — 2.0이면 2배, 0이면 해제) |
| 캐시 | quote 15s / chart 60s / search 10m / exchange_rate 60s (`TWELVE_DISABLE_CACHE=1`로 해제) |
| 에러 | `{"code","message","status":"error"}` → 한글 메시지 Error (401 키 오류 / 404 심볼 없음 / 429 한도) |

## 아키텍처

```
index.ts             — thin entry: export default registerExtension
src/
  client.ts          Twelve Data transport — apikey 쿼리 + 레이트리밋 + TTL 캐시
  ratelimit.ts       promise-chain 레이트리밋 (7600ms, TWELVE_RATE_LIMIT_MULTIPLIER)
  cache.ts           TTL 메모리 캐시 (TtlCache + cached 헬퍼)
  secret.ts          공용 시크릿 스토어 위 Twelve 키 뷰 (namespace pi-twelve-data)
  roles/
    twelve.ts        현재가/차트/검색/환율 (compact 정규화 + Bar 변환)
  agent/
    extension.ts     registerExtension
    tools.ts         twelve_* 4 툴 (execute는 roles 위임)
    commands.ts      /twelve-key, /twelve-status
```

## 시크릿 저장소

전용 네임스페이스(`pi-twelve-data`)를 사용합니다. 백엔드 우선순위: OS 키체인(`@napi-rs/keyring`) → 0600 파일 폴백(`~/.pi/agent/pi-twelve-data-keys.json`). 환경변수 `KIS_SECRET_STORE`/`KIS_KEYS_FILE`로 제어하며, 자세한 동작(적응형 폴백/마이그레이션)은 [pi-finance-core](https://github.com/preinpost/pi-finances/tree/main/packages/pi-finance-core) 참고.

## 개발

이 패키지는 [pi-finances](https://github.com/preinpost/pi-finances) 모노레포(pnpm workspace)의 일부입니다.

```bash
pnpm install        # 루트에서
pnpm --filter pi-twelve-data typecheck
pnpm --filter pi-twelve-data exec node --experimental-transform-types scripts/smoke.mjs
```
