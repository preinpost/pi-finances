---
name: toss-conditional
description: 토스증권 조건주문(SINGLE/OCO/OTO) 사용법 — "연속주문", "예약주문", "예약 매수 후 손절/익절", "위아래 로스/익절컷", "브래킷", "OTO", "OCO", "손익비", "조건주문" 요청 시 이 스킬의 지침대로 toss_conditional을 사용한다. 키 미등록 시 /toss-key 안내, 실전 주문은 사용자 확인 후에만.
---

# Toss 조건주문 (pi-toss)

토스증권 조건주문은 서버가 가격을 감시하다 조건 충족 시 자동으로 주문을 내는 기능.
툴: `toss_conditional` (action: create/list/detail/modify/cancel).

## 타입 3종 (공식 스펙 기준)

| type | 의미 | 방향 규칙 | 호가 |
|---|---|---|---|
| `SINGLE` | 조건 1개만 감시 | 자유 | LIMIT/MARKET |
| `OCO` | **익절·손절** — 2개 동시 감시, 하나 체결 시 나머지 자동 취소 | first/second **모두 SELL**, first 감시가 > 현재가 > second 감시가 | LIMIT만 |
| `OTO` | **연속주문** — first 체결 후 그때부터 second 감시 시작 | first=**BUY** → second=**SELL** (second 방향은 `secondSide`로 지정) | LIMIT만 |

## 파라미터 (create)

- 필수: `symbol`, `side`(first 방향), `triggerPrice`, `quantity`, `orderType`, `expireDate`
- `orderPrice`: 지정가일 때 (LIMIT 필수값). OCO/OTO는 LIMIT만 가능 → first/second 모두 orderPrice 필요
- `secondTriggerPrice`/`secondOrderPrice`: 두번째 조건 (OCO/OTO 필수)
- `secondSide`: **두번째 조건 방향 — OTO(연속주문)는 필수** (예: 매수 체결 후 매도 = `side: "BUY"`, `secondSide: "SELL"`). OCO는 `side`와 동일해야 함
- 기본값: `secondSide` 미지정 시 `side`와 동일. type 기본 `SINGLE`

## 예약 매수 + 체결 시 위아래 로스/익절 (브래킷) — 핵심 패턴

⚠️ **토스 API 한계: OTO 자식(second)은 1개뿐** — "진입 + 손절 + 익절" 3종을 **한 건의 조건주문으로는 불가**. 앱의 '연속주문'도 자식 1개(구매 체결 → 판매 1건)만 지원.

### 패턴 A — 완전 자동, 손절 보장 (⭐ 추천)

```
① OTO: first=BUY 진입조건($X) → second=SELL 손절($X×0.97)   ← 손절이 매수 체결 후에만 발동 → 리스크 보장
② SINGLE: SELL 익절 조건($X×1.09, 손익비 1:3)
```

- 예: 진입 $140.50 → 손절 $136.29(-3%) / 익절 $153.15(+9%), 수량 7주, 만료 YYYY-MM-DD
- **주의 1**: OTO는 LIMIT 강제 → 진입도 지정가가 됨 (시장가 불가). 갭 상승 시 진입 미체결 가능
- **주의 2**: ② 익절 standalone은 매수 체결 전에 발동할 수 있음(갭 상승) → 보유 수량 없이 매도 실패로 익절만 소멸. 손해는 없으나 익절 기회 상실. 손절 보호는 ①이 담당하므로 안전

### 패턴 B — 완전 브래킷, 체결 감시 필요 (이번 SPCX에서 사용자가 수동으로 한 방식)

```
① SINGLE: BUY 예약주문 (시장가 MARKET 가능)
② 매수 체결 감지 → OCO: SELL 익절($X×1.09) + SELL 손절($X×0.97) 즉시 장착
```

- 체결 감지: `toss_conditional list`(status=OPEN)에서 해당 주문이 사라짐, 또는 `toss_orders list`(symbol 지정)에서 FILLED 확인
- 에이전트가 세션 중 체결을 감지하면 OCO를 자동 장착 가능. 세션 종료 후 체결되면 장착 못 하므로 사용자에게 "체결되면 알려달라/직접 확인" 안내 필요

### 패턴 C — 비추천 ❌

- OTO(진입→익절) + standalone 손절: 손절이 매수 체결 **전**에 발동하면(미보유 매도 실패) 손절이 소멸 → 이후 진입은 무방비. 절대 이 구성 금지

## 주의사항

- **실전 주문 — 반드시 사용자 확인 후에만** create/modify/cancel 호출
- 손익비 계산: 진입가 기준 — 손절 -3% = ×0.97, 익절 +9% = ×1.09 (1:3), 계산 후 $0.01 단위로 반올림
- **LIMIT 갭 리스크**: 손절도 지정가라 급락 갭 시 미체결 가능 → 원하면 orderPrice를 triggerPrice보다 살짝 낮게(갭 버퍼)
- modify는 기존 조건주문을 취소+재생성 → **새 conditionalOrderId 발급** (기존 ID 무효)
- list 응답의 first/second에는 orderSide가 없음 — 방향은 생성 시점에 기록/관리
- 발동 세션: 국내=KRX 정규장만, 해외=거래 가능 시간대 전부
- 해외주식 US: $1 이상은 0.01 호가 단위 — $136.285 같은 값은 400 에러 → $136.29로
- 수량·만료일: OCO/OTO는 그룹 공통 (first/second 동일 수량)
- 생성 후 `detail`로 status=WATCHING 확인. 1억원 이상 주문은 `confirmHighValueOrder: true`
