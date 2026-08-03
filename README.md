# pi-kis-trading

한국투자증권 [OPEN API](https://github.com/koreainvestment/open-trading-api)를 **REST로 직접 호출**하는 pi 패키지입니다.
MCP 서버 프로세스도, GitHub에서 코드를 내려받아 실행하는 방식도 없습니다 — 패키지에 포함된 API 정의(`configs/` + `src/generated/apis.json`)와 순수 TypeScript 클라이언트로 동작합니다.

## 설치

```bash
pi install /Users/ms/dev/pi/pi-kis-trading
# pi 재시작
```

## 사용

```bash
# pi 안에서:
/kis-key       # API 키 입력창 → OS 키체인 저장 (파일 폴백 시 ~/.pi/agent/kis-keys.json)
/kis-status    # 백엔드/키/토큰/API 수 진단

# 그 다음 자연어로:
"RKLB 현재가 알려줘"              # kis_overseas_price
"RKLB 1년 일봉으로 52주 고점 계산해줘"  # kis_overseas_chart
"삼성전자 현재가"                  # kis_domestic_price
```

## 도구

| 도구 | 설명 |
|---|---|
| `kis_api` | 범용 디스패치 — `api: "category.api_type"`, `params`, `env` |
| `kis_list_apis` | 사용 가능한 API 목록 (카테고리 필터) |
| `kis_overseas_price` | 해외주식 현재체결가 |
| `kis_overseas_chart` | 해외주식 기간별시세 (일/주/월) |
| `kis_domestic_price` | 국내주식 현재가 |

범용 `kis_api`로는 공식 레포의 **164개 API**를 호출할 수 있습니다 (시세/차트/호가/순위/주문 등, `kis_list_apis`로 확인).

## 키 & 토큰 (시크릿 저장소)

**우선순위: OS 키체인 → 0600 파일 폴백** (`src/secret.ts`)

| 백엔드 | 대상 OS | 비고 |
|---|---|---|
| `@napi-rs/keyring` | macOS Keychain / Windows Credential Manager / Linux Secret Service | 평문 파일 없음, 로그인 세션 바인딩 |
| 파일 (0600) | 전 OS (헤드리스 폴백) | `~/.pi/agent/kis-keys.json` / `kis-token.json` |

- **마이그레이션**: 키체인 활성 시 기존 평문 파일을 자동으로 키체인으로 옮기고 삭제합니다 (확장 로드 시 1회).
- **강제 지정**: `KIS_SECRET_STORE=file` (헤드리스/컨테이너) 또는 `KIS_SECRET_STORE=keyring`
- **의존성**: `@napi-rs/keyring`은 패키지 의존성. npm/git 소스 설치 시 pi가 자동 설치, 로컬 경로 설치 시 패키지 루트에서 `npm install` 1회 실행 필요.
- 키: `/kis-key`로 입력 (입력 다이얼로그). 셸 env(`KIS_APP_KEY` 등)도 fallback.
- 실전 키만으로 시세/차트 조회 가능. 모의 키는 `env: "paper"` 또는 `auto`(모의 키 우선)에 사용.
- 주문/잔고 API는 계좌 정보(htsId, acctStock) 필요 — `/kis-key`에서 선택 등록.
- 토큰: 키체인/파일에 캐시, 만료(~24h) 시에만 재발급. **토큰 발급 시 알림톡(SMS)이 발송**되므로 캐시를 재사용합니다. 401/토큰 만료 시 자동 재발급 후 1회 재시도.

## API 정의 재생성 (선택)

`configs/*.json`과 `src/generated/apis.json`은 공식 레포에서 생성한 것입니다. 레포를 받아두고 재생성하려면:

```bash
git clone --depth 1 https://github.com/koreainvestment/open-trading-api.git /tmp/open-trading-api
cd pi-kis-trading
KIS_REPO=/tmp/open-trading-api node scripts/generate-apis.mjs
```

## 주의사항

- **해외주식 실시간 시세는 유료 구독일 수 있음** — 한국투자증권 해외 시세 이용료 정책 확인. 일봉/기간별 시세는 무료인 경우가 많습니다.
- 펀더멘털(수주잔고, 매출 등)은 조회 불가 — IR/뉴스에서 확인.
- 주문/잔고 API는 실전에서 신중히, 기본은 조회 위주.
- 투자 결정은 본인 책임. 본 패키지는 투자 조언을 제공하지 않습니다.

## License

MIT
