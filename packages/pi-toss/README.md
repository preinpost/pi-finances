# pi-toss

토스증권 [Open API](https://developers.tossinvest.com/) 클라이언트 pi 패키지 — 시세·시장 데이터·자산·주문·조건주문.

**pi-kis v0.3.0에서 분리된 독립 패키지**입니다. KIS 툴(`kis_*`)이 필요하면 [pi-kis](https://github.com/preinpost/pi-finances/tree/main/packages/pi-kis)를 함께 설치하세요.

## 설치

```bash
pi install npm:pi-toss
# (KIS도 함께: pi install npm:pi-kis)
# pi 재시작
```

> **키 마이그레이션 불필요**: pi-kis 0.2.x에서 토스 키를 등록해 뒀다면 그대로 사용됩니다.
> 두 패키지는 같은 키 저장소(OS 키체인 `pi-kis` SERVICE / `~/.pi/agent/kis-keys.json`)를 공유합니다.
> `pi install npm:pi-kis`와 `pi install npm:pi-toss`는 설치 순서 무관.

> **타점 분석(`kis-timing`) 스킬은 pi-kis가 단독 제공**합니다. 두 패키지가 같은 번들 스킬을
> 동시에 등록하면 pi가 이름 충돌 경고(`[Skill conflicts]`)를 내므로, 공용 스킬 등록은
> pi-kis만 담당합니다. pi-kis 없이 pi-toss만 쓰는 경우에는 `toss_chart`로 직접 분석하세요
> (예: "005930 일봉 RSI 알려줘").

## 사용

```bash
# pi 안에서:
/toss-key      # client_id/client_secret 등록 (developers.tossinvest.com 발급) → 공용 키 저장소

# 그 다음 자연어로:
"AAPL 현재가"                  # toss_price
"005930 1분봉"                 # toss_chart (interval: 1m — KIS에는 없는 분봉)
"달러 환율"                     # toss_market (kind: exchange-rate)
"코스피 투자자별 매매대금"        # toss_market (kind: investor-trading)
"테슬라 매수 유의사항"            # toss_market (kind: warnings)
"내 자산 조회"                  # toss_balance
"삼성전자 10주 시장가 매수"       # toss_order  (실전 — 사용자 확인 후)
"손절+목표 OCO 조건주문"          # toss_conditional (KIS에 없는 강점)
```

## 도구

| 도구 | 설명 |
|---|---|
| `toss_price` | 현재가 — 복수 종목 (KRX 6자리 / US 티커, 콤마 구분 최대 200) |
| `toss_chart` | 캔들 차트·지표 — 일봉(1d)/1분봉(1m), 공용 지표 로직(pi-finance-core) |
| `toss_market` | 토스 전용 시장 데이터 (환율·장운영시간·랭킹·투자자별 매매대금·종목경고 — KIS 비겹침) |
| `toss_balance` | 자산 종합 (계좌·보유종목·매수여력 KRW/USD·수수료) |
| `toss_order` | 주문 생성 (지정가/시장가, clientOrderId 멱등, 1억원 이상 confirm 필수) |
| `toss_orders` | 주문 목록/상세/정정/취소 |
| `toss_conditional` | 조건주문 (SINGLE/OCO/OTO — KIS에 없는 강점) |

> 📘 조건주문 사용 패턴 (예약 매수 + 체결 시 위아래 로스/익절 브래킷, OTO `secondSide`, 주의사항)은
> `skills/toss-conditional/SKILL.md` 참고.

> ⚠️ 실전 전용 패키지입니다 (모의투자 없음). 주문·취소·정정 툴은 사용자 확인 후에만 호출하세요.

## 에이전트 디버깅 가이드 (툴 발견·파라미터 확인)

`toss_*` 툴은 **MCP가 아닌 네이티브 pi 툴**입니다 — `mcp({ describe / search })` 게이트웨이는
MCP 서버 전용이라 여기서 조회되지 않습니다 ("Tool not found"). 툴은 직접 호출하고,
파라미터·동작이 궁금하면 아래 순서로 확인하세요 (빠른 것부터).

1. **세션 툴 스키마** — pi가 로드한 툴 함수 정의에 파라미터 설명·필수값이 이미 있음
2. **`src/agent/tools.ts`** (설치본: `~/.pi/agent/npm/node_modules/pi-toss/src/agent/tools.ts`) —
   툴 등록·입력 검증·에러 메시지 원본
   (예: `toss_conditional` modify는 `conditionalOrderId/type/side/quantity/orderType/expireDate/triggerPrice` 필수,
   OCO/OTO는 `secondTriggerPrice` 추가 필요, OTO(연속주문)는 `secondSide`로 자식 방향 지정 — first=BUY 체결 후 second=SELL)
   (참고: OTO/OCO는 지정가 LIMIT만 지원 — 공식 스펙 openapi.tossinvest.com)
3. **`src/roles/toss.ts`** — 실제 API 호출 로직·기본값·제약 (예: OCO/OTO 조건주문은 LIMIT만 허용)

- 실전 API는 **서버 에러 메시지가 가장 빠른 피드백** — 반복 호출하며 파라미터 교정
  (예: "지정가 주문 시 가격을 지정해야 합니다" → orderPrice 누락, "호가 단위에 맞지 않습니다" → 소수점 자리수 조정)
- `rg` 검색 시 glob은 `-g '*.ts'` (ripgrep에는 `--include` 플래그 없음)
- 주문·취소·정정 계열 툴은 실전 반영 전 **사용자 확인 필수**

## 아키텍처

```
index.ts             — thin entry: export default registerExtension
src/
  client.ts          토스 transport — OAuth2 client_credentials + 토큰 캐시 + { result } 언랩 + 재시도 정책
  ratelimit.ts       그룹별 레이트리밋 (ACCOUNT 1/s ~ MARKET_DATA 10/s, 429 백오프)
  secret.ts          공용 키 저장소 위 토스 키 뷰 (pi-kis와 공유 — mergeWrite)
  roles/             — 도메인 역할 (typed wrapper, 에이전트가 직접 import)
    toss.ts          시세·시장·자산·주문·조건주문 (그룹별 ratelimit 명시)
  agent/             — pi 통합
    extension.ts     registerExtension
    tools.ts         toss_* 7 툴 (execute는 roles 위임)
    commands.ts      /toss-key
```

## 시크릿 저장소

pi-kis와 **공유**합니다 (namespace `pi-kis`, env `KIS_SECRET_STORE`/`KIS_KEYS_FILE`).
백엔드 우선순위: OS 키체인(`@napi-rs/keyring`) → 0600 파일 폴백(`~/.pi/agent/kis-keys.json`).
자세한 동작(적응형 폴백/마이그레이션)은 [pi-finance-core](https://github.com/preinpost/pi-finances/tree/main/packages/pi-finance-core) 참고.

## 개발

이 패키지는 [pi-finances](https://github.com/preinpost/pi-finances) 모노레포(pnpm workspace)의 일부입니다.

```bash
pnpm install        # 루트에서
pnpm typecheck      # 전체 타입체크
```
