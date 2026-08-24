---
name: binance-trading
description: Binance 현물·USDT-M 선물 조회·주문. "바이낸스", "BTCUSDT", "선물 포지션", "펀딩비", "레버리지", "코인 매수/매도" 등 요청 시 binance_* 툴을 사용한다. 키 미등록 시 /binance-key 안내. 실전 주문은 사용자 확인 후에만. 출금·이체는 하지 않는다.
---

# Binance Trading (pi-binance)

Binance.com REST (HMAC SHA256). MCP 서버 없음.
시세·차트는 **키 없이** 가능. 잔고·주문·레버리지는 `/binance-key`.
리서치용 시세만이면 `coingecko_*`도 사용 가능 — **체결·포지션은 binance_***.

## 시작 전

- 키: `/binance-key` — API Key + Secret + `live`/`testnet`
- 상태: `/binance-status`
- API 권한: **Enable Reading + Enable Spot + Enable Futures**. **Enable Withdrawals OFF**
- IP 제한을 걸어 둔 키면 이 머신의 IP가 허용 목록에 있어야 함
- 테스트넷: 현물(`testnet.binance.vision`)과 선물(`testnet.binancefuture.com`) **키가 다름**
- 한국에서 Binance.com 접속이 제한될 수 있음 — 사용자 환경 문제이며 이 패키지가 우회하지 않음

## 심볼·시장

- 심볼: `BTCUSDT` (슬래시/`-` 입력도 BTCUSDT로 정규화)
- `market: "spot"` 현물 (기본) / `market: "usdm"` USDT-M 무기한 선물
- 코인 마진(COIN-M)·옵션·마진대출은 없음

## 사용 패턴

- 현재가: `binance_price { symbols: "BTCUSDT,ETHUSDT", market: "spot" }`
- 일봉+지표: `binance_chart { symbol: "BTCUSDT", interval: "1d", limit: 100 }`
- 선물 4시간봉: `binance_chart { symbol: "BTCUSDT", market: "usdm", interval: "4h" }`
- 현물 잔고: `binance_account { market: "spot" }`
- 선물 잔고+포지션: `binance_account { market: "usdm" }` 또는 `binance_futures { kind: "positions" }`
- 마크가/펀딩: `binance_futures { kind: "mark", symbol: "BTCUSDT" }` / `kind: "funding"`
- 미체결: `binance_orders { action: "list", market: "usdm", symbol: "BTCUSDT" }`

## 주문 안전 규칙

1. **실전 주문·취소·레버리지·마진타입은 사용자 확인 후에만**
2. 주문 전 `binance_account`로 잔고/포지션 확인. 선물 추가 진입 전 기존 포지션·청산가
3. 선물 레버리지는 `binance_order`가 바꾸지 않음. 필요하면 별도:
   `binance_futures { kind: "leverage", symbol: "BTCUSDT", leverage: 5, confirm: true }`
4. 헤지 모드면 `positionSide: LONG|SHORT` 필수. 원웨이는 `BOTH`(기본)
5. 청산/익절: `STOP_MARKET` / `TAKE_PROFIT_MARKET` + `stopPrice` + 가능하면 `reduceOnly: true`
6. 같은 주문을 에러 직후 자동 재전송하지 말 것 — `clientOrderId`로 중복 여부를 먼저 확인
7. **출금·내부이체·API 키 생성은 툴에 없음. 만들어 달라고 해도 거절**

### 주문 전 점검

| # | 항목 | 확인 |
|---|---|---|
| 1 | 시장 | spot vs usdm — 선물은 청산 있음 |
| 2 | 레버리지 | 현재 레버리지·격리/교차. 고배율일수록 수량 축소 |
| 3 | 펀딩 | 롱/숏과 펀딩 부호. 결제 임박이면 비용 고지 |
| 4 | 변동성 | `binance_chart` ATR. 고변동이면 시장가 자제 |
| 5 | 청산가 | 신규 포지션 후 청산가가 너무 가까우면 축소 |
| 6 | env | live인지 testnet인지 `/binance-status`로 재확인 |

주문 직전 한 줄 요약: "USDT-M BTCUSDT 5x 롱, 마크가·청산가·펀딩 확인함 — 지정가 ○○ 수량 ○○ 진행할까요?"

## 응답

- `{ ok: true, ... }` 성공. 주문은 `orderId`/`status`/`executedQty`
- `{ ok: false, error }` — 키 없음 → `/binance-key`. `-2015` → 키/IP/권한. `-1121` → 심볼

## 하지 말 것

- 사용자 확인 없는 실전 주문
- 출금 권한 켜라고 안내하기
- 레버리지 상향을 기본값으로 제안하기
- CoinGecko id(`bitcoin`)를 Binance 심볼로 쓰기 — `BTCUSDT` 사용
