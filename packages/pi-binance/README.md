# pi-binance

Binance [Spot](https://binance-docs.github.io/apidocs/spot/en/) · [USDT-M Futures](https://binance-docs.github.io/apidocs/futures/en/) REST 클라이언트 pi 패키지 — 시세·차트·잔고·주문.

HMAC SHA256 직접 호출 (의존성: `pi-finance-core`만, MCP 없음). **외부 출금은 포함하지 않습니다.** 같은 계정 지갑 간 이동(Spot·Funding·Earn·Futures)만 확인 카드 승인 후 지원합니다.

시세 리서치만 필요하면 [pi-coingecko](https://github.com/preinpost/pi-finances/tree/main/packages/pi-coingecko)로도 충분합니다. 체결·포지션은 이 패키지입니다.

## 설치

```bash
pi install npm:pi-binance
# pi 재시작
```

## 사용

```bash
# pi 안에서:
/binance-key       # API Key/Secret + live|testnet
/binance-status    # 키·베이스 URL·레이트리밋

# 그 다음 자연어로:
"BTCUSDT 현재가"                 # binance_price
"ETHUSDT 선물 4시간봉 지표"       # binance_chart market=usdm
"바이낸스 현물 잔고"              # binance_account
"BTCUSDT 선물 포지션·펀딩"        # binance_account usdm / binance_futures
"BTCUSDT 0.001 지정가 매수"       # binance_order (실전 — 사용자 확인 후)
"Earn에 있는 USDT 50 현물로 옮겨줘" # binance_wallet transfer (확인 카드 승인 후 실행)
```

> 심볼은 **BTCUSDT** (BTC/USDT도 허용). CoinGecko id(`bitcoin`)가 아닙니다.

## 도구

| 도구 | 설명 |
|---|---|
| `binance_price` | 24h 티커 — 복수 심볼(최대 10), spot/usdm, **키 없이 가능** |
| `binance_chart` | 캔들·지표 — 1m/5m/15m/1h/4h/1d/1w, 공용 지표(pi-finance-core), **키 없이 가능** |
| `binance_market` | 현물 호가창·최근체결·평균가·북티커·거래소규칙(틱/롯)·롤링티커 |
| `binance_account` | 현물 잔고 + **평단가(FIFO)** / 수수료·계정필터·미체결한도 / 선물 포지션 |
| `binance_order` | 주문 생성·테스트주문 — LIMIT/LIMIT_MAKER/MARKET/스탑 계열 |
| `binance_orders` | 미체결/상세/취소/체결이력/전체주문이력 |
| `binance_orderlist` | 현물 OCO / OTO / OTOCO |
| `binance_futures` | 펀딩·마크가·OI·포지션·레버리지·마진타입 (USDT-M) |
| `binance_wallet` | 지갑별 잔고(Spot/Funding/Earn 유연/USDⓈ-M 선물) + **지갑 간 이동** — 확인 카드에서 승인해야만 실행 |

현물 카탈로그에서 **의도적으로 뺀 것**: 외부 출금·서브계정 이체, SOR, OPO/OPOCO, pegged, amend-keep-priority, cancelReplace, User Data Stream(WS).

> ⚠️ 주문·취소·레버리지 변경은 사용자 확인 후에만. 선물은 청산 위험이 있습니다.
> 참고용 분석이며 투자 결정의 책임은 사용자에게 있습니다.

## 지갑 간 이동 (`binance_wallet`)

| 경로 | API |
|---|---|
| SPOT ↔ FUNDING ↔ FUTURES | `POST /sapi/v1/asset/transfer` (`MAIN_FUNDING`, `FUNDING_MAIN`, `MAIN_UMFUTURE`, …) |
| EARN → SPOT / FUNDING | `POST /sapi/v1/simple-earn/flexible/redeem` (`destAccount=SPOT\|FUND`) |
| SPOT / FUNDING → EARN | `POST /sapi/v1/simple-earn/flexible/subscribe` (`sourceAccount=SPOT\|FUND`) |

- 실행 전 가용 수량·Earn 상품 ID를 조회해 검증하고, `ctx.ui.confirm` **확인 카드**를 띄웁니다. 사용자가 확인을 눌러야만 이동합니다 (취소·3분 시간 초과·UI 없는 모드는 실행 안 함).
- EARN ↔ FUTURES는 직접 경로가 없어 SPOT을 거쳐 두 번 옮깁니다. Earn은 유연(Flexible) 상품만 다룹니다.

## 키 등록

binance.com → API Management → HMAC 키.

- 권한: Enable Reading + Enable Spot & Margin Trading + Enable Futures
- 지갑 간 이동(`binance_wallet`): Spot↔Funding↔Futures는 **Permits Universal Transfer**, Earn 환매·예치는 Enable Spot & Margin Trading
- **Enable Withdrawals 끄기**
- IP 제한 권장
- 셸 env 폴백: `BINANCE_API_KEY` / `BINANCE_API_SECRET` / `BINANCE_ENV=live|testnet`

테스트넷:

| 시장 | URL | 키 |
|---|---|---|
| 현물 | https://testnet.binance.vision | 현물 테스트넷 전용 키 |
| USDT-M | https://testnet.binancefuture.com | **선물 테스트넷 전용 키 (현물과 다름)** |

## 아키텍처

```
index.ts             — thin entry: export default registerExtension
src/
  client.ts          HMAC SHA256 + 서버시간 보정 + 429/-1021 재시도 (GET만 429)
  ratelimit.ts       MARKET/ACCOUNT/ORDER 그룹 간격 (BINANCE_RATE_LIMIT_MULTIPLIER)
  secret.ts          pi-binance 전용 키 스토어
  roles/binance.ts   정규화 + 주문 검증
  agent/
    extension.ts
    tools.ts         binance_* 6
    commands.ts      /binance-key, /binance-status
skills/binance-trading/
```

## 시크릿 저장소

namespace `pi-binance` (env 컨트롤은 공용 `KIS_SECRET_STORE`/`KIS_KEYS_FILE`).
백엔드: OS 키체인 → 0600 파일 폴백 (`~/.pi/agent/pi-binance-keys.json`).
자세한 동작은 [pi-finance-core](https://github.com/preinpost/pi-finances/tree/main/packages/pi-finance-core).

## 개발

이 패키지는 [pi-finances](https://github.com/preinpost/pi-finances) 모노레포(pnpm workspace)의 일부입니다.

```bash
pnpm --filter pi-binance typecheck
pnpm --filter pi-binance exec node --experimental-transform-types scripts/smoke.mjs
```
