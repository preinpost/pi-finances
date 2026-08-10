# pi-finances

finance용 **pi packages 모노레포** (pnpm workspace). 한국 투자·시장 데이터 관련 pi 패키지를
브로커/도메인 단위로 분리해 개발·배포한다.

## 패키지

| 패키지 | 내용 | 설치 |
|---|---|---|
| [pi-kis](packages/pi-kis) | 한국투자증권 OPEN API — 시세·차트·주문·리서치·파생·실시간 (338개 API 스펙) | `pi install npm:pi-kis` |
| [pi-toss](packages/pi-toss) | 토스증권 OPEN API — 시세·시장 데이터·자산·주문·조건주문 | `pi install npm:pi-toss` |
| [pi-twelve-data](packages/pi-twelve-data) | Twelve Data (공식 API) — 전 세계 주식·지수·외환·암호 시세·차트·검색·환율 (무료 키) | `pi install npm:pi-twelve-data` |
| [pi-finnhub](packages/pi-finnhub) | Finnhub (공식 API) — 미국 주식 시세·차트·뉴스·펀더멘털·컨센서스 (무료 키) | `pi install npm:pi-finnhub` |
| [pi-coingecko](packages/pi-coingecko) | CoinGecko (공식 API) — 암호화폐 시세·차트·시장 랭킹·코인 상세·검색 (무료 키) | `pi install npm:pi-coingecko` |
| [pi-naver-news](packages/pi-naver-news) | 네이버 검색 API (공식 오픈API) — 한국 증권·종목 뉴스 검색 (무료 하루 25,000회) | `pi install npm:pi-naver-news` |
| [pi-finance-core](packages/pi-finance-core) | 공용 라이브러리(기술적 지표·시크릿 스토어) + **공용 스킬**(kis-timing — 차트분석·타점). pi-kis/pi-toss가 번들(bundledDependencies)로 포함 | 직접 설치 불필요 (자동 의존) |

- **pi-kis v0.3.0부터 토스증권이 pi-toss로 분리** — 두 브로커를 모두 쓰려면 두 패키지를
  모두 설치하세요. 키 저장소는 공용이라 재등록이 필요 없습니다.
- **무료 시장 데이터 3종 (pi-twelve-data / pi-finnhub / pi-coingecko)** — 공식 API 기반,
  각각 무료 키 등록 후 사용 (`/twelve-key`, `/finnhub-key`, `/coingecko-key`). 리서치·스크리닝용이며
  실시간·주문은 pi-kis / pi-toss를 사용하세요. kis-timing 스킬이 이들의 차트 툴도 지원합니다.
- **공용 스킬은 core가 번들로 제공** — pi-kis/pi-toss 어느 쪽을 설치해도 kis-timing(차트분석) 스킬이
  따라옵니다 (core를 직접 `pi install`할 필요 없음).
- **스킬 네이밍 규칙 (필수)**: 모든 스킬 이름은 `{패키지}-{기능}` 접두사를 붙인다 (예: `kis-trading`,
  `kis-timing`, `kis-stock-research`, `kis-sector-research`). prefix 덕분에 **각 패키지가 같은 기능
  이름을 가져도 충돌하지 않는다** (예: pi-toss가 자체 타점 스킬을 만들면 `toss-timing` — `kis-timing`과
  공존 가능). 새 스킬 추가 시 반드시 패키지 이름을 접두사로 붙일 것.
- 향후 finance 패키지(스크리너·리포트·자산관리 등)도 `packages/*`에 추가 예정.

## 구조

```
packages/*           — npm 배포 단위 (각자 독립 버저닝·태그·publish)
tsconfig.base.json   — 공용 TS 설정 (Node 타입 스트리핑, 빌드 없음)
.github/workflows/   — bump-and-release (변경 패키지 감지 → pnpm publish, topo 순서)
```

## 에이전트 협업 — 툴 발견·디버깅

`kis_*`/`toss_*`/`broker_*` 툴은 **MCP가 아닌 네이티브 pi 툴**입니다 (MCP 게이트웨이에서 조회 불가).
파라미터 확인 순서: 세션 툴 스키마 → `packages/<pkg>/src/agent/tools.ts`(검증·에러 원본) → `src/roles/*.ts`(구현).
자세한 가이드는 **각 패키지 README에 포함** — 설치본(`pi install npm:...`)에도 그대로 들어갑니다.

## 개발

```bash
pnpm install        # 루트에서 1회 (workspace 링크 + 의존성)
pnpm typecheck      # 전체 패키지 타입체크 (tsc --noEmit)
```

로컬에서 pi에 바로 물려 테스트:

```bash
pi install /absolute/path/to/packages/pi-kis
pi install /absolute/path/to/packages/pi-toss
# (로컬 경로 설치는 소스를 그대로 로드 — 개발 중엔 설정 파일을 직접 수정해도 됨)
```

## CI

- **`ci.yml`** — PR + main push 시 패키지별 잡(매트릭스)으로 typecheck / 스모크 테스트
  (확장 툴·커맨드 계약 검증) / tarball 검증(`workspace:*` 미치환 감지) 실행.
  GitHub Actions는 루트 `.github/workflows/`만 읽으므로 패키지별 CI는 잡 단위로 구성.
- 스모크 테스트: `packages/*/scripts/smoke.mjs` (`node --experimental-transform-types`)

## 릴리스 (패키지별 자동)

각 패키지가 자기만의 release 워크플로를 가진다 (`packages/<pkg>/**` 변경 시 해당
패키지만 자동 릴리스, Actions 탭에서 수동 dispatch도 가능):

| 워크플로 | 동작 |
|---|---|
| [release-pi-kis.yml](.github/workflows/release-pi-kis.yml) | typecheck → 스모크 → 범프 → `pi-kis@V` 태그 → npm publish → GitHub Release |
| [release-pi-toss.yml](.github/workflows/release-pi-toss.yml) | 동일 (pi-toss) |
| [release-pi-finance-core.yml](.github/workflows/release-pi-finance-core.yml) | 동일 (core — 스모크 없음) |

- **버전 규칙**: 커밋 메시지 기반(`BREAKING`/`!: `→ major, `feat`→minor, `fix`→patch),
  패키지 태그(`pi-kis@*`) 이후 해당 패키지를 건드린 커밋만 본다.
- **첫 릴리스**: 패키지 태그가 없으면 현재 package.json 버전을 그대로 publish
  (범프 없음). 단, pi-kis는 0.2.1이 이미 npm에 있으므로 **0.3.0으로 올린 뒤**
  첫 push해야 한다 (수동 수정 + `[skip ci]` 커밋, 또는 dispatch에서 bump=minor).
- **순서**: 워크스페이스 의존(pi-finance-core)이 이미 npm에 있어야 kis/toss가
  설치 가능 — core를 먼저 릴리스한다 (core 변경 없이 kis만 릴리스해도 core@0.1.0이
  npm에 있으면 정상). 병렬 릴리스는 `git pull --rebase`로 직렬화, pnpm-lock.yaml은
  워크스페이스 버전을 기록하지 않아 충돌 없음.
- **publish**: 반드시 `pnpm publish` (`npm publish`는 workspace:* 미치환).
  이미 게시된 버전은 스킵되므로 재실행 안전.

> ⚠️ 모노레포 루트는 `pi` manifest가 없으므로 `pi install git:github.com/preinpost/pi-finances`는
> 동작하지 않는다 — 반드시 npm 레지스트리에서 설치할 것.
